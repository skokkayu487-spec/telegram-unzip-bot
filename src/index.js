'use strict';

require('dotenv').config();

const path = require('path');
const fs = require('fs-extra');

// ── Load config first (validates required env vars) ───────────────────────────
let config;
try {
  config = require('./config');
} catch (err) {
  console.error(`[FATAL] Configuration error: ${err.message}`);
  console.error('Copy .env.example to .env and fill in the required values.');
  process.exit(1);
}

const logger = require('./logger');
const { Telegraf } = require('telegraf');
const { registerHandlers } = require('./handlers');
const { initMTProto, disconnectMTProto } = require('./downloader');
const { scheduleCleanup, stopCleanupSchedule, ensureDirectories } = require('./cleanup');
const stats = require('./stats');

const startTime = Date.now();
let bot;
let mtprotoClient = null;
let isShuttingDown = false;

// ── Health heartbeat ──────────────────────────────────────────────────────────
function startHealthHeartbeat() {
  const HEALTH_FILE = path.join(config.dataDir, 'health.json');
  const write = () => {
    fs.writeJson(HEALTH_FILE, {
      status: 'ok',
      timestamp: Date.now(),
      uptime: (Date.now() - startTime) / 1000,
      pid: process.pid,
    }).catch(() => {});
  };
  write();
  return setInterval(write, 30 * 1000); // every 30s
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────
async function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`Received ${signal}. Starting graceful shutdown...`);

  try {
    if (bot) {
      bot.stop(signal);
      logger.info('Telegram bot stopped');
    }
  } catch (err) {
    logger.error(`Error stopping bot: ${err.message}`);
  }

  try {
    await disconnectMTProto();
  } catch (err) {
    logger.error(`Error disconnecting MTProto: ${err.message}`);
  }

  stopCleanupSchedule();

  await stats.saveStats();
  logger.info('Stats saved. Goodbye!');

  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  logger.error(`Uncaught exception: ${err.message}`, err);
  if (!isShuttingDown) shutdown('uncaughtException');
});
process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled rejection: ${reason}`);
});

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  logger.info('═══════════════════════════════════════════');
  logger.info('       Telegram Unzip Bot Starting         ');
  logger.info('═══════════════════════════════════════════');
  logger.info(`Node.js: ${process.version}`);
  logger.info(`Owner ID: ${config.ownerId}`);
  logger.info(`Downloads: ${config.downloadsDir}`);
  logger.info(`Temp: ${config.tempDir}`);
  logger.info(`Cleanup interval: ${config.cleanupIntervalHours}h`);

  // Ensure directories exist
  await ensureDirectories();
  logger.info('Directories verified');

  // Load persistent stats
  await stats.loadStats();

  // Initialize MTProto client
  logger.info('Initializing MTProto client...');
  try {
    mtprotoClient = await initMTProto();
    logger.info('MTProto client ready');
  } catch (err) {
    logger.error(`MTProto init failed (will retry on demand): ${err.message}`);
    // Non-fatal: bot can still work with Bot API for files ≤ 2GB
  }

  // Create bot
  bot = new Telegraf(config.botToken, {
    handlerTimeout: 30 * 60 * 1000, // 30 min handler timeout
  });

  // Error handler
  bot.catch((err, ctx) => {
    logger.error(`Bot error for ${ctx.updateType}: ${err.message}`, err);
    ctx.reply('⚠️ Terjadi kesalahan internal. Silakan coba lagi.').catch(() => {});
  });

  // Register all handlers
  registerHandlers(bot, mtprotoClient);
  logger.info('Handlers registered');

  // Schedule cleanup
  scheduleCleanup();

  // Start health heartbeat
  const healthInterval = startHealthHeartbeat();

  // Launch bot
  await bot.launch({
    dropPendingUpdates: true,
  });

  logger.info('═══════════════════════════════════════════');
  logger.info('       Bot is RUNNING and ready!           ');
  logger.info('═══════════════════════════════════════════');

  // Notify owner
  try {
    await bot.telegram.sendMessage(
      config.ownerId,
      `🟢 *Bot Online!*\n\nVersi Node.js: ${process.version}\nWaktu mulai: ${new Date().toLocaleString('id-ID')}`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    logger.warn(`Could not send startup notification: ${err.message}`);
  }
}

main().catch((err) => {
  console.error(`[FATAL] Bot failed to start: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
