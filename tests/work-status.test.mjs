import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkStatus, leaveWarning } from '../web/work-status.mjs';

test('the untouched demo is safe to leave; edits and pending saves remain unsaved', () => {
  const work = new WorkStatus();
  assert.equal(work.state.dirty, false);
  work.baseline = 'demo'; work.current('demo');
  assert.equal(work.state.label, 'Demo ready');
  work.current('edited'); assert.equal(work.state.dirty, true);
  work.browserSaving('edited');
  assert.equal(work.state.label, 'Saving…'); assert.equal(work.state.dirty, true);
  work.browserSaved('edited');
  assert.equal(work.state.label, 'Saved in this browser'); assert.equal(work.state.dirty, false);
});

test('a stale export or browser save cannot protect newer edits', () => {
  const work = new WorkStatus(); work.current('new');
  work.project = 'old'; work.browserSaved('old');
  assert.equal(work.state.dirty, true);
  work.browserSaving('new'); work.browserSaved('old');
  assert.equal(work.state.label, 'Saving…'); assert.equal(work.state.dirty, true);
  work.browserSaved('new'); assert.equal(work.state.dirty, false);
  work.current('another edit'); assert.equal(work.state.dirty, true);
  work.current('new'); assert.equal(work.state.dirty, false);
});

test('clearing browser recovery keeps project protection but otherwise restores the warning', () => {
  const work = new WorkStatus(); work.current('portrait'); work.browserSaved('portrait');
  work.browserCleared(); assert.equal(work.state.dirty, true);
  work.project = 'portrait'; assert.equal(work.state.label, 'Project exported');
  work.browserSaved('portrait'); work.browserCleared(); assert.equal(work.state.dirty, false);
});

test('failed recovery leaves current work unsaved; the leave handler requests the native prompt', () => {
  const work = new WorkStatus(); work.current('photo'); work.browserSaving('photo'); work.browserFailed('photo');
  assert.equal(work.state.label, 'Unsaved — recovery failed'); assert.equal(work.state.dirty, true);
  let prevented = false;
  const event = { preventDefault() { prevented = true; }, returnValue: null };
  leaveWarning(event);
  assert.equal(prevented, true); assert.equal(event.returnValue, '');
});
