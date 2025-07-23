import Fastify from 'fastify';
import fetch from 'node-fetch';
import { PuppeteerBlocker } from '@ghostery/adblocker-puppeteer';
import { getBrowser, createPage, shutdownBrowser, getBrowserStats } from './browser.js';
import { config } from './config.js';
import { parseWebpage } from './parser.js';

const fastify = Fastify({
  logger: true
});

// Logging utilities that respect config settings and include timestamps
const debugLog = (...args) => {
  if (config.logging.debug) {
    console.log(`[${new Date().toISOString()}]`, ...args);
  }
};

const requestLog = (...args) => {
  if (config.logging.logRequests) {
    console.log(`[${new Date().toISOString()}]`, ...args);
  }
};

// Graceful shutdown handler
let isShuttingDown = false;
const gracefulShutdown = async (signal) => {
  if (isShuttingDown) {
    console.log(`[${new Date().toISOString()}] Already shutting down, ignoring ${signal}`);
    return;
  }
  
  isShuttingDown = true;
  console.log(`[${new Date().toISOString()}] Received ${signal}, starting quick shutdown...`);
  
  // Force exit after 1 second no matter what
  const forceExit = setTimeout(() => {
    console.log(`[${new Date().toISOString()}] Force exit after 1 second`);
    process.exit(0);
  }, 1000);
  
  try {
    // Close browser quickly (most important cleanup)
    console.log(`[${new Date().toISOString()}] Closing browser...`);
    await shutdownBrowser();
    console.log(`[${new Date().toISOString()}] Browser closed`);
  } catch (error) {
    console.log(`[${new Date().toISOString()}] Error closing browser: ${error.message}`);
  }
  
  console.log(`[${new Date().toISOString()}] Quick shutdown complete`);
  clearTimeout(forceExit);
  process.exit(0);
};

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Helper function to log errors with timestamp
const logError = (error, context = '') => {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] ERROR ${context}:`, error.message);
  if (error.stack) {
    console.error(error.stack);
  }
};

// Health check endpoint with browser stats
fastify.get('/health', async (request, reply) => {
  const stats = getBrowserStats();
  
  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    browser: {
      initialized: stats.isInitialized,
      requestCount: stats.requestCount,
      ageMinutes: stats.ageMinutes,
      maxRequests: stats.maxRequests,
      maxAgeMinutes: Math.round(stats.maxAgeMs / 1000 / 60)
    },
    config: {
      debug: config.logging.debug,
      parser: config.parser.engine,
      navigationTimeout: config.page.navigationTimeout,
      conversionTimeout: config.markdown.conversionTimeout
    }
  };
});

// Background crawling function
const processCrawlRequest = async (url, callback_url, test) => {
  let page;

  try {
    const stats = getBrowserStats();
    requestLog(`Starting background crawl for: ${url} (request #${stats.requestCount})`);
    
    // Get persistent browser instance
    debugLog('Getting browser instance...');
    const browser = await getBrowser();

    page = await createPage(browser);
    debugLog('New page created');

    // Set up Ghostery adblocker
    debugLog('Setting up Ghostery adblocker...');
    const blocker = await PuppeteerBlocker.fromPrebuiltAdsAndTracking(fetch);
    await blocker.enableBlockingInPage(page);
    debugLog('Adblocker enabled');

    // Navigate to URL
    debugLog('Navigating to URL...');
    await page.goto(url, { waitUntil: config.page.waitUntil });
    debugLog('Navigation completed');

    // Get fully rendered HTML
    debugLog('Getting page content...');
    const html = await page.content();
    debugLog(`HTML content retrieved (${html.length} chars)`);

    // Parse webpage using the parser module
    debugLog('Processing webpage with parser module...');
    const result = await parseWebpage(html, url);
    debugLog('Webpage parsing completed');

    // Handle test mode vs callback
    if (test) {
      requestLog(`Test mode - Article extracted: "${result.title}" (${result.markdown.length} chars)`);
      // Only log full JSON result when debug is enabled
      if (config.logging.debug) {
        console.log(JSON.stringify(result, null, 2));
      }
    } else {
      requestLog('Production mode - posting to callback...');
      // POST to callback URL
      try {
        const response = await fetch(callback_url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(result)
        });

        if (!response.ok) {
          logError(new Error(`Callback request failed with status ${response.status}`), 'Callback');
        } else {
          requestLog('Successfully posted to callback');
        }
      } catch (callbackError) {
        logError(callbackError, 'Callback');
      }
    }

  } catch (error) {
    logError(error, 'Background crawling');
  } finally {
    // Clean up page resources (keep browser alive)
    debugLog('Starting page cleanup...');
    try {
      if (page) {
        debugLog('Closing page...');
        await page.close();
      }
      debugLog('Page cleanup completed successfully');
    } catch (cleanupError) {
      logError(cleanupError, 'Page cleanup');
    }
  }
};

// POST /crawl endpoint
fastify.post('/crawl', async (request, reply) => {
  const { url, callback_url, test = false } = request.body;

  // Input validation
  if (!url || typeof url !== 'string') {
    return reply.status(400).send({ error: 'url is required and must be a string' });
  }

  if (!test && (!callback_url || typeof callback_url !== 'string')) {
    return reply.status(400).send({ error: 'callback_url is required when test is false' });
  }

  requestLog(`Crawl request received for: ${url} (test: ${test})`);

  // Start background processing (fire-and-forget)
  processCrawlRequest(url, callback_url, test).catch(error => {
    logError(error, 'Background processing');
  });

  // Immediately respond to client
  requestLog('Responding immediately to client');
  return reply.status(202).send({ message: 'Request accepted and processed' });
});

// Start server
const start = async () => {
  try {
    await fastify.listen({ 
      port: config.server.port, 
      host: config.server.host 
    });
    console.log(`Server listening on port ${config.server.port}`);
    
    // Log current configuration
    console.log('Configuration:', JSON.stringify({
      server: config.server,
      browser: {
        headless: config.browser.headless,
        maxAge: config.browser.maxAge,
        maxRequests: config.browser.maxRequests
      },
      page: config.page,
      parser: config.parser,
      markdown: {
        conversionTimeout: config.markdown.conversionTimeout
      },
      logging: config.logging
    }, null, 2));
    
    // Log browser stats on startup
    const stats = getBrowserStats();
    console.log(`Browser initialized: ${stats.isInitialized ? 'Yes' : 'No'}`);
  } catch (err) {
    logError(err, 'Server startup');
    process.exit(1);
  }
};

start(); 