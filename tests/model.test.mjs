import test from "node:test";
import assert from "node:assert/strict";
import { defaults, animationDefaults, readSettings, serializeSettings, History, dragPosition,
  readProject, serializeProject, rectangleMask, paintMask, dustSelected, motionPresets, reverseWind } from "../web/model.mjs";

test("settings round-trip only the known, validated controls", () => {
  const values = { ...defaults, zoom: 2, cutoff: 0.3, bg: "#ffffff", guide: true };
  assert.deepEqual(readSettings(serializeSettings(values)), values);
  assert.ok(!serializeSettings(values).includes("data:image"));
  const document = JSON.parse(serializeSettings(values));
  document.values.unrelated = "ignored";
  assert.deepEqual(readSettings(JSON.stringify(document)), values);
});

test("reject malformed or unsafe settings without changing the original", () => {
  const original = { ...defaults };
  for (const values of [
    { ...defaults, zoom: 0 }, { ...defaults, rows: 20.5 },
    { ...defaults, bright: 95, mid: 80 }, { ...defaults, radius: "1" },
    { ...defaults, bg: '<script>' }, { ...defaults, guide: "true" },
    { ...defaults, feather: null }, { ...defaults, size: 99999 },
  ]) assert.throws(() => readSettings(serializeSettings(values)));
  assert.throws(() => readSettings('{"format":"dot-studio-settings","version":6}'));
  assert.throws(() => readSettings("null"));
  assert.throws(() => readSettings("not json"));
  assert.deepEqual(defaults, original);
});

test("dust color migrates without changing older motion, and reverse wind points opposite", () => {
  const values = { ...defaults }; delete values.dustColor; delete values.dustTint;
  assert.deepEqual(readSettings(JSON.stringify({ format: "dot-studio-settings", version: 4, values })), defaults);
  const custom = { ...defaults, dustColor: "#00ff00", dustTint: true };
  assert.deepEqual(readSettings(serializeSettings(custom)), custom);
  assert.throws(() => readSettings(serializeSettings({ ...custom, dustColor: "red" })));
  for (const angle of [-180, -160, -90, 0, 90, 180]) {
    const opposite = reverseWind(angle);
    assert.ok(opposite >= -180 && opposite <= 180);
    assert.equal(Math.abs(opposite - angle), 180);
    assert.ok(Math.abs(Math.cos(opposite * Math.PI / 180) + Math.cos(angle * Math.PI / 180)) < 1e-10);
  }
});

test("old settings gain export defaults, and motion presets preserve portrait and mask", () => {
  const old = { ...defaults }; delete old.transparent; delete old.webAutoplay;
  assert.deepEqual(readSettings(JSON.stringify({ format: "dot-studio-settings", version: 3, values: old })), defaults);
  const chosen = { ...defaults, zoom: 2, dustMask: "01".repeat(2048), transparent: true, webAutoplay: false };
  for (const preset of Object.values(motionPresets)) {
    const next = readSettings(serializeSettings({ ...chosen, ...preset }));
    assert.equal(next.zoom, 2); assert.equal(next.dustMask, chosen.dustMask);
    assert.equal(next.transparent, true); assert.equal(next.webAutoplay, false);
  }
  assert.throws(() => readSettings(serializeSettings({ ...defaults, transparent: "true" })));
});

test("version 2 settings load without a brush mask; version 3 validates and preserves it", () => {
  const values = { ...defaults }; delete values.dustMask;
  assert.deepEqual(readSettings(JSON.stringify({ format: "dot-studio-settings", version: 2, values })), defaults);
  const painted = { ...defaults, dustMask: "10".repeat(2048) };
  assert.deepEqual(readSettings(serializeSettings(painted)), painted);
  for (const dustMask of ["1", "x".repeat(4096), "1".repeat(4097), null]) {
    assert.throws(() => readSettings(serializeSettings({ ...defaults, dustMask })));
  }
});

test("brush connects fast strokes, erases locally, and leaves distant cells untouched", () => {
  const empty = "0".repeat(4096);
  const start = { x: 0.1, y: 0.5 }, end = { x: 0.9, y: 0.5 };
  const line = paintMask(empty, start, end, 0.04);
  assert.ok(dustSelected({ ...defaults, dustMask: line }, 0.5, 0.5));
  assert.equal(dustSelected({ ...defaults, dustMask: line }, 0.5, 0.1), false);
  const erased = paintMask(line, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, 0.08, true);
  assert.equal(dustSelected({ ...defaults, dustMask: erased }, 0.5, 0.5), false);
  assert.ok(dustSelected({ ...defaults, dustMask: erased }, 0.2, 0.5));
  const rectangle = rectangleMask(defaults);
  assert.ok(dustSelected({ ...defaults, dustMask: rectangle }, 0.2, 0.5));
  assert.equal(dustSelected({ ...defaults, dustMask: rectangle }, 0.9, 0.5), false);
  const history = new History(defaults);
  history.commit({ ...defaults, dustMask: line });
  history.commit({ ...defaults, dustMask: erased });
  assert.equal(history.undo().dustMask, line);
  assert.equal(history.redo().dustMask, erased);
});

test("projects round-trip photo bytes, exact portrait, brush, controls, and workspace", () => {
  const values = { ...defaults, zoom: 2, dustMask: "01".repeat(2048) };
  const portrait = { map: "# .\n @ \n", columns: 3, lattice: { ignored: true } };
  const source = { name: "photo.png", type: "image/png", data: "AQIDBA==" };
  const text = serializeProject(values, portrait, source, "animation");
  assert.deepEqual(readProject(text), { values, portrait: { map: portrait.map, columns: 3 }, source, workspace: "animation" });
  assert.equal(readProject(serializeProject(defaults, portrait, null, "portrait")).source, null);
  assert.ok(!serializeSettings(values).includes(source.data));
  const p = JSON.parse(text);
  for (const changes of [{ version: 99 }, { workspace: "other" }, { portrait: { map: "<script>", columns: 8 } },
    { portrait: { map: "#".repeat(201), columns: 201 } }, { portrait: { map: "#\n".repeat(101), columns: 1 } },
    { source: { ...source, type: "image/svg+xml" } }, { source: { ...source, data: "https://private" } },
    { source: { ...source, data: "AQ?=" } }, { settings: { ...p.settings, values: { ...values, zoom: 99 } } }]) {
    assert.throws(() => readProject(JSON.stringify({ ...p, ...changes })));
  }
});

test("old portrait settings gain animation defaults without changing the portrait", () => {
  const portrait = Object.fromEntries(Object.entries(defaults).filter(([key]) => !(key in animationDefaults)));
  const loaded = readSettings(JSON.stringify({ format: "dot-studio-settings", version: 1, values: { ...portrait, zoom: 2 } }));
  assert.deepEqual(loaded, { ...defaults, zoom: 2 });
  for (const values of [{...defaults, duration: 99}, {...defaults, videoSize: 2048},
    {...defaults, dustLeft: 0.8, dustRight: 0.2}, {...defaults, windStrength: 0}]) {
    assert.throws(() => readSettings(serializeSettings(values)));
  }
});

test("undo and redo isolate snapshots and discard abandoned redo branches", () => {
  const history = new History(defaults);
  const second = { ...defaults, zoom: 2 };
  history.commit(second);
  second.zoom = 3;
  history.commit({ ...defaults, zoom: 2 });
  assert.equal(history.entries.length, 2);
  assert.equal(history.undo().zoom, 1);
  assert.equal(history.redo().zoom, 2);
  history.undo();
  history.commit({ ...defaults, zoom: 1.5 });
  assert.equal(history.canRedo, false);
  for (let i = 0; i < 100; i++) history.commit({ ...defaults, x: i / 100 });
  assert.equal(history.entries.length, 60);
  while (history.canUndo) history.undo();
  assert.equal(history.undo(), undefined);
});

test("crop dragging clamps at edges and handles axes with no spare image", () => {
  const start = { zoom: 1, x: 0.5, y: 0.5 };
  assert.deepEqual(dragPosition(start, 500, 500, 400, 600, 400), { x: 0.5, y: 0 });
  assert.deepEqual(dragPosition(start, -500, -500, 400, 600, 400), { x: 0.5, y: 1 });
  const square = dragPosition({ ...start, zoom: 2 }, 50, -50, 400, 400, 400);
  assert.equal(square.x, 0.375);
  assert.equal(square.y, 0.625);
});
