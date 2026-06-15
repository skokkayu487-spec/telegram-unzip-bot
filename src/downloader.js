'use strict';

const fs = require('fs-extra');
const path = require('path');
const https = require('https');
const http = require('http');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const config = require('./config');
const logger = require('./logger');

let mtprotoClient = null;
let mtprotoConnected = false;

/**
 * Initialize MTProto client (used for files > 2GB or as fallback).
 */
async function initMTProto() {
  if (mtprotoClient && mtprotoConnected) return mtprotoClient;

  const sessionFile = path.join(config.dataDir, 'session.txt');
  let sessionStr = '';
  try {
    if (await fs.pathExists(sessionFile)) {
      sessionStr = (await fs.readFile(sessionFile, 'utf-8')).trim();
    }
  } catch (_) {}

  const session = new StringSession(sessionStr);

  mtprotoClient = new TelegramClient(session, config.apiId, config.apiHash, {
    connectionRetries: 5,
    retryDelay: 1000,
    autoReconnect: true,
    baseLogger: {
      log: () => {},
      warn: (msg) => logger.warn(`[MTProto] ${msg}`),
      error: (msg) => logger.error(`[MTProto] ${msg}`),
    },
  });

  await mtprotoClient.start({
    botAuthToken: config.botToken,
  });

  const savedSession = mtprotoClient.session.save();
  await fs.ensureDir(config.dataDir);
  await fs.writeFile(sessionFile, savedSession, 'utf-8');

  mtprotoConnected = true;
  logger.info('MTProto client connected and session saved');
  return mtprotoClient;
}

/**
 * Disconnect MTProto cleanly.
 */
async function disconnectMTProto() {
  if (mtprotoClient && mtprotoConnected) {
    try {
      await mtprotoClient.disconnect();
      mtprotoConnected = false;
      logger.info('MTProto client disconnected');
    } catch (err) {
      logger.error(`Error disconnecting MTProto: ${err.message}`);
    }
  }
}

/**
 * Download file using Bot API (for files ≤ 20MB via getFile, or use direct link).
 */
async function downloadViaBotApi(bot, fileId, destPath, onProgress) {
  const fileLink = await bot.telegram.getFileLink(fileId);
  const url = fileLink.href;
  logger.info(`Downloading via Bot API: ${url}`);

  await fs.ensureDir(path.dirname(destPath));

  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(destPath);
    let downloaded = 0;
    let totalSize = 0;
    let lastProgressReport = 0;

    protocol.get(url, (response) => {
      totalSize = parseInt(response.headers['content-length'] || '0', 10);

      response.on('data', (chunk) => {
        downloaded += chunk.length;
        const percent = totalSize > 0 ? Math.floor((downloaded / totalSize) * 100) : 0;
        if (percent - lastProgressReport >= 10 || percent === 100) {
          lastProgressReport = percent;
          if (onProgress) onProgress(downloaded, totalSize, percent);
        }
      });

      response.pipe(file);

      file.on('finish', () => {
        file.close();
        logger.info(`Bot API download complete: ${destPath} (${downloaded} bytes)`);
        resolve({ size: downloaded });
      });

      file.on('error', (err) => {
        fs.unlink(destPath).catch(() => {});
        reject(new Error(`File write error: ${err.message}`));
      });

      response.on('error', (err) => {
        fs.unlink(destPath).catch(() => {});
        reject(new Error(`HTTP error: ${err.message}`));
      });
    }).on('error', (err) => {
      fs.unlink(destPath).catch(() => {});
      reject(new Error(`Request error: ${err.message}`));
    });
  });
}

/**
 * Download file via MTProto (supports files > 2GB).
 */
async function downloadViaMTProto(ctx, message, destPath, onProgress) {
  logger.info(`Downloading via MTProto to: ${destPath}`);
  await fs.ensureDir(path.dirname(destPath));

  const client = await initMTProto();

  // Get the full message to access media
  const chatId = ctx.chat.id;
  const msgId = message.message_id;

  const messages = await client.getMessages(chatId, { ids: [msgId] });
  if (!messages || messages.length === 0) {
    throw new Error('Could not retrieve message via MTProto');
  }

  const tgMessage = messages[0];
  if (!tgMessage.media) {
    throw new Error('No media found in message via MTProto');
  }

  const totalSize = tgMessage.media?.document?.size || 0;
  let lastProgressReport = 0;

  const buffer = await client.downloadMedia(tgMessage.media, {
    progressCallback: (downloaded, total) => {
      const percent = total > 0 ? Math.floor((Number(downloaded) / Number(total)) * 100) : 0;
      if (percent - lastProgressReport >= 5 || percent === 100) {
        lastProgressReport = percent;
        if (onProgress) onProgress(Number(downloaded), Number(total), percent);
      }
    },
  });

  await fs.writeFile(destPath, buffer);
  logger.info(`MTProto download complete: ${destPath} (${buffer.length} bytes)`);
  return { size: buffer.length };
}

/**
 * Auto-select download method based on file size.
 */
async function downloadFile(bot, ctx, fileInfo, destPath, onProgress) {
  const { fileId, fileSize, message } = fileInfo;

  // Bot API limit is ~20MB for getFile, but works up to 2GB for large files if using direct URL
  // For files > 2GB, must use MTProto
  if (fileSize && fileSize > config.telegramMaxFileSize) {
    logger.info(`File size ${fileSize} > 2GB, using MTProto`);
    return downloadViaMTProto(ctx, message, destPath, onProgress);
  }

  logger.info(`File size ${fileSize || 'unknown'}, using Bot API`);
  return downloadViaBotApi(bot, fileId, destPath, onProgress);
}

module.exports = { downloadFile, initMTProto, disconnectMTProto };
