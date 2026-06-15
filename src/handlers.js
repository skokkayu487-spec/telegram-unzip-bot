'use strict';

const { Telegraf } = require('telegraf');
const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('crypto');
const config = require('./config');
const logger = require('./logger');
const session = require('./session');
const stats = require('./stats');
const { downloadFile } = require('./downloader');
const { extractArchive, getTotalSize } = require('./extractor');
const { sendFiles } = require('./uploader');
const { markTempDirActive, unmarkTempDirActive } = require('./cleanup');

// Simple UUID via crypto (no external dep)
function generateJobId() {
  return require('crypto').randomUUID();
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Middleware: only allow OWNER_ID.
 */
function ownerOnly(ctx, next) {
  const userId = ctx.from?.id;
  if (userId !== config.ownerId) {
    logger.warn(`Unauthorized access attempt from user ${userId}`);
    return ctx.reply('🚫 Akses ditolak. Bot ini hanya untuk owner.');
  }
  return next();
}

/**
 * Register all bot commands and handlers.
 */
function registerHandlers(bot, mtprotoClient) {
  // /start
  bot.start(ownerOnly, async (ctx) => {
    logger.info(`/start from user ${ctx.from.id}`);
    const menuImagePath = path.join(config.assetsDir, 'menu.jpg');

    const text = [
      '🤖 *Telegram Unzip Bot*',
      '',
      'Bot untuk mengekstrak arsip `.zip` dan `.7z` langsung di Telegram.',
      '',
      '📋 *Cara Pakai:*',
      '1. Kirim file `.zip` atau `.7z`',
      '2. Masukkan password saat diminta',
      '3. Tunggu proses ekstrak & kirim hasil',
      '',
      '📌 *Commands:*',
      '/help — Panduan lengkap',
      '/stats — Statistik & uptime',
    ].join('\n');

    try {
      if (await fs.pathExists(menuImagePath)) {
        await ctx.replyWithPhoto({ source: menuImagePath }, {
          caption: text,
          parse_mode: 'Markdown',
        });
      } else {
        await ctx.reply(text, { parse_mode: 'Markdown' });
      }
    } catch (err) {
      logger.error(`Error in /start: ${err.message}`);
      await ctx.reply(text, { parse_mode: 'Markdown' });
    }
  });

  // /help
  bot.help(ownerOnly, async (ctx) => {
    logger.info(`/help from user ${ctx.from.id}`);
    const text = [
      '📖 *Panduan Penggunaan*',
      '',
      '*Format Didukung:*',
      '• `.zip` — ZIP archive',
      '• `.7z` — 7-Zip archive',
      '',
      '*File Besar (>2GB):*',
      'Bot menggunakan MTProto secara otomatis untuk file di atas 2GB.',
      '',
      '*Password:*',
      `• Maks ${config.maxPasswordAttempts} percobaan`,
      `• Cooldown ${config.cooldownSeconds} detik setelah gagal ${config.maxPasswordAttempts}x`,
      '',
      '*Proses:*',
      '1. Kirim file arsip ke bot',
      '2. Bot akan meminta password',
      '3. Masukkan password (atau ketik `/skip` jika tidak ada password)',
      '4. Bot akan mengunduh, mengekstrak, lalu mengirim hasilnya',
      '',
      '*Commands:*',
      '/start — Menu utama',
      '/help — Panduan ini',
      '/stats — Statistik penggunaan',
      '/cancel — Batalkan proses saat ini',
      '',
      '⚠️ *Catatan:* Auto-cleanup berjalan setiap',
      `${config.cleanupIntervalHours} jam untuk membersihkan file temp.`,
    ].join('\n');

    await ctx.reply(text, { parse_mode: 'Markdown' });
  });

  // /stats
  bot.command('stats', ownerOnly, async (ctx) => {
    logger.info(`/stats from user ${ctx.from.id}`);
    const s = stats.getStats();
    const uptime = stats.formatUptime(Date.now() - s.startTime);

    const text = [
      '📊 *Statistik Bot*',
      '',
      `⏱ *Uptime:* ${uptime}`,
      `📁 *Total File Diproses:* ${s.totalFiles}`,
      `⬇️ *Total Downloaded:* ${formatBytes(s.totalBytesDownloaded)}`,
      `📦 *Total Extracted:* ${formatBytes(s.totalBytesExtracted)}`,
      `✅ *Ekstraksi Berhasil:* ${s.successfulExtractions}`,
      `❌ *Ekstraksi Gagal:* ${s.failedExtractions}`,
      `🔐 *Gagal Password:* ${s.passwordFailures}`,
      `🕐 *Aktivitas Terakhir:* ${s.lastActivity ? new Date(s.lastActivity).toLocaleString('id-ID') : 'Belum ada'}`,
    ].join('\n');

    await ctx.reply(text, { parse_mode: 'Markdown' });
  });

  // /cancel
  bot.command('cancel', ownerOnly, async (ctx) => {
    const userId = ctx.from.id;
    session.clearPending(userId);
    session.clearActiveJob(userId);
    await ctx.reply('🚫 Proses dibatalkan.');
    logger.info(`User ${userId} cancelled pending operation`);
  });

  // /skip (skip password for unencrypted archives)
  bot.command('skip', ownerOnly, async (ctx) => {
    const userId = ctx.from.id;
    if (!session.isAwaitingPassword(userId)) {
      return ctx.reply('Tidak ada file yang menunggu. Kirim file terlebih dahulu.');
    }
    logger.info(`User ${userId} skipping password`);
    await processExtraction(bot, ctx, userId, null, mtprotoClient);
  });

  // Handle document messages (archive files)
  bot.on('document', ownerOnly, async (ctx) => {
    const userId = ctx.from.id;
    const doc = ctx.message.document;
    const fileName = doc.file_name || '';
    const fileExt = path.extname(fileName).toLowerCase();

    // Check cooldown
    const cooldown = session.isOnCooldown(userId);
    if (cooldown.onCooldown) {
      return ctx.reply(`⏳ Cooldown aktif. Coba lagi dalam ${cooldown.remaining} detik.`);
    }

    // Validate format
    if (!['.zip', '.7z'].includes(fileExt)) {
      return ctx.reply('❌ Format tidak didukung. Kirim file `.zip` atau `.7z`.');
    }

    // Check if already processing
    if (session.getActiveJob(userId)) {
      return ctx.reply('⚠️ Masih ada proses aktif. Tunggu selesai atau /cancel.');
    }

    logger.info(`Received file from ${userId}: ${fileName} (${doc.file_size || 'unknown'} bytes)`);

    // Store file info for password prompt
    session.setPendingFile(userId, {
      fileId: doc.file_id,
      fileName,
      fileSize: doc.file_size || 0,
      message: ctx.message,
    });

    session.resetAttempts(userId);

    await ctx.reply(
      `📦 File diterima: *${fileName}*\n` +
      `📏 Ukuran: ${doc.file_size ? formatBytes(doc.file_size) : 'tidak diketahui'}\n\n` +
      `🔐 *Masukkan password arsip:*\n` +
      `(Ketik /skip jika tidak ada password)\n\n` +
      `Percobaan: 0/${config.maxPasswordAttempts}`,
      { parse_mode: 'Markdown' }
    );
  });

  // Handle text messages (password input)
  bot.on('text', ownerOnly, async (ctx) => {
    const userId = ctx.from.id;
    const text = ctx.message.text;

    // Ignore commands
    if (text.startsWith('/')) return;

    // Not awaiting password
    if (!session.isAwaitingPassword(userId)) {
      return ctx.reply('Kirim file `.zip` atau `.7z` terlebih dahulu.');
    }

    // Check cooldown
    const cooldown = session.isOnCooldown(userId);
    if (cooldown.onCooldown) {
      return ctx.reply(`⏳ Cooldown aktif. Coba lagi dalam ${cooldown.remaining} detik.`);
    }

    const password = text.trim();
    logger.info(`User ${userId} entered password attempt`);
    await processExtraction(bot, ctx, userId, password, mtprotoClient);
  });
}

/**
 * Core extraction pipeline.
 */
async function processExtraction(bot, ctx, userId, password, mtprotoClient) {
  const fileInfo = session.getPendingFile(userId);
  if (!fileInfo) {
    return ctx.reply('Tidak ada file pending. Kirim file terlebih dahulu.');
  }

  const jobId = generateJobId();
  session.setActiveJob(userId, jobId);
  session.clearPending(userId);

  const { fileName, fileId, fileSize, message } = fileInfo;
  const ext = path.extname(fileName).toLowerCase();
  const baseName = path.basename(fileName, ext);

  // Unique paths for this job
  const downloadPath = path.join(config.downloadsDir, `${jobId}_${fileName}`);
  const extractDir = path.join(config.tempDir, jobId);

  markTempDirActive(extractDir);

  let statusMsg;
  try {
    // Status message
    statusMsg = await ctx.reply(`⬇️ *Mengunduh* \`${fileName}\`...`, { parse_mode: 'Markdown' });
    stats.increment('totalFiles');

    // ── DOWNLOAD ──────────────────────────────────────────
    let lastDownloadPercent = -1;
    const { size: downloadedSize } = await downloadFile(bot, ctx, fileInfo, downloadPath, async (dl, total, percent) => {
      if (percent !== lastDownloadPercent && (percent % 10 === 0)) {
        lastDownloadPercent = percent;
        const bar = progressBar(percent);
        try {
          await bot.telegram.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            null,
            `⬇️ *Mengunduh* \`${fileName}\`\n${bar} ${percent}%\n${formatBytes(dl)} / ${total ? formatBytes(total) : '?'}`,
            { parse_mode: 'Markdown' }
          );
        } catch (_) {}
      }
    });

    stats.increment('totalBytesDownloaded', downloadedSize);
    logger.info(`Download complete: ${downloadPath} (${downloadedSize} bytes)`);

    // ── EXTRACT ───────────────────────────────────────────
    await bot.telegram.editMessageText(
      ctx.chat.id, statusMsg.message_id, null,
      `📦 *Mengekstrak* \`${fileName}\`...`,
      { parse_mode: 'Markdown' }
    );

    let lastExtractPercent = -1;
    let extractedFiles;
    try {
      extractedFiles = await extractArchive(downloadPath, extractDir, password, async (done, total, percent) => {
        if (percent !== null && percent !== lastExtractPercent && percent % 20 === 0) {
          lastExtractPercent = percent;
          try {
            await bot.telegram.editMessageText(
              ctx.chat.id, statusMsg.message_id, null,
              `📦 *Mengekstrak* \`${fileName}\`\n${progressBar(percent)} ${percent}%\n${done} file diproses`,
              { parse_mode: 'Markdown' }
            );
          } catch (_) {}
        }
      });
    } catch (err) {
      if (err.message === 'WRONG_PASSWORD') {
        const result = session.recordFailedAttempt(userId);
        stats.increment('passwordFailures');

        if (result.locked) {
          session.clearPending(userId);
          await bot.telegram.editMessageText(
            ctx.chat.id, statusMsg.message_id, null,
            `❌ *Password salah!*\n\nTerlalu banyak percobaan. Cooldown ${config.cooldownSeconds} detik.`,
            { parse_mode: 'Markdown' }
          );
        } else {
          // Restore pending so user can try again
          session.setPendingFile(userId, fileInfo);
          await bot.telegram.editMessageText(
            ctx.chat.id, statusMsg.message_id, null,
            `❌ *Password salah!*\n\nSisa percobaan: ${result.attemptsLeft}/${config.maxPasswordAttempts}\nMasukkan password kembali:`,
            { parse_mode: 'Markdown' }
          );
        }

        session.clearActiveJob(userId);
        await fs.remove(downloadPath).catch(() => {});
        return;
      }
      throw err;
    }

    // ── GET TOTAL EXTRACTED SIZE ──────────────────────────
    const totalExtractedSize = await getTotalSize(extractedFiles);
    stats.increment('totalBytesExtracted', totalExtractedSize);
    stats.increment('successfulExtractions');
    session.resetAttempts(userId);

    logger.info(`Extraction complete: ${extractedFiles.length} files, ${formatBytes(totalExtractedSize)}`);

    // ── SEND FILES ────────────────────────────────────────
    await bot.telegram.editMessageText(
      ctx.chat.id, statusMsg.message_id, null,
      `📤 *Mengirim ${extractedFiles.length} file*...\n${formatBytes(totalExtractedSize)} total`,
      { parse_mode: 'Markdown' }
    );

    let lastSendUpdate = '';
    const { sent, failed } = await sendFiles(bot, ctx, extractedFiles, mtprotoClient, async (done, total, sentOk, failedCount) => {
      const msg = `📤 *Mengirim file* ${done}/${total}\n✅ ${sentOk} berhasil • ❌ ${failedCount} gagal`;
      if (msg !== lastSendUpdate) {
        lastSendUpdate = msg;
        try {
          await bot.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, msg, { parse_mode: 'Markdown' });
        } catch (_) {}
      }
    });

    // ── DONE ──────────────────────────────────────────────
    const successImagePath = path.join(config.assetsDir, 'success.jpg');
    const doneText = [
      `✅ *Selesai!*`,
      ``,
      `📦 File: \`${fileName}\``,
      `📄 Diekstrak: ${extractedFiles.length} file`,
      `💾 Total ukuran: ${formatBytes(totalExtractedSize)}`,
      `📤 Terkirim: ${sent} • ❌ Gagal: ${failed}`,
    ].join('\n');

    try {
      await bot.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id);
    } catch (_) {}

    try {
      if (await fs.pathExists(successImagePath)) {
        await ctx.replyWithPhoto({ source: successImagePath }, { caption: doneText, parse_mode: 'Markdown' });
      } else {
        await ctx.reply(doneText, { parse_mode: 'Markdown' });
      }
    } catch (err) {
      await ctx.reply(doneText, { parse_mode: 'Markdown' });
    }

    logger.info(`Job ${jobId} complete: ${sent} sent, ${failed} failed`);

  } catch (err) {
    stats.increment('failedExtractions');
    logger.error(`Job ${jobId} failed: ${err.message}`, err);

    const errText = `❌ *Terjadi kesalahan!*\n\n\`${err.message}\`\n\nSilakan coba lagi.`;
    try {
      if (statusMsg) {
        await bot.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, errText, { parse_mode: 'Markdown' });
      } else {
        await ctx.reply(errText, { parse_mode: 'Markdown' });
      }
    } catch (_) {
      await ctx.reply(errText, { parse_mode: 'Markdown' }).catch(() => {});
    }
  } finally {
    // Cleanup
    session.clearActiveJob(userId);
    unmarkTempDirActive(extractDir);

    try { await fs.remove(downloadPath); } catch (_) {}
    try { await fs.remove(extractDir); } catch (_) {}
    logger.info(`Job ${jobId} cleanup done`);
  }
}

/**
 * Generate a simple ASCII progress bar.
 */
function progressBar(percent, length = 10) {
  const filled = Math.floor((percent / 100) * length);
  const empty = length - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
}

module.exports = { registerHandlers };
