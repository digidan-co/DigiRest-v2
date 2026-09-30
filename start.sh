#!/bin/bash
# Script rápido para iniciar el servidor POS

echo "🚀 Iniciando servidor POS..."
echo ""

# Verificar que existe .env
if [ ! -f .env ]; then
    echo "❌ Error: Archivo .env no encontrado"
    echo "📝 Copiando desde .env.example..."
    cp .env.example .env
    echo "⚠️  Por favor configura el archivo .env antes de continuar"
    exit 1
fi

# Verificar node_modules
if [ ! -d "node_modules" ]; then
    echo "📦 Instalando dependencias principales..."
    npm install
fi

if [ ! -d "server/node_modules" ]; then
    echo "📦 Instalando dependencias del servidor..."
    cd server && npm install && cd ..
fi

echo "✅ Dependencias verificadas"
echo ""
echo "🌐 Servidor disponible en: http://localhost:3000"
echo ""
echo "📝 Presiona Ctrl+C para detener el servidor"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Iniciar servidor
npm run dev
