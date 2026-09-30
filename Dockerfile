FROM node:18-alpine

WORKDIR /app

COPY package*.json ./

# Instalamos todo lo necesario
RUN npm install && npm install helmet compression express-rate-limit sharp

# --- CACHE BUSTING ---
ENV CACHE_BUST=1.1

COPY . .

# --- LA CURA MEJORADA (PROXY) ---
RUN sed -i 's/const app = express.*/const app = express(); app.set("trust proxy", 1);/' server/index.js

# Puerto 3000
EXPOSE 3000

# --- EL AUTO-ARREGLO DE PERMISOS ---
# 1. mkdir -p: Crea las carpetas de uploads y data si no existen.
# 2. chmod -R 777: Permisos de lectura/escritura requeridos por Docker volumes.
# 3. node ...: Arranca el servidor con 384MB de heap para evitar OOM durante reportes Excel y optimización de imágenes.
CMD ["sh", "-c", "mkdir -p /app/server/uploads /app/server/data && chmod -R 777 /app/server/uploads /app/server/data && node --max-old-space-size=384 server/index.js"]
