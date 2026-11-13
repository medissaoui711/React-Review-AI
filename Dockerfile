FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PORT=3000 \
    MCP_HTTP_HOST=0.0.0.0 \
    REACT_REVIEW_ROOT=/app/demo-project

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
    && npm cache clean --force

COPY server ./server
COPY demo-project ./demo-project

RUN chown -R node:node /app
USER node

EXPOSE 3000

HEALTHCHECK --interval=5s --timeout=2s --start-period=30s --retries=12 \
  CMD node -e "fetch('http://127.0.0.1:3000/readyz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server/http.mjs"]
