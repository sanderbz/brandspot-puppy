import { Readability } from '@mozilla/readability';
import Defuddle from 'defuddle';
import { JSDOM } from 'jsdom';
import { NodeHtmlMarkdown } from 'node-html-markdown';
import TurndownService from 'turndown';
import { injectHeader } from './header-splice.js';
import { config } from './config.js';

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
    console.log(`[${new Date().toISOString()}] Trying node-html-markdown...`);
    const markdown = await withTimeout(
      Promise.resolve(NodeHtmlMarkdown.translate(html)),
      timeout,
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
    const turndownService = new TurndownService(config.markdown.turndownOptions);
    const markdown = await withTimeout(
      Promise.resolve(turndownService.turndown(html)),
      timeout,
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

// Parse article content using configured parser
const parseArticle = (document) => {
  if (config.parser.engine === 'defuddle') {
    console.log(`[${new Date().toISOString()}] Using Defuddle parser`);
    const defuddle = new Defuddle(document);
    const result = defuddle.parse();
    
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
    console.log(`[${new Date().toISOString()}] Using Readability parser`);
    const reader = new Readability(document);
    return reader.parse();
  }
};

// Main parsing function that handles the entire pipeline
export const parseWebpage = async (html, url) => {
  console.log(`[${new Date().toISOString()}] Starting webpage parsing pipeline`);
  
  // Parse HTML with jsdom
  console.log(`[${new Date().toISOString()}] Parsing HTML with jsdom...`);
  const dom = new JSDOM(html, { url });
  const document = dom.window.document;
  console.log(`[${new Date().toISOString()}] DOM created`);

  // Inject header into DOM before Readability processing
  console.log(`[${new Date().toISOString()}] Injecting header into DOM...`);
  const headerResult = injectHeader(document);
  console.log(`[${new Date().toISOString()}] Header injection completed - found: ${headerResult.headerFound ? `yes (${headerResult.headerTag})` : 'no'}`);

  // Extract article content with configured parser (now includes header)
  console.log(`[${new Date().toISOString()}] Extracting article with ${config.parser.engine}...`);
  const article = parseArticle(document);
  console.log(`[${new Date().toISOString()}] ${config.parser.engine} extraction completed`);

  if (!article) {
    throw new Error('Failed to extract article content');
  }
  console.log(`[${new Date().toISOString()}] Article extracted: "${article.title}"`);

  // Convert HTML content to Markdown using bullet-proof strategy
  console.log(`[${new Date().toISOString()}] Converting to markdown...`);
  const markdown = await convertToMarkdown(article.content);
  console.log(`[${new Date().toISOString()}] Markdown conversion completed (${markdown.length} chars)`);

  // Build final result object
  return {
    url: url,
    title: article.title || '',
    byline: article.byline || '',
    markdown: markdown,
    extracted_at: new Date().toISOString()
  };
}; 