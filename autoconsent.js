import { createRequire } from 'module';
import path from 'path';

const require = createRequire(import.meta.url);

// Cache the bundled script at module level
let BUNDLE = null;

/**
 * Gets the bundled autoconsent content script.
 * Builds and caches on first call, returns cached version on subsequent calls.
 * @returns {Promise<string>} The bundled autoconsent content script
 */
export async function getAutoConsentScript() {
  if (BUNDLE !== null) {
    return BUNDLE;
  }

  try {
    // Find the package directory using the main entry point
    const mainPath = require.resolve('@duckduckgo/autoconsent');
    const packageDir = path.dirname(path.dirname(mainPath)); // Go up from dist/ to package root
    const contentScriptPath = path.join(packageDir, 'dist', 'addon-mv3', 'content.bundle.js');
    
    // Read the content script file
    const fs = await import('fs');
    BUNDLE = fs.readFileSync(contentScriptPath, 'utf8');
    
    return BUNDLE;
  } catch (error) {
    console.error('Failed to load autoconsent script:', error);
    throw new Error('Failed to load autoconsent content script');
  }
} 