FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile
COPY tsconfig.json ./
COPY src/ ./src/
RUN bunx tsc
RUN mkdir -p dist/web && cp -r src/web/* dist/web/

FROM oven/bun:1-slim
WORKDIR /app
COPY --from=builder /app/dist/ ./dist/
COPY --from=builder /app/node_modules/ ./node_modules/
COPY package.json ./

EXPOSE 4747

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD bun -e "fetch('http://localhost:4747/api/health').then(r=>r.json()).then(d=>{if(d.status!=='ok')process.exit(1)})"

ENV SERVER_HOST=0.0.0.0
ENV SERVER_PORT=4747

CMD ["bun", "run", "dist/server.js"]
