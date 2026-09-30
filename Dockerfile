FROM node:18-alpine

WORKDIR /app

COPY package*.json ./

# Instalamos todas las dependencias
RUN npm install && npm install helmet compression express-rate-limit sharp axios

# --- CACHE BUSTING ---
ENV CACHE_BUST=1.2

COPY . .

# Puerto expuesto por defecto
EXPOSE 3000

# --- AUTO-ARREGLO DE PERMISOS Y ARRANQUE ---
CMD ["sh", "-c", "mkdir -p /app/server/uploads /app/server/data && chmod -R 777 /app/server/uploads /app/server/data && node --max-old-space-size=384 server/index.js"]
