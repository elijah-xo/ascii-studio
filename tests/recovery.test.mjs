import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { setupRecovery as setupBrowserRecovery } from '../web/recovery.mjs';

const setupRecovery = options => setupBrowserRecovery({
  lease: { async acquire() { return true; }, async release() {} }, ...options,
});

function ui() {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { checked: false, hidden: true, handlers: {},
      addEventListener(name, fn) { this.handlers[name] = fn; },
      emit(name) { return this.handlers[name]?.(); } });
    return elements.get(id);
  };
  globalThis.document = { getElementById: element };
  return element;
}
const original = globalThis.document;
test.afterEach(() => { if (original === undefined) delete globalThis.document; else globalThis.document = original; });

function memory() {
  const state = { record: undefined, writes: 0 };
  state.store = async (action, text) => {
    if (action === 'get') return state.record;
    if (action === 'put') { state.record = text; state.writes++; }
    if (action === 'delete') state.record = undefined;
  };
  return state;
}

test('recovery never writes until enabled, debounces edits, and clears when unchecked', async () => {
  const $ = ui(), saved = memory(); let content = 'first';
  const recovery = setupRecovery({ snapshot: async () => content, restore() {}, isReady: () => true, store: saved.store, wait: 0 });
  recovery.changed(); await delay(10); assert.equal(saved.writes, 0);
  $('remember-session').checked = true; $('remember-session').emit('change');
  content = 'latest'; recovery.changed(); recovery.changed();
  await delay(10); assert.equal(saved.record, 'latest'); assert.equal(saved.writes, 1);
  $('remember-session').checked = false; await $('remember-session').emit('change'); await delay(10);
  assert.equal(saved.record, undefined);
  recovery.changed(); await delay(10); assert.equal(saved.writes, 1);
});

test('clearing while a photo snapshot is pending prevents a late save', async () => {
  const $ = ui(), saved = memory(); let resolveSnapshot;
  setupRecovery({ snapshot: () => new Promise(resolve => { resolveSnapshot = resolve; }), restore() {}, isReady: () => true, store: saved.store, wait: 0 });
  $('remember-session').checked = true; $('remember-session').emit('change'); await delay(10);
  await $('clear-session').emit('click'); resolveSnapshot('private-photo'); await delay(10);
  assert.equal(saved.record, undefined); assert.equal(saved.writes, 0);
});

test('a clear waits for an in-flight write then removes it', async () => {
  const $ = ui(), saved = memory(); let finishWrite;
  const store = async (action, value) => {
    if (action === 'put') await new Promise(resolve => { finishWrite = resolve; });
    return saved.store(action, value);
  };
  setupRecovery({ snapshot: async () => 'photo', restore() {}, isReady: () => true, store, wait: 0 });
  $('remember-session').checked = true; $('remember-session').emit('change'); await delay(10);
  const clearing = $('clear-session').emit('click'); finishWrite(); await clearing;
  assert.equal(saved.record, undefined); assert.equal($('remember-session').checked, false);
});

test('startup offers a saved session and restores only after an explicit click', async () => {
  const $ = ui(), saved = memory(); saved.record = 'saved-project'; let restores = 0;
  const recovery = setupRecovery({ snapshot: async () => 'restored-project',
    restore: async (text, current) => { assert.equal(text, 'saved-project'); assert.ok(current()); restores++; recovery.changed(); return true; },
    isReady: () => true, store: saved.store, wait: 0 });
  recovery.changed(); await delay(10);
  assert.equal($('recovery-offer').hidden, false); assert.equal(restores, 0); assert.equal(saved.writes, 0);
  await $('restore-session').emit('click'); await delay(10);
  assert.equal(restores, 1); assert.equal($('remember-session').checked, true); assert.equal(saved.record, 'restored-project');
  await $('clear-session').emit('click');
});

test('storage failures remain visible and do not claim a successful save', async () => {
  const $ = ui();
  setupRecovery({ snapshot: async () => 'photo', restore() {}, isReady: () => true,
    store: async action => { if (action === 'put') throw new Error('quota'); }, wait: 0 });
  $('remember-session').checked = true; $('remember-session').emit('change'); await delay(10);
  assert.match($('recovery-status').textContent, /could not be saved/);
  await $('clear-session').emit('click');
});

test('clearing a session during restore cancels replacement and does not enable recovery', async () => {
  const $ = ui(), saved = memory(); saved.record = 'saved'; let finishRestore, applied = false;
  setupRecovery({ snapshot: async () => 'new', restore: async (text, current) => {
    await new Promise(resolve => { finishRestore = resolve; });
    if (!current()) return false;
    applied = true; return true;
  }, isReady: () => true, store: saved.store, wait: 0 });
  await delay(10); const restoring = $('restore-session').emit('click'); await delay(10);
  await $('clear-session').emit('click'); finishRestore(); await restoring;
  assert.equal(applied, false); assert.equal($('remember-session').checked, false); assert.equal(saved.record, undefined);
});

test('save notifications identify the snapshot that actually reached storage, including stale writes', async () => {
  const $ = ui(), saved = memory(); let key = 'first', finishWrite;
  const events = [];
  const store = async (action, value) => {
    if (action === 'put' && value === 'first') await new Promise(resolve => { finishWrite = resolve; });
    return saved.store(action, value);
  };
  const recovery = setupRecovery({ snapshot: async () => key, restore() {}, isReady: () => true, store, wait: 0,
    getKey: () => key, onState: (phase, snapshot) => events.push([phase, snapshot]) });
  $('remember-session').checked = true; $('remember-session').emit('change'); await delay(10);
  key = 'second'; recovery.changed(); await delay(10); finishWrite(); await delay(10);
  assert.deepEqual(events.filter(event => event[0] === 'saved'), [['saved','first'], ['saved','second']]);
  assert.equal(saved.record, 'second');
  await $('clear-session').emit('click'); assert.equal(events.at(-1)[0], 'cleared');
});

test('a second tab cannot overwrite or delete an active recovery copy', async () => {
  const saved = memory(); let owner = null;
  const lease = () => {
    const token = {};
    return { async acquire() { if (owner && owner !== token) return false; owner = token; return true; },
      async release() { if (owner === token) owner = null; } };
  };
  const a = ui();
  setupRecovery({ snapshot: async () => 'portrait-A', restore() {}, isReady: () => true, store: saved.store, wait: 0, lease: lease() });
  a('remember-session').checked = true; await a('remember-session').emit('change'); await delay(10);
  assert.equal(saved.record, 'portrait-A');
  const b = ui();
  setupRecovery({ snapshot: async () => 'portrait-B', restore() {}, isReady: () => true, store: saved.store, wait: 0, lease: lease() });
  b('remember-session').checked = true; await b('remember-session').emit('change'); await delay(10);
  assert.equal(saved.record, 'portrait-A');
  assert.equal(b('remember-session').checked, false);
  await b('restore-session').emit('click');
  assert.match(b('recovery-status').textContent, /another studio tab/);
  assert.equal(b('remember-session').checked, false);
  await b('clear-session').emit('click'); assert.equal(saved.record, 'portrait-A');
  await a('clear-session').emit('click'); assert.equal(saved.record, undefined);
  b('remember-session').checked = true; await b('remember-session').emit('change'); await delay(10);
  assert.equal(saved.record, 'portrait-B'); await b('clear-session').emit('click');
});
