"use strict";

function createPreview(
  viewport,
  element,
  {
    enabled,
    canSelectRegion,
    selectRegion,
    selectBoxes,
    adjustBox,
    finishBoxDrag,
    showZoom,
    boxColor,
    actionMenu,
    lockButton,
    actionButton,
    addBoxAt,
    toggleBoxLocks,
    deleteBoxes,
  },
) {
  const state = {
    source: null,
    region: null,
    boxes: [],
    selected: new Set(),
    locked: new Map(),
    drag: null,
  };
  const camera = { zoom: 1, x: 0, y: 0 };
  let view;
  let pan;
  let hovered = "";
  let boxAction;
  let lockAction;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const moveGlyph = new Path2D(
    "M-5 0H5 M0-5V5 M-3-2L-5 0l2 2 M3-2L5 0 3 2 M-2-3L0-5l2 2 M-2 3L0 5l2-2",
  );
  const lockGlyph = new Path2D("M4 6V4a2 2 0 0 1 4 0v2 M2.5 6h7v5h-7z");

  function drawPreview() {
    if (!state.source) return;
    const { image, width, height } = state.source;
    const w = viewport.clientWidth;
    const h = viewport.clientHeight;
    const fit = Math.min((w - 16) / width, (h - 16) / height);
    if (fit <= 0) return;
    const scale = fit * camera.zoom;
    const imageW = width * scale;
    const imageH = height * scale;
    const travelX = Math.max(0, (imageW - w + 16) / 2);
    const travelY = Math.max(0, (imageH - h + 16) / 2);
    camera.x = clamp(camera.x, -travelX, travelX);
    camera.y = clamp(camera.y, -travelY, travelY);
    const imageX = (w - imageW) / 2 + camera.x;
    const imageY = (h - imageH) / 2 + camera.y;
    view = { w, h, fit, scale, x: imageX, y: imageY };
    showZoom(
      camera.zoom === 1 ? "Fit" : `${Math.max(1, Math.round(scale * 100))}%`,
    );
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const deviceW = Math.round(w * ratio);
    const deviceH = Math.round(h * ratio);
    if (element.width !== deviceW || element.height !== deviceH) {
      element.width = deviceW;
      element.height = deviceH;
    }
    const context = element.getContext("2d");
    context.setTransform(deviceW / w, 0, 0, deviceH / h, 0, 0);
    context.clearRect(0, 0, w, h);
    context.drawImage(image, imageX, imageY, imageW, imageH);

    const cropping = state.drag?.moved && state.drag.area;
    const region = cropping ? dragRect() : state.region;
    const left = imageX + region.l * scale;
    const top = imageY + region.t * scale;
    const right = imageX + region.r * scale;
    const bottom = imageY + region.b * scale;
    context.lineWidth = 1;
    if (region.l > 0 || region.t > 0 || region.r < width || region.b < height) {
      context.fillStyle = "rgba(11, 10, 18, .64)";
      context.fillRect(imageX, imageY, imageW, top - imageY);
      context.fillRect(imageX, bottom, imageW, (height - region.b) * scale);
      context.fillRect(imageX, top, left - imageX, bottom - top);
      context.fillRect(right, top, (width - region.r) * scale, bottom - top);
      context.strokeStyle = "#fff";
      context.setLineDash([4, 3]);
      context.strokeRect(left, top, right - left, bottom - top);
      context.setLineDash([]);
    }
    if (cropping) return;
    const marquee = state.drag?.moved && !state.drag.handle ? dragRect() : null;
    const selected = marquee ? boxesIn(marquee) : state.selected;
    state.boxes.forEach((box) => {
      const x = left + box.l * scale;
      const y = top + box.t * scale;
      const bw = (box.r - box.l) * scale;
      const bh = (box.b - box.t) * scale;
      const locked = state.locked.has(box.id);
      context.setLineDash(selected.has(box.id) ? [2, 2] : locked ? [6, 2] : []);
      context.strokeStyle = boxColor;
      context.strokeRect(
        x + 0.5,
        y + 0.5,
        Math.max(0, bw - 1),
        Math.max(0, bh - 1),
      );
      if (locked && bw >= 16 && bh >= 16) {
        context.save();
        context.translate(x + 2, y + 2);
        context.fillStyle = "rgba(0, 0, 0, .72)";
        context.fillRect(0, 0, 12, 12);
        context.setLineDash([]);
        context.strokeStyle = "#ff4d55";
        context.stroke(lockGlyph);
        context.restore();
      }
    });
    context.setLineDash([]);
    if (marquee) {
      const x = imageX + marquee.l * scale;
      const y = imageY + marquee.t * scale;
      const w = Math.max(1, (marquee.r - marquee.l) * scale);
      const h = Math.max(1, (marquee.b - marquee.t) * scale);
      context.fillStyle = "rgba(133, 90, 225, .20)";
      context.fillRect(x, y, w, h);
      context.strokeStyle = boxColor;
      context.setLineDash([4, 3]);
      context.strokeRect(x, y, w, h);
      context.setLineDash([]);
      return;
    }
    for (const handle of handles()) {
      const { x, y } = handle;
      context.fillStyle = "#211637";
      if (handle.kind !== "move") {
        context.fillRect(x - 5, y - 5, 10, 10);
        context.fillStyle = "#ffffff";
        context.fillRect(x - 4, y - 4, 8, 8);
      } else {
        context.save();
        context.translate(x, y);
        context.beginPath();
        context.arc(0, 0, 8, 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = "#ffffff";
        context.stroke(moveGlyph);
        context.restore();
      }
    }
  }

  function pointer(event) {
    const rect = element.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function sourcePoint(event, allowOutside = false) {
    const point = pointer(event);
    const { width, height } = state.source;
    const x = (point.x - view.x) / view.scale;
    const y = (point.y - view.y) / view.scale;
    if (
      !allowOutside &&
      (!insideViewport(point) || x < 0 || x > width || y < 0 || y > height)
    )
      return null;
    return {
      x: Math.round(clamp(x, 0, width)),
      y: Math.round(clamp(y, 0, height)),
    };
  }

  function dragRect() {
    const { start, end } = state.drag;
    return {
      l: Math.min(start.x, end.x),
      t: Math.min(start.y, end.y),
      r: Math.max(start.x, end.x),
      b: Math.max(start.y, end.y),
    };
  }

  function boxesIn(rect) {
    const { l, t } = state.region;
    const local = {
      l: rect.l - l,
      t: rect.t - t,
      r: rect.r - l + 1,
      b: rect.b - t + 1,
    };
    return new Set(
      state.boxes
        .filter((box) => ScreenshotBoxes.overlaps(box, local))
        .map((box) => box.id),
    );
  }

  function insideViewport(point) {
    return point.x >= 0 && point.y >= 0 && point.x < view.w && point.y < view.h;
  }

  function handles() {
    const box = !pan && state.boxes.find((item) => item.id === hovered);
    if (!box || state.locked.has(box.id)) return [];
    const x = view.x + (state.region.l + box.r) * view.scale;
    const y = view.y + (state.region.t + box.b) * view.scale;
    const dx = ((box.r - box.l) * view.scale) / 2;
    const dy = ((box.b - box.t) * view.scale) / 2;
    const result = [
      { kind: "resize", box, x, y },
      { kind: "resize-top-left", box, x: x - 2 * dx, y: y - 2 * dy },
    ];
    if (Math.hypot(dx, dy) >= 17)
      result.push({ kind: "move", box, x: x - dx, y: y - dy });
    return result;
  }

  function handleAt(event) {
    const point = pointer(event);
    if (!insideViewport(point)) return null;
    let nearest;
    let radius = 8;
    for (const handle of handles()) {
      const distance = Math.hypot(point.x - handle.x, point.y - handle.y);
      if (distance > radius) continue;
      nearest = handle;
      radius = distance;
    }
    return nearest;
  }

  function boxAt(point) {
    if (!point) return null;
    const x = point.x - state.region.l;
    const y = point.y - state.region.t;
    return state.boxes.find(
      (box) => x >= box.l && x < box.r && y >= box.t && y < box.b,
    );
  }

  function updateHover(event) {
    const current = handleAt(event);
    const id = current?.box.id || boxAt(sourcePoint(event))?.id || "";
    if (id !== hovered) {
      hovered = id;
      drawPreview();
    }
    const handle = current || handleAt(event);
    element.style.cursor = !handle
      ? "default"
      : handle.kind === "move"
        ? "move"
        : "nwse-resize";
    return handle;
  }

  function closeBoxMenu() {
    actionMenu.hidden = true;
    boxAction = null;
    lockAction = null;
  }

  element.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    closeBoxMenu();
    if (!view || !enabled() || state.drag || pan) return;
    const point = sourcePoint(event);
    const box = handleAt(event)?.box || boxAt(point);
    lockButton.hidden = !box;
    actionButton.toggleAttribute("data-destructive", Boolean(box));
    if (box) {
      const ids = state.selected.has(box.id)
        ? state.selected
        : new Set([box.id]);
      lockButton.textContent = [...ids].every((id) => state.locked.has(id))
        ? "Unlock"
        : "Lock";
      lockAction = () => toggleBoxLocks(ids);
      actionButton.textContent =
        ids.size === 1 ? "Delete Box" : `Delete ${ids.size} Boxes`;
      boxAction = () => deleteBoxes(ids);
    } else {
      if (
        !point ||
        point.x < state.region.l ||
        point.x >= state.region.r ||
        point.y < state.region.t ||
        point.y >= state.region.b
      )
        return;
      actionButton.textContent = "Add Box";
      boxAction = () =>
        addBoxAt({ x: point.x - state.region.l, y: point.y - state.region.t });
    }
    const { x, y } = pointer(event);
    actionMenu.hidden = false;
    actionMenu.style.left = `${clamp(x, 2, view.w - actionMenu.offsetWidth - 2)}px`;
    actionMenu.style.top = `${clamp(y, 2, view.h - actionMenu.offsetHeight - 2)}px`;
    (box ? lockButton : actionButton).focus({ preventScroll: true });
  });

  actionMenu.addEventListener("focusout", (event) => {
    if (!actionMenu.contains(event.relatedTarget)) closeBoxMenu();
  });
  function applyBoxAction(action) {
    closeBoxMenu();
    element.focus({ preventScroll: true });
    if (enabled()) action?.();
  }
  actionButton.addEventListener("click", () => applyBoxAction(boxAction));
  lockButton.addEventListener("click", () => applyBoxAction(lockAction));
  actionMenu.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    closeBoxMenu();
    element.focus({ preventScroll: true });
  });

  new ResizeObserver(drawPreview).observe(viewport);

  element.addEventListener(
    "wheel",
    (event) => {
      if (!event.ctrlKey || !view) return;
      event.preventDefault();
      if (!enabled() || state.drag || pan) return;
      closeBoxMenu();
      const unit =
        event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? view.h : 1;
      const zoom = clamp(
        camera.zoom * Math.exp(-event.deltaY * unit * 0.0025),
        1,
        Math.max(8, 4 / view.fit),
      );
      const change = 1 - zoom / camera.zoom;
      const point = pointer(event);
      camera.x += (point.x - view.w / 2 - camera.x) * change;
      camera.y += (point.y - view.h / 2 - camera.y) * change;
      camera.zoom = zoom;
      drawPreview();
      updateHover(event);
    },
    { passive: false },
  );

  element.addEventListener("pointerdown", (event) => {
    if (!view || !event.isPrimary) return;
    if (event.button === 1) event.preventDefault();
    if (!enabled()) return;
    if (event.button === 1) {
      pan = { x: event.clientX - camera.x, y: event.clientY - camera.y };
      element.style.cursor = "grabbing";
      drawPreview();
    } else if (event.button === 0) {
      const handle = updateHover(event);
      const point = sourcePoint(event, Boolean(handle));
      if (!point) return;
      state.drag = {
        start: point,
        end: point,
        clientX: event.clientX,
        clientY: event.clientY,
        handle,
        area: !handle && canSelectRegion(),
      };
      if (handle && handle.kind !== "move") {
        const { l, t, r, b } = handle.box;
        state.drag.resize = {
          origin: point,
          width: r - l,
          height: b - t,
          shift: event.shiftKey,
          axis: null,
        };
      }
      if (handle) selectBoxes([handle.box.id]);
    } else {
      return;
    }
    element.setPointerCapture(event.pointerId);
  });

  function resizeDrag(drag, previous, shiftKey) {
    const { box, kind } = drag.handle;
    const resize = drag.resize;
    if (resize.shift !== shiftKey) {
      const current = state.boxes.find((item) => item.id === box.id);
      if (!current) return;
      // Continue from the current size when Shift is pressed or released mid-drag.
      Object.assign(resize, {
        origin: previous,
        width: current.r - current.l,
        height: current.b - current.t,
        shift: shiftKey,
        axis: null,
      });
    }
    const dx = drag.end.x - resize.origin.x;
    const dy = drag.end.y - resize.origin.y;
    if (shiftKey && !resize.axis && (dx || dy))
      resize.axis = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
    element.style.cursor =
      resize.axis === "x"
        ? "ew-resize"
        : resize.axis === "y"
          ? "ns-resize"
          : "nwse-resize";
    const sign = kind === "resize-top-left" ? -1 : 1;
    const width = resize.width + (resize.axis === "y" ? 0 : sign * dx);
    const height = resize.height + (resize.axis === "x" ? 0 : sign * dy);
    adjustBox(box.id, kind, width, height, true);
  }

  function moveDrag(event) {
    const drag = state.drag;
    const previous = drag.end;
    drag.end = sourcePoint(event, true);
    drag.moved ||=
      Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) >=
      3;
    if (drag.handle && drag.moved) {
      const { box, kind } = drag.handle;
      if (kind === "move") {
        const dx = drag.end.x - drag.start.x;
        const dy = drag.end.y - drag.start.y;
        adjustBox(box.id, kind, box.l + dx, box.t + dy, true);
      } else {
        resizeDrag(drag, previous, event.shiftKey);
      }
    }
  }

  element.addEventListener("pointermove", (event) => {
    if (!event.isPrimary || !view) return;
    if (pan) {
      camera.x = event.clientX - pan.x;
      camera.y = event.clientY - pan.y;
      drawPreview();
      return;
    }
    if (state.drag) {
      moveDrag(event);
      if (!state.drag.handle) drawPreview();
    } else {
      updateHover(event);
    }
  });
  element.addEventListener("pointerup", (event) => {
    if (!event.isPrimary) return;
    if (pan) {
      pan = null;
      updateHover(event);
      drawPreview();
      return;
    }
    if (!state.drag) return;
    moveDrag(event);
    const { moved, handle, area, end } = state.drag;
    const region = !handle && moved ? dragRect() : null;
    state.drag = null;
    if (handle) finishBoxDrag();
    if (
      area &&
      region &&
      region.r - region.l >= 4 &&
      region.b - region.t >= 4
    ) {
      selectRegion(region);
    } else if (!area && region) {
      selectBoxes(boxesIn(region));
    } else if (!handle && !moved) {
      const box = boxAt(end);
      selectBoxes(box ? [box.id] : []);
    }
    updateHover(event);
    drawPreview();
  });

  element.addEventListener("pointerleave", () => {
    if (!state.drag && !pan && hovered) {
      hovered = "";
      element.style.cursor = "default";
      drawPreview();
    }
  });

  element.addEventListener("keydown", (event) => {
    if (
      !enabled() ||
      state.drag?.handle ||
      !state.boxes.length ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey
    )
      return;
    if (event.key === "Delete" && state.selected.size) {
      event.preventDefault();
      deleteBoxes(state.selected);
      return;
    }
    const index = state.boxes.findIndex((box) => state.selected.has(box.id));
    if (event.key === "Enter") {
      event.preventDefault();
      selectBoxes([state.boxes[(index + 1) % state.boxes.length].id]);
      return;
    }
    const offset = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }[event.key];
    if (
      state.selected.size !== 1 ||
      index < 0 ||
      !offset ||
      state.locked.has(state.boxes[index].id)
    )
      return;
    event.preventDefault();
    const box = state.boxes[index];
    const [dx, dy] = offset;
    if (event.shiftKey)
      adjustBox(box.id, "resize", box.r - box.l + dx, box.b - box.t + dy);
    else adjustBox(box.id, "move", box.l + dx, box.t + dy);
  });
  function cancelSelection() {
    closeBoxMenu();
    if (!state.drag && !pan) return;
    if (state.drag?.handle) finishBoxDrag();
    state.drag = null;
    pan = null;
    hovered = "";
    element.style.cursor = "default";
    drawPreview();
  }

  element.addEventListener("lostpointercapture", cancelSelection);
  element.addEventListener("pointercancel", cancelSelection);

  return {
    update(source, region, boxes, selected, locked) {
      if (source !== state.source)
        Object.assign(camera, { zoom: 1, x: 0, y: 0 });
      if (region !== state.region) {
        closeBoxMenu();
        hovered = "";
      }
      Object.assign(state, { source, region, boxes, selected, locked });
      if (!source) {
        view = undefined;
        element.width = element.height = 0;
        element.style.cursor = "default";
        return;
      }
      drawPreview();
    },
    fit() {
      Object.assign(camera, { zoom: 1, x: 0, y: 0 });
      drawPreview();
    },
    setBoxColor(color) {
      boxColor = color;
      drawPreview();
    },
    cancelSelection,
  };
}
