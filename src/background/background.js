// Toolbar button opens the library side panel; the practice bar's Library button asks us to do the same.

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === 'openLibrary' && sender.tab) {
    // Must run synchronously inside the click's user gesture, so no awaits before this call.
    chrome.sidePanel.open({ windowId: sender.tab.windowId }).catch(() => {});
  }
});
