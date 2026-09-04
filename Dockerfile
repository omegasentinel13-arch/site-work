# ==============================================================================
# SITE WORK — Production Dockerfile
# Node.js 22 LTS | Single Container Deployment for Railway
# ==============================================================================

# --- Stage 1: Dependencies ---
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Install dependencies deterministically based on package-lock.json
COPY package.json package-lock.json ./
RUN npm ci

# --- Stage 2: Builder ---
FROM node:22-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Set build environment: disable Next.js telemetry
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Compile Next.js production build (no DB connection required at build time)
RUN npm run build

# --- Stage 3: Production Runner ---
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME="0.0.0.0"
ENV PORT=3000

# Copy runtime assets and dependencies
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next

# Ensure /app/data mount point directory exists for Railway Volume mount
RUN mkdir -p /app/data

# Note: Railway Persistent Volumes are mounted at runtime with root (UID 0) ownership.
# Running as root inside the isolated container ensures seamless write permissions for
# SQLite database creation, WAL/SHM file generation, and POSIX file locking on /app/data.

EXPOSE 3000

# Next.js production start command (automatically respects PORT and binds 0.0.0.0)
CMD ["npm", "run", "start"]
