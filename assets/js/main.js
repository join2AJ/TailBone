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
      text = `Open now · until ${fmtHour(close)} IST (by appointment)`;
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
  const slides = $$(".quote", track);
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

  // Preselect appointment mode from links like "Book online consult"
  $$("[data-mode]").forEach((a) => a.addEventListener("click", () => {
    const radio = $(`input[name="mode"][value="${a.dataset.mode}"]`);
    if (radio) radio.checked = true;
  }));

  // ---- Appointment form -> WhatsApp ----
  const form = $("#apptForm");
  const dateInput = $("#date");
  const today = new Date();
  const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  dateInput.min = iso(today);

  const validate = (input) => {
    const field = input.closest(".field");
    const ok = input.checkValidity() && input.value.trim() !== "";
    field.classList.toggle("has-error", !ok);
    return ok;
  };
  $$("input[required]", form).forEach((i) => i.addEventListener("blur", () => validate(i)));

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const required = $$("input[required]", form);
    const results = required.map(validate);
    if (results.includes(false)) {
      required[results.indexOf(false)].focus();
      toast("Please complete the highlighted fields.");
      return;
    }
    const data = new FormData(form);
    const date = new Date(`${data.get("date")}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
    const lines = [
      "Hello Dr Rajveer Singh, I'd like to book an appointment.",
      "",
      `Name: ${data.get("name").trim()}`,
      `Phone: ${data.get("phone").trim()}`,
      `Where: ${data.get("mode")}`,
      `Preferred: ${date}, ${data.get("slot")}`,
    ];
    const msg = data.get("msg").trim();
    if (msg) lines.push(`About my pain: ${msg}`);
    window.open(`https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(lines.join("\n"))}`, "_blank", "noopener");
    toast("Opening WhatsApp with your request…");
    form.reset();
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
