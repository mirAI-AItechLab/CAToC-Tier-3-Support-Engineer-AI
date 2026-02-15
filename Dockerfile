FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# スタンドアロンモードでも .env 系ファイルを読み込めるようにコピーしておく
COPY --from=builder /app/.env* ./

EXPOSE 3000
ENV PORT 3000
CMD ["node", "server.js"]