// Application Configuration
export const config = {
  // Server settings
  server: {
    port: process.env.PORT || 3000,
    host: '0.0.0.0'
  },

  // Browser management settings
  browser: {
    // Maximum age before browser restart (24 hours)
    maxAge: 24 * 60 * 60 * 1000,
    
    // Maximum requests before browser restart
    maxRequests: 1000,
    
    // Puppeteer launch options
    launchOptions: {
      headless: "new",
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage', // Overcome limited resource problems
        '--disable-accelerated-2d-canvas',
        '--disable-gpu'
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
    debug: process.env.NODE_ENV !== 'production',
    
    // Log request details
    logRequests: true
  }
}; 