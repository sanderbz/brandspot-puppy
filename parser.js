import { Readability } from '@mozilla/readability';
import Defuddle from 'defuddle';
import { JSDOM } from 'jsdom';
import { NodeHtmlMarkdown } from 'node-html-markdown';
import TurndownService from 'turndown';
import { injectHeader } from './header-splice.js';
import { config } from './config.js';

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

  const timeout = config.markdown.conversionTimeout;

  // Step 1: Try node-html-markdown (fastest, zero-dependency)
  try {
    debugLog('Trying node-html-markdown...');
    const markdown = await withTimeout(
      Promise.resolve(NodeHtmlMarkdown.translate(html)),
      timeout,
      'node-html-markdown'
    );
    if (markdown && markdown.trim().length > 0) {
      debugLog(`node-html-markdown success (${markdown.length} chars)`);
      return markdown;
    }
  } catch (error) {
    debugLog(`node-html-markdown failed: ${error.message}`);
  }

  // Step 2: Try turndown (mature, handles edge cases)
  try {
    debugLog('Trying turndown...');
    const turndownService = new TurndownService(config.markdown.turndownOptions);
    const markdown = await withTimeout(
      Promise.resolve(turndownService.turndown(html)),
      timeout,
      'turndown'
    );
    if (markdown && markdown.trim().length > 0) {
      debugLog(`turndown success (${markdown.length} chars)`);
      return markdown;
    }
  } catch (error) {
    debugLog(`turndown failed: ${error.message}`);
  }

  // Step 3: Last-resort plain-text fallback
  debugLog('Using plain-text fallback...');
  const textContent = html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  debugLog(`Plain-text fallback (${textContent.length} chars)`);
  return textContent;
};

// Parse article content using a single parser engine
const parseArticleWithEngine = (document, engine) => {
  if (engine === 'defuddle') {
    requestLog(`Using Defuddle parser`);
    const defuddle = new Defuddle(document);
    const result = defuddle.parse();

    // Only log full result content when debug is enabled
    if (config.logging.debug) {
      console.log('--------------------------------');
      console.log(result);
      console.log('--------------------------------');
    }

    
    // Normalize Defuddle output to match Readability structure
    return {
      title: result.title || '',
      byline: result.byline || result.author || '',
      dir: result.dir || null,
      lang: result.lang || null,
      content: result.content || '',
      textContent: result.textContent || (result.content ? result.content.replace(/<[^>]*>/g, '') : ''),
      length: result.length || (result.textContent || result.content || '').length,
      excerpt: result.excerpt || result.description || '',
      siteName: result.siteName || null
    };
  } else {
    requestLog(`Using Readability parser`);
    const reader = new Readability(document);
    return reader.parse();
  }
};

// Normalize line breaks for consistent console display
const normalizeLineBreaks = (text) => {
  return text
    .replace(/\\n\\n/g, '\n\n')  // Convert double escaped newlines first
    .replace(/\\n/g, '\n')       // Convert escaped \n to actual newlines
    .replace(/\r\n/g, '\n')      // Convert Windows line endings
    .replace(/\r/g, '\n')        // Convert Mac line endings
    .replace(/\n{3,}/g, '\n\n'); // Normalize multiple newlines to max 2
};

// Parse article content using configured parser engines and convert each to markdown
const parseArticle = async (document) => {
  const engines = config.parser.engines;
  const results = [];

  for (const engine of engines) {
    const result = parseArticleWithEngine(document, engine);
    if (result) {
      // Convert this parser's content to markdown
      requestLog(`Converting ${engine} result to markdown...`);
      const markdown = await convertToMarkdown(result.content);
      
      // Debug: Show raw markdown format
      debugLog(`${engine} raw markdown contains: ${markdown.includes('\\n') ? 'escaped newlines' : 'actual newlines'}`);
      
      const normalizedMarkdown = normalizeLineBreaks(markdown);
      // Only log full markdown content when debug is enabled
      if (config.logging.debug) {
        console.log(`[${new Date().toISOString()}] ${engine} markdown result: "${result.title}"\n${normalizedMarkdown}`);
      } else {
        requestLog(`${engine} markdown result: "${result.title}" (${normalizedMarkdown.length} chars)`);
      }
      
      results.push({ ...result, markdown: normalizedMarkdown });
    } else {
      requestLog(`${engine} extraction failed`);
    }
  }

  if (results.length === 0) {
    return null;
  }

  // Use first parser's metadata, concatenate markdown with 2 linebreaks
  const firstResult = results[0];
  const concatenatedMarkdown = results.map(r => r.markdown).join('\n\n');

  requestLog(`Combined markdown from ${engines.length} parser(s): (${concatenatedMarkdown.length} chars total)`);

  return {
    ...firstResult,
    markdown: concatenatedMarkdown
  };
};

// Main parsing function that handles the entire pipeline
export const parseWebpage = async (html, url) => {
  requestLog('Starting webpage parsing pipeline');
  
  // Parse HTML with jsdom
  debugLog('Parsing HTML with jsdom...');
  const dom = new JSDOM(html, { url });
  const document = dom.window.document;
  debugLog('DOM created');

  // Inject header into DOM before Readability processing
  debugLog('Injecting header into DOM...');
  const headerResult = injectHeader(document);
  debugLog(`Header injection completed - found: ${headerResult.headerFound ? `yes (${headerResult.headerTag})` : 'no'}`);

  // Extract article content with configured parsers (now includes header)
  requestLog(`Extracting article with ${config.parser.engines.join(', ')}...`);
  const article = await parseArticle(document);
  requestLog(`${config.parser.engines.join(', ')} extraction completed`);

  if (!article) {
    throw new Error('Failed to extract article content');
  }
  requestLog(`Article extracted: "${article.title}"`);

  // Build final result object
  return {
    url: url,
    title: article.title || '',
    byline: article.byline || '',
    markdown: article.markdown,
    extracted_at: new Date().toISOString()
  };
}; 