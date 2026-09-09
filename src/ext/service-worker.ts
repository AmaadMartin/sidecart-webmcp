/**
 * Opens the side panel, and nothing else.
 *
 * The Prompt API is not available in a service worker, so no inference can
 * happen here. WebMCP tools belong to the page, so no tool call can happen
 * here either. That leaves window management, which is the whole job.
 */

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.action.onClicked.addListener((tab) => {
  if (tab.windowId !== undefined) {
    void chrome.sidePanel.open({ windowId: tab.windowId });
  }
});
