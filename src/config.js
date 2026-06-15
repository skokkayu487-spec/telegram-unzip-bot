'use strict';

require('dotenv').config();
const path = require('path');

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name, defaultValue) {
  return process.env[name] || defaultValue;
}

const config = {
  // Bot
  botToken: requireEnv('BOT_TOKEN'),
  ownerId: parseInt(requireEnv('OWNER_ID'), 10),

  // MTProto
  apiId: parseInt(requireEnv('API_ID'), 10),
  apiHash: requireEnv('API_HASH'),

  // Password
  archivePassword: optionalEnv('ARCHIVE_PASSWORD', ''),
  maxPasswordAttempts: parseInt(optionalEnv('MAX_PASSWORD_ATTEMPTS', '5'), 10),
  cooldownSeconds: parseInt(optionalEnv('COOLDOWN_SECONDS', '10'), 10),

  // Paths
  downloadsDir: path.resolve(optionalEnv('DOWNLOADS_DIR', path.join(__dirname, '..', 'downloads'))),
  tempDir: path.resolve(optionalEnv('TEMP_DIR', path.join(__dirname, '..', 'temp'))),
  logsDir: path.resolve(optionalEnv('LOG_DIR', path.join(__dirname, '..', 'logs'))),
  dataDir: path.resolve(optionalEnv('DATA_DIR', path.join(__dirname, '..', 'data'))),
  assetsDir: path.resolve(path.join(__dirname, '..', 'assets')),

  // Cleanup
  cleanupIntervalHours: parseInt(optionalEnv('CLEANUP_INTERVAL_HOURS', '3'), 10),

  // Logging
  logLevel: optionalEnv('LOG_LEVEL', 'info'),

  // Limits
  telegramMaxFileSize: 2 * 1024 * 1024 * 1024,   // 2GB - Bot API limit
  sendMaxFileSize: 2 * 1024 * 1024 * 1024,         // 2GB send limit via MTProto
};

module.exports = config;
