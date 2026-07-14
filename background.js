// Keep track of captcha counts and lists per tab
let tabCaptchas = new Map();

// Listening for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'captchaDetected') {
    const tabId = sender.tab ? sender.tab.id : null;
    if (!tabId) return;

    const count = message.count;
    const captchas = message.captchas;
    const url = message.url;

    // Update internal tab tracking
    tabCaptchas.set(tabId, { count, captchas, url });

    // Update extension action badge for this specific tab
    if (count > 0) {
      chrome.action.setBadgeText({ text: count.toString(), tabId: tabId });
      chrome.action.setBadgeBackgroundColor({ color: '#ef4444', tabId: tabId }); // Red badge for attention
    } else {
      chrome.action.setBadgeText({ text: '', tabId: tabId });
    }

    // Save history log to storage
    updateHistoryLog(captchas, url);
  }

  if (message.action === 'getTabStatus') {
    const tabId = message.tabId;
    const data = tabCaptchas.get(tabId);
    sendResponse(data ? { count: data.count, captchas: data.captchas } : { count: 0, captchas: [] });
  }
});

// Clean up tab tracking when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  tabCaptchas.delete(tabId);
});

// Reset or update badge when a tab changes URL (reloads/navigates away)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading') {
    // Clear badge on new navigation
    chrome.action.setBadgeText({ text: '', tabId: tabId });
    tabCaptchas.delete(tabId);
  }
});

// Update global detection history log in chrome.storage.local
function updateHistoryLog(captchas, url) {
  chrome.storage.local.get({ detectionHistory: [] }, (data) => {
    let history = data.detectionHistory;
    
    // Create new log entries
    captchas.forEach(type => {
      // Check if similar entry in the last 10 seconds to avoid spamming the log
      const now = Date.now();
      const isDuplicate = history.some(entry => 
        entry.type === type && 
        entry.url === url && 
        (now - entry.timestamp) < 10000
      );

      if (!isDuplicate) {
        history.unshift({
          type: type,
          url: url,
          timestamp: now
        });
      }
    });

    // Limit history log to last 50 entries
    if (history.length > 50) {
      history = history.slice(0, 50);
    }

    chrome.storage.local.set({ detectionHistory: history });
  });
}
