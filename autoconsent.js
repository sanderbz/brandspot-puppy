import { createRequire } from 'module';
import { build } from 'esbuild';

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
    // Locate the autoconsent content script entry point
    const entryPoint = require.resolve('@duckduckgo/autoconsent/lib/content/index.js');
    
    // Bundle the content script with esbuild
    const result = await build({
      entryPoints: [entryPoint],
      bundle: true,
      format: 'iife',
      globalName: 'autoConsent',
      platform: 'browser',
      target: 'es2020',
      write: false,
      minify: true,
      sourcemap: false,
      logLevel: 'silent'
    });

    // Cache the bundled script
    BUNDLE = result.outputFiles[0].text;
    
    return BUNDLE;
  } catch (error) {
    console.error('Failed to bundle autoconsent script:', error);
    throw new Error('Failed to bundle autoconsent content script');
  }
} 