export class WorkStatus {
  key = null;
  baseline = null;
  browser = null;
  project = null;
  saving = null;
  failed = null;

  current(key) { const changed = key !== this.key; this.key = key; return changed; }
  browserSaving(key) { this.saving = key; this.failed = null; }
  browserSaved(key) { this.browser = key; if (this.saving === key) this.saving = null; }
  browserFailed(key) { if (this.saving === key) this.saving = null; this.failed = key; }
  browserCleared() { this.browser = this.saving = this.failed = null; }
  get state() {
    if (!this.key) return { kind: 'idle', label: 'Getting ready', detail: 'Choose a photo or explore the included demo.', dirty: false };
    if (this.key === this.browser) return { kind: 'saved', label: 'Saved in this browser', detail: 'This browser can restore your latest work. Save a project for a portable backup.', dirty: false };
    if (this.key === this.project) return { kind: 'saved', label: 'Project exported', detail: 'Keep the .dotstudio download. Confirm it finished in your browser’s Downloads.', dirty: false };
    if (this.key === this.baseline) return { kind: 'idle', label: 'Demo ready', detail: 'Explore the demo or choose your own photo. No changes to save yet.', dirty: false };
    if (this.key === this.saving) return { kind: 'saving', label: 'Saving…', detail: 'Keep this tab open until your latest work is saved in this browser.', dirty: true };
    return { kind: 'unsaved', label: this.key === this.failed ? 'Unsaved — recovery failed' : 'Unsaved changes',
      detail: 'Save a project or enable session recovery. Image, video, and settings exports do not save the full editable project.', dirty: true };
  }
}

export function leaveWarning(event) {
  event.preventDefault();
  event.returnValue = '';
}
