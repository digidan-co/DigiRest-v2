#!/bin/bash

# --- CONFIGURACIÓN ---
PROJECT_NAME=$1

if [ -z "$PROJECT_NAME" ]; then
    echo "❌ Error: Debes especificar el nombre del proyecto como argumento."
    echo "Uso: ./setup-vps.sh nombre-del-proyecto"
    exit 1
fi

BASE_DIR="/etc/dokploy/mounts/$PROJECT_NAME"

echo "🛠️ Configurando directorios para: $PROJECT_NAME"
echo "📂 Ruta base: $BASE_DIR"

# 1. Crear directorios
mkdir -p "$BASE_DIR/data"
mkdir -p "$BASE_DIR/uploads"

# 2. Asignar permisos (777 para evitar problemas de Docker)
chmod -R 777 "$BASE_DIR/data"
chmod -R 777 "$BASE_DIR/uploads"

echo "✅ Directorios creados y permisos asignados."
echo ""
echo "👉 Ahora en Dokploy configura los volúmenes así:"
echo "---------------------------------------------------"
echo "1. DATOS (Directory Mount - MÁS SEGURO):"
echo "   Host Path:  $BASE_DIR/data/"
echo "   Mount Path: /app/server/data/"
echo "   Type:       Bind Mount (Directory)"
echo ""
echo "2. UPLOADS (Directory Mount):"
echo "   Host Path:  $BASE_DIR/uploads/"
echo "   Mount Path: /app/server/uploads/"
echo "   Type:       Bind Mount (Directory)"
echo "---------------------------------------------------"
