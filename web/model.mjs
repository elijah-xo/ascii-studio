export const animationDefaults = {
  duration: 8, windAngle: -160, windStrength: 1, dustDensity: 0.65,
  dustLeft: 0, dustTop: 0.1, dustRight: 0.6, dustBottom: 0.9, videoSize: 512, dustMask: "",
  dustColor: "#f2f2f0", dustTint: false,
};

export const defaults = {
  rows: 48, bright: 58, mid: 86, blur: 4, mix: 0.7,
  zoom: 1, x: 0.5, y: 0.5, invert: false, cutoff: 0.12, feather: 0,
  radius: 1, bg: "#161616", ink: "#f2f2f0", shadow: "#70706e", size: 1024, guide: false,
  transparent: false, webAutoplay: true,
  ...animationDefaults,
};

export const palettes = {
  ivory: { bg: "#161616", ink: "#f2f2f0", shadow: "#70706e" },
  ember: { bg: "#1b1415", ink: "#f6a18c", shadow: "#8d4c49" },
  paper: { bg: "#e9e1d0", ink: "#282a27", shadow: "#969183" },
};

export const motionPresets = {
  gentle: { duration: 10, windAngle: -150, windStrength: 0.45, dustDensity: 0.25 },
  wind: { duration: 4, windAngle: -170, windStrength: 2.4, dustDensity: 1 },
  dissolve: { duration: 12, windAngle: -120, windStrength: 0.7, dustDensity: 0.9 },
};

export function reverseWind(angle) { return angle > 0 ? angle - 180 : angle + 180; }

const limits = {
  rows: [16, 80], bright: [0, 100], mid: [0, 100], blur: [0, 10], mix: [0, 1.2],
  zoom: [1, 3], x: [0, 1], y: [0, 1], cutoff: [0, 0.9], feather: [0, 0.3], radius: [0.5, 1.6],
  duration: [2, 12], windAngle: [-180, 180], windStrength: [0.25, 3], dustDensity: [0, 1],
  dustLeft: [0, 1], dustTop: [0, 1], dustRight: [0, 1], dustBottom: [0, 1],
};

export function readSettings(text) {
  const document = JSON.parse(text);
  if (!document || document.format !== "dot-studio-settings" || ![1, 2, 3, 4, 5].includes(document.version)) {
    throw new Error("Choose a Dot Studio settings file (version 1–5).");
  }
  const values = document.values;
  if (!values || typeof values !== "object") throw new Error("The settings file has no controls.");
  const clean = {};
  for (const key of Object.keys(defaults)) {
    const missingLegacy = !(key in values) && (document.version === 1 && key in animationDefaults
      || document.version < 3 && key === "dustMask" || document.version < 4 && ["transparent", "webAutoplay"].includes(key)
      || document.version < 5 && ["dustColor", "dustTint"].includes(key));
    const value = missingLegacy ? defaults[key] : values[key];
    let valid;
    if (key in limits) {
      valid = typeof value === "number" && Number.isFinite(value) && value >= limits[key][0] && value <= limits[key][1];
      if (["rows", "duration"].includes(key)) valid = valid && Number.isInteger(value);
    } else if (["bg", "ink", "shadow", "dustColor"].includes(key)) {
      valid = typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
    } else if (key === "dustMask") valid = typeof value === "string" && (value === "" || /^[01]{4096}$/.test(value));
    else if (key === "size") valid = [512, 1024, 2048].includes(value);
    else if (key === "videoSize") valid = [512, 1024].includes(value);
    else valid = typeof value === "boolean";
    if (!valid) throw new Error(`Invalid or missing setting: ${key}. Nothing was changed.`);
    clean[key] = value;
  }
  if (clean.bright > clean.mid) throw new Error("Highlight coverage exceeds total coverage. Nothing was changed.");
  if (clean.dustLeft >= clean.dustRight || clean.dustTop >= clean.dustBottom) throw new Error("Choose a non-empty dust area. Nothing was changed.");
  return clean;
}

export function serializeSettings(values) {
  return JSON.stringify({ format: "dot-studio-settings", version: 5, values }, null, 2);
}

export const MASK_SIZE = 64;
export const MAX_PHOTO_BYTES = 12 * 1024 * 1024;
export const MAX_PROJECT_BYTES = 18 * 1024 * 1024;

export function dustSelected(s, x, y) {
  if (s.dustMask) return s.dustMask[Math.min(63, Math.floor(y * 64)) * 64 + Math.min(63, Math.floor(x * 64))] === "1";
  return x >= s.dustLeft && x < s.dustRight && y >= s.dustTop && y < s.dustBottom;
}

export function rectangleMask(s) {
  return Array.from({ length: 4096 }, (_, i) => dustSelected({ ...s, dustMask: "" }, (i % 64 + 0.5) / 64, (Math.floor(i / 64) + 0.5) / 64) ? "1" : "0").join("");
}

export function paintMask(mask, start, end, radius, erase = false) {
  const dx = end.x - start.x, dy = end.y - start.y, length = dx * dx + dy * dy;
  return [...mask].map((bit, i) => {
    const x = (i % 64 + 0.5) / 64, y = (Math.floor(i / 64) + 0.5) / 64;
    const t = length ? Math.max(0, Math.min(1, ((x - start.x) * dx + (y - start.y) * dy) / length)) : 0;
    return (x - start.x - t * dx) ** 2 + (y - start.y - t * dy) ** 2 <= radius * radius ? (erase ? "0" : "1") : bit;
  }).join("");
}

export function readProject(text) {
  if (text.length > MAX_PROJECT_BYTES) throw new Error("Choose a project smaller than 18 MB.");
  const p = JSON.parse(text);
  if (!p || p.format !== "dot-studio-project" || p.version !== 1) throw new Error("Choose a Dot Studio project file (version 1).");
  const values = readSettings(JSON.stringify(p.settings));
  const portrait = p.portrait;
  if (!portrait || typeof portrait.map !== "string" || portrait.map.length > 20100 || !/^[#. @rq\n]+$/.test(portrait.map)
    || !/[#.@rq]/.test(portrait.map) || !Number.isInteger(portrait.columns) || portrait.columns < 1 || portrait.columns > 200) throw new Error("Invalid project portrait.");
  const rows = portrait.map.replace(/\n$/, "").split("\n");
  if (rows.length > 100 || rows.some(row => row.length > portrait.columns)) throw new Error("Invalid project portrait dimensions.");
  if (!["portrait", "animation"].includes(p.workspace)) throw new Error("Invalid project workspace.");
  let source = null;
  if (p.source !== null) {
    const s = p.source;
    if (!s || typeof s.name !== "string" || !s.name.length || s.name.length > 255 || !["image/jpeg", "image/png", "image/webp"].includes(s.type)
      || typeof s.data !== "string" || !s.data.length || s.data.length > Math.ceil(MAX_PHOTO_BYTES / 3) * 4
      || s.data.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(s.data)) throw new Error("Invalid project image.");
    source = { name: s.name, type: s.type, data: s.data };
  }
  return { values, portrait: { map: portrait.map, columns: portrait.columns }, workspace: p.workspace, source };
}

export function serializeProject(values, portrait, source, workspace) {
  const text = JSON.stringify({ format: "dot-studio-project", version: 1,
    settings: JSON.parse(serializeSettings(values)), portrait: { map: portrait.map, columns: portrait.columns }, source, workspace });
  readProject(text);
  return text;
}

export class History {
  constructor(values) { this.entries = [{ ...values }]; this.index = 0; }
  get canUndo() { return this.index > 0; }
  get canRedo() { return this.index < this.entries.length - 1; }
  commit(values) {
    if (JSON.stringify(values) === JSON.stringify(this.entries[this.index])) return;
    this.entries.splice(this.index + 1);
    this.entries.push({ ...values });
    if (this.entries.length > 60) this.entries.shift();
    this.index = this.entries.length - 1;
  }
  undo() { if (this.canUndo) return { ...this.entries[--this.index] }; }
  redo() { if (this.canRedo) return { ...this.entries[++this.index] }; }
}

export function dragPosition(start, dx, dy, width, height, displaySize) {
  const side = Math.min(width, height) / start.zoom;
  const clamp = (v) => Math.max(0, Math.min(1, v));
  return {
    x: width > side ? clamp(start.x - dx * side / displaySize / (width - side)) : start.x,
    y: height > side ? clamp(start.y - dy * side / displaySize / (height - side)) : start.y,
  };
}
