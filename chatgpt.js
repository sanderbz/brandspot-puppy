import { config } from './config.js';
import { NodeHtmlMarkdown } from 'node-html-markdown';

// Logging utilities that respect config settings
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

// Selectors for ChatGPT elements (update if ChatGPT changes their UI)
const SELECTORS = {
  // Input field - ChatGPT uses a contenteditable div or textarea
  input: '#prompt-textarea, [data-testid="prompt-textarea"], textarea[placeholder*="Message"]',
  // Send button
  sendButton: '[data-testid="send-button"], button[aria-label="Send prompt"]',
  // Response container - the assistant's message
  responseContainer: '[data-message-author-role="assistant"]',
  // Streaming indicator (when response is still being generated)
  streamingIndicator: '[data-testid="stop-button"], button[aria-label="Stop generating"]',
  // Citations/sources
  citationLink: 'a[href^="http"][target="_blank"]',
  // Web search indicator
  webSearchIndicator: '[data-testid="search-source"], .search-results, [aria-label*="search"]'
};

// Wait for element to appear
const waitForElement = async (page, selector, timeout = 30000) => {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    const element = await page.$(selector);
    if (element) return element;
    await new Promise(r => setTimeout(r, 100));
  }
  return null;
};

// Wait for response to complete (streaming to finish)
const waitForResponseComplete = async (page, timeout) => {
  const startTime = Date.now();
  const pollInterval = config.chatgpt.pollInterval;

  debugLog('Waiting for response to complete...');

  // First, wait for any response to appear
  let responseFound = false;
  while (Date.now() - startTime < timeout) {
    const responses = await page.$$(SELECTORS.responseContainer);
    if (responses.length > 0) {
      responseFound = true;
      break;
    }
    await new Promise(r => setTimeout(r, pollInterval));
  }

  if (!responseFound) {
    throw new Error('No response received from ChatGPT');
  }

  // Now wait for streaming to finish (stop button disappears)
  while (Date.now() - startTime < timeout) {
    const stopButton = await page.$(SELECTORS.streamingIndicator);
    if (!stopButton) {
      // Double-check by waiting a bit and confirming no stop button
      await new Promise(r => setTimeout(r, 500));
      const stopButtonRecheck = await page.$(SELECTORS.streamingIndicator);
      if (!stopButtonRecheck) {
        debugLog('Response streaming completed');
        return true;
      }
    }
    await new Promise(r => setTimeout(r, pollInterval));
  }

  throw new Error('Response timeout - ChatGPT took too long to respond');
};

// Extract the last response from ChatGPT
const extractResponse = async (page) => {
  debugLog('Extracting response...');

  // Get all assistant messages and take the last one
  const responses = await page.$$(SELECTORS.responseContainer);
  if (responses.length === 0) {
    throw new Error('No response found');
  }

  const lastResponse = responses[responses.length - 1];

  // Get HTML content
  const html = await lastResponse.evaluate(el => el.innerHTML);

  // Get text content
  const text = await lastResponse.evaluate(el => el.textContent || '');

  return { html, text, element: lastResponse };
};

// Check if web search was used
const checkWebSearched = async (page) => {
  // Look for search indicators in the page
  const searchIndicator = await page.$(SELECTORS.webSearchIndicator);
  if (searchIndicator) return true;

  // Also check page content for search-related text
  const pageContent = await page.content();
  const searchTerms = ['Searched', 'Sources', 'Search results', 'Browsing the web'];
  return searchTerms.some(term => pageContent.includes(term));
};

// Extract citations from the response
const extractCitations = async (page, responseElement) => {
  debugLog('Extracting citations...');

  const citations = [];

  try {
    // Find all external links in the response
    const links = await responseElement.$$('a[href^="http"]');

    for (let i = 0; i < links.length; i++) {
      const link = links[i];
      const href = await link.evaluate(el => el.href);
      const title = await link.evaluate(el => el.textContent || el.title || '');

      // Skip ChatGPT internal links
      if (href.includes('chatgpt.com') || href.includes('openai.com')) {
        continue;
      }

      citations.push({
        url: href,
        title: title.trim(),
        position: citations.length + 1
      });
    }
  } catch (error) {
    debugLog(`Error extracting citations: ${error.message}`);
  }

  debugLog(`Found ${citations.length} citations`);
  return citations;
};

// Convert HTML to markdown
const htmlToMarkdown = (html) => {
  try {
    return NodeHtmlMarkdown.translate(html);
  } catch (error) {
    debugLog(`Markdown conversion failed: ${error.message}`);
    // Fallback to plain text
    return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  }
};

// Main function to ask ChatGPT a question
export const askChatGPT = async (page, question) => {
  const { baseUrl, responseTimeout } = config.chatgpt;

  requestLog(`ChatGPT request: "${question.substring(0, 50)}..."`);

  // Navigate to ChatGPT
  debugLog(`Navigating to ${baseUrl}...`);
  await page.goto(baseUrl, { waitUntil: config.page.waitUntil });
  debugLog('Page loaded');

  // Wait for input field
  debugLog('Waiting for input field...');
  const inputField = await waitForElement(page, SELECTORS.input, 15000);
  if (!inputField) {
    throw new Error('Could not find ChatGPT input field - page may require login');
  }
  debugLog('Input field found');

  // Type the question
  debugLog('Typing question...');
  await inputField.click();
  await inputField.type(question, { delay: 10 });
  debugLog('Question typed');

  // Find and click send button
  debugLog('Looking for send button...');
  await new Promise(r => setTimeout(r, 500)); // Brief pause for UI to update

  const sendButton = await page.$(SELECTORS.sendButton);
  if (sendButton) {
    await sendButton.click();
    debugLog('Send button clicked');
  } else {
    // Try pressing Enter as fallback
    debugLog('Send button not found, pressing Enter...');
    await page.keyboard.press('Enter');
  }

  // Wait for response to complete
  await waitForResponseComplete(page, responseTimeout);

  // Extract the response
  const { html, text, element: responseElement } = await extractResponse(page);

  // Check if web search was used
  const webSearched = await checkWebSearched(page);
  debugLog(`Web searched: ${webSearched}`);

  // Extract citations
  const citations = await extractCitations(page, responseElement);

  // Convert to markdown
  const markdown = htmlToMarkdown(html);

  requestLog(`ChatGPT response received (${text.length} chars, ${citations.length} citations)`);

  return {
    response: text.trim(),
    web_searched: webSearched,
    citations,
    markdown,
    extracted_at: new Date().toISOString()
  };
};
