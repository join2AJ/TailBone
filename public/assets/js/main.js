(() => {
  "use strict";

  // Wake the booking server while the visitor reads, so booking is instant even if the server was idle.
  // Once per browser tab; sends nothing about the visitor.
  try {
    if (!sessionStorage.getItem("tbWarm")) {
      sessionStorage.setItem("tbWarm", "1");
      const ping = () => fetch("/api/health", { cache: "no-store" }).catch(() => {});
      ("requestIdleCallback" in window) ? requestIdleCallback(ping, { timeout: 3000 }) : setTimeout(ping, 1500);
    }
    // Remember which ad or link brought the visitor (this tab only) and any referral code (30 days), for the booking form.
    const q = new URLSearchParams(location.search);
    if (!sessionStorage.getItem("tbLanding")) sessionStorage.setItem("tbLanding", location.pathname);
    if (q.get("utm_source") || q.get("gclid")) {
      sessionStorage.setItem("tbAttr", JSON.stringify({ source: q.get("utm_source") || "", medium: q.get("utm_medium") || "", campaign: q.get("utm_campaign") || "", gclid: q.get("gclid") ? 1 : 0, landing: location.pathname }));
    }
    if (/^[A-Za-z0-9-]{4,12}$/.test(q.get("ref") || "") && !/^TB/i.test(q.get("ref"))) localStorage.setItem("tbRef", JSON.stringify({ code: q.get("ref"), at: Date.now() }));
  } catch { /* storage unavailable */ }

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const WA_NUMBER = "919886688323";
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---- Theme (initial value is set inline in <head> to avoid a flash) ----
  const root = document.documentElement;
  $("#themeToggle")?.addEventListener("click", () => {
    root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
    try { localStorage.setItem("theme", root.dataset.theme); } catch { /* storage unavailable */ }
  });

  // ---- Mobile nav ----
  const nav = $("#nav");
  const burger = $("#burger");
  const setNav = (open) => {
    nav.classList.toggle("is-open", open);
    burger.setAttribute("aria-expanded", String(open));
    burger.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  };
  burger.addEventListener("click", () => setNav(!nav.classList.contains("is-open")));
  $$("a", nav).forEach((a) => a.addEventListener("click", () => setNav(false)));
  document.addEventListener("click", (e) => {
    if (nav.classList.contains("is-open") && !nav.contains(e.target) && !burger.contains(e.target)) setNav(false);
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { setNav(false); setWa(false); } });

  // ---- Header shadow, progress bar, active link ----
  const header = $("#header");
  const progress = $("#progress");
  const onScroll = () => {
    const y = window.scrollY;
    header.classList.toggle("is-scrolled", y > 10);
    const max = document.documentElement.scrollHeight - window.innerHeight;
    progress.style.width = `${max > 0 ? (y / max) * 100 : 0}%`;
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // Active menu item is set by router.js for the current page.

  // ---- Reveal on scroll ----
  const revealer = new IntersectionObserver((entries, obs) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      obs.unobserve(entry.target);
    });
  }, { threshold: 0.12 });
  $$(".reveal").forEach((el, i) => {
    el.style.transitionDelay = `${(i % 4) * 70}ms`;
    revealer.observe(el);
  });

  // ---- Animated counters ----
  const formatter = new Intl.NumberFormat("en-IN");
  const counter = new IntersectionObserver((entries, obs) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      const target = Number(el.dataset.count);
      const suffix = el.dataset.suffix || "";
      obs.unobserve(el);
      if (reduceMotion) { el.textContent = formatter.format(target) + suffix; return; }
      const start = performance.now();
      const dur = 1600;
      const tick = (now) => {
        const p = Math.min((now - start) / dur, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        el.textContent = formatter.format(Math.round(target * eased)) + suffix;
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }, { threshold: 0.6 });
  $$("[data-count]").forEach((el) => counter.observe(el));

  // ---- Open / closed status (clinic time, IST) ----
  const HOURS = { 0: [8, 15], 1: [10, 17], 2: [10, 17], 3: [10, 17], 4: [10, 17], 5: [10, 17], 6: [10, 15] };
  const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const istNow = () => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Kolkata", weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23",
    }).formatToParts(new Date());
    const get = (t) => parts.find((p) => p.type === t).value;
    const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
    return { day, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
  };
  const fmtHour = (h) => `${((h + 11) % 12) + 1} ${h < 12 ? "AM" : "PM"}`;
  const updateStatus = () => {
    const { day, minutes } = istNow();
    const [open, close] = HOURS[day];
    const isOpen = minutes >= open * 60 && minutes < close * 60;
    const status = $("#openStatus");
    status.classList.toggle("is-open", isOpen);
    status.classList.toggle("is-closed", !isOpen);
    let text;
    if (isOpen) {
      text = `Open now · until ${fmtHour(close)} IST · by appointment`;
    } else if (minutes < open * 60) {
      text = `Closed · opens today at ${fmtHour(open)} IST`;
    } else {
      const next = (day + 1) % 7;
      text = `Closed · opens ${DAY_NAMES[next]} at ${fmtHour(HOURS[next][0])} IST`;
    }
    $(".status__text", status).textContent = text;
    $$("#hoursList li").forEach((li) => li.classList.toggle("is-today", Number(li.dataset.day) === day));
  };
  updateStatus();
  setInterval(updateStatus, 60_000);

  // ---- Symptom checker ----
  // Each page now ships only its own sections (see scripts/build-pages.js), so every feature below
  // runs only where its markup exists.
  const symptomForm = $("#symptomForm");
  if (symptomForm) {
  const boxes = $$("input", symptomForm);
  const maxScore = boxes.reduce((s, b) => s + Number(b.value), 0);
  symptomForm.addEventListener("change", () => {
    const score = boxes.filter((b) => b.checked).reduce((s, b) => s + Number(b.value), 0);
    const pct = Math.round((score / maxScore) * 100);
    const bar = $("#meterBar");
    bar.style.width = `${pct}%`;
    bar.style.backgroundPosition = `${100 - pct}% 0`;
    const result = $("#checkerResult");
    const cta = $("#checkerCta");
    if (score === 0) {
      result.textContent = "Select the symptoms that apply to you.";
      cta.hidden = true;
    } else if (score <= 3) {
      result.textContent = "A few signs of coccyx irritation. Try the self-care tips below, and get checked if it lasts more than a few weeks.";
      cta.hidden = false;
    } else if (score <= 6) {
      result.textContent = "Your symptoms are typical of coccydynia. A specialist assessment can pinpoint the cause.";
      cta.hidden = false;
    } else {
      result.textContent = "Many classic coccydynia signs. We'd recommend booking a consultation soon, in person or online.";
      cta.hidden = false;
    }
  });

  }

  const escapeHtml = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---- Testimonials carousel ----
  const track = $("#track");
  if (track) {
  let slides = $$(".quote", track);
  const dotsWrap = $("#dots");
  const perView = () => {
    const w = slides[0].getBoundingClientRect().width;
    return w ? Math.max(1, Math.round(track.clientWidth / w)) : 1;
  };
  const pageCount = () => Math.ceil(slides.length / perView());
  const currentPage = () => (track.clientWidth ? Math.round(track.scrollLeft / track.clientWidth) : 0);
  const goTo = (page) => {
    if (!track.clientWidth) return; // carousel's page isn't showing
    const n = pageCount();
    const p = ((page % n) + n) % n;
    const slide = slides[Math.min(p * perView(), slides.length - 1)];
    track.scrollTo({ left: slide.offsetLeft - track.offsetLeft, behavior: reduceMotion ? "auto" : "smooth" });
  };
  const buildDots = () => {
    dotsWrap.innerHTML = "";
    for (let i = 0; i < pageCount(); i++) {
      const b = document.createElement("button");
      b.setAttribute("aria-label", `Show stories page ${i + 1}`);
      b.addEventListener("click", () => goTo(i));
      dotsWrap.appendChild(b);
    }
    syncDots();
  };
  const syncDots = () => {
    const p = currentPage();
    $$("button", dotsWrap).forEach((d, i) => { if (i === p) d.setAttribute("aria-current", "true"); else d.removeAttribute("aria-current"); });
  };
  $("#prev").addEventListener("click", () => goTo(currentPage() - 1));
  $("#next").addEventListener("click", () => goTo(currentPage() + 1));
  track.addEventListener("scroll", () => requestAnimationFrame(syncDots), { passive: true });
  window.addEventListener("resize", buildDots);
  // The carousel has no width while its page is hidden; re-measure when a page is shown.
  window.addEventListener("routechange", () => requestAnimationFrame(buildDots));
  buildDots();

  let autoplay;
  let paused = reduceMotion;
  const startAuto = () => { clearInterval(autoplay); if (!paused) autoplay = setInterval(() => goTo(currentPage() + 1), 6000); };
  const stopAuto = () => clearInterval(autoplay);
  const pauseBtn = $("#carouselPause");
  const syncPause = () => {
    pauseBtn.setAttribute("aria-pressed", String(paused));
    pauseBtn.setAttribute("aria-label", paused ? "Resume automatic scrolling" : "Pause automatic scrolling");
    pauseBtn.textContent = paused ? "▶" : "❚❚";
  };
  pauseBtn.addEventListener("click", () => { paused = !paused; syncPause(); if (paused) stopAuto(); else startAuto(); });
  syncPause();
  const carousel = $("#carousel");
  carousel.addEventListener("mouseenter", stopAuto);
  carousel.addEventListener("mouseleave", startAuto);
  carousel.addEventListener("focusin", stopAuto);
  carousel.addEventListener("touchstart", stopAuto, { passive: true });
  startAuto();

  // Replace the built-in quotes with approved stories from the database, if the API is available.
  fetch("/api/stories?limit=9")
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then(({ stories, total, average }) => {
      if (!stories.length) return;
      track.innerHTML = stories.map((st) => `
        <figure class="quote">
          <blockquote>${st.title ? `<strong class="quote__title">${escapeHtml(st.title)}</strong>` : ""}${escapeHtml(st.body.length > 260 ? `${st.body.slice(0, 257)}…` : st.body)}</blockquote>
          <figcaption><span class="q-avatar">${escapeHtml(st.name[0])}</span><span>${escapeHtml(st.name)}${st.city ? `<small>${escapeHtml(st.city)}</small>` : ""}</span><span class="stars" aria-label="${st.rating} out of 5">${"★".repeat(st.rating)}</span></figcaption>
        </figure>`).join("");
      slides = $$(".quote", track);
      buildDots();
      if (total) $("#storiesMeta").textContent = `${total} patient stories · average ${average}/5 · published with consent. Individual results vary.`;
    })
    .catch(() => { /* static fallback stays */ });

  }

  // ---- Instagram highlights (managed from the dashboard) ----
  const igGrid = $("#igGrid");
  if (igGrid) fetch("/api/media")
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then(({ media }) => {
      if (!media.length) return;
      const follow = $(".ig-follow", igGrid);
      const cards = media.map((m) => {
        const fig = document.createElement("figure");
        fig.className = `ig-card ig-card--${m.kind}`;
        const embed = `${m.url}embed/`;
        fig.innerHTML = `<div class="ig-card__frame"><button class="ig-card__play" type="button" aria-label="Load Instagram ${m.kind}${m.caption ? `: ${escapeHtml(m.caption)}` : ""}">
            <span class="ig-card__icon" aria-hidden="true">${m.kind === "reel" ? "▶" : "◎"}</span><span>${m.kind === "reel" ? "Watch reel" : "View post"}</span></button></div>
          ${m.caption ? `<figcaption>${escapeHtml(m.caption)}</figcaption>` : ""}`;
        // Load Instagram's iframe only on demand: faster pages and no third-party requests until asked.
        $(".ig-card__play", fig).addEventListener("click", () => {
          const iframe = document.createElement("iframe");
          iframe.src = embed;
          iframe.title = m.caption || `Instagram ${m.kind}`;
          iframe.loading = "lazy";
          iframe.allow = "encrypted-media; picture-in-picture";
          iframe.setAttribute("allowtransparency", "true");
          $(".ig-card__frame", fig).replaceChildren(iframe);
        });
        return fig;
      });
      igGrid.replaceChildren(...cards, follow);
      follow.classList.add("is-visible");
    })
    .catch(() => { /* keep the follow card */ });

  // ---- Location tabs + lazy maps ----
  const tabs = $$(".tab");
  const loadMap = (panel) => {
    const holder = $(".loc__map", panel);
    if (!holder || holder.dataset.loaded) return;
    const iframe = document.createElement("iframe");
    iframe.src = holder.dataset.src;
    iframe.title = holder.dataset.title;
    iframe.loading = "lazy";
    iframe.referrerPolicy = "no-referrer-when-downgrade";
    holder.appendChild(iframe);
    holder.dataset.loaded = "1";
  };
  const activateTab = (tab) => {
    tabs.forEach((t) => {
      const active = t === tab;
      t.classList.toggle("is-active", active);
      t.setAttribute("aria-selected", String(active));
      t.tabIndex = active ? 0 : -1;
      const panel = $(`#${t.getAttribute("aria-controls")}`);
      panel.hidden = !active;
      panel.classList.toggle("is-active", active);
      if (active) loadMap(panel);
    });
    const note = $("#tabNote");
    if (note) {
      const status = [...tab.classList].find((c) => c.startsWith("tab--"))?.slice(5) || "open";
      note.dataset.status = status;
      $(".tab-note__status", note).textContent = { open: "Open", visit: "On request", soon: "Opening soon", closed: "Closed" }[status];
      $(".tab-note__text", note).textContent = tab.dataset.note || "";
    }
  };
  tabs.forEach((t, i) => {
    t.addEventListener("click", () => activateTab(t));
    t.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
      next.focus();
      activateTab(next);
    });
  });
  const mapObserver = new IntersectionObserver((entries, obs) => {
    if (entries.some((e) => e.isIntersecting)) {
      loadMap($(".panel.is-active"));
      obs.disconnect();
    }
  }, { rootMargin: "200px" });
  if ($("#locations")) mapObserver.observe($("#locations"));

  // Parts of the site the super admin has switched off. Router-hidden sections stay hidden either way.
  function applyFeatures(features) {
    $$("[data-feature]").forEach((el) => {
      const off = features[el.dataset.feature] === false;
      el.classList.toggle("feature-off", off);
    });
  }

  function showDemoBar() {
    if ($("#demoBar")) return;
    const bar = document.createElement("div");
    bar.id = "demoBar";
    bar.className = "demo-bar";
    bar.setAttribute("role", "region");
    bar.setAttribute("aria-label", "Demo notice");
    bar.innerHTML = '<span><strong>Demo site</strong> · sample data, resets daily · please don\'t enter real health details</span><span class="demo-bar__actions"><a href="/admin?demo=1">Try as doctor (admin)</a><a href="/manage.html?demo=1">Try as patient</a></span>';
    document.body.prepend(bar);
  }

  // Feature switches and the demo bar apply on every page; the booking page also uses the rest of the config.
  if (!$("#apptForm")) {
    fetch("/api/config").then((r) => (r.ok ? r.json() : Promise.reject())).then((cfg) => {
      if (cfg.demo) showDemoBar();
      applyFeatures(cfg.features || {});
      const glance = $("#glanceFees"); // keep the "at a glance" fees in step with the dashboard
      if (glance && cfg.fees) {
        const open = (cfg.clinics || []).filter((c) => c.status === "open").map((c) => c.id);
        const fee = Math.min(...open.map((id) => cfg.fees[id]).filter(Boolean));
        if (Number.isFinite(fee)) glance.textContent = `Consultation ₹${fee} (in clinic or online).${cfg.followup?.windowDays ? ` Follow-up within ${cfg.followup.windowDays} days of a visit ₹${cfg.followup.fee}.` : ""}`;
      }
    }).catch(() => { /* static hosting */ });
  }

  // ---- Live booking ----
  const form = $("#apptForm");
  if (form) {
  const dayStrip = $("#dayStrip");
  const slotGrid = $("#slotGrid");
  const bookBtn = $("#bookBtn");
  const summary = $("#bookingSummary");
  const CLINIC_NAMES = { del: "New Delhi clinic", online: "Online consultation", lko: "Lucknow clinic", blr: "Bengaluru clinic" };
  const booking = { clinic: "del", date: null, time: null };
  const firstOpenClinic = () => ($('input[name="clinic"]:not(:disabled)', form) || {}).value || "online";

  // Which clinics take bookings is set in the dashboard (open / closed / opening soon).
  function applyClinicStatus(clinics) {
    const LABEL = { closed: "closed", soon: "soon" };
    clinics.forEach((c) => {
      const radio = $(`input[name="clinic"][value="${c.id}"]`, form);
      if (!radio) return;
      const open = c.status === "open";
      radio.disabled = !open;
      const label = radio.closest("label");
      // A clinic that has closed for good isn't offered at all; one opening soon is shown, disabled.
      label.hidden = c.status === "closed";
      if (open) label.removeAttribute("data-clinic-status"); else label.dataset.clinicStatus = c.status;
      $("span", label).textContent = c.short;
      if (!open) { const tag = document.createElement("small"); tag.textContent = ` ${LABEL[c.status] || "closed"}`; $("span", label).append(tag); }
    });
    const checked = $('input[name="clinic"]:checked', form);
    if (!checked || checked.disabled) {
      const first = $('input[name="clinic"]:not(:disabled)', form);
      if (first) { first.checked = true; booking.clinic = first.value; }
    }
  }
  let lastBooking = null;

  const api = async (url, options = {}) => {
    const res = await fetch(url, { headers: { "content-type": "application/json" }, ...options });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || "Something went wrong."), { status: res.status });
    return data;
  };
  const prettyDay = (date, opts) => new Date(`${date}T00:00:00`).toLocaleDateString("en-IN", opts);
  const prettyTime = (t) => { const [h, m] = t.split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };

  // ---- Request mode: used when the booking server isn't reachable (e.g. static hosting) ----
  // The form keeps working with days/times from the opening hours, and sends the request on WhatsApp.
  let offline = false;
  const WA_GREETING = "Hi Dr Rajveer, got your details from your website. I would like to book an appointment.";
  const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const istToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()); // YYYY-MM-DD
  const localDays = () => {
    const out = [];
    const [y, mo, da] = istToday().split("-").map(Number);
    for (let i = 0; i < 21; i++) {
      const d = new Date(y, mo - 1, da + i);
      const free = localSlots(isoDay(d)).filter((x) => x.available).length;
      out.push({ date: isoDay(d), free });
    }
    return out;
  };
  const localSlots = (date) => {
    const day = new Date(`${date}T00:00:00`).getDay();
    const [open, close] = HOURS[day];
    const { day: todayIdx, minutes } = istNow();
    const isToday = date === istToday() && todayIdx === day;
    const out = [];
    for (let m = open * 60; m + 30 <= close * 60; m += 30) {
      const t = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
      out.push({ time: t, available: !isToday || m >= minutes + 60 });
    }
    return out;
  };
  const showFallback = () => {
    if (offline) return;
    offline = true;
    $("#policyNote").hidden = true;
    updateButton();
  };

  // Fees and policy come from the server so the clinic can change them from the dashboard.
  let siteCfg = null;
  const rupee = (n) => `₹${Number(n).toLocaleString("en-IN")}`;
  const feeFor = (clinic) => (siteCfg ? siteCfg.fees[clinic] : 0);

  const updateButton = () => {
    if (offline) {
      bookBtn.textContent = "Send booking request on WhatsApp";
      $("#bookHint").textContent = "Your request goes straight to Dr Rajveer on WhatsApp with these details. The clinic will confirm your time.";
      return;
    }
    const fee = feeFor(booking.clinic);
    bookBtn.textContent = siteCfg?.payOnline && fee ? `Pay ${rupee(fee)} & confirm` : "Confirm booking";
    $("#bookHint").textContent = siteCfg?.payOnline && fee
      ? (siteCfg.demo ? "Demo site: a pretend payment window opens, and no money is taken. You'll get your appointment number instantly."
        : "Secure payment by Razorpay (UPI, cards, net banking). You'll get your appointment number instantly.")
      : `You'll get your appointment number instantly.${fee ? ` Consultation fee ${rupee(fee)}, payable at the clinic.` : ""} Our team confirms every appointment on WhatsApp.`;
  };

  const updateSummary = () => {
    updateButton();
    if (!booking.date || !booking.time) { summary.hidden = true; return; }
    summary.hidden = false;
    summary.innerHTML = "";
    const parts = [CLINIC_NAMES[booking.clinic], prettyDay(booking.date, { weekday: "long", day: "numeric", month: "long" }), prettyTime(booking.time)];
    summary.append("Your slot: ");
    const strong = document.createElement("strong");
    strong.textContent = parts.join(" · ");
    summary.append(strong);
    const fee = feeFor(booking.clinic);
    if (fee) {
      const small = document.createElement("div");
      small.className = "small muted";
      small.textContent = `Consultation fee ${rupee(fee)}${siteCfg.followup?.windowDays ? `. Returning within ${siteCfg.followup.windowDays} days of a visit? The ${rupee(siteCfg.followup.fee)} follow-up rate applies automatically.` : ""}`;
      summary.append(small);
    }
  };

  api("/api/config").then((cfg) => {
    siteCfg = cfg;
    if (cfg.clinics) applyClinicStatus(cfg.clinics);
    if (cfg.demo) showDemoBar();
    applyFeatures(cfg.features || {});
    if (cfg.features && cfg.features.online_booking === false) {
      showFallback(); // booking switched off by the super admin → WhatsApp request form
      if (dayStrip.querySelector(".day")) loadDays();
    }
    const list = $("#policyList");
    [...cfg.policy.cancellation, cfg.policy.reschedule, cfg.policy.clinic].forEach((line) => {
      const li = document.createElement("li");
      li.textContent = line;
      list.appendChild(li);
    });
    $("#policyNote").hidden = false;
    updateSummary();
  }).catch(() => { /* static hosting: booking falls back to WhatsApp */ });

  const selectIn = (container, btn) => {
    $$("[aria-pressed]", container).forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
  };

  async function loadSlots() {
    booking.time = null;
    updateSummary();
    slotGrid.innerHTML = '<p class="muted small">Loading times…</p>';
    try {
      const { slots, closed } = offline
        ? { slots: localSlots(booking.date), closed: false }
        : await api(`/api/slots?clinic=${booking.clinic}&date=${booking.date}`).catch(() => { showFallback(); return { slots: localSlots(booking.date), closed: false }; });
      slotGrid.innerHTML = "";
      const open = slots.filter((s) => s.available);
      if (closed || !open.length) {
        slotGrid.innerHTML = '<p class="muted small">No times left on this day. Please pick another day.</p>';
        return;
      }
      slots.forEach((s) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "slot";
        b.textContent = prettyTime(s.time);
        b.disabled = !s.available;
        b.setAttribute("aria-pressed", "false");
        b.addEventListener("click", () => {
          booking.time = s.time;
          selectIn(slotGrid, b);
          $("#slotErr").style.display = "none";
          updateSummary();
        });
        slotGrid.appendChild(b);
      });
    } catch {
      showFallback();
    }
  }

  async function loadDays() {
    booking.date = null;
    booking.time = null;
    updateSummary();
    dayStrip.innerHTML = '<span class="skeleton"></span>'.repeat(6);
    slotGrid.innerHTML = '<p class="muted small">Choose a day to see open times.</p>';
    try {
      const { days } = offline
        ? { days: localDays() }
        : await api(`/api/days?clinic=${booking.clinic}`).catch(() => { showFallback(); return { days: localDays() }; });
      dayStrip.innerHTML = "";
      days.forEach((d) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "day";
        b.disabled = d.free === 0;
        b.setAttribute("aria-pressed", "false");
        b.setAttribute("aria-label", `${prettyDay(d.date, { weekday: "long", day: "numeric", month: "long" })}, ${d.free ? `${d.free} times free` : "fully booked"}`);
        b.innerHTML = `<small>${prettyDay(d.date, { weekday: "short" })}</small><strong>${prettyDay(d.date, { day: "numeric" })}</strong><em>${d.free ? (offline ? "Open" : `${d.free} free`) : (offline ? "Closed" : "Full")}</em>`;
        b.addEventListener("click", () => {
          booking.date = d.date;
          selectIn(dayStrip, b);
          loadSlots();
        });
        dayStrip.appendChild(b);
      });
      const first = $(".day:not(:disabled)", dayStrip);
      if (first) first.click();
    } catch {
      showFallback();
    }
  }

  $$('input[name="clinic"]', form).forEach((r) => r.addEventListener("change", () => {
    booking.clinic = r.value;
    loadDays();
  }));

  // Preselect clinic from links like "Book online consult"
  $$("[data-mode]").forEach((a) => a.addEventListener("click", () => {
    const radio = $(`input[name="clinic"][value="${a.dataset.mode}"]`, form);
    if (radio && !radio.disabled && !radio.checked) { radio.checked = true; radio.dispatchEvent(new Event("change")); }
  }));

  // Load availability once the booking section is near the viewport.
  const bookingObserver = new IntersectionObserver((entries, obs) => {
    if (entries.some((e) => e.isIntersecting)) { loadDays(); obs.disconnect(); }
  }, { rootMargin: "400px" });
  bookingObserver.observe($("#appointment"));

  const validate = (input) => {
    const field = input.closest(".field");
    const ok = input.checkValidity() && (!input.required || input.value.trim() !== "");
    field.classList.toggle("has-error", !ok);
    return ok;
  };
  $$("input[required]:not([type=checkbox]), input[type=email]", form).forEach((i) => i.addEventListener("blur", () => validate(i)));
  // Referral code: filled in from a referral link (?ref=…, kept 30 days) and checked as the patient types.
  const refInput = $("#refCode");
  if (refInput) {
    try {
      const saved = JSON.parse(localStorage.getItem("tbRef") || "null");
      if (saved && Date.now() - saved.at < 30 * 86400_000) { refInput.value = saved.code.toUpperCase(); $("#aboutYou").open = true; }
    } catch { /* storage unavailable */ }
    const note = $("#refNote");
    const defaultNote = note.textContent;
    const check = async () => {
      const code = refInput.value.trim();
      note.classList.remove("is-ok", "is-bad");
      if (!code || offline) { note.textContent = defaultNote; return; }
      try {
        const r = await fetch(`/api/referral/${encodeURIComponent(code)}`);
        const d = await r.json().catch(() => ({}));
        if (r.ok) { refInput.value = d.code; note.textContent = `✓ Referred by ${d.name}. They'll see only your initials and that you visited, never your health details.`; note.classList.add("is-ok"); }
        else if (r.status === 404) { note.textContent = d.error || "We don't recognise that code."; note.classList.add("is-bad"); }
      } catch { note.textContent = defaultNote; }
    };
    refInput.addEventListener("change", check);
    if (refInput.value) check();
  }
  form.consent.addEventListener("change", () => {
    if (!form.consent.checked) return;
    $("#consentErr").style.display = "none";
    form.consent.closest(".check").classList.remove("check--error");
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    // Check everything at once, so the patient sees every missing item in one go, then go to the first one.
    const inputs = $$("input[required]:not([type=checkbox]), input[type=email]", form);
    const results = inputs.map(validate);
    const slotOk = !!booking.time;
    const consentOk = form.consent.checked;
    $("#slotErr").style.display = slotOk ? "none" : "block";
    $("#consentErr").style.display = consentOk ? "none" : "block";
    form.consent.closest(".check").classList.toggle("check--error", !consentOk);
    if (!slotOk || results.includes(false) || !consentOk) {
      const missing = [!slotOk && "a day and time", results.includes(false) && "your details", !consentOk && "agreement to the privacy notice"].filter(Boolean);
      if (!slotOk) slotGrid.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
      else if (results.includes(false)) inputs[results.indexOf(false)].focus();
      else form.consent.focus();
      toast(`Please add ${missing.join(", ").replace(/, ([^,]*)$/, " and $1")}.`);
      return;
    }
    const fd = new FormData(form);
    if (offline) {
      const lines = [
        WA_GREETING,
        "",
        `Name: ${String(fd.get("name")).trim()}`,
        `Phone: ${String(fd.get("phone")).trim()}`,
        `Clinic: ${CLINIC_NAMES[booking.clinic]}`,
        `Preferred: ${prettyDay(booking.date, { weekday: "short", day: "numeric", month: "short" })}, ${prettyTime(booking.time)}`,
      ];
      if (fd.get("prefersFemale") === "on") lines.push("I'd prefer a female clinician.");
      const reason = String(fd.get("reason") || "").trim();
      if (reason) lines.push(`About my pain: ${reason}`);
      const refCode = String(fd.get("referralCode") || "").trim();
      if (refCode) lines.push(`Referral code: ${refCode}`);
      const url = `https://wa.me/919886688323?text=${encodeURIComponent(lines.join("\n"))}`;
      window.open(url, "_blank", "noopener");
      showDone({
        name: String(fd.get("name")).trim(),
        when: `${prettyDay(booking.date, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}, ${prettyTime(booking.time)}`,
        clinicName: CLINIC_NAMES[booking.clinic],
        address: { del: "150A/09, Shanti Apartment, Kishangarh, Vasant Kunj, New Delhi 110070", online: "Video call (link shared on WhatsApp)" }[booking.clinic] || "",
        status: "requested",
      }, url);
      return;
    }
    const profile = {};
    for (const [k, v] of fd) if (k.startsWith("p_") && String(v).trim()) profile[k.slice(2)] = String(v).trim();
    let attribution = {};
    try { attribution = { ...JSON.parse(sessionStorage.getItem("tbAttr") || "{}") }; attribution.landing ||= sessionStorage.getItem("tbLanding") || ""; } catch { /* storage unavailable */ }
    const payload = {
      clinic: booking.clinic, date: booking.date, time: booking.time,
      name: fd.get("name"), phone: fd.get("phone"), email: fd.get("email"),
      reason: fd.get("reason"), prefersFemale: fd.get("prefersFemale") === "on", website: fd.get("website"),
      consent: true, whatsappConsent: fd.get("whatsappConsent") === "on",
      profile, attribution, referralCode: String(fd.get("referralCode") || "").trim(),
    };
    bookBtn.disabled = true;
    bookBtn.classList.add("is-loading");
    try {
      const { appointment, whatsappUrl, payment } = await api("/api/appointments", { method: "POST", body: JSON.stringify(payload) });
      lastBooking = appointment;
      lastWhatsapp = whatsappUrl || `https://wa.me/919886688323?text=${encodeURIComponent(`Hi Dr Rajveer, got your details from your website. I have booked an appointment (no. ${appointment.ref}).`)}`;
      if (payment) {
        pendingPayment = payment;
        await startPayment();
      } else {
        showDone(appointment, lastWhatsapp);
      }
    } catch (err) {
      if (err.status === 409) loadSlots();
      if (!err.status) { showFallback(); return; }
      toast(err.message);
    } finally {
      bookBtn.disabled = false;
      bookBtn.classList.remove("is-loading");
    }
  });

  // ---- Payment (Razorpay, or the demo's pretend window; see pay.js) ----
  let pendingPayment = null;
  let lastWhatsapp = "";

  function showPayPending(message, { canRetry = true } = {}) {
    form.hidden = true;
    $("#bookingDone").hidden = true;
    const panel = $("#payPending");
    panel.hidden = false;
    $("#payRetry").hidden = !canRetry || !pendingPayment;
    $("#payPendingMsg").textContent = message || `Your slot is held for ${pendingPayment.holdMinutes} minutes while you complete the payment.`;
    panel.focus();
  }

  // Remember a payment in progress, so a reload (or a UPI app switching back) can still show the confirmation.
  const PAYING = "tbPaying";
  const remember = (p) => { try { p ? sessionStorage.setItem(PAYING, JSON.stringify({ orderId: p.orderId, at: Date.now() })) : sessionStorage.removeItem(PAYING); } catch { /* storage unavailable */ } };
  (async () => {
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(PAYING) || "null"); } catch { /* storage unavailable */ }
    if (!saved || Date.now() - saved.at > 60 * 60_000) { remember(null); return; }
    try {
      const d = await api("/api/payments/status", { method: "POST", body: JSON.stringify({ orderId: saved.orderId }) });
      if (d.paid) { remember(null); lastBooking = d.appointment; showDone(d.appointment, ""); }
      else if (d.status === "cancelled") { remember(null); toast("Your earlier payment wasn't completed, so that slot was released. Please choose a time again."); }
    } catch { /* leave the form as it is */ }
  })();

  async function startPayment() {
    remember(pendingPayment);
    try {
      await window.TBPay.checkout(pendingPayment, {
        onSuccess: async (resp) => {
          try {
            const { appointment } = await window.TBPay.verify(resp);
            pendingPayment = null;
            remember(null);
            lastBooking = appointment;
            $("#payPending").hidden = true;
            showDone(appointment, lastWhatsapp);
          } catch (err) {
            // 409: the payment arrived after the slot was released and has been refunded in full. Paying again won't help.
            if (err.status === 409) { pendingPayment = null; remember(null); showPayPending(err.message, { canRetry: false }); return; }
            showPayPending(err.message);
          }
        },
        onFailure: (msg) => showPayPending(`Payment failed: ${msg}. Your slot is still held for a few minutes; you can try again.`),
        onDismiss: () => showPayPending(),
      });
    } catch (err) { showPayPending(err.message); }
  }

  $("#payRetry").addEventListener("click", () => { if (pendingPayment) startPayment(); });
  $("#payCancel").addEventListener("click", () => {
    pendingPayment = null;
    remember(null);
    $("#payPending").hidden = true;
    form.hidden = false;
    loadDays();
  });

  function showDone(a, whatsappUrl) {
    $("#toast")?.classList.remove("is-show"); // no leftover "please add…" message on the success screen
    // Measurement (only if the visitor accepted cookies): no names, phone numbers or health details.
    if (window.tbTrack) {
      if (a.apptNo) window.tbTrack("book_appointment", { value: (a.fee || 0) / 100, currency: "INR", transaction_id: a.apptNo, clinic: a.clinic });
      else window.tbTrack("booking_request", { clinic: booking.clinic });
    }
    form.hidden = true;
    const done = $("#bookingDone");
    done.hidden = false;
    // The appointment number is the patient's reference; the old code line only shows for WhatsApp requests.
    $("#doneRef").textContent = a.ref && !a.apptNo ? `Reference ${a.ref}` : "";
    $("#doneRef").hidden = !$("#doneRef").textContent;
    // Appointment number, patient ID and QR code (server bookings only)
    $("#doneIds").hidden = !a.apptNo;
    if (a.apptNo) {
      $("#doneApptNo").textContent = a.apptNo;
      $("#donePatient").textContent = a.patientCode;
      $("#doneQr").innerHTML = a.qrSvg || ""; // SVG generated by our own server
    }
    $("#doneGcal").hidden = !a.googleCalendarUrl;
    if (a.googleCalendarUrl) $("#doneGcal").href = a.googleCalendarUrl;
    const dl = $("#doneDetails");
    dl.innerHTML = "";
    const paid = a.payment?.status === "paid";
    const rows = [["Patient", a.name], ["When", a.when], ["Where", a.clinicName], ["Address", a.address]];
    if (a.feeText) rows.push(["Fee", paid ? `${a.feeText} paid ✓` : `${a.feeText} (pay at clinic)`]);
    rows.push(["Status", a.status === "confirmed" ? "Confirmed ✓" : a.status === "requested" ? "Request sent on WhatsApp" : "Awaiting confirmation"]);
    $("#bookingDone h3").textContent = a.status === "confirmed" ? "You're confirmed!" : a.status === "requested" ? "Request ready on WhatsApp" : "You're booked in!";
    const requested = a.status === "requested";
    $("#doneRef").hidden = requested || !$("#doneRef").textContent;
    $("#doneIcs").hidden = requested;
    $("#doneManage").hidden = requested;
    $("#bookingDone .muted").textContent = requested ? "WhatsApp opened with your details. Just press send, and the clinic will confirm your time." : "Keep this reference to manage your appointment.";
    $("#doneWa").textContent = requested ? "Open WhatsApp again" : "Send to the clinic on WhatsApp";
    rows.forEach(([k, v]) => {
      const dt = document.createElement("dt"); dt.textContent = k;
      const dd = document.createElement("dd"); dd.textContent = v;
      dl.append(dt, dd);
    });
    $("#doneWa").href = whatsappUrl;
    $("#doneManage").href = `manage.html?ref=${encodeURIComponent(a.ref)}`;
    done.focus();
    done.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
  }

  $("#doneIcs").addEventListener("click", () => {
    if (!lastBooking) return;
    const a = lastBooking;
    // Clinic times are IST (UTC+05:30); calendars get the exact instant in UTC.
    const utcStamp = (date, time) => new Date(`${date}T${time}:00+05:30`).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const [h, m] = a.time.split(":").map(Number);
    const end = `${String(h + Math.floor((m + 30) / 60)).padStart(2, "0")}:${String((m + 30) % 60).padStart(2, "0")}`;
    const esc = (s) => String(s).replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");
    const ics = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Tailbone Treatment//Booking//EN", "BEGIN:VEVENT",
      `UID:${a.apptNo || a.ref}@tailbonetreatment.com`,
      `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`,
      `DTSTART:${utcStamp(a.date, a.time)}`,
      `DTEND:${utcStamp(a.date, end)}`,
      `SUMMARY:${esc(`Tailbone Treatment – ${a.clinicName}`)}`,
      `LOCATION:${esc(a.address)}`,
      `DESCRIPTION:${esc(`Appointment no. ${a.apptNo || a.ref || ""} · Patient ID ${a.patientCode || ""}. Manage: ${a.manageUrl}`)}`,
      "END:VEVENT", "END:VCALENDAR",
    ].join("\r\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    link.download = `tailbone-${a.ref}.ics`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  });

  $("#bookAnother").addEventListener("click", () => {
    form.reset();
    booking.clinic = firstOpenClinic();
    $("#bookingDone").hidden = true;
    form.hidden = false;
    loadDays();
  });

  }

  // ---- WhatsApp widget ----
  const waPanel = $("#waPanel");
  const waBtn = $("#waBtn");
  function setWa(open) {
    waPanel.hidden = !open;
    waBtn.setAttribute("aria-expanded", String(open));
  }
  waBtn.addEventListener("click", () => setWa(waPanel.hidden));
  $("#waClose").addEventListener("click", () => setWa(false));

  // ---- Toast ----
  let toastTimer;
  function toast(text) {
    const t = $("#toast");
    t.textContent = text;
    t.classList.add("is-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("is-show"), 3200);
  }

  $("#year").textContent = new Date().getFullYear();
})();
