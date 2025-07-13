import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { config } from './config.js';
import { initializeExtensions } from './extension-manager.js';

// Use stealth plugin to avoid detection
puppeteer.use(StealthPlugin());

// Global browser instance management
let globalBrowser = null;
let browserLaunchTime = null;
let requestCount = 0;

// Helper function for logging
const log = (message) => {
  if (config.logging.logRequests) {
    console.log(`[${new Date().toISOString()}] ${message}`);
  }
};

// Initialize browser
const initBrowser = async () => {
  if (globalBrowser) {
    try {
      await globalBrowser.close();
    } catch (error) {
      log(`Error closing old browser: ${error.message}`);
    }
  }

  log('Launching new browser instance...');
  
  // Initialize extensions and get Chrome arguments
  let extensionArgs = [];
  try {
    extensionArgs = await initializeExtensions();
    log('Extensions initialized successfully');
  } catch (error) {
    log(`Warning: Failed to initialize extensions: ${error.message}`);
    log('Continuing without extensions...');
  }
  
  // Combine base args with extension args
  const allArgs = [
    ...config.browser.launchOptions.args,
    ...extensionArgs
  ];
  
  const launchOptions = {
    ...config.browser.launchOptions,
    headless: config.browser.headless,
    args: allArgs
  };
  
  log(`Browser mode: ${config.browser.headless ? 'headless' : 'visible (non-headless)'}`);
  if (extensionArgs.length > 0) {
    log(`Loading extensions with ${extensionArgs.length} Chrome arguments`);
  }
  
  globalBrowser = await puppeteer.launch(launchOptions);
  browserLaunchTime = Date.now();
  requestCount = 0;
  
  // Handle browser disconnect
  globalBrowser.on('disconnected', () => {
    log('Browser disconnected, will reinitialize on next request');
    globalBrowser = null;
  });
  
  log('Browser initialized successfully');
};

// Get or create browser instance
export const getBrowser = async () => {
  const now = Date.now();
  const browserAge = browserLaunchTime ? now - browserLaunchTime : Infinity;
  
  // Check if we need to restart the browser
  if (!globalBrowser || 
      browserAge > config.browser.maxAge || 
      requestCount >= config.browser.maxRequests) {
    
    if (browserAge > config.browser.maxAge) {
      log(`Browser restart: max age reached (${Math.round(browserAge / 1000 / 60)} minutes)`);
    } else if (requestCount >= config.browser.maxRequests) {
      log(`Browser restart: max requests reached (${requestCount})`);
    }
    
    await initBrowser();
  }
  
  requestCount++;
  return globalBrowser;
};

// Get current browser stats
export const getBrowserStats = () => {
  const now = Date.now();
  const age = browserLaunchTime ? now - browserLaunchTime : 0;
  
  return {
    isInitialized: !!globalBrowser,
    requestCount,
    ageMinutes: Math.round(age / 1000 / 60),
    ageMs: age,
    maxAgeMs: config.browser.maxAge,
    maxRequests: config.browser.maxRequests
  };
};

// Create a new page with common setup
export const createPage = async (browser) => {
  const page = await browser.newPage();
  
  // Set navigation timeout
  page.setDefaultNavigationTimeout(config.page.navigationTimeout);
  
  return page;
};

// Graceful shutdown (browser only)
export const shutdownBrowser = async () => {
  log('Shutting down browser gracefully...');
  if (globalBrowser) {
    try {
      await globalBrowser.close();
      log('Browser closed successfully');
    } catch (error) {
      log(`Error closing browser: ${error.message}`);
    }
    globalBrowser = null;
  }
};

// Initialize browser on module load for faster first request
const initializeOnStartup = async () => {
  try {
    await initBrowser();
    log('Browser pre-initialized on startup');
  } catch (error) {
    log(`Failed to pre-initialize browser: ${error.message}`);
  }
};

// Auto-initialize browser when module is imported (only in non-test environments)
if (process.env.NODE_ENV !== 'test') {
  initializeOnStartup().catch(() => {
    // Silent catch - errors will be handled when getBrowser() is called
  });
} 