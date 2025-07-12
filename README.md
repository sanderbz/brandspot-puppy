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

### API Endpoints

#### **POST** `/crawl`

Main crawling endpoint for article extraction.

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

**Both Test and Production Mode**:
```json
{
  "message": "Request accepted and processed"
}
```

> **Note**: Both test and production modes return the same response message. In test mode, the extracted content is logged to the console instead of being sent to a callback URL.

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

#### **GET** `/health`

Health check endpoint with browser statistics and configuration info.

#### Response

```json
{
  "status": "ok",
  "timestamp": "2024-01-15T12:00:00.000Z",
  "browser": {
    "initialized": true,
    "requestCount": 42,
    "ageMinutes": 120,
    "maxRequests": 1000,
    "maxAgeMinutes": 1440
  },
  "config": {
    "debug": false,
    "navigationTimeout": 30000,
    "conversionTimeout": 5000
  }
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

### Health Check Example

```bash
curl http://localhost:3000/health
```

This returns browser statistics useful for monitoring performance and determining when the browser will restart.

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
- **Persistent Browser**: Single long-lived browser instance shared across requests
- **Page-per-Request**: Lightweight page creation for concurrent request handling
- **Pre-built Scripts**: Uses optimized content scripts from package distribution
- **Smart Memory Management**: Pages cleaned up after each request, browser persisted
- **Error Logging**: Comprehensive error handling with timestamps

### Cookie Consent Engine
- **Pre-built Script**: Uses the optimized content script from `@duckduckgo/autoconsent`
- **Module Caching**: Caches loaded script in memory for optimal performance
- **Pre-execution Injection**: Injects consent handling before any site JavaScript runs
- **Latest Rules**: Always uses the most recent CMP rules from the installed package

### Browser Management Strategy
- **Persistent Instance**: Single browser shared across all requests for maximum performance
- **Automatic Restart**: Browser restarts after 24 hours or 1000 requests to prevent memory leaks
- **Crash Recovery**: Gracefully handles browser disconnections with automatic reinitialization
- **Concurrent Support**: Multiple requests can create pages simultaneously on the same browser
- **Resource Cleanup**: Each request cleans up its page but preserves the browser instance
- **Graceful Shutdown**: Properly closes browser on application termination signals

### Performance Optimizations
- **Persistent Browser**: Keeps browser instance alive for up to 24 hours or 1000 requests
- **Page Pooling**: Creates lightweight pages for each request instead of full browser instances
- **Network Idle**: Waits for network to be idle before extraction
- **Resource Blocking**: Blocks ads and trackers for faster loading
- **Script Caching**: Loads and caches consent scripts to avoid file system overhead
- **Bullet-proof Markdown**: Multi-tier conversion strategy with timeouts and fallbacks
- **Graceful Restart**: Automatically restarts browser on age/request limits or crashes

### Security Features
- **Sandboxing**: Runs Puppeteer with security flags
- **Input Validation**: Validates all incoming parameters
- **Error Isolation**: Prevents sensitive information leakage

## File Structure

```
brandspot-puppy/
├── server.js          # Main HTTP server and crawl endpoint
├── browser.js         # Browser instance management
├── autoconsent.js     # Cookie consent script loader
├── config.js          # Application configuration
├── package.json       # Dependencies and scripts
└── README.md          # This file
```

### Configuration (`config.js`)

Centralized configuration using JavaScript (not JSON) for flexibility:

```javascript
import { config } from './config.js';

// Browser settings
config.browser.maxAge           // 24 hours browser lifetime
config.browser.maxRequests      // 1000 requests before restart
config.browser.launchOptions    // Puppeteer launch arguments

// Page settings  
config.page.navigationTimeout   // 30 second navigation timeout
config.page.waitUntil          // 'networkidle0' wait condition

// Markdown conversion
config.markdown.conversionTimeout  // 5 second per-converter timeout
config.markdown.turndownOptions   // Turndown service configuration
```

**Why JavaScript config over JSON:**
- **Comments**: Inline documentation for settings
- **Calculations**: Dynamic values (e.g., `24 * 60 * 60 * 1000`)
- **Environment**: Access to `process.env` variables
- **Flexibility**: Easy to extend and modify

### Browser Management (`browser.js`)

High-performance persistent browser with automatic lifecycle management:

```javascript
import { getBrowser, createPage, getBrowserStats } from './browser.js';

const browser = await getBrowser();    // Get shared browser instance
const page = await createPage(browser); // Create new page with timeout
const stats = getBrowserStats();       // Get usage statistics
```

**Key Features:**
- **Persistent Instance**: Single browser shared across all requests
- **Automatic Restart**: Browser restarts after 24 hours or 1000 requests
- **Crash Recovery**: Gracefully handles browser disconnections
- **Pre-initialization**: Browser starts when module is imported

### Cookie Consent Helper (`autoconsent.js`)

Loads and caches the pre-built AutoConsent content script:

```javascript
import { getAutoConsentScript } from './autoconsent.js';

// Gets the pre-built script (caches on first call)
const script = await getAutoConsentScript();
```

**How it Works:**
1. Locates package directory via `require.resolve('@duckduckgo/autoconsent')`
2. Constructs path to pre-built content script
3. Reads and caches the optimized script file
4. Returns cached script on subsequent calls

## Environment Variables

- `PORT`: Server port (default: 3000)
- `NODE_ENV`: Environment mode (development/production)

## Support

For issues and questions, please use the GitHub issue tracker. 