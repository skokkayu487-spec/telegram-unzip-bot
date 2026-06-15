# ─────────────────────────────────────────────
# Stage 1: Builder — install dependencies
# ─────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies needed for native modules
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package.json package-lock.json* ./

# Install production deps only
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# ─────────────────────────────────────────────
# Stage 2: Runtime
# ─────────────────────────────────────────────
FROM node:20-alpine AS runtime

# Install runtime tools
RUN apk add --no-cache \
    # 7-Zip for .7z extraction
    7zip \
    # CA certs for HTTPS
    ca-certificates \
    # Timezone data
    tzdata \
    # Process management
    tini

# Set timezone (optional, change as needed)
ENV TZ=Asia/Jakarta

# Create non-root user for security
RUN addgroup -g 1001 -S botuser && \
    adduser -u 1001 -S botuser -G botuser

WORKDIR /app

# Copy node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy source code
COPY --chown=botuser:botuser src/ ./src/
COPY --chown=botuser:botuser package.json ./

# Create volume mount points with correct ownership
RUN mkdir -p /data/downloads /data/temp /data/logs /data/data /app/assets && \
    chown -R botuser:botuser /data /app/assets

# Create 7za symlink (7zip Alpine package installs as 7za)
RUN ln -sf /usr/bin/7za /usr/local/bin/7za || true

# Ensure 7za is available
RUN 7za --help > /dev/null 2>&1 || echo "Warning: 7za not found"

# Switch to non-root user
USER botuser

# Environment defaults (override via .env or docker-compose)
ENV NODE_ENV=production \
    LOG_LEVEL=info \
    DOWNLOADS_DIR=/data/downloads \
    TEMP_DIR=/data/temp \
    LOG_DIR=/data/logs \
    DATA_DIR=/data/data \
    7Z_BIN=/usr/bin/7za

# Expose health check port (not used, but documents intent)
# EXPOSE 3000

# Use tini as init to handle PID 1 signals properly
ENTRYPOINT ["/sbin/tini", "--"]

# Health check using our health script
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD node /app/src/health.js

CMD ["node", "src/index.js"]
