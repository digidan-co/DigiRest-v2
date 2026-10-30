# ============================================================
# DigiRest v2 - Dockerfile Optimizado (Multi-stage + Poda)
# Builds Vue frontend + Express API + SQLite en un contenedor ultra-ligero
# ============================================================

# ---- Stage 1: Compilar Frontend Vue ----
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci || npm install --prefer-offline --no-audit

COPY frontend/ ./
RUN npm run build

# ---- Stage 2: Dependencias de Producción y Poda Profunda ----
FROM node:20-alpine AS deps-builder
WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev --prefer-offline --no-audit && npm cache clean --force && \
    find ./node_modules -type f -name "*.map" -delete && \
    find ./node_modules -type f -name "*.d.ts" -delete && \
    find ./node_modules -type f -name "*.d.mts" -delete && \
    find ./node_modules -type f \( -name "*.md" -o -name "*.markdown" \) -delete && \
    find ./node_modules -type d \( -name "test" -o -name "tests" -o -name "__tests__" -o -name "example" -o -name "examples" \) -exec rm -rf {} + 2>/dev/null || true

# ---- Stage 3: Contenedor de Ejecución Final ----
FROM node:20-alpine AS runner
WORKDIR /app

# Crear directorios de datos y uploads
RUN mkdir -p /app/server/uploads /app/server/data && chmod 750 /app/server/uploads /app/server/data

# Copiar dependencias podadas
COPY --from=deps-builder /app/node_modules ./node_modules
COPY package*.json ./

# Copiar código del backend y frontend compilado
COPY server/ ./server/
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Variables de entorno optimizadas para VPS
ENV NODE_ENV=production
ENV PORT=3000
ENV UV_THREADPOOL_SIZE=2

EXPOSE 3000

# Healthcheck ligero
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:${PORT:-3000}/api/health || exit 1

# Inicio con flags de memoria V8 optimizados
CMD ["node", "--optimize-for-size", "--max-semi-space-size=2", "--max-old-space-size=112", "server/index.js"]
