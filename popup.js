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
      "For extraction, you must determine the type and any filter criteria. " +
      "Extract the needed info in JSON format as shown in the examples below:\n\n" +
      
      "Available extraction types:\n" +
      "- cell: Extract a single cell value\n" +
      "- cell_by_row_id: Extract a cell value based on row identifier\n" +
      "- row: Extract an entire row\n" +
      "- column: Extract an entire column\n" +
      "- table: Extract entire table or filtered table\n" +
      "- extract_by_criteria: Extract rows matching specific criteria\n" +
      "- list: Extract a list of values from a column\n" +
      "- search: General search across multiple columns\n\n" +
      
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
      
      "Example 2 (Extract Cell):\n" +
      "User: What is the price of the first product in the table at https://example.com/products?\n\n" +
      "Answer: { \"intent\": \"Extract\", " +
      "\"search_type\": \"cell\", " +
      "\"searchHeader\": \"Price\", " +
      "\"rowIndex\": 0, " +
      "\"URL\": \"https://example.com/products\" }\n\n" +
      
      "Example 3 (Extract Cell by Row ID):\n" +
      "User: What is the age of Airi Satou in the table at https://datatables.net/?\n\n" +
      "Answer: { \"intent\": \"Extract\", " +
      "\"search_type\": \"cell_by_row_id\", " +
      "\"column_header\": \"Age\", " +
      "\"row_identifier\": { " +
      "\"header\": \"Name\", " +
      "\"value\": \"Airi Satou\" " +
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
      "\"searchHeader\": \"Price\", " +
      "\"URL\": \"https://example.com/products\" }\n\n" +
      
      "Example 6 (Extract Table):\n" +
      "User: Get all products from the table at https://example.com/products\n\n" +
      "Answer: { \"intent\": \"Extract\", " +
      "\"search_type\": \"table\", " +
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
      
      "Example 9 (Extract List):\n" +
      "User: Get a list of all product names from the table at https://example.com/products\n\n" +
      "Answer: { \"intent\": \"Extract\", " +
      "\"search_type\": \"list\", " +
      "\"column\": \"Name\", " +
      "\"URL\": \"https://example.com/products\" }\n\n" +
      
      "Example 10 (Extract List with Filter):\n" +
      "User: Get all product names that contain 'phone' from the table at https://example.com/products\n\n" +
      "Answer: { \"intent\": \"Extract\", " +
      "\"search_type\": \"list\", " +
      "\"column\": \"Name\", " +
      "\"filter\": \"phone\", " +
      "\"URL\": \"https://example.com/products\" }\n\n" +
      
      "Example 11 (Search):\n" +
      "User: Search for anything related to 'laptop' in the table at https://example.com/products\n\n" +
      "Answer: { \"intent\": \"Extract\", " +
      "\"search_type\": \"search\", " +
      "\"searchTerm\": \"laptop\", " +
      "\"URL\": \"https://example.com/products\" }\n\n" +
      
      "Guidelines for extraction:\n" +
      "1. For 'cell' type: Use when you need a specific cell value by column and row\n" +
      "   - Use searchHeader for column name and searchValue for row identifier\n" +
      "   - Or use rowIndex and columnIndex for direct access\n" +
      "2. For 'cell_by_row_id' type: Use when you need to find a specific cell value based on a row identifier\n" +
      "   - Specify column_header for the value you want to extract\n" +
      "   - Specify row_identifier with header and value to find the correct row\n" +
      "3. For 'row' type: Use when you need all data from a specific row\n" +
      "   - Use searchHeader and searchValue to find the row\n" +
      "   - Or use rowIndex for direct access\n" +
      "4. For 'column' type: Use when you need all values from a specific column\n" +
      "   - Use searchHeader for column name\n" +
      "5. For 'table' type: Use when you need the entire table or filtered table\n" +
      "   - Use searchValue to filter rows containing specific text\n" +
      "   - Use limit to restrict number of rows\n" +
      "6. For 'extract_by_criteria' type: Use when you need to find rows matching specific conditions\n" +
      "   - Specify criteria with column, operator, and value\n" +
      "   - Operators can be: =, !=, >, <, >=, <=, contains, starts_with, ends_with, regex\n" +
      "   - For multiple criteria, use an array of criteria objects (AND condition)\n" +
      "7. For 'list' type: Use when you need a list of values from a column\n" +
      "   - Use column to specify which column\n" +
      "   - Use filter to search within the list\n" +
      "   - Use sort: 'asc' or 'desc' for sorting\n" +
      "   - Use limit to restrict number of items\n" +
      "8. For 'search' type: Use for general search across multiple columns\n" +
      "   - Use searchTerm for the search query\n" +
      "   - Use columns array to specify which columns to search\n" +
      "   - Use caseSensitive: true/false for case sensitivity\n" +
      "9. Always include the URL where the data should be extracted from\n" +
      "10. For text searches, use partial matching unless exact match is specified\n\n" +
      
      "Important: Always analyze the user's intent carefully and extract the most appropriate search parameters. " +
      "If the user's request is ambiguous, prefer the most specific extraction type that matches their needs. " +
      "For simple cell extraction, use 'cell' type. For cell extraction based on row identifier, use 'cell_by_row_id'. " +
      "For filtering data, use 'extract_by_criteria'. For lists of values, use 'list'. For general search, use 'search'.";
    
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
