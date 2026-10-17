(() => {
  "use strict";

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  let creds = null; // { ref, phone }
  let current = null;
  let picked = { date: null, time: null };

  const api = async (url, body) => {
    const res = await fetch(url, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
    return data;
  };
  const prettyDay = (date, opts) => new Date(`${date}T00:00:00`).toLocaleDateString("en-IN", opts);
  const prettyTime = (t) => { const [h, m] = t.split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
  const STATUS = { pending: "Awaiting confirmation", confirmed: "Confirmed", completed: "Completed", cancelled: "Cancelled", no_show: "Missed" };
  const PAY = { paid: "Paid", refunded: "Refunded", partially_refunded: "Partly refunded", pay_at_clinic: "Pay at clinic", awaiting: "Payment pending", unpaid: "" };
  const rupees = (paise) => `₹${(paise / 100).toLocaleString("en-IN")}`;

  let toastTimer;
  const toast = (text) => {
    const t = $("#toast");
    t.textContent = text;
    t.classList.add("is-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("is-show"), 3200);
  };

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  function apptCard(a) {
    const card = el("div", "appt");
    const head = el("div", "appt__head");
    head.append(el("strong", "", a.when), el("span", `badge badge--${a.status}`, STATUS[a.status]));
    card.append(head, el("div", "", a.clinicName), el("div", "muted small", a.address), el("div", "muted small", `Ref ${a.ref}`));
    if (a.fee) {
      const p = a.payment;
      let text = `${a.visitType === "followup" ? "Follow-up" : "Consultation"} fee ${a.feeText}`;
      if (PAY[p.status]) text += ` · ${PAY[p.status]}`;
      if (p.refunded) text += ` · ${rupees(p.refunded)} refunded`;
      card.append(el("div", "pay-chip", text));
    }
    return card;
  }

  function render(data, message, kind = "ok") {
    current = data.appointment;
    $("#lookupCard").hidden = true;
    $("#resultCard").hidden = false;
    $("#hello").textContent = `Hi ${current.name.split(" ")[0]}`;
    $("#apptBox").replaceChildren(apptCard(current));
    $("#actions").hidden = !current.canChange;
    const rs = current.reschedule || {};
    $("#reschedBtn").hidden = !rs.allowed;
    $("#reschedNote").hidden = !current.canChange || rs.allowed;
    $("#reschedNote").textContent = rs.reason || "";
    $("#reschedPanel").hidden = true;
    $("#cancelPanel").hidden = true;
    const msg = $("#resultMsg");
    msg.hidden = !message;
    if (message) { msg.className = `alert alert--${kind}`; msg.textContent = message; }
    const others = data.others || [];
    $("#othersBox").hidden = others.length === 0;
    $("#othersList").replaceChildren(...others.map(apptCard));
  }

  async function lookup(ref, phone) {
    const err = $("#lookupErr");
    err.hidden = true;
    try {
      const data = await api("/api/manage/lookup", { ref, phone });
      creds = { ref, phone };
      render(data);
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
    }
  }

  $("#lookupForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const ref = $("#ref").value.trim();
    const phone = $("#phone").value.trim();
    if (!ref || !phone) { toast("Please enter your reference and phone number."); return; }
    lookup(ref, phone);
  });

  $("#lookupAgain").addEventListener("click", () => {
    $("#resultCard").hidden = true;
    $("#lookupCard").hidden = false;
    creds = null;
  });

  // ---- Reschedule ----
  async function loadSlots(date) {
    picked = { date, time: null };
    $("#confirmResched").disabled = true;
    const grid = $("#slotGrid");
    grid.innerHTML = '<p class="muted small">Loading…</p>';
    const { slots } = await api(`/api/slots?clinic=${current.clinic}&date=${date}`);
    grid.replaceChildren(...slots.map((s) => {
      const b = el("button", "slot", prettyTime(s.time));
      b.type = "button";
      b.disabled = !s.available;
      b.setAttribute("aria-selected", "false");
      b.addEventListener("click", () => {
        picked.time = s.time;
        $$(".slot", grid).forEach((x) => x.setAttribute("aria-selected", String(x === b)));
        $("#confirmResched").disabled = false;
      });
      return b;
    }));
    if (!slots.some((s) => s.available)) grid.innerHTML = '<p class="muted small">No times left on this day.</p>';
  }

  $("#reschedBtn").addEventListener("click", async () => {
    $("#cancelPanel").hidden = true;
    $("#reschedPanel").hidden = false;
    const strip = $("#dayStrip");
    strip.innerHTML = '<span class="skeleton"></span>'.repeat(5);
    try {
      const { days } = await api(`/api/days?clinic=${current.clinic}`);
      strip.replaceChildren(...days.map((d) => {
        const b = el("button", "day");
        b.type = "button";
        b.disabled = d.free === 0;
        b.setAttribute("aria-selected", "false");
        b.append(el("small", "", prettyDay(d.date, { weekday: "short" })), el("strong", "", prettyDay(d.date, { day: "numeric" })), el("em", "", d.free ? `${d.free} free` : "Full"));
        b.addEventListener("click", () => {
          $$(".day", strip).forEach((x) => x.setAttribute("aria-selected", String(x === b)));
          loadSlots(d.date).catch((e) => toast(e.message));
        });
        return b;
      }));
    } catch (e) {
      toast(e.message);
    }
  });
  $("#closeResched").addEventListener("click", () => { $("#reschedPanel").hidden = true; });

  $("#confirmResched").addEventListener("click", async () => {
    if (!picked.time) return;
    try {
      await api("/api/manage/reschedule", { ...creds, ...picked });
      const data = await api("/api/manage/lookup", creds);
      render(data, `Done! Your appointment is now ${data.appointment.when}. The clinic has been notified.`);
    } catch (e) {
      toast(e.message);
      if (picked.date) loadSlots(picked.date).catch(() => {});
    }
  });

  // ---- Cancel ----
  $("#cancelBtn").addEventListener("click", () => {
    $("#reschedPanel").hidden = true;
    $("#cancelPanel").hidden = false;
    const q = current.cancelQuote;
    const box = $("#refundQuote");
    box.hidden = !q;
    if (q) {
      box.replaceChildren(
        el("div", "", "If you cancel now you'll get back"),
        el("strong", "", `${rupees(q.amount)} of ${rupees(q.refundable)}`),
        el("div", "small muted", `${q.rule} Refunds reach the original payment method in 5–7 working days.`),
      );
    }
  });
  $("#closeCancel").addEventListener("click", () => { $("#cancelPanel").hidden = true; });
  $("#confirmCancel").addEventListener("click", async () => {
    try {
      const res = await api("/api/manage/cancel", { ...creds, reason: $("#cancelReason").value });
      const data = await api("/api/manage/lookup", creds);
      render(data, res.refund ? `Your appointment has been cancelled. A refund of ${rupees(res.refund.amount)} has been ${res.refund.status === "processed" ? "issued" : "requested"}. The clinic has been notified.` : "Your appointment has been cancelled and the clinic has been notified. We hope to see you again soon.");
    } catch (e) {
      toast(e.message);
    }
  });

  // Prefill the reference from the confirmation link.
  const ref = new URLSearchParams(location.search).get("ref");
  if (ref) {
    $("#ref").value = ref;
    $("#phone").focus();
  }
})();
