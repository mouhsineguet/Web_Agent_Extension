// Listen for messages from the extension
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === 'fillForm') {
    fillForm(request.userData);
    sendResponse({success: true});
  } else if (request.action === 'extractData') {
    const extractedData = extractDataFromPage(request.searchParams);
    sendResponse({success: true, data: extractedData});
  } else if (request.action === 'showValidatedData') {
    // Remove loading notification
    removeLoadingNotification();
    
    // Show the validated and enhanced data
    if (request.data.error) {
      showNoDataFound(request.data.metadata, request.data.error);
    } else {
      showExtractedData(request.data.extractedData, request.data.metadata, request.data.enhancedData);
    }
    sendResponse({success: true});
  }
  return true; // Keep the message channel open for async response
});

/**
 * Fills a form on the page with the provided user data
 */
function fillForm(userData) {
  console.log('Filling form with:', userData);
  
  // Create a mapping of common field types to try and match with form fields
  const fieldMapping = {
    'first name': ['first name', 'firstname', 'first', 'given name', 'fname'],
    'last name': ['last name', 'lastname', 'last', 'surname', 'lname'],
    'email': ['email', 'e-mail', 'email address'],
    'phone': ['phone', 'telephone', 'phone number', 'mobile', 'cell'],
    'date of birth': ['date of birth', 'dob', 'birth date', 'birthdate', "date de naissance"],
    // Add more mappings as needed
  };
  
  // Get all input elements on the page
  const inputElements = document.querySelectorAll('input, textarea, select');
  
  // Try to intelligently match and fill fields
  inputElements.forEach(element => {
    // Skip hidden or submit inputs
    if (element.type === 'hidden' || element.type === 'submit' || element.type === 'button') {
      return;
    }
    
    // Get all attributes that might indicate the field's purpose
    const id = element.id ? element.id.toLowerCase() : '';
    const name = element.name ? element.name.toLowerCase() : '';
    const placeholder = element.placeholder ? element.placeholder.toLowerCase() : '';
    const label = findLabelFor(element);
    const ariaLabel = element.getAttribute('aria-label') ? 
                      element.getAttribute('aria-label').toLowerCase() : '';
    
    // Check for matches in our mapping
    for (const [dataKey, possibleMatches] of Object.entries(fieldMapping)) {
      if (userData[dataKey]) {
        // Check if any of the element's attributes match our possible field names
        if (possibleMatches.some(match => 
              id.includes(match) || 
              name.includes(match) || 
              placeholder.includes(match) || 
              ariaLabel.includes(match) ||
              (label && label.includes(match)))) {
          
          // Format special fields
          let value = userData[dataKey];
          if (dataKey === 'date of birth' && element.type === 'date') {
            // Convert DD/MM/YYYY to YYYY-MM-DD for date inputs
            const parts = value.split('/');
            if (parts.length === 3) {
              value = `${parts[2]}-${parts[1]}-${parts[0]}`;
            }
          }
          
          // Set the value and dispatch input events
          setFieldValue(element, value);
          console.log(`Filled ${dataKey} field:`, element);
        }
      }
    }
    
    // Special case for URL field which we don't try to fill
    // as we're presumably already navigated to it
  });
  
  // Success notification
  const notification = document.createElement('div');
  notification.textContent = 'Form filled by Form Assistant';
  notification.style.position = 'fixed';
  notification.style.bottom = '20px';
  notification.style.right = '20px';
  notification.style.backgroundColor = '#4285f4';
  notification.style.color = 'white';
  notification.style.padding = '10px 20px';
  notification.style.borderRadius = '4px';
  notification.style.zIndex = '10000';
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.remove();
  }, 3000);
}

/**
 * Finds the label text for an input element
 */
function findLabelFor(element) {
  // Check for a label with a matching 'for' attribute
  if (element.id) {
    const label = document.querySelector(`label[for="${element.id}"]`);
    if (label) {
      return label.textContent.toLowerCase();
    }
  }
  
  // Check if the input is inside a label
  let parent = element.parentElement;
  while (parent) {
    if (parent.tagName === 'LABEL') {
      return parent.textContent.toLowerCase();
    }
    parent = parent.parentElement;
  }
  
  return '';
}

/**
 * Sets a value on a form field and triggers appropriate events
 */
function setFieldValue(element, value) {
  // Different handling based on element type
  if (element.tagName === 'SELECT') {
    // For select elements, find option with matching text
    const options = Array.from(element.options);
    const option = options.find(opt => 
      opt.text.toLowerCase().includes(value.toLowerCase())
    );
    
    if (option) {
      element.value = option.value;
    }
  } else if (element.type === 'checkbox') {
    // Convert string true/false to boolean
    const boolValue = 
      value === true || 
      value === 'true' || 
      value === 'yes' || 
      value === '1';
    element.checked = boolValue;
  } else {
    // For text inputs, textareas, etc.
    element.value = value;
  }
  
  // Trigger events
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Extracts data from tables on the page based on various criteria
 */
function extractDataFromPage(params) {
  console.log('Extracting data with params:', params);
  
  // Find all tables on the page
  const tables = document.querySelectorAll('table');
  let extractedData = null;
  let metadata = {
    tableCount: tables.length,
    matchedTables: 0,
    extractionType: params.searchType,
    url: window.location.href,
    timestamp: new Date().toISOString()
  };
  
  // Process each table
  for (let tableIndex = 0; tableIndex < tables.length; tableIndex++) {
    const table = tables[tableIndex];
    const tableData = parseTable(table);
    
    if (!tableData.isValid) continue;
    
    let tableMatch = false;
    let tableExtractedData = null;
    
    switch (params.searchType) {
      case 'cell':
        tableExtractedData = extractCell(tableData, params);
        break;
      case 'row':
        tableExtractedData = extractRow(tableData, params);
        break;
      case 'column':
        tableExtractedData = extractColumn(tableData, params);
        break;
      case 'table':
        tableExtractedData = extractEntireTable(tableData, params);
        break;
      default:
        console.warn('Unknown search type:', params.searchType);
        continue;
    }
    
    if (tableExtractedData) {
      tableMatch = true;
      extractedData = tableExtractedData;
      metadata.matchedTables++;
      metadata.tableIndex = tableIndex;
      metadata.tableHeaders = tableData.headers;
      metadata.tableDimensions = {
        rows: tableData.rows.length,
        columns: tableData.headers.length
      };
    }
  }
  
  // Send the extracted data back to background script for LLM validation
  chrome.runtime.sendMessage({
    action: 'validateExtractedData',
    data: {
      extractedData,
      metadata,
      originalParams: params
    }
  });
  
  // Show a loading notification while waiting for LLM validation
  showLoadingNotification();
  
  return { data: extractedData, metadata };
}

/**
 * Parses a table element into a structured format
 */
function parseTable(table) {
  const result = {
    isValid: false,
    headers: [],
    rows: [],
    rawTable: table
  };
  
  // Get all rows
  const rows = table.querySelectorAll('tr');
  if (rows.length < 2) return result; // Need at least header and one data row
  
  // Parse headers
  const headerRow = rows[0];
  const headerCells = headerRow.querySelectorAll('th, td');
  result.headers = Array.from(headerCells).map(cell => cell.textContent.trim());
  
  // Parse data rows
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const cells = row.querySelectorAll('td');
    if (cells.length === 0) continue; // Skip empty rows
    
    const rowData = Array.from(cells).map(cell => cell.textContent.trim());
    result.rows.push(rowData);
  }
  
  result.isValid = result.headers.length > 0 && result.rows.length > 0;
  return result;
}

/**
 * Extracts a single cell based on search criteria
 */
function extractCell(tableData, params) {
  const { searchHeader, searchValue } = params;
  const headerIndex = tableData.headers.findIndex(h => 
    h.toLowerCase().includes(searchHeader.toLowerCase())
  );
  
  if (headerIndex === -1) return null;
  
  for (const row of tableData.rows) {
    if (row[headerIndex]?.toLowerCase().includes(searchValue.toLowerCase())) {
      return {
        type: 'cell',
        value: row[headerIndex],
        header: tableData.headers[headerIndex],
        rowIndex: tableData.rows.indexOf(row)
      };
    }
  }
  
  return null;
}

/**
 * Extracts an entire row based on search criteria
 */
function extractRow(tableData, params) {
  const { searchHeader, searchValue, rowIndex } = params;
  
  if (typeof rowIndex === 'number') {
    // Extract specific row by index
    if (rowIndex >= 0 && rowIndex < tableData.rows.length) {
      const rowData = {};
      tableData.headers.forEach((header, i) => {
        rowData[header] = tableData.rows[rowIndex][i];
      });
      return {
        type: 'row',
        data: rowData,
        rowIndex
      };
    }
    return null;
  }
  
  // Search for row by header and value
  const headerIndex = tableData.headers.findIndex(h => 
    h.toLowerCase().includes(searchHeader.toLowerCase())
  );
  
  if (headerIndex === -1) return null;
  
  for (let i = 0; i < tableData.rows.length; i++) {
    const row = tableData.rows[i];
    if (row[headerIndex]?.toLowerCase().includes(searchValue.toLowerCase())) {
      const rowData = {};
      tableData.headers.forEach((header, j) => {
        rowData[header] = row[j];
      });
      return {
        type: 'row',
        data: rowData,
        rowIndex: i
      };
    }
  }
  
  return null;
}

/**
 * Extracts an entire column based on search criteria
 */
function extractColumn(tableData, params) {
  const { searchHeader, columnIndex } = params;
  
  let targetIndex = columnIndex;
  if (typeof targetIndex !== 'number') {
    targetIndex = tableData.headers.findIndex(h => 
      h.toLowerCase().includes(searchHeader.toLowerCase())
    );
  }
  
  if (targetIndex === -1 || targetIndex >= tableData.headers.length) return null;
  
  const columnData = {
    type: 'column',
    header: tableData.headers[targetIndex],
    values: tableData.rows.map(row => row[targetIndex])
  };
  
  return columnData;
}

/**
 * Extracts the entire table data
 */
function extractEntireTable(tableData, params) {
  const { searchValue } = params;
  
  // If no search value, return entire table
  if (!searchValue) {
    return {
      type: 'table',
      headers: tableData.headers,
      rows: tableData.rows.map((row, i) => {
        const rowData = {};
        tableData.headers.forEach((header, j) => {
          rowData[header] = row[j];
        });
        return rowData;
      })
    };
  }
  
  // Search for rows containing the value
  const matchingRows = tableData.rows.filter(row => 
    row.some(cell => cell.toLowerCase().includes(searchValue.toLowerCase()))
  );
  
  if (matchingRows.length === 0) return null;
  
  return {
    type: 'table',
    headers: tableData.headers,
    rows: matchingRows.map(row => {
      const rowData = {};
      tableData.headers.forEach((header, j) => {
        rowData[header] = row[j];
      });
      return rowData;
    })
  };
}

/**
 * Shows a loading notification while waiting for LLM validation
 */
function showLoadingNotification() {
  const notification = document.createElement('div');
  notification.id = 'extraction-loading-notification';
  notification.style.position = 'fixed';
  notification.style.top = '20px';
  notification.style.left = '20px';
  notification.style.backgroundColor = '#e3f2fd';
  notification.style.border = '1px solid #90caf9';
  notification.style.borderRadius = '4px';
  notification.style.padding = '15px';
  notification.style.color = '#1976d2';
  notification.style.zIndex = '10000';
  
  const title = document.createElement('h3');
  title.textContent = 'Processing Extracted Data';
  title.style.margin = '0 0 10px 0';
  notification.appendChild(title);
  
  const message = document.createElement('p');
  message.textContent = 'Validating and enhancing the extracted data...';
  message.style.margin = '0';
  notification.appendChild(message);
  
  document.body.appendChild(notification);
}

/**
 * Removes the loading notification
 */
function removeLoadingNotification() {
  const notification = document.getElementById('extraction-loading-notification');
  if (notification) {
    notification.remove();
  }
}

/**
 * Shows a notification when no data is found
 */
function showNoDataFound(metadata, error = null) {
  const notification = document.createElement('div');
  notification.style.position = 'fixed';
  notification.style.top = '20px';
  notification.style.left = '20px';
  notification.style.backgroundColor = '#f8d7da';
  notification.style.border = '1px solid #f5c6cb';
  notification.style.borderRadius = '4px';
  notification.style.padding = '15px';
  notification.style.color = '#721c24';
  notification.style.zIndex = '10000';
  
  const title = document.createElement('h3');
  title.textContent = error ? 'Data Validation Error' : 'No Data Found';
  title.style.margin = '0 0 10px 0';
  notification.appendChild(title);
  
  const message = document.createElement('p');
  if (error) {
    message.textContent = error;
  } else {
    message.textContent = `Searched ${metadata.tableCount} tables but found no matching data.`;
  }
  notification.appendChild(message);
  
  document.body.appendChild(notification);
  
  setTimeout(() => notification.remove(), 5000);
}

/**
 * Displays extracted data in a notification with improved formatting
 */
function showExtractedData(data, metadata, enhancedData = null) {
  const notification = document.createElement('div');
  notification.style.position = 'fixed';
  notification.style.top = '20px';
  notification.style.left = '20px';
  notification.style.backgroundColor = 'white';
  notification.style.border = '1px solid #ccc';
  notification.style.borderRadius = '4px';
  notification.style.padding = '15px';
  notification.style.boxShadow = '0 2px 10px rgba(0,0,0,0.1)';
  notification.style.zIndex = '10000';
  notification.style.maxWidth = '400px';
  notification.style.maxHeight = '600px';
  notification.style.overflow = 'auto';
  
  // Create title
  const title = document.createElement('h3');
  title.textContent = `Extracted Data (${metadata.extractionType})`;
  title.style.margin = '0 0 10px 0';
  title.style.color = '#4285f4';
  notification.appendChild(title);
  
  // Add metadata
  const metaInfo = document.createElement('div');
  metaInfo.style.fontSize = '12px';
  metaInfo.style.color = '#666';
  metaInfo.style.marginBottom = '10px';
  metaInfo.innerHTML = `
    <p>Tables found: ${metadata.tableCount}</p>
    <p>Matched tables: ${metadata.matchedTables}</p>
    ${metadata.tableDimensions ? 
      `<p>Table dimensions: ${metadata.tableDimensions.rows} rows × ${metadata.tableDimensions.columns} columns</p>` : 
      ''}
    <p>Source URL: ${metadata.url}</p>
    <p>Extracted at: ${new Date(metadata.timestamp).toLocaleString()}</p>
  `;
  notification.appendChild(metaInfo);
  
  // Add enhanced data if available
  if (enhancedData) {
    const enhancedSection = document.createElement('div');
    enhancedSection.style.marginTop = '15px';
    enhancedSection.style.padding = '10px';
    enhancedSection.style.backgroundColor = '#f8f9fa';
    enhancedSection.style.borderRadius = '4px';
    
    const enhancedTitle = document.createElement('h4');
    enhancedTitle.textContent = 'Enhanced Analysis';
    enhancedTitle.style.margin = '0 0 10px 0';
    enhancedTitle.style.color = '#28a745';
    enhancedSection.appendChild(enhancedTitle);
    
    const enhancedContent = document.createElement('div');
    enhancedContent.innerHTML = enhancedData;
    enhancedSection.appendChild(enhancedContent);
    
    notification.appendChild(enhancedSection);
  }
  
  // Add data based on type
  const content = document.createElement('div');
  content.style.marginTop = '10px';
  
  switch (data.type) {
    case 'cell':
      content.innerHTML = `
        <div style="margin-bottom: 10px">
          <strong>${data.header}:</strong> ${data.value}
        </div>
      `;
      break;
      
    case 'row':
      const rowList = document.createElement('dl');
      for (const [key, value] of Object.entries(data.data)) {
        const dt = document.createElement('dt');
        dt.textContent = key;
        dt.style.fontWeight = 'bold';
        dt.style.marginTop = '5px';
        
        const dd = document.createElement('dd');
        dd.textContent = value;
        dd.style.marginLeft = '10px';
        dd.style.marginBottom = '5px';
        
        rowList.appendChild(dt);
        rowList.appendChild(dd);
      }
      content.appendChild(rowList);
      break;
      
    case 'column':
      content.innerHTML = `
        <h4 style="margin: 0 0 5px 0">${data.header}</h4>
        <ul style="margin: 0; padding-left: 20px">
          ${data.values.map(v => `<li>${v}</li>`).join('')}
        </ul>
      `;
      break;
      
    case 'table':
      const table = document.createElement('table');
      table.style.width = '100%';
      table.style.borderCollapse = 'collapse';
      table.style.marginTop = '10px';
      
      // Add headers
      const thead = document.createElement('thead');
      const headerRow = document.createElement('tr');
      data.headers.forEach(header => {
        const th = document.createElement('th');
        th.textContent = header;
        th.style.padding = '8px';
        th.style.border = '1px solid #ddd';
        th.style.backgroundColor = '#f5f5f5';
        headerRow.appendChild(th);
      });
      thead.appendChild(headerRow);
      table.appendChild(thead);
      
      // Add rows
      const tbody = document.createElement('tbody');
      data.rows.forEach(row => {
        const tr = document.createElement('tr');
        data.headers.forEach(header => {
          const td = document.createElement('td');
          td.textContent = row[header];
          td.style.padding = '8px';
          td.style.border = '1px solid #ddd';
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      
      content.appendChild(table);
      break;
  }
  
  notification.appendChild(content);
  
  // Add close button
  const closeButton = document.createElement('button');
  closeButton.textContent = 'Close';
  closeButton.style.backgroundColor = '#4285f4';
  closeButton.style.color = 'white';
  closeButton.style.border = 'none';
  closeButton.style.padding = '5px 10px';
  closeButton.style.borderRadius = '4px';
  closeButton.style.marginTop = '10px';
  closeButton.style.cursor = 'pointer';
  closeButton.onclick = () => notification.remove();
  notification.appendChild(closeButton);
  
  document.body.appendChild(notification);
  
  // Auto-remove after 30 seconds
  setTimeout(() => {
    if (document.body.contains(notification)) {
      notification.remove();
    }
  }, 30000);
}
