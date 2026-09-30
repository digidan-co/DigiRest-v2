FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

# Instalamos únicamente las dependencias de producción de Node.js (cero paquetes del SO, cero compiladores)
RUN npm install --omit=dev

# --- CACHE BUSTING ---
ENV CACHE_BUST=1.5

COPY . .

# Variables de entorno por defecto
ENV NODE_ENV=production
ENV PORT=3000

# Puerto expuesto
EXPOSE 3000

# Permisos y arranque
CMD ["sh", "-c", "mkdir -p /app/server/uploads /app/server/data && chmod -R 777 /app/server/uploads /app/server/data && node --max-old-space-size=384 server/index.js"]
