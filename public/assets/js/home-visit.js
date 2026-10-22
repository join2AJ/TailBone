// Doctor at your place: the request form (dates must start at least 7 days ahead).
(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const form = $("#hvForm");
  if (!form) return;
  const err = $("#hvErr");
  const showErr = (msg) => { err.textContent = msg; err.hidden = false; err.scrollIntoView({ block: "center", behavior: "smooth" }); };
  const pretty = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "long", timeZone: "UTC" });

  fetch("/api/home-visits/rules").then((r) => (r.ok ? r.json() : Promise.reject())).then((d) => {
    if (!d.enabled) { form.hidden = true; $("#hvClosed").hidden = false; return; }
    form.dateFrom.min = d.earliest;
    form.dateTo.min = d.earliest;
    $("#hvEarliest").textContent = `The first date must be at least ${d.minDays} days from today: ${pretty(d.earliest)} or later.`;
  }).catch(() => {
    // Without the server, requests go by WhatsApp instead.
    $("#hvEarliest").textContent = "The first date must be at least 7 days from today. Your request opens in WhatsApp.";
    form.dataset.offline = "1";
  });
  form.dateFrom.addEventListener("change", () => { form.dateTo.min = form.dateFrom.value; if (!form.dateTo.value || form.dateTo.value < form.dateFrom.value) form.dateTo.value = form.dateFrom.value; });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.hidden = true;
    const body = Object.fromEntries(new FormData(form));
    body.agree = form.agree.checked;
    body.consent = form.consent.checked;
    if (!body.name.trim() || !body.phone.trim() || !body.city.trim()) return showErr("Please fill in your name, mobile number and the city.");
    if (!body.dateFrom || !body.dateTo) return showErr("Please choose the dates you'd like.");
    if (form.dateFrom.min && body.dateFrom < form.dateFrom.min) return showErr(`Please choose a first date of ${pretty(form.dateFrom.min)} or later, so the doctor can plan.`);
    if (!body.agree) return showErr("Please tick to confirm you'll cover the fees, travel, meals and stay.");
    if (!body.consent) return showErr("Please tick to agree to the privacy notice so we can contact you.");
    if (form.dataset.offline) {
      const text = `Hi Dr Rajveer, I'd like to request a visit to ${body.city} from ${body.dateFrom} to ${body.dateTo} for ${body.patients} patient(s). Name: ${body.name}. Phone: ${body.phone}.${body.details ? ` ${body.details}` : ""}`;
      window.open(`https://wa.me/919886688323?text=${encodeURIComponent(text)}`, "_blank", "noopener");
      return;
    }
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      const res = await fetch("/api/home-visits", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Something went wrong. Please try again or WhatsApp us.");
      form.hidden = true;
      $("#hvRef").textContent = d.ref;
      $("#hvWa").href = d.whatsappUrl;
      $("#hvDone").hidden = false;
      $("#hvDone").focus();
    } catch (ex) { showErr(ex.message); } finally { btn.disabled = false; }
  });
})();
