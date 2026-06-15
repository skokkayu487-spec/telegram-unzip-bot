'use strict';

const path = require('path');
const fs = require('fs-extra');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const config = require('./config');
const logger = require('./logger');

const MAX_SINGLE_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2GB Bot API limit
const MAX_CAPTION_LENGTH = 1024;

/**
 * Send a file to Telegram chat.
 * Uses Bot API for files ≤ 2GB, MTProto for larger.
 */
async function sendFile(bot, ctx, filePath, caption, mtprotoClient) {
  const stat = await fs.stat(filePath);
  const fileSize = stat.size;
  const fileName = path.basename(filePath);

  // Truncate caption if needed
  const safeCaption = caption && caption.length > MAX_CAPTION_LENGTH
    ? caption.substring(0, MAX_CAPTION_LENGTH - 3) + '...'
    : caption;

  if (fileSize > MAX_SINGLE_FILE_SIZE) {
    logger.info(`File ${fileName} (${fileSize} bytes) exceeds 2GB, using MTProto to upload`);
    return sendViaMTProto(mtprotoClient, ctx.chat.id, filePath, fileName, safeCaption);
  }

  logger.info(`Uploading ${fileName} (${fileSize} bytes) via Bot API`);
  return ctx.replyWithDocument(
    { source: filePath, filename: fileName },
    { caption: safeCaption }
  );
}

/**
 * Upload file using MTProto (for files > 2GB).
 */
async function sendViaMTProto(client, chatId, filePath, fileName, caption) {
  logger.info(`MTProto upload: ${filePath} → chat ${chatId}`);

  await client.sendFile(chatId, {
    file: filePath,
    caption: caption || '',
    forceDocument: true,
    attributes: [{ fileName }],
    progressCallback: (progress) => {
      logger.debug(`Upload progress: ${Math.floor(progress * 100)}%`);
    },
  });

  logger.info(`MTProto upload complete: ${fileName}`);
}

/**
 * Send multiple files with progress tracking.
 * Returns { sent, failed } counts.
 */
async function sendFiles(bot, ctx, files, mtprotoClient, onProgress) {
  let sent = 0;
  let failed = 0;

  for (let i = 0; i < files.length; i++) {
    const filePath = files[i];
    const fileName = path.basename(filePath);

    try {
      const caption = `📄 ${fileName} (${i + 1}/${files.length})`;
      await sendFile(bot, ctx, filePath, caption, mtprotoClient);
      sent++;
      if (onProgress) onProgress(i + 1, files.length, sent, failed);
      logger.info(`Sent file ${i + 1}/${files.length}: ${fileName}`);

      // Small delay between sends to avoid flood wait
      if (i < files.length - 1) {
        await delay(500);
      }
    } catch (err) {
      failed++;
      logger.error(`Failed to send ${fileName}: ${err.message}`);
      if (onProgress) onProgress(i + 1, files.length, sent, failed);

      // Try to notify user of individual failure
      try {
        await ctx.reply(`⚠️ Gagal mengirim file: ${fileName}\n${err.message}`);
      } catch (_) {}
    }
  }

  return { sent, failed };
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { sendFile, sendFiles };
