// Refer a patient (sign-up) and the partner page (log-in, referral ID, referrals and payments).
(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const day = (t) => new Date(`${String(t).replace(" ", "T")}Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
  let toastTimer;
  const toast = (text) => {
    const t = $("#toast");
    t.textContent = text;
    t.classList.add("is-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("is-show"), 3500);
  };
  async function api(path, body) {
    const res = await fetch(`/api/partners${path}`, {
      method: body ? "POST" : "GET",
      credentials: "same-origin",
      headers: { "content-type": "application/json", "x-requested-with": "fetch" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || "Something went wrong. Please try again."), { status: res.status });
    return data;
  }
  const showErr = (el, msg) => { el.textContent = msg; el.hidden = false; el.scrollIntoView({ block: "center", behavior: "smooth" }); };

  // ---------- Refer a patient ----------
  const joinForm = $("#joinForm");
  if (joinForm) {
    api("/info").then((d) => {
      $("#rwFirst").textContent = d.firstBooking;
      $("#rwTreat").textContent = d.treatment;
      $("#rwMonths").textContent = ` in their first ${d.months} months`;
    }).catch((e) => {
      if (e.status === 404) { joinForm.hidden = true; $("#joinClosed").hidden = false; }
    });
    joinForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = $("#joinErr");
      err.hidden = true;
      const f = joinForm;
      const body = Object.fromEntries(new FormData(f));
      body.agree = f.agree.checked;
      if (!body.kind || !body.name.trim() || !body.phone.trim()) return showErr(err, "Please fill in who you are, your name and your mobile number.");
      if (String(body.password).length < 8) return showErr(err, "Please choose a password of at least 8 characters.");
      if (!body.agree) return showErr(err, "Please tick to agree to the partner terms.");
      const btn = f.querySelector("button[type=submit]");
      btn.disabled = true;
      try {
        await api("/signup", body);
        f.hidden = true;
        $("#joinDone").hidden = false;
        $("#joinDone").focus();
      } catch (ex) { showErr(err, ex.message); } finally { btn.disabled = false; }
    });
  }

  // ---------- Partner page ----------
  const portal = $("#portal");
  if (!portal) return;

  async function load() {
    let d;
    try { d = await api("/me"); } catch (e) {
      $("#loginCard").hidden = false;
      portal.hidden = true;
      if (e.status === 404) $("#partnerLogin").outerHTML = '<div class="alert">The referral programme isn\'t open at the moment.</div>';
      return;
    }
    $("#loginCard").hidden = true;
    portal.hidden = false;
    const p = d.partner;
    $("#pKind").textContent = p.kind;
    $("#pHello").textContent = `Hello, ${p.contactName || p.name}`;
    $("#pendingNote").hidden = p.status !== "pending";
    if (p.status === "suspended") $("#pendingNote").textContent = "This partner account is paused. Please contact the clinic.";
    const active = !!p.code;
    $("#codeCard").hidden = !active;
    $("#pStats").hidden = !active;
    $("#refCard").hidden = !active;
    $("#payCard").hidden = !active || !d.payouts.length;
    $("#pRules").textContent = active ? `You earn ${d.rules.firstBooking} when a new patient's first appointment is confirmed, and ${d.rules.treatment} for each treatment visit they complete in their first ${d.rules.months} months. Rewards for cancelled visits are withdrawn. We pay what's due once a month.` : "";
    if (!active) return;
    $("#pCode").textContent = p.code;
    $("#pLink").href = d.link;
    $("#pLink").textContent = d.link.replace(/^https?:\/\//, "");
    $("#pShareWa").href = `https://wa.me/?text=${encodeURIComponent(d.shareText)}`;
    $("#sPatients").textContent = d.totals.patients;
    $("#sVisits").textContent = d.totals.visits;
    $("#sDue").textContent = d.totals.dueText;
    $("#sPaid").textContent = d.totals.paidText;
    $("#refRows").innerHTML = d.referrals.map((r) => `<tr><td>${esc(r.initials)}</td><td>${esc(day(r.referredAt))}</td><td>${esc(r.stage)}</td><td>${esc(r.earnedText)}</td></tr>`).join("")
      || '<tr><td colspan="4" class="muted">No referrals yet. Share your link to get started.</td></tr>';
    $("#payRows").innerHTML = d.payouts.map((x) => `<li><strong>${esc(x.amountText)}</strong> · ${esc(day(x.paid_at))}${x.method ? ` · ${esc(x.method)}` : ""}${x.reference ? ` · ref. ${esc(x.reference)}` : ""}</li>`).join("");
    $("#pCopy").onclick = async () => { try { await navigator.clipboard.writeText(d.link); toast("Link copied."); } catch { prompt("Copy your link:", d.link); } };
  }

  // Demo site: offer the sample partner's log-in.
  fetch("/api/config").then((r) => r.json()).then((cfg) => {
    if (!cfg?.demo?.partner) return;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn btn--ghost btn--block";
    b.textContent = "▶ Try as a demo partner (City Ortho Hospital)";
    b.addEventListener("click", () => { $("#plPhone").value = cfg.demo.partner.phone; $("#plPw").value = cfg.demo.partner.password; $("#partnerLogin").requestSubmit(); });
    $("#partnerLogin").after(b);
  }).catch(() => {});

  $("#partnerLogin").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#loginErr");
    err.hidden = true;
    if (!e.target.phone.value.trim() || !e.target.password.value) { showErr(err, "Please enter your mobile number and password."); (e.target.phone.value.trim() ? e.target.password : e.target.phone).focus(); return; }
    try { await api("/login", Object.fromEntries(new FormData(e.target))); e.target.reset(); load(); } catch (ex) { showErr(err, ex.message); }
  });
  $("#logoutBtn").addEventListener("click", async () => { await api("/logout", {}).catch(() => {}); load(); });
  $("#pwForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await api("/password", Object.fromEntries(new FormData(e.target))); e.target.reset(); toast("Password changed."); } catch (ex) { toast(ex.message); }
  });
  load();
})();
