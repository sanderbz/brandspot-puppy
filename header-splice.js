// Header splicing utility - finds and combines headers with Readability content

const HEADER_SELECTORS = [
  // Semantic elements
  'header',
  // Common utility classes
  '.site-header', '.page-header', '.page-hero', '.hero', '.hero-banner', '.hero-section',
  '.masthead', '.top-bar', '.navbar', '.nav-bar', '.app-header', '.layout-header',
  // ID variants
  '#header', '#site-header', '#page-header', '#masthead', '#hero'
].join(',');

/**
 * Inject header element into DOM before Readability processing
 * @param {Document} document - JSDOM document
 * @returns {Object} Metadata about header injection
 */
export function injectHeader(document) {
  const headerEl = document.querySelector(HEADER_SELECTORS);
  
  if (!headerEl) {
    return { headerFound: false, headerTag: null };
  }

  // Find main content area to inject header into
  const mainContent = document.querySelector('main, article, .content, .post-content, .entry-content, [role="main"]') || document.body;
  
  // Clone header content and wrap in neutral div so Readability processes it
  const contentDiv = document.createElement('div');
  contentDiv.innerHTML = headerEl.innerHTML;
  mainContent.insertBefore(contentDiv, mainContent.firstChild);
  
  return {
    headerFound: true,
    headerTag: headerEl.tagName.toLowerCase()
  };
} 