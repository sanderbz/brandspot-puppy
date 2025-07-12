import Fastify from 'fastify';
import puppeteer from 'puppeteer';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import markdownify from 'markdownify';
import fetch from 'node-fetch';
import { PuppeteerBlocker } from '@ghostery/adblocker-puppeteer';
import { AutoConsent } from '@duckduckgo/autoconsent';

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
    // Launch Puppeteer
    browser = await puppeteer.launch({
      headless: "new",
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    page = await browser.newPage();

    // Set up Ghostery adblocker
    blocker = await PuppeteerBlocker.fromPrebuiltAdsAndTracking(fetch);
    await blocker.enableBlockingInPage(page);

    // Set up DuckDuckGo AutoConsent
    const autoConsent = new AutoConsent(page);
    await autoConsent.init();

    // Navigate to URL
    await page.goto(url, { waitUntil: 'networkidle0' });

    // Handle cookie consent popups
    try {
      await autoConsent.optOut();
    } catch (consentError) {
      // Non-critical: log but continue if consent handling fails
      console.log(`[${new Date().toISOString()}] Consent handling info: ${consentError.message}`);
    }

    // Get fully rendered HTML
    const html = await page.content();

    // Parse HTML with jsdom
    const dom = new JSDOM(html, { url });
    const document = dom.window.document;

    // Extract article content with Readability
    const reader = new Readability(document);
    const article = reader.parse();

    if (!article) {
      logError(new Error('Failed to extract article content'), 'Readability');
      return reply.status(502).send({ error: 'Failed to extract article content' });
    }

    // Convert HTML content to Markdown
    const markdown = markdownify(article.content);

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