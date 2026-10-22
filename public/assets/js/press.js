// "In the news": tap a clipping to open it full size. It grows out of the thumbnail, and you can swipe or use the arrow
// keys to move between clippings. Without JavaScript the link still opens the image.
(() => {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const links = [...document.querySelectorAll(".press-card__img[data-full]")];
  if (!links.length) return;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const box = document.createElement("dialog");
  box.className = "lightbox";
  box.setAttribute("aria-label", "Newspaper clipping");
  box.innerHTML = `<figure class="lightbox__fig"><img class="lightbox__img" alt=""><figcaption class="lightbox__cap"></figcaption></figure>
    <button type="button" class="lightbox__btn lightbox__close" aria-label="Close">×</button>
    <button type="button" class="lightbox__btn lightbox__prev" aria-label="Previous clipping">‹</button>
    <button type="button" class="lightbox__btn lightbox__next" aria-label="Next clipping">›</button>
    <a class="lightbox__open" target="_blank" rel="noopener">Open the image on its own ↗</a>`;
  document.body.append(box);
  const img = $(".lightbox__img", box);
  let index = 0;

  function show(i, from) {
    index = (i + links.length) % links.length;
    const a = links[index];
    img.src = a.dataset.full;
    img.width = Number(a.dataset.w);
    img.height = Number(a.dataset.h);
    img.alt = `Newspaper clipping: ${a.dataset.caption}`;
    $(".lightbox__cap", box).textContent = `${a.dataset.caption} · ${index + 1} of ${links.length}`;
    $(".lightbox__open", box).href = a.dataset.full;
    if (!box.open) box.showModal();
    if (reduce) return;
    // Grow from the thumbnail that was tapped (or fade between clippings).
    const thumb = from?.querySelector("img");
    requestAnimationFrame(() => {
      const end = img.getBoundingClientRect();
      if (thumb && end.width) {
        const t = thumb.getBoundingClientRect();
        img.animate([
          { transform: `translate(${t.left - end.left}px, ${t.top - end.top}px) scale(${t.width / end.width}, ${t.height / end.height})`, opacity: 0.6 },
          { transform: "none", opacity: 1 },
        ], { duration: 380, easing: "cubic-bezier(.2,.8,.2,1)" });
      } else {
        img.animate([{ opacity: 0, transform: "scale(.96)" }, { opacity: 1, transform: "none" }], { duration: 240, easing: "ease-out" });
      }
    });
  }

  function close() {
    if (reduce) { box.close(); return; }
    const anim = box.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160 });
    anim.onfinish = () => box.close();
  }

  links.forEach((a, i) => a.addEventListener("click", (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; // let people open it in a new tab
    e.preventDefault();
    show(i, a);
  }));
  $(".lightbox__close", box).addEventListener("click", close);
  $(".lightbox__prev", box).addEventListener("click", () => show(index - 1));
  $(".lightbox__next", box).addEventListener("click", () => show(index + 1));
  box.addEventListener("click", (e) => { if (e.target === box) close(); });
  box.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") show(index + 1);
    if (e.key === "ArrowLeft") show(index - 1);
  });
  box.addEventListener("close", () => links[index].focus({ preventScroll: true }));
  let startX = null;
  box.addEventListener("touchstart", (e) => { startX = e.touches[0].clientX; }, { passive: true });
  box.addEventListener("touchend", (e) => {
    if (startX == null) return;
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 50) show(index + (dx < 0 ? 1 : -1));
    startX = null;
  });

  // Arriving from "As featured in" (press.html#clipping): bring that clipping into view and highlight it.
  const target = location.hash ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null;
  if (target && target.classList.contains("press-card")) {
    target.classList.add("is-highlight");
    setTimeout(() => target.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" }), 100);
  }
})();
