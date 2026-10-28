# Reddcoin regtest-server: the HTTP API only. The node runs separately from the
# stock reddcoincore/reddcoind image (see docker-compose.yml).

# Native modules (leveldown, zeromq) are compiled here
FROM node:20-bookworm AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:20-bookworm-slim
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY package.json index.js service.js rpc.js bootstrap.js reddcoin.js ./
COPY routes ./routes
COPY scripts ./scripts

RUN mkdir -p /data && echo "satoshi" > /data/KEYS && chown -R node:node /data
USER node

ENV PORT=8080 \
    KEYDB=/data/KEYS \
    INDEXDB=/data/db \
    RPC=http://reddcoind:56443 \
    ZMQ=tcp://reddcoind:28332 \
    RPCCONCURRENT=32

EXPOSE 8080
HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=60 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/1/ready').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

CMD ["node", "index.js"]
