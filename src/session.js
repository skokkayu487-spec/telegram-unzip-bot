'use strict';

const config = require('./config');
const logger = require('./logger');

/**
 * In-memory session store per user.
 * Tracks: password attempts, cooldown, awaiting password state, active job.
 */
const sessions = new Map();

function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, {
      awaitingPassword: false,
      pendingFileInfo: null,
      attempts: 0,
      cooldownUntil: null,
      activeJob: null,
    });
  }
  return sessions.get(userId);
}

function resetAttempts(userId) {
  const s = getSession(userId);
  s.attempts = 0;
  s.cooldownUntil = null;
  logger.debug(`Attempts reset for user ${userId}`);
}

function recordFailedAttempt(userId) {
  const s = getSession(userId);
  s.attempts += 1;
  logger.warn(`User ${userId} failed password attempt ${s.attempts}/${config.maxPasswordAttempts}`);

  if (s.attempts >= config.maxPasswordAttempts) {
    s.cooldownUntil = Date.now() + config.cooldownSeconds * 1000;
    s.attempts = 0;
    s.awaitingPassword = false;
    s.pendingFileInfo = null;
    logger.warn(`User ${userId} exceeded max attempts. Cooldown until ${new Date(s.cooldownUntil).toISOString()}`);
    return { locked: true, cooldownUntil: s.cooldownUntil };
  }

  return { locked: false, attemptsLeft: config.maxPasswordAttempts - s.attempts };
}

function isOnCooldown(userId) {
  const s = getSession(userId);
  if (s.cooldownUntil && Date.now() < s.cooldownUntil) {
    const remaining = Math.ceil((s.cooldownUntil - Date.now()) / 1000);
    return { onCooldown: true, remaining };
  }
  if (s.cooldownUntil && Date.now() >= s.cooldownUntil) {
    s.cooldownUntil = null;
  }
  return { onCooldown: false };
}

function setPendingFile(userId, fileInfo) {
  const s = getSession(userId);
  s.pendingFileInfo = fileInfo;
  s.awaitingPassword = true;
}

function getPendingFile(userId) {
  const s = getSession(userId);
  return s.pendingFileInfo;
}

function clearPending(userId) {
  const s = getSession(userId);
  s.awaitingPassword = false;
  s.pendingFileInfo = null;
}

function isAwaitingPassword(userId) {
  const s = getSession(userId);
  return s.awaitingPassword;
}

function setActiveJob(userId, jobId) {
  const s = getSession(userId);
  s.activeJob = jobId;
}

function getActiveJob(userId) {
  const s = getSession(userId);
  return s.activeJob;
}

function clearActiveJob(userId) {
  const s = getSession(userId);
  s.activeJob = null;
}

module.exports = {
  getSession,
  resetAttempts,
  recordFailedAttempt,
  isOnCooldown,
  setPendingFile,
  getPendingFile,
  clearPending,
  isAwaitingPassword,
  setActiveJob,
  getActiveJob,
  clearActiveJob,
};
