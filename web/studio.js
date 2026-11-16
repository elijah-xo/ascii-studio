"use strict";

import { defaults, palettes, motionPresets, History, readSettings, serializeSettings, dragPosition,
  readProject, serializeProject, MAX_PROJECT_BYTES } from "/static/model.mjs";
import { setupAnimation } from "/static/animation-ui.mjs";
import { setupRecovery } from "/static/recovery.mjs";
import { WorkStatus, leaveWarning } from "/static/work-status.mjs";

const $ = (id) => document.getElementById(id);
const apiKeys = ["rows", "bright", "mid", "blur", "mix", "zoom", "x", "y", "invert", "cutoff", "feather"];
const colors = ["bg", "ink", "shadow"];
const state = { file: null, image: null, map: null, view: "art", workspace: "portrait", ready: false, revision: 0, keepLoadedCrop: false };
let animation, recovery;
let history = new History(defaults);
let timer, uploadRevision = 0, activeConversion = false, pendingConversion = false;
const protection = new WorkStatus(), fileIds = new WeakMap();
let nextFileId = 1, warningActive = false;

function workKey(values = settings(), map = state.map, file = state.file) {
  if (!map && !file) return null;
  if (file && !fileIds.has(file)) fileIds.set(file, nextFileId++);
  return JSON.stringify([values, map?.map, map?.columns, file ? fileIds.get(file) : 0]);
}

function showProtection() {
  const value = protection.state;
  if ($("work-save-state").textContent !== value.label) $("work-save-state").textContent = value.label;
  $("work-save-state").dataset.state = value.kind;
  $("work-save-detail").textContent = value.detail;
  $("work-save-state").title = value.detail;
  $("save-menu").querySelector("summary").setAttribute("aria-label", `${value.label}. Saving details`);
  if (value.dirty !== warningActive) {
    window[value.dirty ? "addEventListener" : "removeEventListener"]("beforeunload", leaveWarning);
    warningActive = value.dirty;
  }
}

function workChanged() {
  if (protection.current(workKey())) recovery?.changed();
  showProtection();
}

function status(message, kind = "ready") {
  $("status").textContent = message;
  $("status-dot").className = `status-dot ${kind}`;
  $("drop-zone").setAttribute("aria-busy", String(kind === "busy"));
}

function ready(value) {
  state.ready = value;
  $("export-png").disabled = !value;
  $("export-svg").disabled = !value;
  $("preview-export").disabled = !value;
  $("save-project").disabled = !value;
  $("save-project-top").disabled = !value;
  if (value) { animation?.refresh(); recovery?.changed(); }
  else animation?.invalidate();
  workChanged();
}

function settings() {
  return Object.fromEntries(Object.entries(defaults).map(([id, value]) => [id,
    typeof value === "boolean" ? $(id).checked : typeof value === "number" ? Number($(id).value) : $(id).value,
  ]));
}

function conversionKey(values) { return JSON.stringify(apiKeys.map((key) => values[key])); }

function updateLabels() {
  const s = settings();
  $("rows-value").value = `${s.rows} rows`;
  $("bright-value").value = `${s.bright}%`;
  $("mid-value").value = `${s.mid}%`;
  $("blur-value").value = s.blur.toFixed(1);
  $("mix-value").value = s.mix.toFixed(2);
  $("zoom-value").value = `${s.zoom.toFixed(2)}×`;
  $("radius-value").value = `${s.radius.toFixed(2)}×`;
  $("cutoff-value").value = `${Math.round(s.cutoff * 100)}%`;
  $("feather-value").value = `${Math.round(s.feather * 100)}%`;
  $("circle-guide").hidden = !s.guide;
  document.querySelectorAll("[data-palette]").forEach((button) => {
    const selected = colors.every((key) => palettes[button.dataset.palette][key] === s[key]);
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

function updateHistory() {
  $("undo").disabled = !history.canUndo;
  $("redo").disabled = !history.canRedo;
}

function commit() { history.commit(settings()); updateHistory(); workChanged(); }

function applySettings(values) {
  const before = conversionKey(settings());
  for (const [id, value] of Object.entries(values)) {
    if (typeof defaults[id] === "boolean") $(id).checked = value;
    else $(id).value = value;
  }
  updateLabels();
  draw();
  if (state.file && before !== conversionKey(settings())) schedule();
  workChanged();
}
function artwork(size) {
  const { lattice: l, columns, map } = state.map;
  const rows = map.replace(/\n$/, "").split("\n");
  const k = size * 0.9 / Math.max(columns * l.px, rows.length * l.py + l.dim_dy);
  const ox = (size - columns * l.px * k) / 2;
  const oy = (size - (rows.length * l.py + l.dim_dy) * k) / 2;
  const dots = [];
  rows.forEach((row, j) => [...row].forEach((char, i) => {
    if (!"#.@rq".includes(char)) return;
    const dim = ".q".includes(char);
    dots.push({
      x: ox + (i + 0.5) * l.px * k,
      y: oy + ((j + 0.5) * l.py + (dim ? l.dim_dy : 0)) * k,
      r: (dim ? l.r_dim : l.r_big) * k * Number($("radius").value),
      color: $(dim ? "shadow" : "ink").value,
    });
  }));
  return dots;
}

function render(canvas, transparent = false) {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!transparent) {
    ctx.fillStyle = $("bg").value;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  if (!state.map) return;
  for (const dot of artwork(canvas.width)) {
    ctx.beginPath();
    ctx.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2);
    ctx.fillStyle = dot.color;
    ctx.fill();
  }
}


function drawSource() {
  const image = state.image;
  const { zoom, x, y } = settings();
  const side = Math.min(image.naturalWidth, image.naturalHeight) / zoom;
  const left = (image.naturalWidth - side) * x;
  const top = (image.naturalHeight - side) * y;
  const canvas = $("source-preview"), ctx = canvas.getContext("2d");
  ctx.fillStyle = $("bg").value;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Use the artwork's inset so source and dots line up in the comparison view.
  if (!state.map) return;
  const lattice = state.map.lattice;
  const rows = state.map ? state.map.map.replace(/\n$/, "").split("\n").length : Number($("rows").value);
  const height = rows * lattice.py;
  const columns = state.map?.columns || Math.floor(height / lattice.px);
  const scale = canvas.width * 0.9 / Math.max(columns * lattice.px, height + lattice.dim_dy);
  const ox = (canvas.width - columns * lattice.px * scale) / 2;
  const oy = (canvas.height - (height + lattice.dim_dy) * scale) / 2;
  ctx.drawImage(image, Math.round(left), Math.round(top), Math.round(left + side) - Math.round(left), Math.round(top + side) - Math.round(top), ox, oy, height * scale, height * scale);
}

function updateComparison() {
  const split = Number($("comparison").value);
  $("comparison-value").value = `${split}%`;
  $("source-preview").style.clipPath = state.view === "compare" ? `inset(0 ${100 - split}% 0 0)` : "none";
  $("split-line").style.left = `${split}%`;
}

function draw() {
  render($("preview"));
  for (const id of ["avatar32", "avatar64", "avatar96"]) {
    const canvas = $(id);
    canvas.getContext("2d").drawImage($("preview"), 0, 0, canvas.width, canvas.height);
  }
  if (state.image && state.view !== "art") drawSource();
  updateComparison();
  animation?.refresh();
  workChanged();
}

function setView(view) {
  state.view = view;
  for (const name of ["art", "source", "compare"]) $(name + "-view").setAttribute("aria-pressed", String(view === name));
  $("source-preview").hidden = view === "art" || state.workspace === "animation";
  $("comparison-controls").hidden = view !== "compare" || state.workspace === "animation";
  $("split-line").hidden = view !== "compare" || state.workspace === "animation";
  draw();
}

async function runConversion() {
  if (activeConversion || !pendingConversion || !state.file) return;
  activeConversion = true;
  pendingConversion = false;
  const revision = state.revision, file = state.file, values = settings();
  const parameters = Object.fromEntries(apiKeys.map((key) => [key, values[key]]));
  try {
    const response = await fetch(`/api/convert?${new URLSearchParams(parameters)}`, {
      method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file,
    });
    const data = await response.json();
    if (revision !== state.revision) return;
    if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "These settings could not be processed. Try resetting the controls.");
    state.map = data;
    ready(true);
    draw();
    $("dot-count").textContent = `${data.map.replace(/[^#.@rq]/g, "").length.toLocaleString()} DOTS`;
    status("Preview ready. Your original photo is unchanged.");
  } catch (error) {
    if (revision === state.revision) {
      ready(false);
      status(error.message || "Could not reach the editor. Check that its server is still running.", "error");
    }
  } finally {
    activeConversion = false;
    if (pendingConversion) runConversion();
  }
}

function schedule() {
  updateLabels();
  workChanged();
  if (!state.file) return;
  state.revision++;
  pendingConversion = false;
  clearTimeout(timer);
  ready(false);
  status("Updating… showing the last finished artwork until your changes are ready.", "busy");
  if (state.view !== "art") drawSource();
  // Finish at most one conversion, then process only the latest pending controls.
  timer = setTimeout(() => { pendingConversion = true; runConversion(); }, 250);
}

async function decodePhoto(file) {
  if (file.size > 12 * 1024 * 1024) throw new Error("Choose an image smaller than 12 MB.");
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Choose a JPEG, PNG, or WebP image.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (image.naturalWidth * image.naturalHeight > 24000000) throw new Error("Choose an image smaller than 24 megapixels.");
    return image;
  } finally { URL.revokeObjectURL(url); }
}

async function loadPhoto(file) {
  if (!file) return;
  const revision = ++uploadRevision;
  try {
    const image = await decodePhoto(file);
    if (revision !== uploadRevision) return;
    state.image = image;
    state.file = file;
    $("photo-controls").disabled = false;
    $("source-view").disabled = $("compare-view").disabled = false;
    document.querySelectorAll("[data-study]").forEach((button) => button.disabled = false);
    $("filename").textContent = `${file.name} · ${image.naturalWidth} × ${image.naturalHeight}`;
    $("canvas-label").textContent = "YOUR PORTRAIT / WORKING STUDY";
    if (!state.keepLoadedCrop) for (const id of ["zoom", "x", "y", "dustMask"]) $(id).value = defaults[id];
    state.keepLoadedCrop = false;
    history = new History(settings());
    updateHistory();
    setView("compare");
    schedule();
  } catch (error) {
    if (revision === uploadRevision) status(error.message || "This image could not be opened.", "error");
  }
}

function download(blob, extension, settingsFile = false) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const stem = state.file ? state.file.name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 70) : "bust";
  link.href = url;
  link.download = `${stem}-${extension === "dotstudio" ? "dot-studio-project" : extension === "zip" ? "dot-website-kit" : settingsFile ? "dot-studio-settings" : "dot-portrait"}.${extension}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  const stillUpdating = settingsFile && state.file && !state.ready;
  status(settingsFile ? `Settings downloaded without your photo.${stillUpdating ? " Preview still updating…" : ""}` : `${extension.toUpperCase()} downloaded. Ready for your next experiment.`, stillUpdating ? "busy" : "ready");
}

$("upload").addEventListener("click", () => $("file").click());
$("file").addEventListener("change", (event) => { loadPhoto(event.target.files[0]); event.target.value = ""; });
for (const id of apiKeys) {
  $(id).addEventListener("input", () => {
    if (id === "bright" && Number($("bright").value) > Number($("mid").value)) $("mid").value = $("bright").value;
    if (id === "mid" && Number($("mid").value) < Number($("bright").value)) $("bright").value = $("mid").value;
    schedule();
  });
  $(id).addEventListener("change", commit);
}
for (const id of ["radius", "guide", ...colors]) {
  $(id).addEventListener("input", () => { updateLabels(); draw(); });
  $(id).addEventListener("change", commit);
}
$("size").addEventListener("change", commit);
$("transparent").addEventListener("change", commit);
$("webAutoplay").addEventListener("change", commit);
document.querySelectorAll("[data-motion]").forEach(button => button.addEventListener("click", () => {
  applySettings({ ...settings(), ...motionPresets[button.dataset.motion] });
  commit();
}));
$("comparison").addEventListener("input", updateComparison);
for (const view of ["art", "source", "compare"]) $(view + "-view").addEventListener("click", () => setView(view));
document.querySelectorAll("[data-palette]").forEach((button) => button.addEventListener("click", () => {
  applySettings({ ...settings(), ...palettes[button.dataset.palette] });
  commit();
}));
document.querySelectorAll("[data-study]").forEach((button) => button.addEventListener("click", () => {
  const study = { soft: { rows: 40, bright: 65, mid: 90, blur: 6, mix: 0.5 }, bold: { rows: 32, bright: 78, mid: 92, blur: 4, mix: 0.9 }, fine: { rows: 72, bright: 58, mid: 86, blur: 2, mix: 0.7 } }[button.dataset.study];
  applySettings({ ...settings(), ...study });
  commit();
}));
$("reset").addEventListener("click", () => { applySettings(defaults); commit(); });
function stepHistory(redo) {
  const value = redo ? history.redo() : history.undo();
  if (value) applySettings(value);
  updateHistory();
}
$("undo").addEventListener("click", () => stepHistory(false));
$("redo").addEventListener("click", () => stepHistory(true));
document.addEventListener("keydown", (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.target.isContentEditable || event.target.tagName === "TEXTAREA") return;
  const key = event.key.toLowerCase();
  if (key !== "z" && key !== "y") return;
  event.preventDefault();
  stepHistory(key === "y" || event.shiftKey);
});

let drag = null;
$("source-preview").addEventListener("pointerdown", (event) => {
  if (drag || !state.image || event.button !== 0) return;
  event.preventDefault();
  drag = { pointer: event.pointerId, clientX: event.clientX, clientY: event.clientY, start: settings(), width: $("source-preview").getBoundingClientRect().width };
  $("source-preview").setPointerCapture(event.pointerId);
});
$("source-preview").addEventListener("pointermove", (event) => {
  if (!drag || drag.pointer !== event.pointerId) return;
  const position = dragPosition(drag.start, event.clientX - drag.clientX, event.clientY - drag.clientY, state.image.naturalWidth, state.image.naturalHeight, drag.width * 0.9);
  $("x").value = position.x;
  $("y").value = position.y;
  schedule();
});
for (const event of ["pointerup", "pointercancel", "lostpointercapture"]) $("source-preview").addEventListener(event, (pointer) => {
  if (drag?.pointer === pointer.pointerId) { drag = null; commit(); }
});

$("save-settings").addEventListener("click", () => download(new Blob([serializeSettings(settings())], { type: "application/json" }), "json", true));
$("save-project-top").addEventListener("click", () => $("save-project").click());
const headerMenus = [$("save-menu"), $("settings-menu")];
for (const menu of headerMenus) menu.addEventListener("toggle", () => {
  if (menu.open) for (const other of headerMenus) if (other !== menu) other.open = false;
});
document.addEventListener("pointerdown", event => {
  for (const menu of headerMenus) if (menu.open && !menu.contains(event.target)) menu.open = false;
});
document.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;
  const menu = headerMenus.find(item => item.open);
  if (menu) { menu.open = false; menu.querySelector("summary").focus(); }
});
for (const id of ["load-settings", "save-settings"]) $(id).addEventListener("click", () => $("settings-menu").open = false);
$("show-recovery").addEventListener("click", () => {
  $("save-menu").open = false;
  $("recovery-options").open = true;
  $("recovery-options").scrollIntoView({ block: "start" });
  $("remember-session").focus({ preventScroll: true });
});
async function projectSnapshot() {
  if (!state.ready) throw new Error("Wait for portrait conversion to finish.");
  const values = settings(), portrait = state.map, file = state.file, mode = state.workspace;
  let source = null;
  if (file) {
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(",")[1]);
      reader.onerror = () => reject(new Error("The original image could not be read. Try selecting it again."));
      reader.readAsDataURL(file);
    });
    source = { name: file.name, type: file.type, data };
  }
  return serializeProject(values, portrait, source, mode);
}
$("save-project").addEventListener("click", async () => {
  if (!state.ready) return;
  try {
    const key = workKey();
    const text = await projectSnapshot();
    download(new Blob([text], { type: "application/json" }), "dotstudio");
    protection.project = key; showProtection();
    status("Project export started. Keep the .dotstudio download to resume editing; it includes your original photo when one is selected.");
  } catch (error) { status(error.message || "The project could not be saved.", "error"); }
});
$("open-project").addEventListener("click", () => $("project-file").click());
async function restoreProject(text, isCurrent = () => true, fromProjectFile = true) {
  const revision = ++uploadRevision;
  const project = readProject(text);
  let photo = null, image = null;
  if (project.source) {
    const binary = atob(project.source.data), bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    photo = new File([bytes], project.source.name, { type: project.source.type });
    image = await decodePhoto(photo);
  }
  const lattice = state.map?.lattice || (await (await fetch("/api/sample")).json()).lattice;
  if (!lattice) throw new Error("The editor could not load its dot grid. Check the local server and try again.");
  if (revision !== uploadRevision || !isCurrent()) return false;
  clearTimeout(timer); pendingConversion = false; state.revision++;
  state.projectLoaded = true;
  state.file = null;
  state.image = null;
  applySettings(project.values);
  state.file = photo; state.image = image;
  state.map = { ...project.portrait, lattice };
  state.keepLoadedCrop = false;
  $("photo-controls").disabled = !photo;
  $("source-view").disabled = $("compare-view").disabled = !photo;
  document.querySelectorAll("[data-study]").forEach(button => button.disabled = !photo);
  $("filename").textContent = photo ? `${photo.name} · ${image.naturalWidth} × ${image.naturalHeight}` : "Project using the included artwork.";
  $("canvas-label").textContent = "YOUR PROJECT / WORKING STUDY";
  $("dot-count").textContent = `${state.map.map.replace(/[^#.@rq]/g, "").length.toLocaleString()} DOTS`;
  history = new History(settings()); updateHistory();
  state.view = "art";
  ready(true); workspace(project.workspace);
  if (fromProjectFile) { protection.project = workKey(); showProtection(); }
  status("Project opened. Photo, portrait, and animation restored.");
  return true;
}
$("project-file").addEventListener("change", async event => {
  const file = event.target.files[0]; event.target.value = "";
  if (!file) return;
  try {
    if (file.size > MAX_PROJECT_BYTES) throw new Error("Choose a project smaller than 18 MB.");
    const current = ++uploadRevision;
    const text = await file.text();
    if (current !== uploadRevision) return;
    await restoreProject(text);
  } catch (error) { status(`${error.message || "This project could not be opened."} Your current work is unchanged.`, "error"); }
});
$("load-settings").addEventListener("click", () => $("settings-file").click());
$("settings-file").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  try {
    if (file.size > 65536) throw new Error("This settings file is too large. Choose a Dot Studio JSON file under 64 KB.");
    const values = readSettings(await file.text());
    applySettings(values);
    commit();
    if (!state.file) {
      state.keepLoadedCrop = true;
      status("Settings loaded. Choose the original photo to resume; photos are not stored in settings files.");
    } else if (state.ready) status("Settings loaded onto your selected photo.");
  } catch (error) { status(error.message || "This settings file could not be read. Nothing was changed.", "error"); }
});
function downloadPNG(canvas) {
  canvas.toBlob((blob) => {
    if (blob) download(blob, "png");
    else status("PNG export failed. Try a smaller export size.", "error");
  }, "image/png");
}
$("export-png").addEventListener("click", () => {
  if (!state.ready) return;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = Number($("size").value);
  render(canvas, $("transparent").checked);
  downloadPNG(canvas);
});
function previewScale() {
  const canvas = $("export-preview-canvas");
  canvas.style.width = $("export-actual-size").checked ? `${canvas.width}px` : "100%";
}
$("preview-export").addEventListener("click", () => {
  if (!state.ready) return;
  const canvas = $("export-preview-canvas"), size = Number($("size").value);
  canvas.width = canvas.height = size;
  render(canvas, $("transparent").checked);
  $("export-preview-summary").textContent = `${size} × ${size} pixels · ${$("transparent").checked ? "Transparent background; checkerboard is not exported" : "Solid ground color"}. This is the PNG that will be downloaded.`;
  $("export-preview-stage").classList.toggle("checkerboard", $("transparent").checked);
  $("export-actual-size").checked = false; previewScale();
  $("export-dialog").showModal();
});
$("close-export-preview").addEventListener("click", () => $("export-dialog").close());
$("export-actual-size").addEventListener("change", previewScale);
$("download-preview-png").addEventListener("click", () => downloadPNG($("export-preview-canvas")));
function jumpTo(id) {
  $(id).scrollIntoView({ block: "start" });
  const target = $(id).querySelector("input:not(:disabled):not([type=hidden]), button:not(:disabled)");
  target?.focus({ preventScroll: true });
}
function mobileControls() { jumpTo(state.workspace === "animation" ? "animation-controls" : "photo-controls"); }
$("mobile-photo").addEventListener("click", () => $("file").click());
$("mobile-adjust").addEventListener("click", mobileControls);
$("mobile-controls").addEventListener("click", mobileControls);
$("mobile-export").addEventListener("click", () => jumpTo(state.workspace === "animation" ? "animation-export" : "still-export"));
$("export-svg").addEventListener("click", () => {
  if (!state.ready) return;
  const size = Number($("size").value);
  const circles = artwork(size).map((dot) => `<circle cx="${dot.x.toFixed(3)}" cy="${dot.y.toFixed(3)}" r="${dot.r.toFixed(3)}" fill="${dot.color}"/>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="100%" height="100%" fill="${$("bg").value}"/>${circles}</svg>`;
  download(new Blob([svg], { type: "image/svg+xml" }), "svg");
});
for (const event of ["dragenter", "dragover"]) document.addEventListener(event, (e) => { e.preventDefault(); $("drop-zone").classList.add("dragging"); });
document.addEventListener("dragleave", (e) => { if (!e.relatedTarget) $("drop-zone").classList.remove("dragging"); });
document.addEventListener("drop", (e) => { e.preventDefault(); $("drop-zone").classList.remove("dragging"); loadPhoto(e.dataTransfer.files[0]); });

async function loadSample() {
  try {
    const response = await fetch("/api/sample");
    if (!response.ok) throw new Error("The demo could not be loaded. Restart the local server and refresh.");
    const data = await response.json();
    if (state.file || state.projectLoaded) return;
    state.map = data;
    protection.baseline = workKey(defaults, data, null);
    draw();
    ready(true);
    $("dot-count").textContent = `${data.map.replace(/[^#.@rq]/g, "").length.toLocaleString()} DOTS`;
    status("Demo artwork. Choose your photo to make it personal.");
  } catch (error) { if (!state.file && !state.projectLoaded) status(error.message, "error"); }
}
animation = setupAnimation({ getMap: () => state.map, getSettings: settings, isPortraitReady: () => state.ready,
  onCommit: commit, onDownload: download, onChange: workChanged });
function workspace(name) {
  state.workspace = name;
  document.body.classList.toggle("animation-mode", name === "animation");
  $("portrait-workspace").setAttribute("aria-pressed", String(name === "portrait"));
  $("animation-workspace").setAttribute("aria-pressed", String(name === "animation"));
  $("animation-controls").hidden = $("animation-export").hidden = name !== "animation";
  $("photo-controls").hidden = $("still-export").hidden = name === "animation";
  document.querySelector("h1").textContent = name === "animation" ? "A portrait, in motion." : "A portrait, reduced.";
  if (name === "animation") animation.enter();
  else animation.exit();
  setView(state.view);
  recovery?.changed();
}
$("portrait-workspace").addEventListener("click", () => workspace("portrait"));
$("animation-workspace").addEventListener("click", () => workspace("animation"));
recovery = setupRecovery({ snapshot: projectSnapshot, restore: (text, current) => restoreProject(text, current, false),
  isReady: () => state.ready, getKey: workKey, onState: (phase, key) => {
    if (phase === "saving") protection.browserSaving(key);
    if (phase === "saved") protection.browserSaved(key);
    if (phase === "failed") protection.browserFailed(key);
    if (phase === "cleared") protection.browserCleared();
    showProtection();
  } });
updateLabels();
updateHistory();
showProtection();
loadSample();
