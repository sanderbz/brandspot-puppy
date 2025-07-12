import Fastify from 'fastify';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { NodeHtmlMarkdown } from 'node-html-markdown';
import TurndownService from 'turndown';
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

// Bullet-proof HTML to Markdown conversion with timeouts and fallbacks
const convertToMarkdown = async (html) => {
  const withTimeout = (promise, timeoutMs, name) => {
    return Promise.race([
      promise,
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error(`${name} timeout after ${timeoutMs}ms`)), timeoutMs)
      )
    ]);
  };

  // Step 1: Try node-html-markdown (fastest, zero-dependency)
  try {
    console.log(`[${new Date().toISOString()}] Trying node-html-markdown...`);
    const markdown = await withTimeout(
      Promise.resolve(NodeHtmlMarkdown.translate(html)),
      5000,
      'node-html-markdown'
    );
    if (markdown && markdown.trim().length > 0) {
      console.log(`[${new Date().toISOString()}] node-html-markdown success (${markdown.length} chars)`);
      return markdown;
    }
  } catch (error) {
    console.log(`[${new Date().toISOString()}] node-html-markdown failed: ${error.message}`);
  }

  // Step 2: Try turndown (mature, handles edge cases)
  try {
    console.log(`[${new Date().toISOString()}] Trying turndown...`);
    const turndownService = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced'
    });
    const markdown = await withTimeout(
      Promise.resolve(turndownService.turndown(html)),
      5000,
      'turndown'
    );
    if (markdown && markdown.trim().length > 0) {
      console.log(`[${new Date().toISOString()}] turndown success (${markdown.length} chars)`);
      return markdown;
    }
  } catch (error) {
    console.log(`[${new Date().toISOString()}] turndown failed: ${error.message}`);
  }

  // Step 3: Last-resort plain-text fallback
  console.log(`[${new Date().toISOString()}] Using plain-text fallback...`);
  const textContent = html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  console.log(`[${new Date().toISOString()}] Plain-text fallback (${textContent.length} chars)`);
  return textContent;
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


    // Convert HTML content to Markdown using bullet-proof strategy
    console.log(`[${new Date().toISOString()}] Converting to markdown...`);
    const markdown = await convertToMarkdown(article.content);
    console.log(`[${new Date().toISOString()}] Markdown conversion completed (${markdown.length} chars)`);

    // Build response object
    console.log(`[${new Date().toISOString()}] Building response object...`);
    const result = {
      url: url,
      title: article.title || '',
      byline: article.byline || '',
      markdown: markdown,
      extracted_at: new Date().toISOString()
    };
    console.log(`[${new Date().toISOString()}] Response object built`);

    // Handle test mode vs callback
    if (test) {
      console.log(`[${new Date().toISOString()}] Test mode - Article extracted:`);
      console.log(JSON.stringify(result, null, 2));
      console.log(`[${new Date().toISOString()}] Sending test mode response...`);
      return reply.status(200).send({ message: 'Article extracted successfully (test mode)' });
    } else {
      console.log(`[${new Date().toISOString()}] Production mode - posting to callback...`);
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
    console.log(`[${new Date().toISOString()}] Starting cleanup...`);
    try {
      if (blocker && page) {
        console.log(`[${new Date().toISOString()}] Disabling adblocker...`);
        await blocker.disableBlockingInPage(page);
      }
      if (page) {
        console.log(`[${new Date().toISOString()}] Closing page...`);
        await page.close();
      }
      if (browser) {
        console.log(`[${new Date().toISOString()}] Closing browser...`);
        await browser.close();
      }
      console.log(`[${new Date().toISOString()}] Cleanup completed successfully`);
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