(() => {
  "use strict";

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const WA_NUMBER = "919886688323";
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---- Theme (initial value is set inline in <head> to avoid a flash) ----
  const root = document.documentElement;
  $("#themeToggle").addEventListener("click", () => {
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

  const navLinks = $$('.nav a[href^="#"]:not(.btn)');
  const spy = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      navLinks.forEach((l) => l.classList.toggle("is-active", l.getAttribute("href") === `#${entry.target.id}`));
    });
  }, { rootMargin: "-45% 0px -50% 0px" });
  navLinks.forEach((l) => { const s = $(l.getAttribute("href")); if (s) spy.observe(s); });

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
  const symptomForm = $("#symptomForm");
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

  // ---- Testimonials carousel ----
  const track = $("#track");
  let slides = $$(".quote", track);
  const dotsWrap = $("#dots");
  const perView = () => Math.max(1, Math.round(track.clientWidth / slides[0].getBoundingClientRect().width));
  const pageCount = () => Math.ceil(slides.length / perView());
  const currentPage = () => Math.round(track.scrollLeft / track.clientWidth);
  const goTo = (page) => {
    const n = pageCount();
    const p = ((page % n) + n) % n;
    const slide = slides[Math.min(p * perView(), slides.length - 1)];
    track.scrollTo({ left: slide.offsetLeft - track.offsetLeft, behavior: reduceMotion ? "auto" : "smooth" });
  };
  const buildDots = () => {
    dotsWrap.innerHTML = "";
    for (let i = 0; i < pageCount(); i++) {
      const b = document.createElement("button");
      b.setAttribute("role", "tab");
      b.setAttribute("aria-label", `Show stories page ${i + 1}`);
      b.addEventListener("click", () => goTo(i));
      dotsWrap.appendChild(b);
    }
    syncDots();
  };
  const syncDots = () => {
    const p = currentPage();
    $$("button", dotsWrap).forEach((d, i) => d.setAttribute("aria-selected", String(i === p)));
  };
  $("#prev").addEventListener("click", () => goTo(currentPage() - 1));
  $("#next").addEventListener("click", () => goTo(currentPage() + 1));
  track.addEventListener("scroll", () => requestAnimationFrame(syncDots), { passive: true });
  window.addEventListener("resize", buildDots);
  buildDots();

  let autoplay;
  const startAuto = () => { if (!reduceMotion) autoplay = setInterval(() => goTo(currentPage() + 1), 6000); };
  const stopAuto = () => clearInterval(autoplay);
  const carousel = $("#carousel");
  carousel.addEventListener("mouseenter", stopAuto);
  carousel.addEventListener("mouseleave", startAuto);
  carousel.addEventListener("focusin", stopAuto);
  carousel.addEventListener("touchstart", stopAuto, { passive: true });
  startAuto();

  // Replace the built-in quotes with approved stories from the database, if the API is available.
  const escapeHtml = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
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

  // ---- Instagram highlights (managed from the dashboard) ----
  const igGrid = $("#igGrid");
  fetch("/api/media")
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
  mapObserver.observe($("#locations"));

  // ---- Live booking ----
  const form = $("#apptForm");
  const dayStrip = $("#dayStrip");
  const slotGrid = $("#slotGrid");
  const bookBtn = $("#bookBtn");
  const summary = $("#bookingSummary");
  const CLINIC_NAMES = { blr: "Bengaluru clinic", del: "New Delhi clinic", online: "Online consultation" };
  const booking = { clinic: "blr", date: null, time: null };
  let lastBooking = null;

  const api = async (url, options = {}) => {
    const res = await fetch(url, { headers: { "content-type": "application/json" }, ...options });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || "Something went wrong."), { status: res.status });
    return data;
  };
  const prettyDay = (date, opts) => new Date(`${date}T00:00:00`).toLocaleDateString("en-IN", opts);
  const prettyTime = (t) => { const [h, m] = t.split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };

  const showFallback = () => {
    form.hidden = true;
    $("#bookingFallback").hidden = false;
  };

  // Fees and policy come from the server so the clinic can change them from the dashboard.
  let siteCfg = null;
  const rupee = (n) => `₹${Number(n).toLocaleString("en-IN")}`;
  const feeFor = (clinic) => (siteCfg ? siteCfg.fees[clinic] : 0);

  const updateButton = () => {
    const fee = feeFor(booking.clinic);
    bookBtn.textContent = siteCfg?.payOnline && fee ? `Pay ${rupee(fee)} & confirm` : "Confirm booking";
    $("#bookHint").textContent = siteCfg?.payOnline && fee
      ? "Secure payment by Razorpay (UPI, cards, net banking). You'll get a booking reference instantly."
      : `You'll get a booking reference instantly.${fee ? ` Consultation fee ${rupee(fee)}, payable at the clinic.` : ""} Our team confirms every appointment on WhatsApp.`;
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
    $$("[aria-selected]", container).forEach((b) => b.setAttribute("aria-selected", String(b === btn)));
  };

  async function loadSlots() {
    booking.time = null;
    updateSummary();
    slotGrid.innerHTML = '<p class="muted small">Loading times…</p>';
    try {
      const { slots, closed } = await api(`/api/slots?clinic=${booking.clinic}&date=${booking.date}`);
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
        b.setAttribute("role", "option");
        b.setAttribute("aria-selected", "false");
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
      const { days } = await api(`/api/days?clinic=${booking.clinic}`);
      dayStrip.innerHTML = "";
      days.forEach((d) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "day";
        b.disabled = d.free === 0;
        b.setAttribute("role", "option");
        b.setAttribute("aria-selected", "false");
        b.setAttribute("aria-label", `${prettyDay(d.date, { weekday: "long", day: "numeric", month: "long" })}, ${d.free ? `${d.free} times free` : "fully booked"}`);
        b.innerHTML = `<small>${prettyDay(d.date, { weekday: "short" })}</small><strong>${prettyDay(d.date, { day: "numeric" })}</strong><em>${d.free ? `${d.free} free` : "Full"}</em>`;
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
    if (radio && !radio.checked) { radio.checked = true; radio.dispatchEvent(new Event("change")); }
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
  $$("input[required], input[type=email]", form).forEach((i) => i.addEventListener("blur", () => validate(i)));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!booking.time) {
      $("#slotErr").style.display = "block";
      slotGrid.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
      toast("Please choose a day and time.");
      return;
    }
    const inputs = $$("input[required], input[type=email]", form);
    const results = inputs.map(validate);
    if (results.includes(false)) {
      inputs[results.indexOf(false)].focus();
      toast("Please complete the highlighted fields.");
      return;
    }
    const fd = new FormData(form);
    const payload = {
      clinic: booking.clinic, date: booking.date, time: booking.time,
      name: fd.get("name"), phone: fd.get("phone"), email: fd.get("email"),
      reason: fd.get("reason"), prefersFemale: fd.get("prefersFemale") === "on", website: fd.get("website"),
    };
    bookBtn.disabled = true;
    bookBtn.classList.add("is-loading");
    try {
      const { appointment, whatsappUrl, payment } = await api("/api/appointments", { method: "POST", body: JSON.stringify(payload) });
      lastBooking = appointment;
      lastWhatsapp = whatsappUrl || `https://wa.me/919886688323?text=${encodeURIComponent(`Hello Dr Rajveer Singh, my booking reference is ${appointment.ref}.`)}`;
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

  // ---- Razorpay Checkout ----
  let pendingPayment = null;
  let lastWhatsapp = "";
  let razorpayLoading = null;
  const loadRazorpay = () => {
    if (window.Razorpay) return Promise.resolve();
    razorpayLoading ??= new Promise((resolve, reject) => {
      const sc = document.createElement("script");
      sc.src = "https://checkout.razorpay.com/v1/checkout.js";
      sc.onload = resolve;
      sc.onerror = () => { razorpayLoading = null; reject(new Error("Couldn't load the payment window. Check your connection and try again.")); };
      document.head.appendChild(sc);
    });
    return razorpayLoading;
  };

  function showPayPending(message) {
    form.hidden = true;
    $("#bookingDone").hidden = true;
    const panel = $("#payPending");
    panel.hidden = false;
    $("#payPendingMsg").textContent = message || `Your slot is held for ${pendingPayment.holdMinutes} minutes while you complete the payment.`;
    panel.focus();
  }

  async function startPayment() {
    const p = pendingPayment;
    try {
      await loadRazorpay();
    } catch (err) {
      showPayPending(err.message);
      return;
    }
    const rzp = new window.Razorpay({
      key: p.keyId,
      amount: p.amount,
      currency: p.currency,
      name: p.name,
      description: p.description,
      order_id: p.orderId,
      prefill: p.prefill,
      theme: { color: "#16a34a" },
      handler: async (resp) => {
        try {
          const { appointment } = await api("/api/payments/verify", {
            method: "POST",
            body: JSON.stringify({ orderId: resp.razorpay_order_id, paymentId: resp.razorpay_payment_id, signature: resp.razorpay_signature }),
          });
          pendingPayment = null;
          lastBooking = appointment;
          $("#payPending").hidden = true;
          showDone(appointment, lastWhatsapp);
        } catch (err) {
          showPayPending(err.message);
        }
      },
      modal: { ondismiss: () => showPayPending() },
    });
    rzp.on("payment.failed", (resp) => showPayPending(`Payment failed: ${resp.error?.description || "please try again"}. Your slot is still held for a few minutes.`));
    rzp.open();
  }

  $("#payRetry").addEventListener("click", () => { if (pendingPayment) startPayment(); });
  $("#payCancel").addEventListener("click", () => {
    pendingPayment = null;
    $("#payPending").hidden = true;
    form.hidden = false;
    loadDays();
  });

  function showDone(a, whatsappUrl) {
    form.hidden = true;
    const done = $("#bookingDone");
    done.hidden = false;
    $("#doneRef").textContent = a.ref;
    const dl = $("#doneDetails");
    dl.innerHTML = "";
    const paid = a.payment?.status === "paid";
    const rows = [["Patient", a.name], ["When", a.when], ["Where", a.clinicName], ["Address", a.address]];
    if (a.feeText) rows.push(["Fee", paid ? `${a.feeText} paid ✓` : `${a.feeText} (pay at clinic)`]);
    rows.push(["Status", a.status === "confirmed" ? "Confirmed ✓" : "Awaiting confirmation"]);
    $("#bookingDone h3").textContent = a.status === "confirmed" ? "You're confirmed!" : "You're booked in!";
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
    const stamp = (date, time) => `${date.replace(/-/g, "")}T${time.replace(":", "")}00`;
    const [h, m] = a.time.split(":").map(Number);
    const end = `${String(h + Math.floor((m + 30) / 60)).padStart(2, "0")}:${String((m + 30) % 60).padStart(2, "0")}`;
    const esc = (s) => String(s).replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");
    const ics = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Tailbone Treatment//Booking//EN", "BEGIN:VEVENT",
      `UID:${a.ref}@tailbonetreatment.com`,
      `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`,
      `DTSTART;TZID=Asia/Kolkata:${stamp(a.date, a.time)}`,
      `DTEND;TZID=Asia/Kolkata:${stamp(a.date, end)}`,
      `SUMMARY:${esc(`Tailbone Treatment – ${a.clinicName}`)}`,
      `LOCATION:${esc(a.address)}`,
      `DESCRIPTION:${esc(`Booking ref ${a.ref}. Manage: ${a.manageUrl}`)}`,
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
    booking.clinic = "blr";
    $("#bookingDone").hidden = true;
    form.hidden = false;
    loadDays();
  });

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
