// Service worker lifecycle
async function initialize() {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (error) {
    console.error('Failed to set side panel behavior:', error);
  }
}

chrome.runtime.onInstalled.addListener(() => initialize());
chrome.runtime.onStartup.addListener(() => initialize());
initialize();
