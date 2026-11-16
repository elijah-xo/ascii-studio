import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { defaults } from '../web/model.mjs';
import { setupAnimation } from '../web/animation-ui.mjs';

test('touch strokes capture one pointer, ignore a second finger, and finish once on cancellation', async () => {
  const original = Object.fromEntries(['document','window','fetch','requestAnimationFrame','cancelAnimationFrame'].map(key => [key, globalThis[key]]));
  const elements = new Map();
  const drawing = { clearRect() {}, fillRect() {}, beginPath() {}, ellipse() {}, stroke() {} };
  function element(id) {
    if (!elements.has(id)) elements.set(id, { value: defaults[id] ?? '', checked: false, hidden: true, style: {}, handlers: {}, width: 1024, height: 1024,
      addEventListener(name, fn) { (this.handlers[name] ||= []).push(fn); },
      emit(name, event = {}) { for (const handler of this.handlers[name] || []) handler(event); },
      setAttribute(name, value) { this[name] = value; }, getContext() { return drawing; }, focus() {},
      getBoundingClientRect() { return { left: 0, top: 0, width: 400, height: 400 }; },
      setPointerCapture(id) { this.captured = id; } });
    return elements.get(id);
  }
  let commits = 0;
  try {
    globalThis.document = { getElementById: element, addEventListener() {} };
    globalThis.window = { createDotScene: () => ({ render() {} }) };
    globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });
    globalThis.requestAnimationFrame = () => 0; globalThis.cancelAnimationFrame = () => {};
    element('selection-tool').value = 'brush'; element('brush-size').value = 6;
    const animation = setupAnimation({ getMap: () => ({ map: Array(10).fill('##########').join('\n'), columns: 10, lattice: { px: 5, py: 5, dim_dy: 0 } }),
      getSettings: () => ({ ...defaults, dustMask: element('dustMask').value }), isPortraitReady: () => true,
      onCommit: () => commits++, onDownload() {} });
    animation.enter(); await delay(240);
    element('motion-split').value = 50;
    element('motion-compare').checked = true; element('motion-compare').emit('change');
    assert.equal(element('animation-preview').style.clipPath, 'inset(0 0 0 50%)');
    assert.equal(element('motion-divider').hidden, false);
    element('clear-region').emit('click'); await delay(240); commits = 0;
    element('selection-tool').emit('change');
    assert.equal(element('motion-compare').checked, false);
    assert.equal(element('animation-preview').style.clipPath, 'none');
    const canvas = element('region-selector');
    const pointer = { pointerType: 'touch', pointerId: 1, isPrimary: true, button: 0, clientX: 100, clientY: 200, preventDefault() {} };
    canvas.emit('pointerdown', { ...pointer, pointerId: 2, isPrimary: false });
    assert.equal(canvas.captured, undefined);
    canvas.emit('pointerdown', pointer);
    assert.equal(canvas.captured, 1);
    const first = element('dustMask').value;
    canvas.emit('pointerdown', { ...pointer, pointerId: 2, isPrimary: false, clientX: 350 });
    canvas.emit('pointermove', { ...pointer, pointerId: 2, isPrimary: false, clientX: 350 });
    assert.equal(element('dustMask').value, first);
    canvas.emit('pointermove', { ...pointer, clientX: 250 });
    assert.ok(element('dustMask').value.split('1').length > first.split('1').length);
    canvas.emit('pointercancel', pointer); canvas.emit('lostpointercapture', pointer); canvas.emit('pointerup', pointer);
    assert.equal(commits, 1);
    animation.exit(); animation.invalidate();
    assert.equal(element('region-selector').hidden, true);
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});
