# ==========================================
# Stage 1: Compilar Frontend Vue + Precompresión (.br / .gz)
# ==========================================
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci || npm install
COPY frontend/ ./
RUN npm run build

# ==========================================
# Stage 2: Imagen Ligera de Producción
# ==========================================
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

# Copiar únicamente el código necesario del servidor y el frontend compilado
COPY server/ ./server/
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

RUN mkdir -p /app/server/uploads /app/server/data && chmod 750 /app/server/uploads /app/server/data

# Variables de entorno optimizadas para contenedor de 256MB en VPS
ENV NODE_ENV=production
ENV PORT=3000
ENV UV_THREADPOOL_SIZE=2
ENV NODE_OPTIONS="--max-old-space-size=160"

EXPOSE 3000

CMD ["sh", "-c", "mkdir -p /app/server/uploads /app/server/data && exec node server/index.js"]
