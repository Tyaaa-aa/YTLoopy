// Runs at document_start, before YouTube's own scripts, so these listeners fire ahead of YouTube's
// keyboard shortcuts. Keys typed into YTLoopy's text fields are stopped here (typing still works, since
// nothing is prevented) and handed to the field's own handler (`ytlKey`, set by bar.js) instead.
// Without this, Space in the section name field toggles play/pause, "k" pauses, and so on.
for (const type of ['keydown', 'keypress', 'keyup']) {
  window.addEventListener(type, (e) => {
    const t = e.composedPath()[0];
    if (!(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement)) return;
    if (t.getRootNode()?.host?.id !== 'ytloopy-bar') return;
    e.stopImmediatePropagation();
    if (type === 'keydown') t.ytlKey?.(e);
  }, true);
}
