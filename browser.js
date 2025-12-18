import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import proxyChain from 'proxy-chain';
import { config } from './config.js';
import { initializeExtensions } from './extension-manager.js';

// Use stealth plugin to avoid detection
puppeteer.use(StealthPlugin());

// Global browser instance management
let globalBrowser = null;
let browserLaunchTime = null;
let requestCount = 0;
let browserInitPromise = null;
let anonymizedProxyUrl = null; // Local proxy URL from proxy-chain

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

  // Set up proxy using proxy-chain for authenticated proxies
  if (config.proxy?.enabled && config.proxy.server) {
    // Close any existing anonymized proxy
    if (anonymizedProxyUrl) {
      try {
        await proxyChain.closeAnonymizedProxy(anonymizedProxyUrl, true);
      } catch (e) {
        log(`Warning: Failed to close old proxy: ${e.message}`);
      }
    }

    // Build the upstream proxy URL with auth
    const proxyUrl = config.proxy.username && config.proxy.password
      ? `http://${config.proxy.username}:${config.proxy.password}@${config.proxy.server}`
      : `http://${config.proxy.server}`;

    // Create anonymized local proxy (handles auth internally)
    anonymizedProxyUrl = await proxyChain.anonymizeProxy(proxyUrl);
    allArgs.push(`--proxy-server=${anonymizedProxyUrl}`);
    log(`Proxy enabled via proxy-chain: ${config.proxy.server} -> ${anonymizedProxyUrl}`);
  }

  const launchOptions = {
    ...config.browser.launchOptions,
    headless: config.browser.headless,
    devtools: config.browser.devtools,
    args: allArgs
  };

  if (config.browser.devtools) {
    log('DevTools will open automatically for debugging');
  }
  
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
    
    // If another request is already initializing, wait for it
    if (browserInitPromise) {
      await browserInitPromise;
    } else {
      // Start initialization and store the promise
      browserInitPromise = initBrowser().finally(() => {
        browserInitPromise = null;
      });
      await browserInitPromise;
    }
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
  // Always use incognito context for isolated cookies/session
  // Proxy auth is handled by proxy-chain at browser level, so incognito works fine
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page._isolatedContext = context;
  log('Created isolated browser context for request');

  // Set navigation timeout
  page.setDefaultNavigationTimeout(config.page.navigationTimeout);

  return page;
};

// Close page and its isolated context
export const closePage = async (page) => {
  try {
    if (page._isolatedContext) {
      await page._isolatedContext.close();
      log('Closed isolated browser context');
    } else {
      await page.close();
    }
  } catch (error) {
    log(`Error closing page: ${error.message}`);
  }
};

// Generate a unique session ID for proxy rotation
const generateSessionId = () => {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
};

// Create a fresh browser with a new proxy session (for IP rotation)
// This is used for requests that need a fresh IP each time (like ChatGPT)
export const createFreshBrowserWithProxy = async () => {
  log('Creating fresh browser with new proxy session...');

  const allArgs = [...config.browser.launchOptions.args];
  let sessionProxyUrl = null;

  if (config.proxy?.enabled && config.proxy.server) {
    const sessionId = generateSessionId();

    // Add session ID to username for IP rotation (SmartProxy format)
    // e.g., user-spnz0omji9-country-nl -> user-spnz0omji9-country-nl-session-abc123
    const sessionUsername = `${config.proxy.username}-session-${sessionId}`;

    const proxyUrl = `http://${sessionUsername}:${config.proxy.password}@${config.proxy.server}`;

    // Create anonymized local proxy for this session
    sessionProxyUrl = await proxyChain.anonymizeProxy(proxyUrl);
    allArgs.push(`--proxy-server=${sessionProxyUrl}`);
    log(`Fresh proxy session created: ${sessionId} -> ${sessionProxyUrl}`);
  }

  const launchOptions = {
    ...config.browser.launchOptions,
    headless: config.browser.headless,
    args: allArgs
  };

  const browser = await puppeteer.launch(launchOptions);

  // Store proxy URL on browser for cleanup
  browser._sessionProxyUrl = sessionProxyUrl;

  log('Fresh browser launched successfully');
  return browser;
};

// Close a fresh browser and its proxy session
export const closeFreshBrowser = async (browser) => {
  if (!browser) return;

  try {
    await browser.close();
    log('Fresh browser closed');
  } catch (error) {
    log(`Error closing fresh browser: ${error.message}`);
  }

  // Close the session-specific proxy
  if (browser._sessionProxyUrl) {
    try {
      await proxyChain.closeAnonymizedProxy(browser._sessionProxyUrl, true);
      log('Session proxy closed');
    } catch (error) {
      log(`Error closing session proxy: ${error.message}`);
    }
  }
};

// Graceful shutdown (browser and proxy-chain)
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

  // Close the anonymized proxy from proxy-chain
  if (anonymizedProxyUrl) {
    try {
      await proxyChain.closeAnonymizedProxy(anonymizedProxyUrl, true);
      log('Anonymized proxy closed successfully');
    } catch (error) {
      log(`Error closing anonymized proxy: ${error.message}`);
    }
    anonymizedProxyUrl = null;
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