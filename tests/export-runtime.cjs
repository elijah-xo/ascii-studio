const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(0, 'utf8');
const autoplay = process.argv[2] === 'true';
assert.match(html, /<img id="poster" src="data:image\/svg\+xml;base64,/);
assert.match(html, /<canvas id="c"[^>]* hidden>/);
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
assert.equal(scripts.length, 3);
for (const reducedMotion of [false, true]) {
  const handlers = {}, preferenceHandlers = {};
  const context = { scale() {}, beginPath() {}, fillRect() {}, arc() {}, fill() {} };
  const elements = { c: { hidden: true, getContext: () => context }, poster: { hidden: false },
    play: { hidden: true, setAttribute(name, value) { this[name] = value; } } };
  let frame;
  const preference = { matches: reducedMotion, addEventListener(name, fn) { preferenceHandlers[name] = fn; } };
  const scope = { document: { hidden: false, getElementById: id => elements[id], addEventListener(name, fn) { handlers[name] = fn; } },
    matchMedia: () => preference, performance: { now: () => 0 }, requestAnimationFrame(fn) { frame = fn; } };
  scope.window = scope;
  vm.createContext(scope);
  for (const script of scripts) vm.runInContext(script, scope);
  const expected = autoplay && !reducedMotion;
  assert.equal(elements.c.hidden, !expected);
  assert.equal(elements.poster.hidden, expected);
  assert.equal(elements.play.textContent, expected ? 'Pause animation' : 'Play animation');
  assert.equal(elements.play.hidden, false);
  if (expected) elements.play.onclick();
  assert.equal(elements.play.textContent, 'Play animation');
  elements.play.onclick();
  assert.equal(elements.play.textContent, 'Pause animation');
  assert.equal(elements.c.hidden, false);
  frame(500); frame(1000);
  scope.document.hidden = true; handlers.visibilitychange();
  assert.equal(elements.play.textContent, 'Play animation');
  elements.play.onclick(); preference.matches = true; preferenceHandlers.change();
  assert.equal(elements.play.textContent, 'Play animation');
  assert.equal(elements.c.hidden, true); assert.equal(elements.poster.hidden, false);
}
