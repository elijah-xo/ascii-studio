// One writer owns the shared recovery slot until it clears recovery or closes.
export function createRecoveryLease(locks = globalThis.navigator?.locks) {
  let unlock, finished, pending;
  return {
    async acquire() {
      if (unlock) return true;
      if (pending) return pending;
      if (!locks) throw new Error('Safe session recovery is unavailable in this browser. Save a project instead.');
      let granted, failed;
      pending = new Promise((resolve, reject) => { granted = resolve; failed = reject; });
      try {
        finished = locks.request('dot-studio-recovery-writer', { ifAvailable: true }, lock => {
          if (!lock) { granted(false); return; }
          return new Promise(resolve => { unlock = resolve; granted(true); });
        });
        finished.catch(failed);
      } catch (error) { failed(error); }
      try { return await pending; }
      finally { pending = null; }
    },
    async release() {
      if (!unlock) return;
      unlock(); unlock = null;
      await finished;
    },
  };
}
