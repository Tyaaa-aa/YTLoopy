// Toolbar button opens the library side panel; the practice bar's Library button asks us to do the same.
// Also upgrades stored data when a new version is installed.
import { ensureSchema } from '../shared/storage.js';

// Chained so two upgrades never run at the same time (startup and onInstalled both fire on update).
let upgrade = ensureSchema().catch(console.error);
chrome.runtime.onInstalled.addListener(() => {
  upgrade = upgrade.then(ensureSchema).catch(console.error);
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === 'openLibrary' && sender.tab) {
    // Must run synchronously inside the click's user gesture, so no awaits before this call.
    chrome.sidePanel.open({ windowId: sender.tab.windowId }).catch(() => {});
  }
});
