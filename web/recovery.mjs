import { createRecoveryLease } from './recovery-lock.mjs';

export async function sessionStore(action, value) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('dot-studio-recovery', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('session');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Browser storage is blocked.'));
  });
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('session', action === 'get' ? 'readonly' : 'readwrite');
      const store = transaction.objectStore('session');
      const request = action === 'get' ? store.get('current') : action === 'put' ? store.put(value, 'current') : store.delete('current');
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error || new Error('Browser storage could not be updated.'));
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

export function setupRecovery({ snapshot, restore, isReady, getKey = () => null, onState = () => {}, store = sessionStore, wait = 1200, lease = createRecoveryLease() }) {
  const $ = document.getElementById.bind(document);
  let enabled = false, revision = 0, timer, queue = Promise.resolve(), interacted = false, restoring = false;
  const message = (text, error = false) => {
    $('recovery-status').textContent = text;
    if (error) $('recovery-options').open = true;
  };
  function serial(operation) {
    const task = queue.then(operation);
    queue = task.catch(() => {});
    return task;
  }
  function changed() {
    if (restoring || !enabled) return;
    const current = ++revision;
    clearTimeout(timer);
    const key = getKey();
    onState('saving', key);
    message('Changes pending. Keep this tab open until the session is saved.');
    if (!isReady()) return;
    timer = setTimeout(async () => {
      try {
        const text = await snapshot();
        await serial(async () => {
          if (!enabled || current !== revision) return;
          await store('put', text);
          if (enabled) onState('saved', key);
          if (enabled && current === revision) message('Session saved in this browser, including your photo.');
        });
      } catch {
        if (enabled && current === revision) {
          onState('failed', key);
          message('Session could not be saved. Download a project instead; browser storage may be full or unavailable.', true);
        }
      }
    }, wait);
  }
  async function clear() {
    interacted = true;
    enabled = false; revision++; clearTimeout(timer);
    onState('cleared');
    $('remember-session').checked = false;
    $('recovery-offer').hidden = true;
    try {
      await serial(async () => {
        if (!await lease.acquire()) throw new Error('Recovery is active in another studio tab. Turn it off there before clearing the saved session.');
        try { await store('delete'); }
        finally { await lease.release(); }
      });
      message('Stored session removed. Your open artwork is unchanged.');
    } catch (error) { message(error.message || 'Could not clear browser storage. Remove this site’s stored data in your browser settings.', true); }
  }
  $('remember-session').addEventListener('change', async () => {
    interacted = true;
    if (!$('remember-session').checked) { await clear(); return; }
    const current = ++revision;
    try {
      const acquired = await serial(async () => {
        if (current !== revision) return false;
        if (!await lease.acquire()) throw new Error('Recovery is already enabled in another studio tab. Turn it off there, or save a project in this tab.');
        if (current !== revision || !$('remember-session').checked) { await lease.release(); return false; }
        return true;
      });
      if (!acquired || current !== revision) return;
      enabled = true; $('recovery-offer').hidden = true; changed();
    } catch (error) {
      enabled = false; $('remember-session').checked = false;
      onState('failed', getKey()); message(error.message, true);
    }
  });
  $('clear-session').addEventListener('click', clear);
  $('discard-session').addEventListener('click', clear);
  $('restore-session').addEventListener('click', async () => {
    interacted = true;
    const current = ++revision;
    $('restore-session').disabled = true;
    try {
      const text = await serial(async () => {
        if (!await lease.acquire()) throw new Error('Recovery is active in another studio tab. Turn it off there before restoring this session.');
        return store('get');
      });
      if (current !== revision) return;
      if (!text) throw new Error('There is no stored session to restore.');
      restoring = true;
      const restored = await restore(text, () => current === revision);
      if (!restored || current !== revision) return;
      enabled = true; $('remember-session').checked = true;
      onState('saved', getKey());
      $('recovery-offer').hidden = true;
      restoring = false; changed();
    } catch (error) { message(`${error.message || 'The stored session could not be restored.'} Current work is unchanged.`, true); }
    finally {
      restoring = false; $('restore-session').disabled = false;
      if (!enabled) await serial(() => lease.release());
    }
  });
  serial(() => store('get')).then(text => {
    if (text && !interacted && !enabled) {
      $('recovery-offer').hidden = false;
      message('A previous session is available. Restore it or clear the stored copy.');
    }
  }).catch(() => message('Session recovery is unavailable in this browser. Save a project to keep your work.', true));
  return { changed };
}
