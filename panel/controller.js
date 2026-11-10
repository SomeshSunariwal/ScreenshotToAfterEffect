"use strict";

const ui = Object.fromEntries([
  "source", "file", "upload", "image-area", "capture", "count", "count-slider", "padding", "padding-value",
  "drop", "viewport", "empty", "preview", "box-total", "reset-region", "source-info", "source-size", "fit-view", "reset-boxes",
  "box-color", "box-menu", "box-lock", "box-action", "help-toggle", "panel-help",
  "animate", "animation-duration", "animation-stagger", "animation-style", "animation-effect", "create", "status"
].map(id => [id, document.getElementById(id)]));

const { canvas, decodeImage } = ScreenshotMedia;
const countSlider = ui["count-slider"];
const timingInputs = [ui["animation-duration"], ui["animation-stagger"]];
const animationOptions = [...timingInputs, ui["animation-style"], ui["animation-effect"]];
const dropdowns = [ui["box-color"], ui["animation-style"], ui["animation-effect"]].map(createDropdown);
const savedBoxes = new Map();
const excludedBoxes = new Map();
const lockedBoxes = new Map();
let nextManualBox = 0;
const state = { source: null, region: null, pixels: null, boxes: [], selected: new Set(), limit: ui.count.valueAsNumber, imageArea: false, busy: false };
const preview = createPreview(ui.viewport, ui.preview, {
  enabled: () => !state.busy, canSelectRegion: () => state.imageArea,
  selectRegion: setRegion, selectBoxes, adjustBox, boxColor: ui["box-color"].value,
  actionMenu: ui["box-menu"], lockButton: ui["box-lock"], actionButton: ui["box-action"],
  addBoxAt, toggleBoxLocks, deleteBoxes,
  showZoom(label) {
    if (ui["fit-view"].textContent !== label) ui["fit-view"].textContent = label;
  }
});

function status(message, error = false) {
  ui.status.textContent = message;
  ui.status.dataset.error = error;
}

function syncControls() {
  ui.upload.disabled = state.busy;
  ui["image-area"].disabled = !state.source || state.busy;
  ui["image-area"].setAttribute("aria-pressed", String(state.imageArea));
  ui.capture.disabled = state.busy || !ScreenshotAE.available;
  ui.count.disabled = countSlider.disabled = ui.padding.disabled = !state.source || state.busy;
  ui["reset-region"].disabled = state.busy;
  ui["fit-view"].disabled = state.busy;
  ui["reset-boxes"].disabled = state.busy || (!savedBoxes.size && !excludedBoxes.size && !lockedBoxes.size);
  ui.animate.disabled = state.busy;
  for (const option of animationOptions) option.disabled = state.busy || !ui.animate.checked;
  for (const sync of dropdowns) sync();
  ui.create.disabled = !ScreenshotAE.available || !state.boxes.length || state.busy;
}

async function run(message, action) {
  if (state.busy) return;
  state.busy = true;
  preview.cancelSelection();
  syncControls();
  status(message);
  try {
    status(await action());
  } catch (error) {
    status(error.message, true);
  } finally {
    state.busy = false;
    syncControls();
  }
}

async function openFile(file) {
  if (!file) return;
  await run("Reading image…", async () => {
    let image;
    try {
      image = await decodeImage(file, file.name);
    } catch (browserError) {
      if (!ScreenshotAE.available) throw new Error("This image needs the After Effects importer. Open Screenshot2AE inside After Effects to try it.");
      image = await ScreenshotAE.decodeFile(file);
    }
    setSource(image, file.name, file.name.replace(/\.[^.]+$/, "") || "Screenshot");
    return "";
  });
}

function setSource(image, label, name) {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!width || !height) throw new Error("The image has no readable dimensions.");
  if (state.source && state.source.image.close) state.source.image.close();
  state.source = { image, name, label, width, height };
  state.imageArea = false;
  ui.empty.hidden = true;
  ui.preview.hidden = ui["box-total"].hidden = ui["source-size"].hidden = ui["fit-view"].hidden = false;
  ui["reset-boxes"].hidden = false;
  setRegion(null);
}

function clearBoxEdits() {
  savedBoxes.clear();
  excludedBoxes.clear();
  lockedBoxes.clear();
  state.selected.clear();
}

function setRegion(selection) {
  const { image, width, height, label } = state.source;
  const full = { l: 0, t: 0, r: width, b: height };
  state.region = selection || full;
  clearBoxEdits();
  const { l, t, r, b } = state.region;
  const w = r - l;
  const h = b - t;
  const scale = Math.min(1, 1440 / Math.max(w, h));
  const small = canvas(Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)));
  const context = small.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, l, t, w, h, 0, 0, small.width, small.height);
  state.pixels = context.getImageData(0, 0, small.width, small.height);
  ui["source-info"].textContent = ui["source-info"].title = label;
  ui["source-size"].textContent = `${w} × ${h}`;
  ui["reset-region"].hidden = !selection;
  updateBoxes();
}

function updateBoxes() {
  const count = ui.count.valueAsNumber;
  if (Number.isInteger(count) && count >= Number(ui.count.min) && count <= Number(ui.count.max)) {
    state.limit = count;
  }
  countSlider.value = Math.min(state.limit, Number(countSlider.max));
  ui["padding-value"].value = `${ui.padding.value} px`;
  if (!state.pixels) return;
  const { l, t, r, b } = state.region;
  const limit = state.limit;
  if (state.analysis?.pixels !== state.pixels || state.analysis.limit !== limit) {
    state.analysis = { pixels: state.pixels, limit, boxes: ScreenshotBoxes.splitBoxes(state.pixels, limit) };
  }
  const sx = (r - l) / state.pixels.width;
  const sy = (b - t) / state.pixels.height;
  const detected = ScreenshotBoxes.scaleBoxes(state.analysis.boxes, sx, sy, 0);
  state.detectedBounds = new Map(detected.map(box => [box.id, box]));
  const padding = Number(ui.padding.value);
  const candidates = padding ? ScreenshotBoxes.scaleBoxes(state.analysis.boxes, sx, sy, padding) : detected;
  const pinned = new Map(savedBoxes);
  const excluded = [...excludedBoxes.values()];
  for (const [id, { box, origin }] of lockedBoxes) {
    pinned.set(id, box);
    excluded.push(origin);
  }
  const preserved = [...pinned.values()];
  // Edits and locks take priority over regenerated boxes, including merged boxes.
  state.boxes = candidates.filter(box => !excludedBoxes.has(box.id) && !pinned.has(box.id)
    && !excluded.some(area => ScreenshotBoxes.overlaps(state.detectedBounds.get(box.id), area))
    && !preserved.some(other => ScreenshotBoxes.overlaps(box, other))).concat(preserved);
  refreshBoxList();
}

function refreshBoxList(selected = state.selected) {
  state.boxes.sort(ScreenshotBoxes.byPosition);
  ui["box-total"].textContent = state.boxes.length === 1 ? "1 box" : `${state.boxes.length} boxes`;
  selectBoxes(selected);
}

function selectBoxes(ids) {
  const requested = new Set(ids);
  state.selected = new Set(state.boxes.filter(box => requested.has(box.id)).map(box => box.id));
  syncControls();
  preview.update(state.source, state.region, state.boxes, state.selected, lockedBoxes);
}

function addBoxAt(point) {
  const { x, y } = point;
  const { l, t, r, b } = state.region;
  const width = r - l;
  const height = b - t;
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const sx = width / state.pixels.width;
  const sy = height / state.pixels.height;
  const room = ScreenshotBoxes.roomForBox(point, {
    l: Math.max(0, x - Math.ceil(90 * sx)), t: Math.max(0, y - Math.ceil(64 * sy)),
    r: Math.min(width, x + Math.ceil(90 * sx)), b: Math.min(height, y + Math.ceil(64 * sy))
  }, state.boxes);
  if (!room) return;

  const w = room.r - room.l;
  const h = room.b - room.t;
  const sample = canvas(Math.max(1, Math.round(w / sx)), Math.max(1, Math.round(h / sy)));
  const context = sample.getContext("2d", { willReadFrequently: true });
  context.drawImage(state.source.image, l + room.l, t + room.t, w, h, 0, 0, sample.width, sample.height);
  const pixels = context.getImageData(0, 0, sample.width, sample.height);
  const detected = ScreenshotBoxes.splitBoxes(pixels, 12, { keepLongEdges: true })
    .filter(({ content, bounds }) => content !== bounds);
  const candidate = ScreenshotBoxes.scaleBoxes(detected, w / sample.width, h / sample.height, Number(ui.padding.value))
    .find(box => x - room.l >= box.l && x - room.l < box.r && y - room.t >= box.t && y - room.t < box.b);
  const geometry = candidate ? {
    l: candidate.l + room.l, t: candidate.t + room.t, r: candidate.r + room.l, b: candidate.b + room.t
  } : {
    l: Math.max(room.l, x - Math.ceil(36 * sx)), t: Math.max(room.t, y - Math.ceil(20 * sy)),
    r: Math.min(room.r, x + Math.ceil(36 * sx)), b: Math.min(room.b, y + Math.ceil(20 * sy))
  };
  const box = { ...geometry, id: `manual-${++nextManualBox}` };
  savedBoxes.set(box.id, box);
  state.boxes.push(box);
  refreshBoxList([box.id]);
}

function excludeBox(box) {
  if (!excludedBoxes.has(box.id)) {
    excludedBoxes.set(box.id, lockedBoxes.get(box.id)?.origin || state.detectedBounds.get(box.id) || box);
  }
}

function toggleBoxLocks(ids) {
  const boxes = state.boxes.filter(box => ids.has(box.id));
  if (boxes.every(box => lockedBoxes.has(box.id))) {
    for (const box of boxes) lockedBoxes.delete(box.id);
    updateBoxes();
  } else {
    for (const box of boxes) {
      if (!lockedBoxes.has(box.id)) {
        lockedBoxes.set(box.id, { box, origin: excludedBoxes.get(box.id) || state.detectedBounds.get(box.id) || box });
      }
    }
    refreshBoxList();
  }
}

function deleteBoxes(ids) {
  const removed = new Set(ids);
  state.boxes = state.boxes.filter(box => {
    if (!removed.has(box.id)) return true;
    excludeBox(box);
    savedBoxes.delete(box.id);
    lockedBoxes.delete(box.id);
    return false;
  });
  refreshBoxList();
}

function adjustBox(id, mode, x, y) {
  if (lockedBoxes.has(id)) return;
  const index = state.boxes.findIndex(box => box.id === id);
  if (index < 0) return;
  const box = state.boxes[index];
  const { l, t, r, b } = state.region;
  const updated = mode === "move"
    ? ScreenshotBoxes.moveBox(box, x, y, r - l, b - t, state.boxes)
    : ScreenshotBoxes.resizeBox(box, x, y, r - l, b - t, state.boxes, mode === "resize-top-left");
  if (updated.l === box.l && updated.t === box.t && updated.r === box.r && updated.b === box.b) return;
  if (!savedBoxes.has(id)) excludeBox(box);
  savedBoxes.set(id, updated);
  state.boxes[index] = updated;
  refreshBoxList();
}

ui.upload.addEventListener("click", () => ui.file.click());
ui["image-area"].addEventListener("click", () => {
  state.imageArea = !state.imageArea;
  preview.cancelSelection();
  syncControls();
});
ui.file.addEventListener("change", () => {
  const file = ui.file.files[0];
  ui.file.value = "";
  openFile(file);
});
ui.capture.addEventListener("click", () => run("Loading the selected image…", async () => {
  const result = await ScreenshotAE.loadSelectedImage();
  setSource(result.image, result.name, result.name);
  return "";
}));
function readSeconds(input) {
  const value = input.valueAsNumber;
  const seconds = Number.isFinite(value) ? Math.max(0, value) : Number(input.defaultValue);
  input.value = seconds;
  return seconds;
}

for (const input of timingInputs) {
  input.addEventListener("change", () => readSeconds(input));
}

ui.create.addEventListener("click", () => run("Creating layers…", async () => {
  const { source, region, boxes } = state;
  const animation = ui.animate.checked ? {
    duration: readSeconds(ui["animation-duration"]),
    stagger: readSeconds(ui["animation-stagger"]),
    style: ui["animation-style"].value,
    effect: ui["animation-effect"].value
  } : null;
  const name = await ScreenshotAE.createLayers({ source, region, boxes, animation });
  return "Created " + boxes.length + (boxes.length === 1 ? " layer" : " layers") + " plus background in “" + name + "”.";
}));
ui.animate.addEventListener("change", syncControls);
ui["box-color"].addEventListener("change", () => preview.setBoxColor(ui["box-color"].value));
ui["reset-region"].addEventListener("click", () => setRegion(null));
ui["fit-view"].addEventListener("click", preview.fit);
ui["reset-boxes"].addEventListener("click", () => {
  preview.cancelSelection();
  clearBoxEdits();
  updateBoxes();
});

function setHelpOpen(open) {
  ui["panel-help"].hidden = !open;
  ui["help-toggle"].setAttribute("aria-expanded", String(open));
}

ui["help-toggle"].addEventListener("click", () => setHelpOpen(ui["panel-help"].hidden));
document.addEventListener("pointerdown", event => {
  if (!ui["panel-help"].hidden && !ui["panel-help"].contains(event.target) && !ui["help-toggle"].contains(event.target)) {
    setHelpOpen(false);
  }
});
document.addEventListener("keydown", event => {
  if (event.key !== "Escape" || ui["panel-help"].hidden) return;
  event.preventDefault();
  setHelpOpen(false);
  ui["help-toggle"].focus({ preventScroll: true });
});

let scheduled = 0;
function queueBoxes() {
  cancelAnimationFrame(scheduled);
  scheduled = requestAnimationFrame(updateBoxes);
}
function applySliderLimit() {
  if (ui.count.value === countSlider.value) return;
  ui.count.value = countSlider.value;
  queueBoxes();
}
countSlider.addEventListener("input", applySliderLimit);
countSlider.addEventListener("click", applySliderLimit);
ui.count.addEventListener("input", () => {
  if (ui.count.validity.valid) queueBoxes();
});
ui.count.addEventListener("change", () => {
  const { valueAsNumber, min, max } = ui.count;
  ui.count.value = Number.isFinite(valueAsNumber)
    ? Math.max(Number(min), Math.min(Number(max), Math.round(valueAsNumber))) : state.limit;
  queueBoxes();
});
ui.padding.addEventListener("input", queueBoxes);

for (const target of [ui.source, ui.drop]) {
  target.addEventListener("dragover", event => {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = state.busy ? "none" : "copy";
    target.classList.toggle("is-over", !state.busy);
  });
  target.addEventListener("dragleave", event => {
    if (!target.contains(event.relatedTarget)) target.classList.remove("is-over");
  });
  target.addEventListener("drop", event => {
    event.preventDefault();
    target.classList.remove("is-over");
    openFile(event.dataTransfer.files[0]);
  });
}
window.addEventListener("dragover", event => event.preventDefault());
window.addEventListener("drop", event => event.preventDefault());

syncControls();
if (!ScreenshotAE.available) status("Open Screenshot2AE inside After Effects to use a selected layer or create layers.");
