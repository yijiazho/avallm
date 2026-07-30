# Railway deploy image. node:24 is required — the server runs TypeScript
# natively (no build step, no dependencies); only the client needs a build.
FROM node:24-slim

WORKDIR /app

# Client deps first so the layer caches independently of source changes.
COPY client/package.json client/package-lock.json ./client/
RUN npm --prefix client ci

COPY . .

# vite build strips types without checking them, so a type error otherwise ships
# a bundle that only fails in the browser. There is no CI, which makes this the
# last gate before a deploy rather than a redundant one. It runs before the build
# so a broken type fails the image instead of being bundled, and it invokes the
# client's own typescript because the image never installs the root dev tooling.
RUN node client/node_modules/typescript/bin/tsc -p client/tsconfig.json

RUN npm --prefix client run build

ENV NODE_ENV=production
CMD ["node", "server/server.ts"]
