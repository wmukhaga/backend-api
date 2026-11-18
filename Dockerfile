FROM node:24-alpine AS build
WORKDIR /app

# Chromium comes from the production stage, so skip Puppeteer's own download
ENV PUPPETEER_SKIP_DOWNLOAD=true

COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

FROM node:24-slim AS production
WORKDIR /app

# Chromium + fonts for PDF generation
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

COPY --from=build /app ./
EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "src/server.js"]