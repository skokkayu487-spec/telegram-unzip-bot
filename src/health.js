'use strict';

/**
 * Health check script for Docker healthcheck.
 * Reads the health file written by the bot and exits 0 if healthy.
 */

const path = require('path');
const fs = require('fs');

const HEALTH_FILE = path.join(
  process.env.DATA_DIR || path.join(__dirname, '..', 'data'),
  'health.json'
);

const MAX_AGE_MS = 60 * 1000; // 1 minute

try {
  if (!fs.existsSync(HEALTH_FILE)) {
    console.error('Health file not found');
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(HEALTH_FILE, 'utf-8'));
  const age = Date.now() - data.timestamp;

  if (age > MAX_AGE_MS) {
    console.error(`Health file too old: ${Math.floor(age / 1000)}s`);
    process.exit(1);
  }

  if (data.status !== 'ok') {
    console.error(`Unhealthy status: ${data.status}`);
    process.exit(1);
  }

  console.log(`Healthy: uptime ${Math.floor(data.uptime)}s`);
  process.exit(0);
} catch (err) {
  console.error(`Health check error: ${err.message}`);
  process.exit(1);
}
