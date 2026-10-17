(() => {
  "use strict";

  const $ = (s, el = document) => el.querySelector(s);
  const token = new URLSearchParams(location.search).get("t") || "";
  const show = (id) => ["loading", "invalid", "checkinCard", "thanks"].forEach((x) => { $(`#${x}`).hidden = x !== id; });

  let toastTimer;
  const toast = (text) => {
    const t = $("#toast");
    t.textContent = text;
    t.classList.add("is-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("is-show"), 3200);
  };

  // 0–10 pain scale buttons
  const scale = $("#scale");
  for (let v = 0; v <= 10; v++) {
    const label = document.createElement("label");
    label.innerHTML = `<input type="radio" name="painScore" value="${v}" aria-label="Pain ${v} out of 10"><span style="--v:${v}">${v}</span>`;
    scale.appendChild(label);
  }

  const thanks = (msg) => {
    if (msg) $("#thanksMsg").textContent = msg;
    show("thanks");
    $("#thanks").focus();
  };

  async function init() {
    if (!token) return show("invalid");
    try {
      const res = await fetch(`/api/checkin/${encodeURIComponent(token)}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.error && /turned off/.test(data.error)) $("#invalid p").textContent = data.error;
        return show("invalid");
      }
      const data = await res.json();
      if (data.done) return thanks("We've already received this check-in. Thank you!");
      $("#hello").textContent = `Hi ${data.firstName}, how are you feeling?`;
      show("checkinCard");
    } catch {
      show("invalid");
    }
  }

  $("#checkinForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    if (fd.get("painScore") === null) return toast("Please choose a pain score.");
    if (!fd.get("trend")) return toast("Please tell us if you feel better, the same or worse.");
    const btn = e.submitter;
    btn.disabled = true;
    try {
      const res = await fetch(`/api/checkin/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          painScore: Number(fd.get("painScore")),
          trend: fd.get("trend"),
          sittingMinutes: fd.get("sittingMinutes"),
          notes: fd.get("notes"),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't send. Please try again.");
      $("#storyInvite").hidden = fd.get("trend") !== "better";
      thanks(data.needsAttention
        ? "Thanks for letting us know. We're sorry it's still troubling you. Our team will reach out on WhatsApp shortly."
        : "Great to hear from you. Keep up the exercises and posture habits, and we'll be in touch if anything's needed.");
    } catch (err) {
      toast(err.message);
      btn.disabled = false;
    }
  });

  init();
})();
