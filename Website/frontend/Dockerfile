FROM node:22-alpine

# Build context is Website/ (see docker-compose.yml) so the shared river model is available
WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm install

COPY frontend/ .
COPY shared/ /app/shared/

EXPOSE 5173

CMD ["npx", "vite", "--host", "0.0.0.0", "--port", "5173"]
