'use strict';

const path = require('path');
const fs = require('fs-extra');
const AdmZip = require('adm-zip');
const Seven = require('node-7z');
const logger = require('./logger');

/**
 * Validate that the resolved path is under the allowed base directory.
 * Prevents path traversal attacks.
 */
function validateExtractPath(basePath, targetPath) {
  const resolved = path.resolve(basePath, targetPath);
  if (!resolved.startsWith(path.resolve(basePath) + path.sep) &&
      resolved !== path.resolve(basePath)) {
    throw new Error(`Path traversal detected: ${targetPath}`);
  }
  return resolved;
}

/**
 * Sanitize filename to prevent dangerous characters.
 */
function sanitizeFilename(name) {
  return name
    .replace(/\.\./g, '_')
    .replace(/^\/+/, '')
    .replace(/\\/g, '/')
    .split('/')
    .map(part => part.replace(/[<>:"|?*\x00-\x1f]/g, '_'))
    .join('/');
}

/**
 * Extract .zip file.
 */
async function extractZip(archivePath, outputDir, password, onProgress) {
  logger.info(`Extracting ZIP: ${archivePath} → ${outputDir}`);
  await fs.ensureDir(outputDir);

  const zip = new AdmZip(archivePath);
  const entries = zip.getEntries();
  let processed = 0;

  for (const entry of entries) {
    const safeName = sanitizeFilename(entry.entryName);
    if (!safeName) continue;

    const destPath = validateExtractPath(outputDir, safeName);

    if (entry.isDirectory) {
      await fs.ensureDir(destPath);
    } else {
      await fs.ensureDir(path.dirname(destPath));

      try {
        let data;
        if (password) {
          data = zip.readFile(entry, password);
        } else {
          data = zip.readFile(entry);
        }

        if (data === null) {
          throw new Error(`Failed to read entry: ${entry.entryName}. Wrong password?`);
        }

        await fs.writeFile(destPath, data);
      } catch (err) {
        if (err.message.includes('Wrong password') ||
            err.message.includes('bad password') ||
            err.message.includes('Failed to read entry')) {
          throw new Error('WRONG_PASSWORD');
        }
        throw err;
      }
    }

    processed++;
    if (onProgress) {
      const percent = Math.floor((processed / entries.length) * 100);
      onProgress(processed, entries.length, percent);
    }
  }

  const extractedFiles = await collectFiles(outputDir);
  logger.info(`ZIP extracted: ${extractedFiles.length} files to ${outputDir}`);
  return extractedFiles;
}

/**
 * Extract .7z file using node-7z (requires 7za binary).
 */
async function extract7z(archivePath, outputDir, password, onProgress) {
  logger.info(`Extracting 7Z: ${archivePath} → ${outputDir}`);
  await fs.ensureDir(outputDir);

  return new Promise((resolve, reject) => {
    const options = {
      $bin: process.env['7Z_BIN'] || '7za',
      recursive: true,
      overwrite: true,
      outputPath: outputDir,
    };

    if (password) {
      options.password = password;
    }

    const stream = Seven.extractFull(archivePath, outputDir, options);
    let hasError = false;
    let errorMsg = '';
    let fileCount = 0;

    stream.on('data', (data) => {
      if (data.status === 'extracted') {
        fileCount++;
        if (onProgress) {
          onProgress(fileCount, null, null);
        }
      }
    });

    stream.on('error', (err) => {
      hasError = true;
      errorMsg = err.message || String(err);
      logger.error(`7z extraction error: ${errorMsg}`);

      if (errorMsg.includes('Wrong password') ||
          errorMsg.includes('Cannot open encrypted') ||
          errorMsg.includes('password')) {
        reject(new Error('WRONG_PASSWORD'));
      } else {
        reject(new Error(`7z extraction failed: ${errorMsg}`));
      }
    });

    stream.on('end', async () => {
      if (hasError) return;

      // Validate extracted paths for security
      try {
        const extractedFiles = await collectFiles(outputDir);
        for (const f of extractedFiles) {
          validateExtractPath(outputDir, path.relative(outputDir, f));
        }
        logger.info(`7Z extracted: ${extractedFiles.length} files to ${outputDir}`);
        resolve(extractedFiles);
      } catch (err) {
        reject(err);
      }
    });
  });
}

/**
 * Recursively collect all file paths under a directory.
 */
async function collectFiles(dir) {
  const results = [];
  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        results.push(fullPath);
      }
    }
  }
  await walk(dir);
  return results;
}

/**
 * Get total size of all extracted files.
 */
async function getTotalSize(files) {
  let total = 0;
  for (const f of files) {
    try {
      const stat = await fs.stat(f);
      total += stat.size;
    } catch (_) {}
  }
  return total;
}

/**
 * Main extraction entry point — auto-detects format.
 */
async function extractArchive(archivePath, outputDir, password, onProgress) {
  const ext = path.extname(archivePath).toLowerCase();

  if (ext === '.zip') {
    return extractZip(archivePath, outputDir, password, onProgress);
  } else if (ext === '.7z') {
    return extract7z(archivePath, outputDir, password, onProgress);
  } else {
    throw new Error(`Unsupported archive format: ${ext}`);
  }
}

module.exports = { extractArchive, collectFiles, getTotalSize };
