# Brandspot Puppy - Web Crawling API

A minimal, production-ready Node.js backend application that provides web crawling and article extraction capabilities with built-in privacy features.

## Features

- **Fast HTTP Server**: Built with Fastify for optimal performance
- **Web Crawling**: Uses Puppeteer for JavaScript-rendered content extraction
- **Article Extraction**: Powered by Mozilla's Readability.js for clean article content
- **Markdown Conversion**: Converts HTML content to Markdown format
- **Privacy Protection**: Integrated ad blocking and cookie consent handling
- **Flexible Response**: Supports both test mode and webhook callbacks

## Privacy Features

### 🛡️ Ad & Tracker Blocking
- **Ghostery Adblocker**: Blocks ads and trackers using Ghostery's advanced filtering
- **Enhanced Privacy**: Prevents tracking scripts from loading during crawling
- **Better Performance**: Faster page loads by blocking unnecessary content

### 🍪 Cookie Consent Management
- **Pre-built CMP Engine**: Uses the latest @duckduckgo/autoconsent content script
- **Pre-execution Injection**: Injects consent handling before any site JavaScript runs
- **Efficient Loading**: Loads pre-built content script for optimal performance
- **Rule Caching**: Caches loaded script for optimal performance on subsequent requests

## Installation

```bash
# Install dependencies
npm install

# Or using pnpm (recommended)
pnpm install
```

### Privacy Features Setup

After installation, the app will automatically:
- Block ads and trackers using Ghostery's advanced filtering
- Avoid detection using Puppeteer Extra's stealth capabilities
- Load and inject the latest cookie consent rules before page execution
- Provide cleaner, faster crawling with enhanced privacy protection

No additional configuration is required - the privacy features are enabled by default.

## Usage

### Start the Server

```bash
# Development mode with auto-reload
npm run dev

# Production mode
npm start
```

The server will start on port 3000 by default (configurable via PORT environment variable).

### API Endpoint

**POST** `/crawl`

#### Request Body

```json
{
  "url": "https://example.com/article",
  "callback_url": "https://your-service.com/webhook",
  "test": false
}
```

#### Parameters

- `url` (required): The URL to crawl and extract content from
- `callback_url` (required when test=false): Webhook URL to receive the extracted content
- `test` (optional): When true, logs the result to console instead of sending to callback

#### Response

**Test Mode** (test=true):
```json
{
  "message": "Article extracted successfully (test mode)"
}
```

**Production Mode** (test=false):
```json
{
  "message": "Request accepted and processed"
}
```

#### Extracted Content Format

The content sent to your callback URL or logged in test mode:

```json
{
  "url": "https://example.com/article",
  "title": "Article Title",
  "byline": "Author Name",
  "markdown": "# Article Title\n\nArticle content in markdown...",
  "extracted_at": "2024-01-15T12:00:00.000Z"
}
```

## Error Handling

The API returns appropriate HTTP status codes:

- `200 OK`: Test mode successful
- `202 Accepted`: Production mode, request processed
- `400 Bad Request`: Invalid or missing parameters
- `502 Bad Gateway`: Failed to extract content or navigate to URL
- `500 Internal Server Error`: Unexpected server error

All errors are logged with timestamps and stack traces for debugging.

## Examples

### Test Mode Example

```bash
curl -X POST http://localhost:3000/crawl \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/article",
    "test": true
  }'
```

### Production Mode Example

```bash
curl -X POST http://localhost:3000/crawl \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/article",
    "callback_url": "https://your-webhook.com/endpoint"
  }'
```

## Dependencies

### Core Dependencies
- **fastify**: Fast and low overhead web framework
- **puppeteer**: Headless Chrome automation
- **@mozilla/readability**: Article extraction library
- **jsdom**: JavaScript implementation of DOM standards
- **node-html-markdown**: Primary HTML to Markdown converter (fast, zero-dependency)
- **turndown**: Fallback HTML to Markdown converter (mature, handles edge cases)
- **node-fetch**: HTTP client for Node.js
- **esbuild**: JavaScript bundler for runtime CMP rule compilation

### Privacy Dependencies
- **@ghostery/adblocker-puppeteer**: Ad and tracker blocking (v2.11.1)
- **@duckduckgo/autoconsent**: CMP rules and consent management (v14.5.1)
- **puppeteer-extra**: Enhanced Puppeteer with plugin support (v3.3.6)
- **puppeteer-extra-plugin-stealth**: Stealth plugin to avoid detection (v2.11.2)
- **esbuild**: Runtime bundling of consent scripts (v0.25.6)


## Technical Details

### Architecture
- **ES Modules**: Uses modern JavaScript module syntax
- **Headless Browser**: Puppeteer with "new" headless mode
- **Pre-built Scripts**: Uses optimized content scripts from package distribution
- **Memory Management**: Proper cleanup of browser resources
- **Error Logging**: Comprehensive error handling with timestamps

### Cookie Consent Engine
- **Pre-built Script**: Uses the optimized content script from `@duckduckgo/autoconsent`
- **Module Caching**: Caches loaded script in memory for optimal performance
- **Pre-execution Injection**: Injects consent handling before any site JavaScript runs
- **Latest Rules**: Always uses the most recent CMP rules from the installed package

### Performance Optimizations
- **Network Idle**: Waits for network to be idle before extraction
- **Resource Blocking**: Blocks ads and trackers for faster loading
- **Script Caching**: Loads and caches consent scripts to avoid file system overhead
- **Bullet-proof Markdown**: Multi-tier conversion strategy with timeouts and fallbacks
- **Efficient Cleanup**: Properly closes browser instances and pages

### Security Features
- **Sandboxing**: Runs Puppeteer with security flags
- **Input Validation**: Validates all incoming parameters
- **Error Isolation**: Prevents sensitive information leakage

## Implementation Details

### Cookie Consent Helper (`autoconsent.js`)

The application includes a reusable helper module that handles runtime bundling of the latest CMP rules:

```javascript
import { getAutoConsentScript } from './autoconsent.js';

// Gets the bundled script (builds and caches on first call)
const script = await getAutoConsentScript();
```

**Key Features:**
- **Pre-built Script**: Uses the optimized content script from the package's dist directory
- **Module Caching**: Caches the loaded script in memory for subsequent requests
- **No Build Step**: Uses the pre-built script from `@duckduckgo/autoconsent`
- **ES Module**: Pure ES module implementation using `createRequire()` for compatibility

**How it Works:**
1. Locates the pre-built content script: `@duckduckgo/autoconsent/dist/addon-mv3/content.bundle.js`
2. Reads the optimized script file directly
3. Caches the result at the module level for performance
4. Returns the cached script on subsequent calls

## Environment Variables

- `PORT`: Server port (default: 3000)
- `NODE_ENV`: Environment mode (development/production)

## Support

For issues and questions, please use the GitHub issue tracker. 