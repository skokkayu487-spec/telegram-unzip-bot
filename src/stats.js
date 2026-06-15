'use strict';

const path = require('path');
const fs = require('fs-extra');
const config = require('./config');
const logger = require('./logger');

const STATS_FILE = path.join(config.dataDir, 'stats.json');

const defaultStats = {
  startTime: Date.now(),
  totalFiles: 0,
  totalBytesDownloaded: 0,
  totalBytesExtracted: 0,
  successfulExtractions: 0,
  failedExtractions: 0,
  passwordFailures: 0,
  lastActivity: null,
};

let stats = { ...defaultStats };

async function loadStats() {
  try {
    await fs.ensureDir(config.dataDir);
    if (await fs.pathExists(STATS_FILE)) {
      const data = await fs.readJson(STATS_FILE);
      stats = { ...defaultStats, ...data };
      // Reset startTime to now on each boot
      stats.startTime = Date.now();
      logger.info('Stats loaded from disk');
    }
  } catch (err) {
    logger.warn(`Could not load stats: ${err.message}`);
  }
}

async function saveStats() {
  try {
    await fs.ensureDir(config.dataDir);
    await fs.writeJson(STATS_FILE, stats, { spaces: 2 });
  } catch (err) {
    logger.error(`Could not save stats: ${err.message}`);
  }
}

function increment(key, amount = 1) {
  if (key in stats && typeof stats[key] === 'number') {
    stats[key] += amount;
    stats.lastActivity = Date.now();
    saveStats().catch(() => {});
  }
}

function getStats() {
  return { ...stats };
}

function formatUptime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(' ');
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

module.exports = { loadStats, saveStats, increment, getStats, formatUptime, formatBytes };
