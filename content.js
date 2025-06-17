// Listen for messages from the extension
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === 'fillForm') {
    fillForm(request.userData);
    sendResponse({success: true});
  } else if (request.action === 'extractData') {
    console.log('Received extract request:', request.searchParams);
    // Ensure searchParams has the correct structure for cell_by_row_id
    if (request.searchParams.searchType === 'cell_by_row_id') {
      if (!request.searchParams.column_header || !request.searchParams.row_identifier) {
        console.error('Missing required parameters for cell_by_row_id extraction');
        sendResponse({success: false, error: 'Missing required parameters'});
        return true;
      }
    }
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
    
    // Use the new unified extraction function
    tableExtractedData = extractFromTable(tableData, params);
    
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
 * Unified table extraction function that handles all extraction types
 */
function extractFromTable(tableData, params) {
  const { searchType, ...searchParams } = params;
  
  console.log('Extracting from table with type:', searchType, 'and params:', searchParams);
  
  switch (searchType) {
    case 'cell':
      return extractCellData(tableData, searchParams);
    case 'cell_by_row_id':
      return extractCellByRowIdentifier(tableData, searchParams);
    case 'row':
      return extractRowData(tableData, searchParams);
    case 'column':
      return extractColumnData(tableData, searchParams);
    case 'table':
      return extractTableData(tableData, searchParams);
    case 'extract_by_criteria':
      return extractByCriteria(tableData, searchParams);
    case 'list':
      return extractListData(tableData, searchParams);
    case 'search':
      return extractSearchResults(tableData, searchParams);
    default:
      console.warn('Unknown search type:', searchType);
      return null;
  }
}

/**
 * Enhanced cell extraction with multiple strategies
 */
function extractCellData(tableData, params) {
  const { searchHeader, searchValue, rowIndex, columnIndex } = params;
  
  // If specific indices are provided, use them directly
  if (typeof rowIndex === 'number' && typeof columnIndex === 'number') {
    if (rowIndex >= 0 && rowIndex < tableData.rows.length && 
        columnIndex >= 0 && columnIndex < tableData.headers.length) {
      return {
        type: 'cell',
        value: tableData.rows[rowIndex][columnIndex],
        header: tableData.headers[columnIndex],
        rowIndex: rowIndex,
        columnIndex: columnIndex,
        matchType: 'direct_index'
      };
    }
    return null;
  }
  
  // Find column index using flexible matching
  const foundColumnIndex = findColumnIndex(tableData.headers, searchHeader);
  if (foundColumnIndex === -1) {
    console.log('Column not found:', searchHeader, 'Available:', tableData.headers);
    return null;
  }
  
  // If only column is specified, return first non-empty value
  if (!searchValue) {
    for (let i = 0; i < tableData.rows.length; i++) {
      const value = tableData.rows[i][foundColumnIndex];
      if (value && value.trim()) {
        return {
          type: 'cell',
          value: value,
          header: tableData.headers[foundColumnIndex],
          rowIndex: i,
          columnIndex: foundColumnIndex,
          matchType: 'first_non_empty'
        };
      }
    }
    return null;
  }
  
  // Search for matching value in the column
  const matchResult = findValueInColumn(tableData.rows, foundColumnIndex, searchValue);
  if (matchResult) {
    return {
      type: 'cell',
      value: matchResult.value,
      header: tableData.headers[foundColumnIndex],
      rowIndex: matchResult.rowIndex,
      columnIndex: foundColumnIndex,
      matchType: matchResult.matchType
    };
  }
  
  return null;
}

/**
 * Enhanced cell extraction by row identifier
 */
function extractCellByRowIdentifier(tableData, params) {
  const { column_header, row_identifier } = params;
  
  // Find target column
  const targetColumnIndex = findColumnIndex(tableData.headers, column_header);
  if (targetColumnIndex === -1) {
    console.log('Target column not found:', column_header);
    return null;
  }
  
  // Find identifier column
  const idColumnIndex = findColumnIndex(tableData.headers, row_identifier.header);
  if (idColumnIndex === -1) {
    console.log('Identifier column not found:', row_identifier.header);
    return null;
  }
  
  // Find matching row
  const matchResult = findValueInColumn(tableData.rows, idColumnIndex, row_identifier.value);
  if (matchResult) {
    return {
      type: 'cell_by_row_id',
      value: tableData.rows[matchResult.rowIndex][targetColumnIndex],
      column: tableData.headers[targetColumnIndex],
      rowIdentifier: {
        column: tableData.headers[idColumnIndex],
        value: tableData.rows[matchResult.rowIndex][idColumnIndex]
      },
      rowIndex: matchResult.rowIndex,
      matchType: matchResult.matchType
    };
  }
  
  return null;
}

/**
 * Enhanced row extraction
 */
function extractRowData(tableData, params) {
  const { searchHeader, searchValue, rowIndex } = params;
  
  // Direct row index access
  if (typeof rowIndex === 'number') {
    if (rowIndex >= 0 && rowIndex < tableData.rows.length) {
      return {
        type: 'row',
        data: createRowObject(tableData.headers, tableData.rows[rowIndex]),
        rowIndex: rowIndex,
        matchType: 'direct_index'
      };
    }
    return null;
  }
  
  // Search by header and value
  if (searchHeader && searchValue) {
    const columnIndex = findColumnIndex(tableData.headers, searchHeader);
    if (columnIndex === -1) return null;
    
    const matchResult = findValueInColumn(tableData.rows, columnIndex, searchValue);
    if (matchResult) {
      return {
        type: 'row',
        data: createRowObject(tableData.headers, tableData.rows[matchResult.rowIndex]),
        rowIndex: matchResult.rowIndex,
        matchType: matchResult.matchType
      };
    }
  }
  
  return null;
}

/**
 * Enhanced column extraction
 */
function extractColumnData(tableData, params) {
  const { searchHeader, columnIndex: paramColumnIndex } = params;
  
  let targetIndex = paramColumnIndex;
  if (typeof targetIndex !== 'number') {
    targetIndex = findColumnIndex(tableData.headers, searchHeader);
  }
  
  if (targetIndex === -1 || targetIndex >= tableData.headers.length) {
    return null;
  }
  
  const values = tableData.rows.map(row => row[targetIndex]).filter(val => val && val.trim());
  
  return {
    type: 'column',
    header: tableData.headers[targetIndex],
    values: values,
    totalValues: values.length,
    columnIndex: targetIndex
  };
}

/**
 * Enhanced table extraction
 */
function extractTableData(tableData, params) {
  const { searchValue, limit } = params;
  
  let rows = tableData.rows;
  
  // Filter by search value if provided
  if (searchValue) {
    rows = rows.filter(row => 
      row.some(cell => 
        cell && cell.toString().toLowerCase().includes(searchValue.toLowerCase())
      )
    );
  }
  
  // Apply limit if specified
  if (limit && typeof limit === 'number' && limit > 0) {
    rows = rows.slice(0, limit);
  }
  
  if (rows.length === 0) return null;
  
  return {
    type: 'table',
    headers: tableData.headers,
    rows: rows.map(row => createRowObject(tableData.headers, row)),
    totalRows: rows.length,
    originalRowCount: tableData.rows.length
  };
}

/**
 * Enhanced criteria-based extraction
 */
function extractByCriteria(tableData, params) {
  const { criteria } = params;
  
  // Convert single criteria to array
  const criteriaArray = Array.isArray(criteria) ? criteria : [criteria];
  
  // Validate criteria
  for (const criterion of criteriaArray) {
    if (!criterion.column || !criterion.operator || criterion.value === undefined) {
      console.error('Invalid criterion:', criterion);
      return null;
    }
  }
  
  // Find matching rows
  const matchingRows = tableData.rows.filter(row => {
    return criteriaArray.every(criterion => {
      const columnIndex = findColumnIndex(tableData.headers, criterion.column);
      if (columnIndex === -1) return false;
      
      const cellValue = row[columnIndex];
      return evaluateCriterion(cellValue, criterion);
    });
  });
  
  if (matchingRows.length === 0) return null;
  
  return {
    type: 'extract_by_criteria',
    criteria: criteriaArray,
    rows: matchingRows.map(row => createRowObject(tableData.headers, row)),
    totalMatches: matchingRows.length
  };
}

/**
 * Extract list data (useful for simple lists or enumerated data)
 */
function extractListData(tableData, params) {
  const { column, filter, sort, limit } = params;
  
  let columnIndex = 0; // Default to first column
  if (column) {
    columnIndex = findColumnIndex(tableData.headers, column);
    if (columnIndex === -1) columnIndex = 0;
  }
  
  let values = tableData.rows.map(row => row[columnIndex]).filter(val => val && val.trim());
  
  // Apply filter if specified
  if (filter) {
    values = values.filter(val => 
      val.toString().toLowerCase().includes(filter.toLowerCase())
    );
  }
  
  // Apply sorting if specified
  if (sort) {
    if (sort === 'asc') {
      values.sort((a, b) => a.toString().localeCompare(b.toString()));
    } else if (sort === 'desc') {
      values.sort((a, b) => b.toString().localeCompare(a.toString()));
    }
  }
  
  // Apply limit
  if (limit && typeof limit === 'number' && limit > 0) {
    values = values.slice(0, limit);
  }
  
  return {
    type: 'list',
    values: values,
    totalValues: values.length,
    column: tableData.headers[columnIndex],
    columnIndex: columnIndex
  };
}

/**
 * Extract search results (general search across all columns)
 */
function extractSearchResults(tableData, params) {
  const { searchTerm, columns, caseSensitive = false } = params;
  
  if (!searchTerm) return null;
  
  const searchValue = caseSensitive ? searchTerm : searchTerm.toLowerCase();
  const targetColumns = columns ? 
    columns.map(col => findColumnIndex(tableData.headers, col)).filter(idx => idx !== -1) :
    Array.from({ length: tableData.headers.length }, (_, i) => i);
  
  const matchingRows = tableData.rows.filter(row => {
    return targetColumns.some(colIndex => {
      const cellValue = row[colIndex];
      if (!cellValue) return false;
      
      const cellStr = caseSensitive ? cellValue.toString() : cellValue.toString().toLowerCase();
      return cellStr.includes(searchValue);
    });
  });
  
  if (matchingRows.length === 0) return null;
  
  return {
    type: 'search_results',
    searchTerm: searchTerm,
    matchingRows: matchingRows.map(row => createRowObject(tableData.headers, row)),
    totalMatches: matchingRows.length,
    searchedColumns: targetColumns.map(idx => tableData.headers[idx])
  };
}

/**
 * Utility function to find column index with flexible matching
 */
function findColumnIndex(headers, searchHeader) {
  if (!searchHeader) return -1;
  
  const searchLower = searchHeader.toLowerCase().trim();
  
  // Strategy 1: Exact match
  let index = headers.findIndex(h => h.toLowerCase().trim() === searchLower);
  if (index !== -1) return index;
  
  // Strategy 2: Contains match
  index = headers.findIndex(h => h.toLowerCase().trim().includes(searchLower));
  if (index !== -1) return index;
  
  // Strategy 3: Normalized match (remove special characters)
  const normalizedSearch = searchLower.replace(/[-_\s]/g, '');
  index = headers.findIndex(h => 
    h.toLowerCase().replace(/[-_\s]/g, '').includes(normalizedSearch)
  );
  if (index !== -1) return index;
  
  // Strategy 4: Partial word match
  const searchWords = searchLower.split(/\s+/);
  index = headers.findIndex(h => {
    const headerLower = h.toLowerCase();
    return searchWords.some(word => headerLower.includes(word));
  });
  
  return index;
}

/**
 * Utility function to find value in column with multiple matching strategies
 */
function findValueInColumn(rows, columnIndex, searchValue) {
  if (!searchValue) return null;
  
  const searchLower = searchValue.toString().toLowerCase().trim();
  
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const cellValue = rows[rowIndex][columnIndex];
    if (!cellValue) continue;
    
    const cellLower = cellValue.toString().toLowerCase().trim();
    
    // Strategy 1: Exact match
    if (cellLower === searchLower) {
      return { value: cellValue, rowIndex, matchType: 'exact' };
    }
    
    // Strategy 2: Contains match
    if (cellLower.includes(searchLower)) {
      return { value: cellValue, rowIndex, matchType: 'contains' };
    }
    
    // Strategy 3: Normalized match
    const normalizedCell = cellLower.replace(/[-_\s]/g, '');
    const normalizedSearch = searchLower.replace(/[-_\s]/g, '');
    if (normalizedCell.includes(normalizedSearch)) {
      return { value: cellValue, rowIndex, matchType: 'normalized' };
    }
    
    // Strategy 4: Numeric match
    const cellNum = parseFloat(cellValue);
    const searchNum = parseFloat(searchValue);
    if (!isNaN(cellNum) && !isNaN(searchNum) && cellNum === searchNum) {
      return { value: cellValue, rowIndex, matchType: 'numeric' };
    }
  }
  
  return null;
}

/**
 * Utility function to evaluate a single criterion
 */
function evaluateCriterion(cellValue, criterion) {
  if (cellValue === undefined || cellValue === null) return false;
  
  const cellStr = cellValue.toString().toLowerCase().trim();
  const criterionStr = criterion.value.toString().toLowerCase().trim();
  
  // Try numeric comparison first
  const cellNum = parseFloat(cellValue);
  const criterionNum = parseFloat(criterion.value);
  const isNumeric = !isNaN(cellNum) && !isNaN(criterionNum);
  
  switch (criterion.operator) {
    case '=':
      return isNumeric ? cellNum === criterionNum : cellStr === criterionStr;
    case '!=':
      return isNumeric ? cellNum !== criterionNum : cellStr !== criterionStr;
    case '>':
      return isNumeric ? cellNum > criterionNum : cellStr > criterionStr;
    case '<':
      return isNumeric ? cellNum < criterionNum : cellStr < criterionStr;
    case '>=':
      return isNumeric ? cellNum >= criterionNum : cellStr >= criterionStr;
    case '<=':
      return isNumeric ? cellNum <= criterionNum : cellStr <= criterionStr;
    case 'contains':
      return cellStr.includes(criterionStr);
    case 'starts_with':
      return cellStr.startsWith(criterionStr);
    case 'ends_with':
      return cellStr.endsWith(criterionStr);
    case 'regex':
      try {
        const regex = new RegExp(criterion.value, 'i');
        return regex.test(cellValue);
      } catch (e) {
        return false;
      }
    default:
      return false;
  }
}

/**
 * Utility function to create row object from headers and values
 */
function createRowObject(headers, values) {
  const rowData = {};
  headers.forEach((header, index) => {
    rowData[header] = values[index] || '';
  });
  return rowData;
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
  
  try {
    // Get all rows
    const rows = table.querySelectorAll('tr');
    if (rows.length < 1) return result; // Need at least one row
    
    // Try to find header row - check first few rows for th elements
    let headerRowIndex = 0;
    let headerCells = null;
    
    for (let i = 0; i < Math.min(3, rows.length); i++) {
      const thCells = rows[i].querySelectorAll('th');
      if (thCells.length > 0) {
        headerRowIndex = i;
        headerCells = thCells;
        break;
      }
    }
    
    // If no th elements found, use first row as headers
    if (!headerCells) {
      headerCells = rows[0].querySelectorAll('td');
      headerRowIndex = 0;
    }
    
    // Parse headers and clean them
    result.headers = Array.from(headerCells).map(cell => {
      let text = cell.textContent || cell.innerText || '';
      return text.trim().replace(/\s+/g, ' '); // Normalize whitespace
    });
    
    // Filter out empty headers
    if (result.headers.every(h => h === '')) {
      // If all headers are empty, create generic ones
      result.headers = result.headers.map((_, i) => `Column ${i + 1}`);
    }
    
    console.log('Parsed headers:', result.headers);
    
    // Parse data rows (skip header row)
    for (let i = headerRowIndex + 1; i < rows.length; i++) {
      const row = rows[i];
      const cells = row.querySelectorAll('td, th');
      if (cells.length === 0) continue; // Skip empty rows
      
      const rowData = Array.from(cells).map(cell => {
        let text = cell.textContent || cell.innerText || '';
        return text.trim().replace(/\s+/g, ' '); // Normalize whitespace
      });
      
      // Ensure row has same number of columns as headers
      while (rowData.length < result.headers.length) {
        rowData.push('');
      }
      
      // Trim extra columns if row is longer than headers
      if (rowData.length > result.headers.length) {
        rowData.splice(result.headers.length);
      }
      
      result.rows.push(rowData);
    }
    
    console.log(`Parsed ${result.rows.length} data rows`);
    
    result.isValid = result.headers.length > 0 && result.rows.length > 0;
    return result;
  } catch (error) {
    console.error('Error parsing table:', error);
    return result;
  }
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
      
    case 'cell_by_row_id':
      content.innerHTML = `
        <div style="margin-bottom: 10px">
          <strong>${data.column}:</strong> ${data.value}
          <div style="font-size: 0.9em; color: #666; margin-top: 5px">
            Found in row where ${data.rowIdentifier.column} = ${data.rowIdentifier.value}
          </div>
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
      
    case 'extract_by_criteria':
      const criteriaList = data.criteria.map(c => 
        `${c.column} ${c.operator} ${c.value}`
      ).join(' AND ');
      
      content.innerHTML = `
        <div style="margin-bottom: 15px">
          <h4 style="margin: 0 0 10px 0">Found ${data.totalMatches} matching rows</h4>
          <div style="font-size: 0.9em; color: #666; margin-bottom: 10px">
            Criteria: ${criteriaList}
          </div>
          <table style="width: 100%; border-collapse: collapse; margin-top: 10px">
            <thead>
              <tr>
                ${metadata.tableHeaders.map(header => 
                  `<th style="padding: 8px; border: 1px solid #ddd; background-color: #f5f5f5">${header}</th>`
                ).join('')}
              </tr>
            </thead>
            <tbody>
              ${data.rows.map(row => `
                <tr>
                  ${metadata.tableHeaders.map(header => 
                    `<td style="padding: 8px; border: 1px solid #ddd">${row[header]}</td>`
                  ).join('')}
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
      break;
      
    case 'list':
      content.innerHTML = `
        <div style="margin-bottom: 15px">
          <h4 style="margin: 0 0 10px 0">${data.column} (${data.totalValues} items)</h4>
          <ul style="margin: 0; padding-left: 20px; max-height: 200px; overflow-y: auto">
            ${data.values.map(v => `<li>${v}</li>`).join('')}
          </ul>
        </div>
      `;
      break;
      
    case 'search_results':
      content.innerHTML = `
        <div style="margin-bottom: 15px">
          <h4 style="margin: 0 0 10px 0">Search Results for "${data.searchTerm}" (${data.totalMatches} matches)</h4>
          <div style="font-size: 0.9em; color: #666; margin-bottom: 10px">
            Searched columns: ${data.searchedColumns.join(', ')}
          </div>
          <table style="width: 100%; border-collapse: collapse; margin-top: 10px">
            <thead>
              <tr>
                ${metadata.tableHeaders.map(header => 
                  `<th style="padding: 8px; border: 1px solid #ddd; background-color: #f5f5f5">${header}</th>`
                ).join('')}
              </tr>
            </thead>
            <tbody>
              ${data.matchingRows.map(row => `
                <tr>
                  ${metadata.tableHeaders.map(header => 
                    `<td style="padding: 8px; border: 1px solid #ddd">${row[header]}</td>`
                  ).join('')}
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
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
