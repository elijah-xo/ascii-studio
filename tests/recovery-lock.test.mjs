import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecoveryLease } from '../web/recovery-lock.mjs';

function lockManager() {
  const held = new Set();
  return { async request(name, options, callback) {
    assert.equal(options.ifAvailable, true);
    if (held.has(name)) return callback(null);
    held.add(name);
    try { return await callback({ name }); }
    finally { held.delete(name); }
  } };
}

test('recovery locks exclude another tab and become available after release', async () => {
  const locks = lockManager(), a = createRecoveryLease(locks), b = createRecoveryLease(locks);
  assert.deepEqual(await Promise.all([a.acquire(), a.acquire()]), [true, true]);
  assert.equal(await b.acquire(), false);
  await b.release();
  assert.equal(await b.acquire(), false);
  await a.release();
  assert.equal(await b.acquire(), true);
  await b.release();
  assert.equal(await a.acquire(), true);
  await a.release();
});

test('unavailable or denied Web Locks fail safely', async () => {
  await assert.rejects(createRecoveryLease(null).acquire(), /Save a project/);
  const lease = createRecoveryLease({ request() { throw new Error('denied'); } });
  await assert.rejects(lease.acquire(), /denied/);
  await lease.release();
});
