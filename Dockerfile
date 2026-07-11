# --- Stage 1: build the React client -----------------------------------
FROM node:20-alpine AS client-builder
WORKDIR /app/client
COPY client/package.json client/package-lock.json* ./
RUN npm install
COPY client/ ./
RUN npm run build

# --- Stage 2: server runtime ---------------------------------------------
FROM node:20-alpine AS server
# better-sqlite3 compiles a native addon on install; these are only needed
# during npm install and are fine to leave since alpine images stay small.
RUN apk add --no-cache python3 make g++

WORKDIR /app/server
COPY server/package.json server/package-lock.json* ./
RUN npm install --omit=dev
COPY server/ ./

COPY --from=client-builder /app/client/dist /app/client/dist

ENV NODE_ENV=production
ENV PORT=4000
ENV DATA_DIR=/app/data
VOLUME ["/app/data"]

EXPOSE 4000
CMD ["node", "src/index.js"]
