import crypto from "node:crypto";

// Razorpay integration (Orders API + Checkout + Route split + Refunds + Webhooks).
// Docs: https://razorpay.com/docs/api/  ·  Route: https://razorpay.com/docs/payments/route/
// Payments are switched on only when RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are set.
// The demo (DEMO_MODE=true) uses a built-in pretend gateway instead: the same steps and checks, but no money moves.

const API = "https://api.razorpay.com/v1";

export const isDemoPayments = () => process.env.DEMO_MODE === "true";
const DEMO_SECRET = "demo-gateway-secret";

const keys = () => (isDemoPayments()
  ? { keyId: "rzp_demo", keySecret: DEMO_SECRET, webhookSecret: "" }
  : { keyId: process.env.RAZORPAY_KEY_ID || "", keySecret: process.env.RAZORPAY_KEY_SECRET || "", webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || "" });

export const paymentsEnabled = () => {
  const k = keys();
  return !!(k.keyId && k.keySecret);
};
export const publicKeyId = () => keys().keyId;

/** "live", "test", "demo" or "off", for the dashboard (test keys start rzp_test_, live keys rzp_live_). */
export function paymentMode() {
  if (isDemoPayments()) return "demo";
  const { keyId, keySecret } = keys();
  if (!keyId || !keySecret) return "off";
  return keyId.startsWith("rzp_live_") ? "live" : "test";
}
export const webhookConfigured = () => !!keys().webhookSecret;

// Swappable HTTP client so tests never hit the real API.
let httpClient = async (method, path, body, extraHeaders = {}) => {
  const { keyId, keySecret } = keys();
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
      "content-type": "application/json",
      ...extraHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.description || `Payment provider error (${res.status})`;
    throw Object.assign(new Error(msg), { status: 502 });
  }
  return data;
};
export function setPaymentClient(fn) {
  httpClient = fn;
}

// The demo's pretend gateway: keeps orders in memory and answers like Razorpay does.
const demoOrders = new Map();
const demoId = (prefix) => `${prefix}_demo${crypto.randomBytes(6).toString("hex")}`;
async function demoClient(method, path, body) {
  if (method === "POST" && path === "/orders") {
    const order = { id: demoId("order"), entity: "order", amount: body.amount, currency: body.currency, receipt: body.receipt, status: "created", payments: [] };
    demoOrders.set(order.id, order);
    if (demoOrders.size > 5000) demoOrders.delete(demoOrders.keys().next().value);
    return order;
  }
  let m;
  if (method === "GET" && (m = /^\/orders\/([\w]+)\/payments$/.exec(path))) return { entity: "collection", items: demoOrders.get(m[1])?.payments || [] };
  if (method === "GET" && (m = /^\/payments\/([\w]+)$/.exec(path))) {
    const pay = [...demoOrders.values()].flatMap((o) => o.payments).find((x) => x.id === m[1]);
    if (pay) return pay;
  }
  if (method === "POST" && /^\/payments\/[\w]+\/refund$/.test(path)) return { id: demoId("rfnd"), entity: "refund", amount: body.amount, status: "processed" };
  throw Object.assign(new Error("The demo gateway doesn't support that."), { status: 502 });
}
const client = (...args) => (isDemoPayments() ? demoClient(...args) : httpClient(...args));

/**
 * Demo only: what Razorpay Checkout hands the browser after a successful payment (ids and a valid signature),
 * so the demo goes through exactly the same verification as a real payment.
 */
export function demoPay(orderId, method = "upi") {
  if (!isDemoPayments()) throw Object.assign(new Error("Not available."), { status: 404 });
  const order = demoOrders.get(orderId);
  if (!order) throw Object.assign(new Error("This demo payment has expired. Please start again."), { status: 404 });
  const paymentId = demoId("pay");
  order.payments.push({ id: paymentId, entity: "payment", amount: order.amount, currency: order.currency, status: "captured", method, order_id: orderId });
  order.status = "paid";
  return { orderId, paymentId, signature: crypto.createHmac("sha256", DEMO_SECRET).update(`${orderId}|${paymentId}`).digest("hex") };
}

/** One payment, straight from Razorpay: its order, amount, currency and status (captured, authorized, failed…). */
export const fetchPayment = (paymentId) => client("GET", `/payments/${encodeURIComponent(paymentId)}`);

/**
 * Capture an authorised payment. Needed only if the Razorpay account is set to capture payments manually; otherwise
 * Razorpay would refund the money by itself after a few days while the booking showed as paid.
 */
export const capturePayment = (paymentId, amount) => client("POST", `/payments/${encodeURIComponent(paymentId)}/capture`, { amount, currency: "INR" });

/** Payments made against an order, straight from Razorpay (used when a confirmation from the browser or webhook went missing). */
export async function fetchOrderPayments(orderId) {
  const data = await client("GET", `/orders/${encodeURIComponent(orderId)}/payments`);
  return Array.isArray(data?.items) ? data.items : [];
}

/**
 * Create an order. If a doctor's linked account is given, Razorpay Route automatically
 * transfers `doctorShare` to the doctor once the payment is captured; the rest stays with the platform.
 */
export function createOrder({ amount, receipt, notes, doctorAccountId, doctorShare }) {
  const body = { amount, currency: "INR", receipt, notes, payment_capture: 1 };
  if (doctorAccountId && doctorShare > 0) {
    body.transfers = [{
      account: doctorAccountId,
      amount: doctorShare,
      currency: "INR",
      notes: { purpose: "consultation", receipt },
      on_hold: false,
    }];
  }
  return client("POST", "/orders", body);
}

/**
 * Refund a payment. `reverse_all` pulls the doctor's transferred share back proportionally,
 * so the platform isn't left paying the doctor's part of a refund.
 */
export function refundPayment(paymentId, amount, { reason, split = false, idempotencyKey } = {}) {
  const body = { amount, speed: "normal", notes: { reason: String(reason || "").slice(0, 250) } };
  if (split) body.reverse_all = 1;
  // The same key on a retry makes Razorpay return the first refund instead of refunding twice.
  return client("POST", `/payments/${encodeURIComponent(paymentId)}/refund`, body, idempotencyKey ? { "X-Refund-Idempotency": idempotencyKey } : {});
}

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/** Signature returned by Checkout: HMAC_SHA256(order_id + "|" + payment_id, key_secret). */
export function verifyCheckoutSignature({ orderId, paymentId, signature }) {
  const expected = crypto.createHmac("sha256", keys().keySecret).update(`${orderId}|${paymentId}`).digest("hex");
  return safeEqual(expected, signature);
}

/** Webhook signature: HMAC_SHA256(raw body, webhook secret) in the X-Razorpay-Signature header. */
export function verifyWebhookSignature(rawBody, signature) {
  const { webhookSecret } = keys();
  if (!webhookSecret || !signature) return false;
  const expected = crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
  return safeEqual(expected, signature);
}

export const rupees = (paise) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
