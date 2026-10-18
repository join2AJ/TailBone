// Payment receipt: shown over the page and printed (or saved as PDF) on its own. Used by My appointments and the dashboard.
(() => {
  "use strict";
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const rupees = (paise) => `₹${(Number(paise || 0) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const when = (ts) => new Date(/[zZ]$/.test(ts) ? ts : `${String(ts).replace(" ", "T")}Z`)
    .toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

  function html(r) {
    const refunds = r.refunds.map((f) => `<tr><td>Refund ${f.status === "processed" ? "" : `(${esc(f.status)})`} · ${esc(when(f.created_at))}</td><td class="num">− ${rupees(f.amount)}</td></tr>`).join("");
    return `
      <div class="receipt__head">
        <img src="/assets/img/logo.svg" alt="" width="44" height="44">
        <div><strong>${esc(r.issuer.name)}</strong><small>${esc(r.issuer.practitioner)} · ${esc(r.issuer.address)}<br>${esc(r.issuer.phone)} · ${esc(r.issuer.email)}</small></div>
      </div>
      <h2 class="receipt__title">Payment receipt</h2>
      <dl class="receipt__meta">
        <dt>Receipt no.</dt><dd>${esc(r.receiptNo)}</dd>
        <dt>Date</dt><dd>${esc(when(r.issuedAt))}</dd>
        <dt>Patient</dt><dd>${esc(r.patient.name)}${r.patient.code ? ` (${esc(r.patient.code)})` : ""}</dd>
        <dt>Appointment no.</dt><dd>${esc(r.appointment.no)}</dd>
        <dt>Visit</dt><dd>${esc(r.appointment.when)} · ${esc(r.appointment.clinic)}</dd>
      </dl>
      <table class="receipt__table">
        <thead><tr><th scope="col">Description</th><th scope="col" class="num">Amount</th></tr></thead>
        <tbody>
          <tr><td>${esc(r.service)}</td><td class="num">${rupees(r.fee)}</td></tr>
          <tr><td>Paid · ${esc(r.method)}${r.paymentId ? `<br><small>Payment ID ${esc(r.paymentId)}</small>` : ""}</td><td class="num">${rupees(r.paid)}</td></tr>
          ${refunds}
        </tbody>
        <tfoot><tr><th scope="row">Net amount paid</th><td class="num"><strong>${rupees(r.net)}</strong></td></tr></tfoot>
      </table>
      <p class="receipt__note">This is a computer-generated receipt and needs no signature. Thank you for choosing ${esc(r.issuer.name)}.</p>`;
  }

  /** Show the receipt over the page, with Print / save as PDF and Close. */
  function show(r) {
    document.querySelector(".receipt-sheet")?.remove();
    const sheet = document.createElement("div");
    sheet.className = "receipt-sheet";
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-label", `Payment receipt ${r.receiptNo}`);
    sheet.innerHTML = `<div class="receipt">${html(r)}
      <div class="receipt__actions"><button type="button" class="btn btn--primary btn--sm" data-r="print">Print / save as PDF</button>
      <button type="button" class="btn btn--ghost btn--sm" data-r="close">Close</button></div></div>`;
    const close = () => { sheet.remove(); document.body.classList.remove("print-receipt"); document.removeEventListener("keydown", onKey); };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    sheet.querySelector('[data-r="print"]').addEventListener("click", () => { document.body.classList.add("print-receipt"); window.print(); });
    sheet.querySelector('[data-r="close"]').addEventListener("click", close);
    sheet.addEventListener("click", (e) => { if (e.target === sheet) close(); });
    document.addEventListener("keydown", onKey);
    window.addEventListener("afterprint", () => document.body.classList.remove("print-receipt"), { once: true });
    document.body.append(sheet);
    sheet.querySelector('[data-r="print"]').focus();
  }

  window.TBReceipt = { html, show };
})();
