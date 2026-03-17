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

// Strip all HTML attributes except semantically meaningful ones (href, src, alt)
// This is the single biggest token-reduction step — following Crawl4AI's approach
const stripAttributes = (document) => {
  const keepAttrs = {
    'a': ['href'],
    'img': ['src', 'alt'],
    'input': ['id', 'type', 'name', 'placeholder', 'value', 'aria-label', 'required'],
    'textarea': ['id', 'name', 'placeholder', 'aria-label', 'required'],
    'select': ['id', 'name', 'aria-label', 'required'],
    'option': ['value', 'selected'],
    'label': ['for'],
    'form': ['action', 'method'],
    'button': ['type'],
    'td': ['colspan', 'rowspan'],
    'th': ['colspan', 'rowspan', 'scope'],
    'time': ['datetime'],
    'details': ['open'],
    'summary': []
  };

  document.querySelectorAll('*').forEach(el => {
    const tag = el.tagName.toLowerCase();
    const allowed = keepAttrs[tag] || [];
    const attrs = Array.from(el.attributes);
    for (const attr of attrs) {
      if (!allowed.includes(attr.name)) {
        el.removeAttribute(attr.name);
      }
    }
  });
};

// Clean the DOM for full-page extraction (remove junk, keep structure)
const cleanDomForFullPage = (document) => {
  // Step 1: Remove non-content tags entirely
  const removeTags = ['script', 'style', 'noscript', 'iframe', 'object', 'embed', 'applet', 'link', 'meta'];
  for (const tag of removeTags) {
    document.querySelectorAll(tag).forEach(el => el.remove());
  }

  // Step 2: Remove hidden elements (display:none, aria-hidden="true", hidden attribute)
  document.querySelectorAll('[aria-hidden="true"], [hidden]').forEach(el => el.remove());
  document.querySelectorAll('[style]').forEach(el => {
    const style = el.getAttribute('style') || '';
    if (/display\s*:\s*none/i.test(style) || /visibility\s*:\s*hidden/i.test(style)) {
      el.remove();
    }
  });

  // Step 3: Remove ALL SVGs (decorative noise for LLMs — icons add no semantic value)
  document.querySelectorAll('svg').forEach(svg => svg.remove());

  // Step 4: Remove tracking pixels (1x1 or 0x0 images)
  document.querySelectorAll('img').forEach(img => {
    const width = img.getAttribute('width');
    const height = img.getAttribute('height');
    if ((width === '1' && height === '1') || (width === '0' && height === '0')) {
      img.remove();
    }
  });

  // Step 5: Remove boilerplate containers by class/id patterns
  // Based on Firecrawl's removal list + common patterns across tools
  const boilerplatePatterns = [
    // Ads
    '[class*="ad-container"]', '[class*="ad-wrapper"]', '[class*="ad-slot"]', '[class*="ad-banner"]',
    '[id*="google_ads"]', '[id*="doubleclick"]',
    '[data-ad]', '[data-ad-slot]', '[data-google-query-id]',
    // Tracking & analytics
    '[class*="tracking"]', '[class*="analytics"]',
    // Cookie/consent banners
    '[class*="cookie"]', '[class*="consent"]', '[id*="cookie"]', '[id*="consent"]',
    '[class*="gdpr"]', '[id*="gdpr"]',
    // Social sharing
    '[class*="social-share"]', '[class*="share-button"]', '[class*="sharing"]',
    // Newsletter signups (but NOT regular forms)
    '[class*="newsletter"]', '[id*="newsletter"]',
    // Comment sections
    '[class*="comments"]', '[id*="comments"]', '[id*="disqus"]',
    // Sidebar widgets (often ads/related)
    '[class*="sidebar"]', '[id*="sidebar"]',
  ];
  for (const selector of boilerplatePatterns) {
    try {
      document.querySelectorAll(selector).forEach(el => el.remove());
    } catch (_) {
      // Invalid selector in jsdom, skip
    }
  }

  // Step 6: Strip all non-semantic HTML attributes (biggest token reduction)
  stripAttributes(document);

  // Step 7: Remove empty containers (keep structural/interactive elements)
  const preserveTags = new Set([
    'img', 'input', 'textarea', 'select', 'br', 'hr',
    'th', 'td', 'tr', 'table', 'form', 'button',
    'video', 'audio', 'source', 'canvas'
  ]);
  document.querySelectorAll('div, span, p, section, aside').forEach(el => {
    if (!preserveTags.has(el.tagName.toLowerCase()) &&
        !el.textContent.trim() &&
        !el.querySelector('img, input, textarea, select, button, video, audio')) {
      el.remove();
    }
  });

  return document;
};

// Enhance interactive elements with descriptive text before markdown conversion
const describeInteractiveElements = (document) => {
  // Annotate form inputs with their labels/placeholders
  document.querySelectorAll('input, textarea, select').forEach(el => {
    const type = el.getAttribute('type') || 'text';
    const placeholder = el.getAttribute('placeholder') || '';
    const label = el.getAttribute('aria-label') || '';

    // Find associated label element
    const id = el.getAttribute('id');
    let labelText = label;
    if (!labelText && id) {
      const labelEl = document.querySelector(`label[for="${id}"]`);
      if (labelEl) labelText = labelEl.textContent.trim();
    }

    if (el.tagName.toLowerCase() === 'select') {
      const options = Array.from(el.querySelectorAll('option'))
        .map(o => o.textContent.trim())
        .filter(Boolean)
        .slice(0, 10); // Limit options shown
      const desc = `[Dropdown${labelText ? ': ' + labelText : ''}${options.length ? ' — Options: ' + options.join(', ') : ''}]`;
      el.insertAdjacentHTML('afterend', `<span>${desc}</span>`);
    } else if (el.tagName.toLowerCase() === 'textarea') {
      const desc = `[Text area${labelText ? ': ' + labelText : ''}${placeholder ? ' — "' + placeholder + '"' : ''}]`;
      el.insertAdjacentHTML('afterend', `<span>${desc}</span>`);
    } else if (['checkbox', 'radio'].includes(type)) {
      // These are usually fine with their label, skip
    } else {
      const desc = `[Input${type !== 'text' ? ' (' + type + ')' : ''}${labelText ? ': ' + labelText : ''}${placeholder ? ' — "' + placeholder + '"' : ''}]`;
      el.insertAdjacentHTML('afterend', `<span>${desc}</span>`);
    }
  });

  // Annotate details/summary (toggles)
  document.querySelectorAll('details').forEach(el => {
    const summary = el.querySelector('summary');
    if (summary && !summary.textContent.includes('[Toggle]')) {
      summary.insertAdjacentHTML('afterbegin', '[Toggle] ');
    }
  });

  return document;
};

// Parse full page content — keeps navigation, CTAs, forms, pricing, etc.
const parseFullPage = async (document) => {
  requestLog('Using full-page extraction mode');

  // Clean the DOM (remove scripts, ads, tracking, hidden elements)
  cleanDomForFullPage(document);

  // Describe interactive elements before conversion
  describeInteractiveElements(document);

  // Get the cleaned body HTML
  const body = document.body;
  if (!body) {
    throw new Error('No body element found in document');
  }

  const html = body.innerHTML;

  // Convert to markdown using existing converter
  const markdown = await convertToMarkdown(html);
  const normalizedMarkdown = normalizeLineBreaks(markdown);

  // Extract title from document
  const title = document.title ||
    (document.querySelector('h1') ? document.querySelector('h1').textContent.trim() : '') ||
    '';

  requestLog(`Full-page extraction complete: "${title}" (${normalizedMarkdown.length} chars)`);

  return {
    title,
    byline: '',
    content: html,
    markdown: normalizedMarkdown
  };
};

// Main parsing function that handles the entire pipeline
export const parseWebpage = async (html, url, mode = 'article') => {
  requestLog('Starting webpage parsing pipeline');
  
  // Parse HTML with jsdom
  debugLog('Parsing HTML with jsdom...');
  const dom = new JSDOM(html, { url });
  const document = dom.window.document;
  debugLog('DOM created');

  let result;

  if (mode === 'full') {
    // Full-page mode: keep all structural content
    result = await parseFullPage(document);
  } else {
    // Article mode (default): use Readability/Defuddle article extraction
    // Inject header into DOM before Readability processing
    debugLog('Injecting header into DOM...');
    const headerResult = injectHeader(document);
    debugLog(`Header injection completed - found: ${headerResult.headerFound ? `yes (${headerResult.headerTag})` : 'no'}`);

    // Extract article content with configured parsers (now includes header)
    requestLog(`Extracting article with ${config.parser.engines.join(', ')}...`);
    result = await parseArticle(document);
    requestLog(`${config.parser.engines.join(', ')} extraction completed`);

    if (!result) {
      throw new Error('Failed to extract article content');
    }
    requestLog(`Article extracted: "${result.title}"`);
  }

  // Build final result object
  return {
    url: url,
    mode: mode,
    title: result.title || '',
    byline: result.byline || '',
    markdown: result.markdown,
    extracted_at: new Date().toISOString()
  };
}; 