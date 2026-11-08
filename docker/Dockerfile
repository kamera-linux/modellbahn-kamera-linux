# ---------- build stage ----------
FROM node:20-trixie AS build
WORKDIR /app

# Dependencies first (cached as long as the lockfiles don't change)
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN npm --prefix frontend ci --no-audit --no-fund

COPY tsconfig.json tsconfig.backend.json ./
COPY src ./src
COPY frontend ./frontend
RUN npm run build

# ---------- runtime stage ----------
FROM node:20-trixie-slim
ENV NODE_ENV=production
WORKDIR /app

# ffmpeg: microphone capture (PulseAudio/PipeWire or ALSA) and muxing audio into the videos
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
# Scripts for the camera cars – synced to every Pi automatically (ScriptSync)
COPY scripts/camera_common.py scripts/camera-capture.py scripts/camera-record.py \
     scripts/camera-selfcheck.py scripts/setup-rpi-zero.sh scripts/test-camera.sh ./scripts/

# Runs as the unprivileged "node" user (uid 1000). config/ and data/ are bind mounts
# and must be writable for that uid (see APP_UID in docker-compose.yml).
RUN mkdir -p /app/config /app/data && chown node:node /app/config /app/data
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/backend/index.js"]
