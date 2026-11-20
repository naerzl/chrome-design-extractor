chrome.action.onClicked.addListener((tab) => {
  if (tab.id === undefined) return;
  // Use the action listener so Chrome grants activeTab before opening the panel.
  void chrome.sidePanel.open({ tabId: tab.id }).catch((error: unknown) => {
    console.error('Could not open the Design Lens side panel.', error);
  });
});
