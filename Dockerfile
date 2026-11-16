FROM node:24-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev
copy . .

FROM node:24-slim AS production
WORKDIR /app
COPY --from=build /app ./
EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "src/server.js"]

