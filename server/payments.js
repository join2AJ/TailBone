import crypto from "node:crypto";

// Razorpay integration (Orders API + Checkout + Route split + Refunds + Webhooks).
// Docs: https://razorpay.com/docs/api/  ·  Route: https://razorpay.com/docs/payments/route/
// Payments are switched on only when RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are set.

const API = "https://api.razorpay.com/v1";

const keys = () => ({
  keyId: process.env.RAZORPAY_KEY_ID || "",
  keySecret: process.env.RAZORPAY_KEY_SECRET || "",
  webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || "",
});

export const paymentsEnabled = () => {
  if (process.env.DEMO_MODE === "true") return false;
  const k = keys();
  return !!(k.keyId && k.keySecret);
};
export const publicKeyId = () => keys().keyId;

// Swappable HTTP client so tests never hit the real API.
let httpClient = async (method, path, body) => {
  const { keyId, keySecret } = keys();
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
      "content-type": "application/json",
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
  return httpClient("POST", "/orders", body);
}

/**
 * Refund a payment. `reverse_all` pulls the doctor's transferred share back proportionally,
 * so the platform isn't left paying the doctor's part of a refund.
 */
export function refundPayment(paymentId, amount, { reason, split = false } = {}) {
  const body = { amount, speed: "normal", notes: { reason: String(reason || "").slice(0, 250) } };
  if (split) body.reverse_all = 1;
  return httpClient("POST", `/payments/${encodeURIComponent(paymentId)}/refund`, body);
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
