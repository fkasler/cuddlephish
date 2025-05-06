let attachedTabId = null;

// Use the new chrome.runtime.onMessage format
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getAllStorageData") {
    handleGetAllStorageData(sendResponse);
    return true; // Indicates we wish to send a response asynchronously
  } else if (request.action === "setStorageData") {
    handleSetStorageData(request, sendResponse);
    return true;
  }
});

// Helper functions to handle message actions
async function handleGetAllStorageData(sendResponse) {
  try {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    await attachDebugger(tab.id);
    const [cookies, localStorage] = await Promise.all([
      getAllCookies(),
      getLocalStorage(tab.id)
    ]);
    sendResponse({
      url: tab.url,
      cookies: cookies,
      localStorage: localStorage
    });
  } catch (error) {
    console.error("Error:", error);
    sendResponse({error: error.message});
  } finally {
    if (attachedTabId !== null) {
      await detachDebugger(attachedTabId);
    }
  }
}

async function handleSetStorageData(request, sendResponse) {
  try {
    const data = JSON.parse(request.data);
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    await attachDebugger(tab.id);
    await setCookies(tab.url, data.cookies);
    await setLocalStorage(tab.id, data.localStorage);
    sendResponse({success: true});
  } catch (error) {
    console.error("Error:", error);
    sendResponse({error: error.message});
  } finally {
    if (attachedTabId !== null) {
      await detachDebugger(attachedTabId);
    }
  }
}

async function attachDebugger(tabId) {
  if (attachedTabId === tabId) return;
  if (attachedTabId !== null) {
    await chrome.debugger.detach({tabId: attachedTabId});
  }
  await chrome.debugger.attach({tabId: tabId}, "1.3");
  attachedTabId = tabId;
}

async function detachDebugger(tabId) {
  if (attachedTabId === tabId) {
    await chrome.debugger.detach({tabId: tabId});
    attachedTabId = null;
  }
}

function sendCommand(method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({tabId: attachedTabId}, method, params, (result) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(result);
      }
    });
  });
}

async function getAllCookies() {
  const result = await sendCommand("Network.getAllCookies");
  return result.cookies;
}

async function getLocalStorage(tabId) {
  const script = `
    Object.entries(localStorage).reduce((acc, [key, value]) => {
      acc[key] = value;
      return acc;
    }, {})
  `;
  const result = await sendCommand("Runtime.evaluate", {
    expression: script,
    returnByValue: true
  });
  return result.result.value;
}

async function setCookies(url, cookies) {
  for (const cookie of cookies) {
    await sendCommand("Network.setCookie", {
      ...cookie,
      url: url
    });
  }
}

async function setLocalStorage(tabId, items) {
  const script = Object.entries(items).map(([key, value]) => {
    return `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)});`;
  }).join('\n');
  
  await sendCommand("Runtime.evaluate", {
    expression: script
  });
}

// Keep the service worker alive
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});