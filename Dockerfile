FROM node:20-slim

WORKDIR /app

# Instalar dependencias del sistema necesarias para sqlite3, openssl y sharp
RUN apt-get update -y && apt-get install -y openssl python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

# Instalamos todas las dependencias
RUN npm install

# --- CACHE BUSTING ---
ENV CACHE_BUST=1.3

COPY . .

# Variables de entorno por defecto
ENV NODE_ENV=production
ENV PORT=3000

# Puerto expuesto por defecto
EXPOSE 3000

# --- AUTO-ARREGLO DE PERMISOS Y ARRANQUE ---
CMD ["sh", "-c", "mkdir -p /app/server/uploads /app/server/data && chmod -R 777 /app/server/uploads /app/server/data && node --max-old-space-size=384 server/index.js"]
