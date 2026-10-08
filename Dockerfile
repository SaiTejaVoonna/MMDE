# MMDE backend for Railway (or any container host). No runtime dependencies: the server uses only Node built-ins
# and runs TypeScript directly (type stripping), which needs Node >= 22.18, hence the pinned major.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY . .
# Railway injects PORT; the server reads it. Secrets (TMDB_READ_ACCESS_TOKEN etc.) come from the platform's
# environment variables at runtime, never from the image (.dockerignore excludes .env).
EXPOSE 8787
CMD ["node", "src/server/main.ts"]
