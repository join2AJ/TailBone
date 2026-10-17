// Fill the policy page with the clinic's current fees and rules (static defaults stay if the API is unreachable).
(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const rupee = (n) => `₹${Number(n).toLocaleString("en-IN")}`;
  const fill = (list, lines) => {
    const ul = $(list);
    ul.replaceChildren(...lines.map((t) => Object.assign(document.createElement("li"), { textContent: t })));
  };

  fetch("/api/config")
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((cfg) => {
      const fees = (cfg.clinics || []).filter((c) => c.status === "open").map((c) =>
        c.id === "online" ? `Online video consultation: ${rupee(cfg.fees.online)}` : `Consultation in ${c.short}: ${rupee(cfg.fees[c.id])}`);
      if (cfg.followup.windowDays) fees.push(`Follow-up / review visit within ${cfg.followup.windowDays} days of a completed visit: ${rupee(cfg.followup.fee)}`);
      fill("#feeList", fees);
      fill("#cancelList", cfg.policy.cancellation);
      $("#reschedText").textContent = cfg.policy.reschedule;
      if (cfg.policyUpdatedAt) {
        const when = new Date(cfg.policyUpdatedAt).toLocaleString("en-IN", { day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
        $("#policyUpdated").textContent = `Fees and rules last updated: ${when} IST.`;
      }
    })
    .catch(() => {});
})();
