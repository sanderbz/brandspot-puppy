// Application Configuration
export const config = {
  // Server settings
  server: {
    port: process.env.PORT || 3000,
    host: process.env.HOST || '0.0.0.0'
  },

  // Browser management settings
  browser: {
    // Maximum age before browser restart (24 hours)
    maxAge: 24 * 60 * 60 * 1000,
    
    // Maximum requests before browser restart
    maxRequests: 1000,
    
    // Run browser in headless mode (true in production by default, overridable via HEADLESS)
    headless: (() => {
      if (typeof process.env.HEADLESS === 'string') {
        const v = process.env.HEADLESS.toLowerCase();
        return v === '1' || v === 'true' || v === 'yes';
      }
      return process.env.NODE_ENV === 'production';
    })(),

    // Open DevTools automatically (for debugging selectors, network, etc.)
    devtools: process.env.DEVTOOLS === 'true' || false,

    // Max concurrent pages (tabs) to prevent overload
    maxConcurrentPages: parseInt(process.env.MAX_CONCURRENT_PAGES, 10) || 5,

    // Puppeteer launch options
    launchOptions: {
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage', // Overcome limited resource problems
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--disable-background-timer-throttling', // Prevent background throttling
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-features=TranslateUI',
        '--disable-default-apps',
        '--disable-sync',
        '--metrics-recording-only',
        '--no-first-run',
        '--safebrowsing-disable-auto-update',
        '--disable-component-update',
        '--disable-domain-reliability'
      ]
    }
  },

  // Page settings
  page: {
    // Navigation timeout (30 seconds)
    navigationTimeout: 30000,
    
    // Wait condition for page load
    waitUntil: 'networkidle0'
  },

  // Content parsing settings
  parser: {
    // Which parsers to use: array of 'readability' and/or 'defuddle'
    engines: ['defuddle', 'readability']
    // engines: ['readability']
    // engines: ['defuddle', 'readability']
  },

  // Markdown conversion settings
  markdown: {
    // Timeout per converter (5 seconds)
    conversionTimeout: 5000,
    
    // Turndown service options
    turndownOptions: {
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-'
    }
  },

  // Logging settings
  logging: {
    // Enable detailed debug logging
    debug: true, // process.env.NODE_ENV !== 'production',

    // Log request details
    logRequests: true
  },

  // Proxy settings (optional - set enabled: true to use)
  proxy: {
    enabled: process.env.PROXY_ENABLED === 'true' || false,
    server: process.env.PROXY_SERVER || 'dc.smartproxy.com:10000',
    username: process.env.PROXY_USERNAME || '',
    password: process.env.PROXY_PASSWORD || ''
  },

  // ChatGPT crawler settings
  chatgpt: {
    // Base URL for ChatGPT
    baseUrl: 'https://chatgpt.com',

    // Timeout for waiting for response (ms)
    responseTimeout: 120000,

    // Polling interval to check if response is complete (ms)
    pollInterval: 500
  }
}; 