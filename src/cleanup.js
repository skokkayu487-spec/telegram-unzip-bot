'use strict';

const path = require('path');
const fs = require('fs-extra');
const schedule = require('node-schedule');
const config = require('./config');
const logger = require('./logger');
const { getActiveJob } = require('./session');

// Track which temp folders are currently in use
const activeTempDirs = new Set();

function markTempDirActive(dirPath) {
  activeTempDirs.add(path.resolve(dirPath));
}

function unmarkTempDirActive(dirPath) {
  activeTempDirs.delete(path.resolve(dirPath));
}

function isTempDirActive(dirPath) {
  return activeTempDirs.has(path.resolve(dirPath));
}

/**
 * Clean a specific directory, skipping active ones.
 */
async function cleanDirectory(dirPath, maxAgeHours = 0) {
  if (!await fs.pathExists(dirPath)) {
    logger.debug(`Directory does not exist, skipping: ${dirPath}`);
    return { deleted: 0, skipped: 0, errors: 0 };
  }

  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  let deleted = 0, skipped = 0, errors = 0;
  const cutoffTime = Date.now() - (maxAgeHours * 60 * 60 * 1000);

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    // Skip active temp dirs
    if (isTempDirActive(fullPath)) {
      logger.debug(`Skipping active temp dir: ${fullPath}`);
      skipped++;
      continue;
    }

    try {
      const stat = await fs.stat(fullPath);

      // If maxAgeHours > 0, only remove old entries
      if (maxAgeHours > 0 && stat.mtimeMs > cutoffTime) {
        skipped++;
        continue;
      }

      await fs.remove(fullPath);
      deleted++;
      logger.debug(`Removed: ${fullPath}`);
    } catch (err) {
      errors++;
      logger.error(`Failed to remove ${fullPath}: ${err.message}`);
    }
  }

  return { deleted, skipped, errors };
}

/**
 * Full cleanup run: temp + old downloads.
 */
async function runCleanup(force = false) {
  logger.info(`Running cleanup (force=${force})...`);

  const maxAge = force ? 0 : config.cleanupIntervalHours;

  // Clean temp
  const tempResult = await cleanDirectory(config.tempDir, maxAge);
  logger.info(`Temp cleanup: ${tempResult.deleted} deleted, ${tempResult.skipped} skipped, ${tempResult.errors} errors`);

  // Clean downloads older than cleanup interval
  const dlResult = await cleanDirectory(config.downloadsDir, maxAge);
  logger.info(`Downloads cleanup: ${dlResult.deleted} deleted, ${dlResult.skipped} skipped, ${dlResult.errors} errors`);

  return {
    temp: tempResult,
    downloads: dlResult,
  };
}

let cleanupJob = null;

/**
 * Schedule automatic cleanup every N hours.
 */
function scheduleCleanup() {
  const hours = config.cleanupIntervalHours;
  logger.info(`Scheduling auto-cleanup every ${hours} hour(s)`);

  // Use node-schedule: every N hours
  // e.g., every 3 hours: "0 */3 * * *"
  const cronExpr = `0 */${hours} * * *`;

  cleanupJob = schedule.scheduleJob(cronExpr, async () => {
    logger.info('Auto-cleanup triggered by scheduler');
    try {
      await runCleanup();
    } catch (err) {
      logger.error(`Auto-cleanup failed: ${err.message}`);
    }
  });

  logger.info(`Cleanup scheduled with cron: ${cronExpr}`);
  return cleanupJob;
}

function stopCleanupSchedule() {
  if (cleanupJob) {
    cleanupJob.cancel();
    logger.info('Cleanup schedule stopped');
  }
}

/**
 * Ensure required directories exist.
 */
async function ensureDirectories() {
  const dirs = [
    config.downloadsDir,
    config.tempDir,
    config.logsDir,
    config.dataDir,
  ];

  for (const dir of dirs) {
    await fs.ensureDir(dir);
    logger.debug(`Ensured directory: ${dir}`);
  }
}

module.exports = {
  markTempDirActive,
  unmarkTempDirActive,
  runCleanup,
  scheduleCleanup,
  stopCleanupSchedule,
  ensureDirectories,
};
