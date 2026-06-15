'use strict';

const winston = require('winston');
require('winston-daily-rotate-file');
const path = require('path');
const fs = require('fs-extra');

const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, '..', 'logs');
fs.ensureDirSync(LOG_DIR);

const logLevel = process.env.LOG_LEVEL || 'info';

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack }) => {
    const base = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    return stack ? `${base}\n${stack}` : base;
  })
);

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message }) => {
    return `[${timestamp}] ${level}: ${message}`;
  })
);

const transports = [
  new winston.transports.Console({
    format: consoleFormat,
    level: logLevel,
  }),
  new winston.transports.DailyRotateFile({
    dirname: LOG_DIR,
    filename: 'bot-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '14d',
    format: logFormat,
    level: logLevel,
  }),
  new winston.transports.DailyRotateFile({
    dirname: LOG_DIR,
    filename: 'error-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    maxSize: '10m',
    maxFiles: '30d',
    format: logFormat,
    level: 'error',
  }),
];

const logger = winston.createLogger({
  level: logLevel,
  transports,
  exitOnError: false,
});

module.exports = logger;
