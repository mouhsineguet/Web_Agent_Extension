// Background script for Form Assistant Chrome Extension

// Listen for messages from popup and content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Background received message:', request);
    
    switch (request.action) {
      case 'executeIntent':
        handleExecuteIntent(request.data, sendResponse);
        break;
      case 'validateExtractedData':
        handleValidateExtractedData(request.data, sendResponse);
        break;
      default:
        console.warn('Unknown action:', request.action);
        sendResponse({ success: false, message: 'Unknown action' });
    }
    
    return true; // Keep message channel open for async response
  });
  
  /**
   * Handles the execution of detected intents (Fill or Extract)
   */
  async function handleExecuteIntent(data, sendResponse) {
    try {
      const intent = data.intent.toLowerCase();
      
      if (intent === 'fill') {
        await handleFillIntent(data);
        sendResponse({ success: true, message: 'Form filling initiated' });
      } else if (intent === 'extract') {
        await handleExtractIntent(data);
        sendResponse({ success: true, message: 'Data extraction initiated' });
      } else {
        sendResponse({ success: false, message: 'Unknown intent' });
      }
    } catch (error) {
      console.error('Error executing intent:', error);
      sendResponse({ success: false, message: error.message });
    }
  }
  
  /**
   * Handles form filling intent
   */
  async function handleFillIntent(data) {
    const { user_data } = data;
    
    if (!user_data || !user_data.URL) {
      throw new Error('Missing user data or URL');
    }
    
    const url = user_data.URL;
    
    try {
      // Create or update tab with the target URL
      const tab = await createOrUpdateTab(url);
      
      // Wait for tab to load
      await waitForTabToLoad(tab.id);
      
      // Inject content script if needed
      await ensureContentScriptInjected(tab.id);
      
      // Send fill form message to content script
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'fillForm',
        userData: user_data
      });
      
      if (!response || !response.success) {
        throw new Error('Failed to fill form');
      }
      
      console.log('Form filling completed successfully');
    } catch (error) {
      console.error('Error in form filling:', error);
      throw error;
    }
  }
  
  /**
   * Handles data extraction intent
   */
  async function handleExtractIntent(data) {
    const { URL, search_type, search_header = '', search_value = '', row_index, column_index } = data;
    
    if (!URL) {
      throw new Error('Missing URL for data extraction');
    }
    
    try {
      // Create or update tab with the target URL
      const tab = await createOrUpdateTab(URL);
      
      // Wait for tab to load
      await waitForTabToLoad(tab.id);
      
      // Inject content script if needed
      await ensureContentScriptInjected(tab.id);
      
      // Prepare search parameters
      const searchParams = {
        searchType: search_type,
        searchHeader: search_header,
        searchValue: search_value,
        rowIndex: row_index,
        columnIndex: column_index
      };
      
      // Send extract data message to content script
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'extractData',
        searchParams: searchParams
      });
      
      if (!response || !response.success) {
        throw new Error('Failed to extract data');
      }
      
      console.log('Data extraction initiated successfully');
    } catch (error) {
      console.error('Error in data extraction:', error);
      throw error;
    }
  }
  
  /**
   * Handles validation and enhancement of extracted data using LLM
   */
  async function handleValidateExtractedData(data, sendResponse) {
    try {
      const { extractedData, metadata, originalParams } = data;
      
      if (!extractedData) {
        // Send error back to content script
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) {
          chrome.tabs.sendMessage(tab.id, {
            action: 'showValidatedData',
            data: {
              error: 'No matching data found in the tables on this page.',
              metadata: metadata
            }
          });
        }
        sendResponse({ success: true });
        return;
      }
      
      // Get API key from storage
      const result = await chrome.storage.local.get(['groqApiKey']);
      const apiKey = result.groqApiKey;
      
      let enhancedData = null;
      
      if (apiKey) {
        try {
          // Use LLM to validate and enhance the extracted data
          enhancedData = await enhanceDataWithLLM(extractedData, metadata, apiKey);
        } catch (error) {
          console.warn('LLM enhancement failed:', error);
          // Continue without enhancement
        }
      }
      
      // Send validated data back to content script
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        chrome.tabs.sendMessage(tab.id, {
          action: 'showValidatedData',
          data: {
            extractedData: extractedData,
            metadata: metadata,
            enhancedData: enhancedData
          }
        });
      }
      
      sendResponse({ success: true });
    } catch (error) {
      console.error('Error validating extracted data:', error);
      sendResponse({ success: false, error: error.message });
    }
  }
  
  /**
   * Enhances extracted data using LLM analysis
   */
  async function enhanceDataWithLLM(extractedData, metadata, apiKey) {
    const prompt = `
  Analyze the following extracted data and provide insights, validation, or enhancement:
  
  Data Type: ${extractedData.type}
  Source: ${metadata.url}
  Extraction Method: ${metadata.extractionType}
  
  Extracted Data:
  ${JSON.stringify(extractedData, null, 2)}
  
  Metadata:
  ${JSON.stringify(metadata, null, 2)}
  
  Please provide:
  1. Data validation (check for inconsistencies, missing values, or errors)
  2. Brief analysis or insights about the data
  3. Any suggestions for data interpretation or next steps
  4. Format the response in clean HTML for display
  
  Keep the response concise and user-friendly.
  `;
  
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "llama3-8b-8192",
        messages: [
          {
            role: "system",
            content: "You are a data analyst assistant. Analyze extracted data and provide helpful insights in clean HTML format."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        max_tokens: 1024,
        temperature: 0.3
      })
    });
  
    if (!response.ok) {
      throw new Error('Failed to enhance data with LLM');
    }
  
    const data = await response.json();
    return data.choices[0].message.content;
  }
  
  /**
   * Creates a new tab or updates existing tab with the given URL
   */
  async function createOrUpdateTab(url) {
    try {
      // Try to find an existing tab with the same URL
      const tabs = await chrome.tabs.query({ url: url });
      
      if (tabs.length > 0) {
        // Update existing tab and make it active
        const tab = await chrome.tabs.update(tabs[0].id, { active: true });
        await chrome.tabs.reload(tab.id);
        return tab;
      } else {
        // Create new tab
        const tab = await chrome.tabs.create({ url: url, active: true });
        return tab;
      }
    } catch (error) {
      console.error('Error creating/updating tab:', error);
      throw error;
    }
  }
  
  /**
   * Waits for a tab to finish loading
   */
  function waitForTabToLoad(tabId) {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('Tab loading timeout'));
      }, 30000); // 30 second timeout
      
      function onUpdated(updatedTabId, changeInfo, tab) {
        if (updatedTabId === tabId && changeInfo.status === 'complete') {
          clearTimeout(timeoutId);
          chrome.tabs.onUpdated.removeListener(onUpdated);
          resolve(tab);
        }
      }
      
      function onRemoved(removedTabId) {
        if (removedTabId === tabId) {
          clearTimeout(timeoutId);
          chrome.tabs.onUpdated.removeListener(onUpdated);
          chrome.tabs.onRemoved.removeListener(onRemoved);
          reject(new Error('Tab was closed'));
        }
      }
      
      chrome.tabs.onUpdated.addListener(onUpdated);
      chrome.tabs.onRemoved.addListener(onRemoved);
      
      // Check if tab is already loaded
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError) {
          clearTimeout(timeoutId);
          chrome.tabs.onUpdated.removeListener(onUpdated);
          chrome.tabs.onRemoved.removeListener(onRemoved);
          reject(new Error('Tab not found'));
          return;
        }
        
        if (tab.status === 'complete') {
          clearTimeout(timeoutId);
          chrome.tabs.onUpdated.removeListener(onUpdated);
          chrome.tabs.onRemoved.removeListener(onRemoved);
          resolve(tab);
        }
      });
    });
  }
  
  /**
   * Ensures content script is injected into the target tab
   */
  async function ensureContentScriptInjected(tabId) {
    try {
      // Try to ping the content script
      await chrome.tabs.sendMessage(tabId, { action: 'ping' });
    } catch (error) {
      // Content script not present, inject it
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: ['content.js']
        });
        
        // Wait a bit for the script to initialize
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (injectionError) {
        console.error('Failed to inject content script:', injectionError);
        throw new Error('Cannot inject content script into this page');
      }
    }
  }
  
  /**
   * Handle extension installation and updates
   */
  chrome.runtime.onInstalled.addListener((details) => {
    console.log('Form Assistant extension installed/updated:', details.reason);
    
    if (details.reason === 'install') {
      // Set default settings or show welcome page
      chrome.storage.local.set({
        installDate: Date.now(),
        version: chrome.runtime.getManifest().version
      });
    }
  });
  
  /**
   * Handle extension startup
   */
  chrome.runtime.onStartup.addListener(() => {
    console.log('Form Assistant extension started');
  });
  
  /**
   * Error handling for unhandled promise rejections
   */
  self.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection in background script:', event.reason);
  });