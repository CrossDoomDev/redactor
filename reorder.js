"use strict";
// Pointer events keep the same drag interaction available to mouse, pen and touch.
window.CourseReorder = {
  bind({root, handle, source, locate, commit, enabled = () => true}) {
    let drag = null, frame = 0, suppressClick = false;
    function clearMarker() {
      root.querySelectorAll(".drop-before,.drop-after,.drop-inside").forEach(el => {
        el.classList.remove("drop-before", "drop-after", "drop-inside");
      });
    }
    function cleanup() {
      if (!drag) return;
      cancelAnimationFrame(frame);
      clearMarker();
      drag.ghost?.remove();
      document.querySelectorAll(".reorder-source").forEach(el => el.classList.remove("reorder-source"));
      document.body.classList.remove("reordering");
      const pointerId = drag.pointerId;
      drag = null;
      if (root.hasPointerCapture(pointerId)) root.releasePointerCapture(pointerId);
    }
    function scrollNearEdge(element, axis) {
      const horizontal = axis === "x", rect = element.getBoundingClientRect();
      const point = horizontal ? drag.x : drag.y;
      const start = horizontal ? rect.left : Math.max(72, rect.top);
      const end = horizontal ? rect.right : Math.min(innerHeight, rect.bottom);
      if (drag.x < rect.left - 24 || drag.x > rect.right + 24 || drag.y < rect.top - 24 || drag.y > rect.bottom + 24) return;
      const speed = point < start + 36 ? -10 : point > end - 36 ? 10 : 0;
      if (speed) element.scrollBy(horizontal ? {left: speed} : {top: speed});
    }
    function paint() {
      if (!drag?.active) return;
      if (!enabled()) { cleanup(); return; }
      drag.ghost.style.left = Math.max(8, Math.min(innerWidth - drag.ghost.offsetWidth - 8, drag.x + 14)) + "px";
      drag.ghost.style.top = Math.max(76, Math.min(innerHeight - 48, drag.y + 14)) + "px";
      for (let el = root; el && el !== document.body; el = el.parentElement) {
        const style = getComputedStyle(el);
        if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight) scrollNearEdge(el, "y");
        if (/(auto|scroll)/.test(style.overflowX) && el.scrollWidth > el.clientWidth) scrollNearEdge(el, "x");
      }
      if (drag.y < 100) window.scrollBy(0, -10);
      else if (drag.y > innerHeight - 36) window.scrollBy(0, 10);
      clearMarker();
      const hit = document.elementFromPoint(drag.x, drag.y);
      drag.target = hit && root.contains(hit) ? locate(drag.data, hit, drag.x, drag.y) : null;
      if (drag.target) drag.target.element.classList.add("drop-" + drag.target.edge);
      frame = requestAnimationFrame(paint);
    }
    root.addEventListener("pointerdown", event => {
      if (!enabled() || event.button !== 0 || !event.isPrimary || drag) return;
      const grip = event.target.closest(handle);
      if (!grip || !root.contains(grip)) return;
      const data = source(grip);
      if (!data) return;
      suppressClick = false;
      drag = {data, grip, pointerId: event.pointerId, x: event.clientX, y: event.clientY,
        startX: event.clientX, startY: event.clientY, active: false};
    });
    document.addEventListener("pointermove", event => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      drag.x = event.clientX; drag.y = event.clientY;
      if (!drag.active && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) >= 6) {
        drag.active = true;
        root.setPointerCapture(event.pointerId);
        drag.grip.closest(".course-module-heading,.module-lesson-row,.step-tab")?.classList.add("reorder-source");
        document.body.classList.add("reordering");
        const ghost = document.createElement("div");
        ghost.className = "reorder-ghost";
        ghost.textContent = drag.data.label;
        ghost.setAttribute("aria-hidden", "true");
        document.body.append(ghost); drag.ghost = ghost;
        paint();
      }
      if (drag.active) event.preventDefault();
    }, {passive: false});
    document.addEventListener("pointerup", event => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const {active, data} = drag;
      const hit = document.elementFromPoint(event.clientX, event.clientY);
      const target = active && hit && root.contains(hit) ? locate(data, hit, event.clientX, event.clientY) : null;
      suppressClick = active;
      cleanup();
      if (enabled() && active && target) commit(data, target);
      // The synthesized click follows pointerup, before this timer.
      setTimeout(() => { suppressClick = false; }, 0);
    });
    document.addEventListener("pointercancel", cleanup);
    root.addEventListener("lostpointercapture", event => {
      // Touch starts with implicit capture on the grip; transferring it to the
      // stable list emits a bubbling lostpointercapture from that grip.
      if (event.target === root && event.pointerId === drag?.pointerId) cleanup();
    });
    root.addEventListener("click", event => {
      if (suppressClick) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && drag) { event.preventDefault(); cleanup(); }
    });
    window.addEventListener("blur", cleanup);
  }
};
