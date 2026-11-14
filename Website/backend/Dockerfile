FROM node:22-alpine

# Build context is Website/ (see docker-compose.yml) so the shared river model is available
WORKDIR /app/backend

COPY backend/package*.json ./
RUN npm install

COPY backend/ .
COPY shared/ /app/shared/

EXPOSE 3000

CMD ["node", "src/server.js"]
