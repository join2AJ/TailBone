// Privacy-rights request form (DPDP / GDPR).
(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const form = $("#reqForm");

  // Allow deep links like privacy.html?request=erasure#request
  const pre = new URLSearchParams(location.search).get("request");
  if (pre && form.type.querySelector(`option[value="${CSS.escape(pre)}"]`)) form.type.value = pre;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#reqErr");
    err.hidden = true;
    const body = Object.fromEntries(new FormData(form));
    const btn = e.submitter;
    btn.disabled = true;
    try {
      const res = await fetch("/api/privacy/request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't send. Please email contact@tailbonetreatment.com.");
      form.hidden = true;
      const done = $("#reqDone");
      done.hidden = false;
      done.textContent = `Request received. Your reference is ${data.ref}. We'll reply by ${new Date(data.due).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}.`;
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      btn.disabled = false;
    }
  });
})();
