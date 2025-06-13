# Web Agent Chrome Extension

A Chrome extension that helps automate web form interactions through intelligent data extraction and form filling capabilities.

## Features

- **Authentication**: Secure Google OAuth integration for user authentication
- **Form Filling**: Automatically fill web forms with validated user data
- **Data Extraction**: Extract data from web pages based on various search parameters
- **Data Validation**: Server-side validation of extracted and form data
- **Cross-Domain Support**: Works across different websites with proper permissions

## Prerequisites

- Node.js (v14 or higher)
- Chrome browser
- A running backend server (see Configuration section)

## Installation

1. Clone this repository:
```bash
git clone [repository-url]
cd [repository-name]
```

2. Install dependencies:
```bash
npm install
```

3. Build the extension:
```bash
npm run build
```

4. Load the extension in Chrome:
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable "Developer mode" in the top right
   - Click "Load unpacked" and select the `dist` directory of this project

## Configuration

The extension requires a backend server to handle authentication and data processing. Configure the server URL in `background.js`:

```javascript
const SERVER_URL = process.env.NODE_ENV === 'production' 
  ? 'https://your-production-server.com'
  : 'http://localhost:3000';
```

## Usage

### Authentication

The extension uses Google OAuth for authentication. When first installed, users will be prompted to authenticate with their Google account.

### Form Filling

1. Navigate to a webpage containing a form
2. Click the extension icon
3. Select "Fill Form" and provide the necessary data
4. The extension will validate and fill the form automatically

### Data Extraction

1. Navigate to a webpage containing data you want to extract
2. Click the extension icon
3. Choose "Extract Data" and specify:
   - Search type (table, text, etc.)
   - Search parameters (headers, values, indices)
4. The extension will extract and validate the requested data

## Development

### Project Structure

- `background.js`: Main extension logic, authentication, and API communication
- `manifest.json`: Extension configuration and permissions
- `content.js`: Content scripts for webpage interaction
- `popup/`: UI components for the extension popup

### API Endpoints

The extension communicates with the backend server through these endpoints:

- `/api/users/auth/google`: Google OAuth token exchange
- `/api/forms/validate`: Form data validation
- `/api/forms/extract`: Data extraction
- `/api/forms/extract/validate`: Validation of extracted data

## Security

- All API requests are authenticated using JWT tokens
- Sensitive data is stored securely in Chrome's storage
- Cross-origin requests are properly handled with appropriate permissions