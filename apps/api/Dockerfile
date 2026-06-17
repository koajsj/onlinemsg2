FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
RUN npm ci --omit=dev --workspace apps/api

COPY apps/api apps/api

ENV NODE_ENV=production
CMD ["npm", "--workspace", "apps/api", "run", "start"]
