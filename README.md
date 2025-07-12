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
- **Runtime CMP Engine**: Bundles the latest @duckduckgo/autoconsent rules at runtime
- **Pre-execution Injection**: Injects consent handling before any site JavaScript runs
- **Auto-bundling**: Uses esbuild to create optimized content scripts on first startup
- **Rule Caching**: Caches bundled rules for optimal performance on subsequent requests

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
- Bundle and inject the latest cookie consent rules at runtime
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
- **markdownify**: HTML to Markdown converter
- **node-fetch**: HTTP client for Node.js
- **esbuild**: JavaScript bundler for runtime CMP rule compilation

### Privacy Dependencies
- **@ghostery/adblocker-puppeteer**: Ad and tracker blocking (v2.11.1)
- **@duckduckgo/autoconsent**: CMP rules and consent management (v14.5.1)
- **puppeteer-extra**: Enhanced Puppeteer with plugin support (v3.3.6)
- **puppeteer-extra-plugin-stealth**: Stealth plugin to avoid detection (v2.11.2)
- **esbuild**: Runtime bundling of consent scripts (v0.25.6)

> **Note**: The originally requested `@inqludeit/cmp-b-gone` package does not exist. We've implemented a superior solution using runtime-bundled DuckDuckGo AutoConsent rules that are injected before any site JavaScript runs, combined with Puppeteer Extra's stealth capabilities and Ghostery's adblocker for comprehensive privacy protection.

## Technical Details

### Architecture
- **ES Modules**: Uses modern JavaScript module syntax
- **Headless Browser**: Puppeteer with "new" headless mode
- **Runtime Bundling**: Dynamic compilation of CMP rules using esbuild
- **Memory Management**: Proper cleanup of browser resources
- **Error Logging**: Comprehensive error handling with timestamps

### Cookie Consent Engine
- **Runtime Compilation**: Bundles `@duckduckgo/autoconsent` content script on first startup
- **Module Caching**: Caches bundled script in memory for optimal performance
- **Pre-execution Injection**: Injects consent handling before any site JavaScript runs
- **Latest Rules**: Always uses the most recent CMP rules from the installed package

### Performance Optimizations
- **Network Idle**: Waits for network to be idle before extraction
- **Resource Blocking**: Blocks ads and trackers for faster loading
- **Script Caching**: Bundles and caches consent rules to avoid rebuild overhead
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
- **Runtime Bundling**: Uses esbuild to compile the content script on first startup
- **Module Caching**: Caches the bundled script in memory for subsequent requests
- **No Build Step**: Automatically picks up newly-published CMP rules on server restart
- **ES Module**: Pure ES module implementation using `createRequire()` for compatibility

**How it Works:**
1. Locates the entry point: `@duckduckgo/autoconsent/lib/content/index.js`
2. Bundles it using esbuild with optimized browser-compatible settings
3. Caches the result at the module level for performance
4. Returns the cached script on subsequent calls

## Environment Variables

- `PORT`: Server port (default: 3000)
- `NODE_ENV`: Environment mode (development/production)

## License

This project is licensed under the MIT License.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## Support

For issues and questions, please use the GitHub issue tracker. 