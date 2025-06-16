document.addEventListener('DOMContentLoaded', function() {
  // Get DOM elements
  const apiKeyInput = document.getElementById('apiKey');
  const saveApiKeyButton = document.getElementById('saveApiKey');
  const userPromptTextarea = document.getElementById('userPrompt');
  const processPromptButton = document.getElementById('processPrompt');
  const executeActionButton = document.getElementById('executeAction');
  const statusDiv = document.getElementById('status');
  const resultDiv = document.getElementById('result');
  
  let processedData = null;
  
  // Load saved API key if available
  chrome.storage.local.get(['groqApiKey'], function(result) {
    if (result.groqApiKey) {
      apiKeyInput.value = result.groqApiKey;
    }
  });
  
  // Save API key
  saveApiKeyButton.addEventListener('click', function() {
    const apiKey = apiKeyInput.value.trim();
    if (apiKey) {
      chrome.storage.local.set({ groqApiKey: apiKey }, function() {
        statusDiv.textContent = 'API key saved!';
        setTimeout(() => { statusDiv.textContent = ''; }, 2000);
      });
    } else {
      statusDiv.textContent = 'Please enter a valid API key';
    }
  });
  
  // Process user prompt
  processPromptButton.addEventListener('click', async function() {
    const prompt = userPromptTextarea.value.trim();
    const apiKey = apiKeyInput.value.trim();
    
    if (!prompt) {
      statusDiv.textContent = 'Please enter a prompt';
      return;
    }
    
    if (!apiKey) {
      statusDiv.textContent = 'Please enter your Groq API key';
      return;
    }
    
    statusDiv.textContent = 'Processing prompt...';
    resultDiv.classList.add('hidden');
    executeActionButton.classList.add('hidden');
    
    try {
      const response = await askQwen(prompt, apiKey);
      processedData = extractJsonFromText(response);
      
      if (processedData) {
        statusDiv.textContent = `Intent detected: ${processedData.intent}`;
        resultDiv.textContent = JSON.stringify(processedData, null, 2);
        resultDiv.classList.remove('hidden');
        executeActionButton.classList.remove('hidden');
      } else {
        statusDiv.textContent = 'Could not extract valid JSON from the response';
      }
    } catch (error) {
      statusDiv.textContent = `Error: ${error.message}`;
    }
  });
  
  // Execute detected action
  executeActionButton.addEventListener('click', function() {
    if (!processedData) {
      statusDiv.textContent = 'No processed data available';
      return;
    }
    
    const intent = processedData.intent.toLowerCase();
    
    // Send message to the background script to handle the action
    chrome.runtime.sendMessage({
      action: 'executeIntent',
      data: processedData
    }, function(response) {
      if (response && response.success) {
        statusDiv.textContent = `${intent.charAt(0).toUpperCase() + intent.slice(1)} operation initiated`;
      } else {
        statusDiv.textContent = response ? response.message : 'Error executing action';
      }
    });
  });
  
  // Function to ask Qwen via Groq API
  async function askQwen(prompt, apiKey) {
    const systemPrompt = 
      "You are Controller. You understand the user's prompt and detect their intent " +
      "as either 'Fill' (to fill a web form) or 'Extract' (to extract data from a webpage). " +
      "For extraction, you must determine the type (cell_by_row_id, extract_by_criteria, row, column, or table) and any filter criteria. " +
      "Extract the needed info in JSON format as shown in the examples below:\n\n" +
      
      "Example 1 (Fill):\n" +
      "User: Hi! My name is Richard Guallam born on 14/02/1999, my phone is +3468417884, " +
      "my email is test.tse@gmail.com, and I want to fill the form at https://forms.gle/ExampleURL. Thank you!\n\n" +
      "Answer: { \"intent\": \"Fill\", " +
      "\"user_data\": { " +
      "\"first name\": \"Richard\", " +
      "\"last name\": \"Gaullam\", " +
      "\"email\": \"test.tse@gmail.com\", " +
      "\"phone\": \"003468417884\", " +
      "\"date of birth\": \"14/02/1999\", " +
      "\"URL\": \"https://forms.gle/ExampleURL\" } }\n\n" +
      
      "Example 2 (Extract Cell by Row ID):\n" +
      "User: What is the age of Airi Satou in the table at https://datatables.net/?\n\n" +
      "Answer: { \"intent\": \"Extract\", " +
      "\"search_type\": \"cell_by_row_id\", " +
      "\"column_header\": \"Age\", " +
      "\"row_identifier\": { " +
      "\"header\": \"Name\", " +
      "\"value\": \"Airi Satou\" " +
      "}, " +
      "\"URL\": \"https://datatables.net/\" }\n\n" +
      
      "Example 3 (Extract Cell by Row ID):\n" +
      "User: Get the office location for Angelica Ramos from the table at https://datatables.net/\n\n" +
      "Answer: { \"intent\": \"Extract\", " +
      "\"search_type\": \"cell_by_row_id\", " +
      "\"column_header\": \"Office\", " +
      "\"row_identifier\": { " +
      "\"header\": \"Name\", " +
      "\"value\": \"Angelica Ramos\" " +
      "}, " +
      "\"URL\": \"https://datatables.net/\" }\n\n" +
      
      "Example 4 (Extract Row):\n" +
      "User: Get all information about the product with ID 12345 from the table at https://example.com/products\n\n" +
      "Answer: { \"intent\": \"Extract\", " +
      "\"search_type\": \"row\", " +
      "\"search_header\": \"ID\", " +
      "\"search_value\": \"12345\", " +
      "\"URL\": \"https://example.com/products\" }\n\n" +
      
      "Example 5 (Extract Column):\n" +
      "User: Show me all prices from the products table at https://example.com/products\n\n" +
      "Answer: { \"intent\": \"Extract\", " +
      "\"search_type\": \"column\", " +
      "\"search_header\": \"Price\", " +
      "\"URL\": \"https://example.com/products\" }\n\n" +
      
      "Example 6 (Extract Table):\n" +
      "User: Get all products that cost less than $500 from the table at https://example.com/products\n\n" +
      "Answer: { \"intent\": \"Extract\", " +
      "\"search_type\": \"table\", " +
      "\"search_header\": \"Price\", " +
      "\"search_value\": \"<500\", " +
      "\"URL\": \"https://example.com/products\" }\n\n" +
      
      "Example 7 (Extract by Criteria):\n" +
      "User: Find all employees who are older than 30 years in the table at https://datatables.net/\n\n" +
      "Answer: { \"intent\": \"Extract\", " +
      "\"search_type\": \"extract_by_criteria\", " +
      "\"criteria\": { " +
      "\"column\": \"Age\", " +
      "\"operator\": \">\", " +
      "\"value\": 30 " +
      "}, " +
      "\"URL\": \"https://datatables.net/\" }\n\n" +
      
      "Example 8 (Extract by Multiple Criteria):\n" +
      "User: Show me all employees in Tokyo who earn more than $5000 from the table at https://datatables.net/\n\n" +
      "Answer: { \"intent\": \"Extract\", " +
      "\"search_type\": \"extract_by_criteria\", " +
      "\"criteria\": [ " +
      "{ \"column\": \"Office\", \"operator\": \"=\", \"value\": \"Tokyo\" }, " +
      "{ \"column\": \"Salary\", \"operator\": \">\", \"value\": 5000 } " +
      "], " +
      "\"URL\": \"https://datatables.net/\" }\n\n" +
      
      "Guidelines for extraction:\n" +
      "1. For 'cell_by_row_id' type: Use when you need to find a specific cell value based on a row identifier (like name)\n" +
      "   - Specify column_header for the value you want to extract\n" +
      "   - Specify row_identifier with header and value to find the correct row\n" +
      "2. For 'extract_by_criteria' type: Use when you need to find rows matching specific conditions\n" +
      "   - Specify criteria with column, operator, and value\n" +
      "   - Operators can be: =, !=, >, <, >=, <=, contains, starts_with, ends_with\n" +
      "   - For multiple criteria, use an array of criteria objects\n" +
      "   - All criteria in the array must be met (AND condition)\n" +
      "3. For 'row' type: Use when you need all data from a specific row\n" +
      "4. For 'column' type: Use when you need all values from a specific column\n" +
      "5. For 'table' type: Use when you need the entire table or filtered table\n" +
      "6. Always include the URL where the data should be extracted from\n" +
      "7. For text searches, use partial matching unless exact match is specified\n\n" +
      
      "Important: Always analyze the user's intent carefully and extract the most appropriate search parameters. " +
      "If the user's request is ambiguous, prefer the most specific extraction type that matches their needs. " +
      "For cell extraction, prefer cell_by_row_id when the user is looking for a specific value based on an identifier. " +
      "For filtering data, use extract_by_criteria when the user wants to find rows matching specific conditions.";
    
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "gemma2-9b-it",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt }
        ],
        max_tokens: 1024,
        temperature: 0.3 // Lower temperature for more consistent JSON output
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || 'API request failed');
    }
    
    const data = await response.json();
    return data.choices[0].message.content;
  }
  
  // Function to extract JSON from text
  function extractJsonFromText(text) {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch (e) {
        console.error('JSON parse error:', e);
        return null;
      }
    }
    return null;
  }
});
