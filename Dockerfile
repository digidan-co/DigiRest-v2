FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

# Instalamos únicamente las dependencias de Node.js del proyecto
RUN npm install

# --- CACHE BUSTING ---
ENV CACHE_BUST=1.4

COPY . .

# Puerto expuesto
EXPOSE 3000

# Permisos y arranque
CMD ["sh", "-c", "mkdir -p /app/server/uploads /app/server/data && chmod -R 777 /app/server/uploads /app/server/data && node --max-old-space-size=384 server/index.js"]
