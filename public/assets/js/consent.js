// Ad and visit measurement with Google (Google Ads + Analytics), only after the visitor agrees.
// Nothing is loaded or sent to Google before "Accept" (DPDP Act / GDPR). Health details are never sent.
// Events: book_appointment (online booking confirmed), booking_request (WhatsApp booking request),
// whatsapp_click and call_click. Mark them as key events in Analytics and import them into Google Ads,
// or paste Google Ads conversion labels below ("AW-969590760/AbCdEf…") to send them directly.
(() => {
  "use strict";
  const CONFIG = {
    ads: "AW-969590760",        // Google Ads tag (same account tag as the old tailbonetreatment.com site)
    analytics: "G-HTE5TE5B9K",  // Google Analytics 4
    conversions: { book_appointment: "", booking_request: "", whatsapp_click: "", call_click: "" },
  };
  const KEY = "tb_consent";
  const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
  const save = (v) => { try { localStorage.setItem(KEY, v); } catch { /* private mode: ask again next visit */ } };

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  gtag("consent", "default", { ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", analytics_storage: "denied" });

  let loaded = false;
  function load() {
    if (loaded || !(CONFIG.analytics || CONFIG.ads)) return;
    loaded = true;
    gtag("consent", "update", { ad_storage: "granted", ad_user_data: "granted", ad_personalization: "denied", analytics_storage: "granted" });
    const s = document.createElement("script");
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(CONFIG.analytics || CONFIG.ads)}`;
    document.head.appendChild(s);
    gtag("js", new Date());
    if (CONFIG.analytics) gtag("config", CONFIG.analytics);
    if (CONFIG.ads) gtag("config", CONFIG.ads);
  }

  /** Record a measurement event (no-op without consent). Never pass names, phone numbers or health details. */
  window.tbTrack = (name, params = {}) => {
    if (read() !== "granted") return;
    gtag("event", name, params);
    const sendTo = CONFIG.conversions[name];
    if (sendTo) gtag("event", "conversion", { send_to: sendTo, value: params.value, currency: params.currency, transaction_id: params.transaction_id });
  };

  // ---- Banner ----
  let banner;
  function showBanner() {
    if (banner) { banner.hidden = false; banner.querySelector("button").focus(); return; }
    banner = document.createElement("div");
    banner.className = "cookie-bar";
    banner.setAttribute("role", "region");
    banner.setAttribute("aria-label", "Cookie choices");
    banner.innerHTML = document.documentElement.lang.startsWith("hi")
      ? `<p>क्या हम Google कुकीज़ से यह जान सकते हैं कि हमारे कौन-से विज्ञापन और पेज मरीज़ों को हम तक पहुँचाते हैं? कोई स्वास्थ्य जानकारी साझा नहीं होती। <a href="/privacy.html#cookies">और जानें</a></p>
      <div class="cookie-bar__actions"><button type="button" class="btn btn--primary btn--sm" data-consent="granted">हाँ, ठीक है</button><button type="button" class="btn btn--ghost btn--sm" data-consent="denied">नहीं, धन्यवाद</button></div>`
      : `<p>May we use Google cookies to see which of our ads and pages help patients find us? No health details are shared. <a href="/privacy.html#cookies">Learn more</a></p>
      <div class="cookie-bar__actions"><button type="button" class="btn btn--primary btn--sm" data-consent="granted">Accept</button><button type="button" class="btn btn--ghost btn--sm" data-consent="denied">No thanks</button></div>`;
    banner.addEventListener("click", (e) => {
      const b = e.target.closest("[data-consent]");
      if (!b) return;
      const choice = b.dataset.consent;
      const before = read();
      save(choice);
      banner.hidden = true;
      if (choice === "granted") load();
      else if (before === "granted") location.reload(); // stop measurement on this page too
    });
    document.body.appendChild(banner);
  }

  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-cookie-settings]")) { e.preventDefault(); showBanner(); return; }
    const a = e.target.closest("a[href]");
    if (!a) return;
    if (a.href.startsWith("https://wa.me/")) window.tbTrack("whatsapp_click", { link_url: location.pathname });
    else if (a.protocol === "tel:") window.tbTrack("call_click", { link_url: location.pathname });
  });

  const start = () => {
    const choice = read();
    if (choice === "granted") load();
    else if (!choice) showBanner();
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
