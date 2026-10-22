// The payment window, shared by the booking page and My appointments.
// With real keys it opens Razorpay Checkout (UPI, cards, net banking, wallets). On the demo site it opens a pretend
// window that goes through the same server checks, so the whole journey can be tried without any money moving.
(() => {
  "use strict";
  let loading = null;
  const loadRazorpay = () => {
    if (window.Razorpay) return Promise.resolve();
    loading ??= new Promise((resolve, reject) => {
      const sc = document.createElement("script");
      sc.src = "https://checkout.razorpay.com/v1/checkout.js";
      sc.onload = resolve;
      sc.onerror = () => { loading = null; reject(new Error("Couldn't load the payment window. Check your connection and try again.")); };
      document.head.appendChild(sc);
    });
    return loading;
  };
  const rupees = (paise) => `₹${(paise / 100).toLocaleString("en-IN")}`;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function demoWindow(p, { onSuccess, onFailure, onDismiss }) {
    const box = document.createElement("dialog");
    box.className = "paydemo";
    box.setAttribute("aria-labelledby", "paydemoTitle");
    box.innerHTML = `<form method="dialog" class="paydemo__card">
        <div class="paydemo__head"><strong id="paydemoTitle">${esc(p.name)}</strong><span>${esc(p.description)}</span></div>
        <p class="paydemo__badge">Demo payment: no money is taken</p>
        <p class="paydemo__amount">${rupees(p.amount)}</p>
        <fieldset class="paydemo__methods"><legend>Pay with</legend>
          <label><input type="radio" name="m" value="upi" checked> UPI (GPay, PhonePe, Paytm)</label>
          <label><input type="radio" name="m" value="card"> Debit or credit card</label>
          <label><input type="radio" name="m" value="netbanking"> Net banking</label>
        </fieldset>
        <button type="button" class="btn btn--primary btn--block" data-pay>Pay ${rupees(p.amount)}</button>
        <div class="paydemo__more">
          <button type="button" class="linkish" data-fail>Try a failed payment</button>
          <button type="button" class="linkish" data-cancel>Cancel</button>
        </div>
        <p class="paydemo__note">On the real site this is Razorpay's secure window.</p>
      </form>`;
    document.body.append(box);
    let settled = false;
    const done = (fn, arg) => { settled = true; box.close(); box.remove(); fn?.(arg); };
    box.querySelector("[data-pay]").addEventListener("click", async (e) => {
      e.target.disabled = true;
      e.target.textContent = "Processing…";
      try {
        const res = await fetch("/api/payments/demo-pay", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderId: p.orderId, method: box.querySelector("input[name=m]:checked").value }) });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || "Payment failed.");
        done(onSuccess, { razorpay_order_id: d.orderId, razorpay_payment_id: d.paymentId, razorpay_signature: d.signature });
      } catch (err) { done(onFailure, err.message); }
    });
    box.querySelector("[data-fail]").addEventListener("click", () => done(onFailure, "Your bank declined the payment (demo)"));
    box.querySelector("[data-cancel]").addEventListener("click", () => done(onDismiss));
    box.addEventListener("close", () => { if (!settled) { box.remove(); onDismiss?.(); } });
    box.showModal();
  }

  /**
   * Open the payment window for an order from our server (`p`: keyId, orderId, amount, currency, name, description, prefill, demo).
   * Callbacks: onSuccess(response with razorpay_order_id / _payment_id / _signature), onFailure(message), onDismiss().
   */
  async function checkout(p, handlers) {
    if (p.demo) { demoWindow(p, handlers); return; }
    await loadRazorpay();
    const secondsLeft = p.expiresAt ? Math.floor((Date.parse(p.expiresAt) - Date.now()) / 1000) : 0;
    const rzp = new window.Razorpay({
      ...(secondsLeft > 0 ? { timeout: Math.max(60, secondsLeft) } : {}),
      key: p.keyId, amount: p.amount, currency: p.currency, name: p.name, description: p.description, order_id: p.orderId,
      prefill: p.prefill, theme: { color: "#16a34a" },
      handler: (resp) => handlers.onSuccess(resp),
      modal: { ondismiss: () => handlers.onDismiss?.(), confirm_close: true },
      retry: { enabled: true },
    });
    rzp.on("payment.failed", (resp) => handlers.onFailure?.(resp.error?.description || "The payment didn't go through"));
    rzp.open();
  }

  /** Send the window's success response to our server, which checks the signature and records the payment. */
  async function verify(resp) {
    const res = await fetch("/api/payments/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderId: resp.razorpay_order_id, paymentId: resp.razorpay_payment_id, signature: resp.razorpay_signature }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || "We couldn't confirm the payment. If money was taken, it will show here within a few minutes."), { status: res.status });
    return data;
  }

  window.TBPay = { checkout, verify };
})();
