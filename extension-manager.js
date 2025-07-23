import path from 'path';
import { promises as fs } from 'fs';
import { createRequire } from 'module';
import yauzl from 'yauzl';
import fetch from 'node-fetch';
import { config } from './config.js';

const require = createRequire(import.meta.url);

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

/**
 * Extension Manager - Downloads and manages Chrome extensions for Puppeteer
 */

const EXTENSIONS_DIR = './extensions';

// Configuration for extensions to install
const EXTENSIONS_CONFIG = [
  {
    id: 'ofpnikijgfhlmmjlpkfaifhhdonchhoi',
    name: 'accepteer-alle-cookies',
    url: 'https://chrome.google.com/webstore/detail/accepteer-alle-cookies/ofpnikijgfhlmmjlpkfaifhhdonchhoi',
    description: 'Accepteer alle cookies'
  },
  {
    id: 'neooppigbkahgfdhbpbhcccgpimeaafi',
    name: 'superagent-automatic-cookie-consent',
    url: 'https://chromewebstore.google.com/detail/superagent-automatic-cook/neooppigbkahgfdhbpbhcccgpimeaafi',
    description: 'Superagent Automatic Cookie Consent'
  },
  {
    id: 'edibdbjcniadpccecjdfdjjppcpchdlm',
    name: 'i-still-dont-care-about-cookies',
    url: 'https://chromewebstore.google.com/detail/cookies-kunnen-mij-nog-st/edibdbjcniadpccecjdfdjjppcpchdlm',
    description: 'I still don\'t care about cookies'
  }
];

/**
 * Ensure extensions directory exists
 */
async function ensureExtensionsDir() {
  try {
    await fs.access(EXTENSIONS_DIR);
  } catch (error) {
    await fs.mkdir(EXTENSIONS_DIR, { recursive: true });
  }
}

/**
 * Download CRX file directly from Chrome Web Store
 * @param {string} extensionId - The Chrome extension ID
 * @param {string} outputPath - Where to save the CRX file
 */
async function downloadCrxDirect(extensionId, outputPath) {
  // Chrome's official CRX download URL
  const downloadUrl = `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=131.0.6778.204&acceptformat=crx2,crx3&x=id%3D${extensionId}%26uc&nacl_arch=x86-64`;
  
  debugLog(`Fetching CRX from: ${downloadUrl}`);
  
  try {
    const response = await fetch(downloadUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const contentType = response.headers.get('content-type');
    debugLog(`Response content type: ${contentType}`);
    
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    if (buffer.length === 0) {
      throw new Error('Downloaded file is empty');
    }
    
    debugLog(`Downloaded ${buffer.length} bytes`);
    
    // Ensure output directory exists
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    
    // Write the file
    await fs.writeFile(outputPath, buffer);
    
    debugLog(`CRX file saved to: ${outputPath}`);
    
  } catch (error) {
    throw new Error(`Failed to download CRX: ${error.message}`);
  }
}

/**
 * Extract a CRX file to a directory
 * CRX files are ZIP files with additional headers that need to be skipped
 * @param {string} crxFilePath - Path to the .crx file
 * @param {string} extractDir - Directory to extract to
 */
async function extractCrxFile(crxFilePath, extractDir) {
  try {
    // Ensure extract directory exists
    await fs.mkdir(extractDir, { recursive: true });
    
    // Read the CRX file
    const crxBuffer = await fs.readFile(crxFilePath);
    
    if (crxBuffer.length < 12) {
      throw new Error('Invalid CRX file: too small');
    }
    
    // Check magic number
    const magic = crxBuffer.toString('ascii', 0, 4);
    if (magic !== 'Cr24') {
      throw new Error('Invalid CRX file: wrong magic number');
    }
    
    // Read version
    const version = crxBuffer.readUInt32LE(4);
    debugLog(`CRX version: ${version}`);
    
    let zipStart;
    
    if (version === 2) {
      // CRX2 format:
      // 4 bytes: "Cr24"
      // 4 bytes: version (2)
      // 4 bytes: public key length
      // 4 bytes: signature length
      // public key + signature + ZIP data
      
      if (crxBuffer.length < 16) {
        throw new Error('Invalid CRX2 file: header too small');
      }
      
      const publicKeyLength = crxBuffer.readUInt32LE(8);
      const signatureLength = crxBuffer.readUInt32LE(12);
      zipStart = 16 + publicKeyLength + signatureLength;
      
    } else if (version === 3) {
      // CRX3 format:
      // 4 bytes: "Cr24"
      // 4 bytes: version (3)
      // 4 bytes: header length
      // header (protobuf) + ZIP data
      
      if (crxBuffer.length < 12) {
        throw new Error('Invalid CRX3 file: header too small');
      }
      
      const headerLength = crxBuffer.readUInt32LE(8);
      zipStart = 12 + headerLength;
      
      debugLog(`CRX3 header length: ${headerLength}, ZIP starts at: ${zipStart}`);
      
    } else {
      throw new Error(`Unsupported CRX version: ${version}`);
    }
    
    if (zipStart >= crxBuffer.length) {
      throw new Error(`Invalid CRX file: header extends beyond file (zipStart: ${zipStart}, fileSize: ${crxBuffer.length})`);
    }
    
    // Extract ZIP portion
    const zipBuffer = crxBuffer.slice(zipStart);
    debugLog(`Extracted ZIP data: ${zipBuffer.length} bytes`);
    
    // Write ZIP data to temporary file
    const tempZipPath = crxFilePath + '.zip';
    await fs.writeFile(tempZipPath, zipBuffer);
    
    // Extract ZIP file
    await extractZipFile(tempZipPath, extractDir);
    
    // Clean up temporary ZIP file
    try {
      await fs.unlink(tempZipPath);
    } catch (error) {
      console.warn(`[${new Date().toISOString()}] Warning: Could not clean up temp ZIP file: ${error.message}`);
    }
    
  } catch (error) {
    throw new Error(`Failed to extract CRX file: ${error.message}`);
  }
}

/**
 * Extract a ZIP file to a directory using yauzl
 * @param {string} zipFilePath - Path to the .zip file
 * @param {string} extractDir - Directory to extract to
 */
async function extractZipFile(zipFilePath, extractDir) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipFilePath, { lazyEntries: true }, (err, zipfile) => {
      if (err) {
        reject(new Error(`Failed to open ZIP file: ${err.message}`));
        return;
      }

      zipfile.readEntry();
      
      zipfile.on('entry', (entry) => {
        if (/\/$/.test(entry.fileName)) {
          // Directory entry
          const dirPath = path.join(extractDir, entry.fileName);
          fs.mkdir(dirPath, { recursive: true }).then(() => {
            zipfile.readEntry();
          }).catch(reject);
        } else {
          // File entry
          zipfile.openReadStream(entry, (err, readStream) => {
            if (err) {
              reject(err);
              return;
            }
            
            const filePath = path.join(extractDir, entry.fileName);
            const fileDir = path.dirname(filePath);
            
            // Ensure the directory exists
            fs.mkdir(fileDir, { recursive: true }).then(() => {
              const writeStream = require('fs').createWriteStream(filePath);
              
              writeStream.on('close', () => {
                zipfile.readEntry();
              });
              
              writeStream.on('error', reject);
              readStream.on('error', reject);
              
              readStream.pipe(writeStream);
            }).catch(reject);
          });
        }
      });
      
      zipfile.on('end', () => {
        resolve();
      });
      
      zipfile.on('error', reject);
    });
  });
}

/**
 * Download and extract a single extension
 * @param {Object} extensionConfig - Extension configuration object
 * @returns {Promise<string>} Path to the extracted extension directory
 */
async function downloadSingleExtension(extensionConfig) {
  await ensureExtensionsDir();
  
  const extensionDir = path.join(EXTENSIONS_DIR, extensionConfig.name);
  
  // Check if extension is already downloaded and extracted
  try {
    await fs.access(extensionDir);
    debugLog(`Extension already exists: ${extensionDir}`);
    return extensionDir;
  } catch (error) {
    // Extension not found, need to download
  }
  
  requestLog(`Downloading ${extensionConfig.description} extension...`);
  
  try {
    // Use Chrome's direct CRX download URL
    const crxFileName = `${extensionConfig.name}.crx`;
    const crxFilePath = path.join(EXTENSIONS_DIR, crxFileName);
    
    debugLog(`Downloading extension ID: ${extensionConfig.id}`);
    await downloadCrxDirect(extensionConfig.id, crxFilePath);
    
    debugLog(`CRX file downloaded to: ${crxFilePath}`);
    
    // Now we need to extract the .crx file to the extension directory
    await extractCrxFile(crxFilePath, extensionDir);
    
    debugLog(`Extension extracted to: ${extensionDir}`);
    
    // Clean up the .crx file
    try {
      await fs.unlink(crxFilePath);
      debugLog('Cleaned up CRX file');
    } catch (cleanupError) {
      console.warn(`[${new Date().toISOString()}] Warning: Could not clean up CRX file: ${cleanupError.message}`);
    }
    
    return extensionDir;
    
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Failed to download ${extensionConfig.description}:`, error.message);
    throw error;
  }
}

/**
 * Download all configured extensions
 * @returns {Promise<Array<string>>} Array of paths to extracted extension directories
 */
export async function downloadAllExtensions() {
  const extensionPaths = [];
  
  for (const extensionConfig of EXTENSIONS_CONFIG) {
    try {
      const extensionPath = await downloadSingleExtension(extensionConfig);
      extensionPaths.push(extensionPath);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Failed to download ${extensionConfig.description}, skipping...`);
      // Continue with other extensions
    }
  }
  
  if (extensionPaths.length === 0) {
    throw new Error('Failed to download any extensions');
  }
  
  requestLog(`Successfully downloaded ${extensionPaths.length} extension(s)`);
  return extensionPaths;
}

/**
 * Get Chrome arguments for loading multiple extensions
 * @param {Array<string>} extensionPaths - Array of paths to extracted extension directories
 * @returns {Array<string>} Chrome arguments
 */
export function getExtensionArgs(extensionPaths) {
  if (!extensionPaths || extensionPaths.length === 0) {
    return [];
  }
  
  const absolutePaths = extensionPaths.map(p => path.resolve(p));
  const pathsString = absolutePaths.join(',');
  
  return [
    `--disable-extensions-except=${pathsString}`,
    `--load-extension=${pathsString}`,
    '--disable-web-security', // Sometimes needed for extension content scripts
    '--allow-running-insecure-content' // Sometimes needed for extension functionality
  ];
}

/**
 * Initialize all extensions for use with Puppeteer
 * @returns {Promise<Array<string>>} Chrome arguments for loading all extensions
 */
export async function initializeExtensions() {
  try {
    const extensionPaths = await downloadAllExtensions();
    const args = getExtensionArgs(extensionPaths);
    
    debugLog(`${extensionPaths.length} extension(s) ready for use with Chrome arguments:`, args);
    return args;
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Failed to initialize extensions:`, error.message);
    throw error;
  }
} 