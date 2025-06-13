// Configuration
const SERVER_URL = process.env.NODE_ENV === 'production' 
  ? 'https://your-production-server.com'
  : 'http://localhost:3000';

// Authentication state
let authToken = null;
let userProfile = null;

// Initialize extension
chrome.runtime.onInstalled.addListener(async () => {
  // Check for existing auth token
  const stored = await chrome.storage.local.get(['authToken', 'userProfile']);
  if (stored.authToken) {
    authToken = stored.authToken;
    userProfile = stored.userProfile;
  }
});

// Handle authentication
async function authenticate() {
  try {
    const authResult = await chrome.identity.getAuthToken({ interactive: true });
    if (authResult.token) {
      // Exchange Google token for our server token
      const response = await fetch(`${SERVER_URL}/api/users/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: authResult.token })
      });
      
      const data = await response.json();
      if (data.token) {
        authToken = data.token;
        userProfile = data.profile;
        await chrome.storage.local.set({ authToken, userProfile });
        return true;
      }
    }
    return false;
  } catch (error) {
    console.error('Authentication failed:', error);
    return false;
  }
}

// API request helper
async function apiRequest(endpoint, options = {}) {
  if (!authToken && !await authenticate()) {
    throw new Error('Authentication required');
  }

  const defaultOptions = {
    headers: {
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json'
    }
  };

  const response = await fetch(`${SERVER_URL}${endpoint}`, {
    ...defaultOptions,
    ...options
  });

  if (response.status === 401) {
    // Token expired, try to re-authenticate
    if (await authenticate()) {
      return apiRequest(endpoint, options);
    }
    throw new Error('Authentication failed');
  }

  return response.json();
}

// Message handling
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'validateExtractedData') {
    handleDataValidation(request.data, sender.tab.id)
      .then(sendResponse)
      .catch(error => sendResponse({ error: error.message }));
    return true;
  }

  if (request.action === 'executeIntent') {
    handleIntent(request.data, sender.tab.id)
      .then(sendResponse)
      .catch(error => sendResponse({ error: error.message }));
    return true;
  }
});

// Handle data validation
async function handleDataValidation(data, tabId) {
  try {
    const validatedData = await apiRequest('/api/forms/extract/validate', {
      method: 'POST',
      body: JSON.stringify(data)
    });

    chrome.tabs.sendMessage(tabId, {
      action: 'showValidatedData',
      data: validatedData
    });

    return { success: true };
  } catch (error) {
    chrome.tabs.sendMessage(tabId, {
      action: 'showValidatedData',
      data: {
        error: error.message,
        metadata: data.metadata
      }
    });
    throw error;
  }
}

// Handle user intents
async function handleIntent(data, tabId) {
  const { intent, user_data, URL } = data;

  try {
    if (intent === 'fill') {
      // Validate form data on server
      const validatedData = await apiRequest('/api/forms/validate', {
        method: 'POST',
        body: JSON.stringify({ formData: user_data, url: URL })
      });

      // Navigate if needed
      const activeTab = await chrome.tabs.query({ active: true, currentWindow: true });
      if (URL && activeTab[0].url !== URL) {
        await chrome.tabs.update(activeTab[0].id, { url: URL });
        await new Promise(resolve => {
          chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
            if (changeInfo.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }
          });
        });
      }

      // Fill the form
      chrome.tabs.sendMessage(tabId, {
        action: 'fillForm',
        userData: validatedData
      });

    } else if (intent === 'extract') {
      const extractParams = {
        searchType: data.search_type || 'table',
        searchHeader: data.search_header,
        searchValue: data.search_value,
        rowIndex: data.row_index,
        columnIndex: data.column_index,
        url: URL
      };

      const extractedData = await apiRequest('/api/forms/extract', {
        method: 'POST',
        body: JSON.stringify(extractParams)
      });

      chrome.tabs.sendMessage(tabId, {
        action: 'extractData',
        searchParams: extractParams,
        extractedData
      });
    }

    return { success: true };
  } catch (error) {
    console.error('Intent handling failed:', error);
    throw error;
  }
}

// Export for testing
if (typeof module !== 'undefined') {
  module.exports = {
    authenticate,
    apiRequest,
    handleDataValidation,
    handleIntent
  };
}
