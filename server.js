import Fastify from 'fastify';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import markdownify from 'markdownify';
import fetch from 'node-fetch';
import { PuppeteerBlocker } from '@ghostery/adblocker-puppeteer';
import { getAutoConsentScript } from './autoconsent.js';

// Use stealth plugin to avoid detection
puppeteer.use(StealthPlugin());

const fastify = Fastify({
  logger: true
});

// Helper function to log errors with timestamp
const logError = (error, context = '') => {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] ERROR ${context}:`, error.message);
  if (error.stack) {
    console.error(error.stack);
  }
};

// Helper function to inject autoconsent script before any site JavaScript runs
const injectAutoConsentScript = async (page) => {
  try {
    const autoConsentScript = await getAutoConsentScript();
    
    // Inject the script before any site JavaScript runs
    await page.evaluateOnNewDocument(autoConsentScript);
    
    console.log(`[${new Date().toISOString()}] AutoConsent script injected successfully`);
  } catch (error) {
    console.log(`[${new Date().toISOString()}] AutoConsent injection failed: ${error.message}`);
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

  let browser;
  let page;
  let blocker;

  try {
    console.log(`[${new Date().toISOString()}] Starting crawl for: ${url}`);
    
    // Launch Puppeteer
    console.log(`[${new Date().toISOString()}] Launching Puppeteer...`);
    browser = await puppeteer.launch({
      headless: "new",
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    page = await browser.newPage();
    console.log(`[${new Date().toISOString()}] Browser and page created`);

    // Set up Ghostery adblocker
    console.log(`[${new Date().toISOString()}] Setting up Ghostery adblocker...`);
    blocker = await PuppeteerBlocker.fromPrebuiltAdsAndTracking(fetch);
    await blocker.enableBlockingInPage(page);
    console.log(`[${new Date().toISOString()}] Adblocker enabled`);

    // Inject autoconsent script before any site JavaScript runs
    await injectAutoConsentScript(page);

    // Navigate to URL
    console.log(`[${new Date().toISOString()}] Navigating to URL...`);
    await page.goto(url, { waitUntil: 'networkidle0' });
    console.log(`[${new Date().toISOString()}] Navigation completed`);

    // Get fully rendered HTML
    console.log(`[${new Date().toISOString()}] Getting page content...`);
    const html = await page.content();
    console.log(`[${new Date().toISOString()}] HTML content retrieved (${html.length} chars)`);

    // Parse HTML with jsdom
    console.log(`[${new Date().toISOString()}] Parsing HTML with jsdom...`);
    const dom = new JSDOM(html, { url });
    const document = dom.window.document;
    console.log(`[${new Date().toISOString()}] DOM created`);

    // Extract article content with Readability
    console.log(`[${new Date().toISOString()}] Extracting article with Readability...`);
    const reader = new Readability(document);
    const article = reader.parse();
    console.log(`[${new Date().toISOString()}] Readability extraction completed`);

    if (!article) {
      logError(new Error('Failed to extract article content'), 'Readability');
      return reply.status(502).send({ error: 'Failed to extract article content' });
    }
    console.log(`[${new Date().toISOString()}] Article extracted: "${article.title}"`);


    // Convert HTML content to Markdown
    console.log(`[${new Date().toISOString()}] Converting to markdown...`);
    let markdown = '';
    try {
      if (typeof markdownify === 'function') {
        const markdownStream = markdownify(article.content);
        console.log(`[${new Date().toISOString()}] Markdownify called, checking stream...`);
        
        // If it's a stream, collect the data
        if (markdownStream && typeof markdownStream.on === 'function') {
          console.log(`[${new Date().toISOString()}] Processing markdown stream...`);
          markdown = await new Promise((resolve, reject) => {
            let result = '';
            markdownStream.on('data', chunk => {
              result += chunk;
              console.log(`[${new Date().toISOString()}] Markdown chunk received (${chunk.length} chars)`);
            });
            markdownStream.on('end', () => {
              console.log(`[${new Date().toISOString()}] Markdown stream ended`);
              resolve(result);
            });
            markdownStream.on('error', reject);
          });
        } else {
          console.log(`[${new Date().toISOString()}] Markdownify returned direct result`);
          markdown = markdownStream;
        }
      } else {
        console.log(`[${new Date().toISOString()}] Markdownify not a function, using HTML fallback`);
        markdown = article.content; // Fallback to HTML if markdownify fails
      }
    } catch (markdownError) {
      console.log(`[${new Date().toISOString()}] Markdown conversion failed, using HTML: ${markdownError.message}`);
      markdown = article.content;
    }
    console.log(`[${new Date().toISOString()}] Markdown conversion completed (${markdown.length} chars)`);

    // Build response object
    const result = {
      url: url,
      title: article.title || '',
      byline: article.byline || '',
      markdown: markdown,
      extracted_at: new Date().toISOString()
    };

    // Handle test mode vs callback
    if (test) {
      console.log('Test mode - Article extracted:');
      console.log(JSON.stringify(result, null, 2));
      return reply.status(200).send({ message: 'Article extracted successfully (test mode)' });
    } else {
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
        }

        return reply.status(202).send({ message: 'Request accepted and processed' });
      } catch (callbackError) {
        logError(callbackError, 'Callback');
        return reply.status(202).send({ message: 'Request accepted but callback failed' });
      }
    }

  } catch (error) {
    logError(error, 'Crawling');
    
    if (error.message.includes('net::ERR_') || error.message.includes('Navigation')) {
      return reply.status(502).send({ error: 'Failed to navigate to URL' });
    }
    
    return reply.status(500).send({ error: 'Internal server error' });
  } finally {
    // Clean up resources
    try {
      if (blocker && page) await blocker.disableBlockingInPage(page);
      if (page) await page.close();
      if (browser) await browser.close();
    } catch (cleanupError) {
      logError(cleanupError, 'Cleanup');
    }
  }
});

// Start server
const start = async () => {
  try {
    const port = process.env.PORT || 3000;
    await fastify.listen({ port, host: '0.0.0.0' });
    console.log(`Server listening on port ${port}`);
  } catch (err) {
    logError(err, 'Server startup');
    process.exit(1);
  }
};

start(); 