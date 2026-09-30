# Guía de Despliegue POS (Docker & VPS)

Esta guía explica cómo desplegar el sistema POS refactorizado (Node.js + SQLite) en un servidor VPS usando Docker.

## Prerrequisitos en el VPS
- Ubuntu 20.04/22.04 LTS (o similar)
- Docker instalado ([Guía Oficial](https://docs.docker.com/engine/install/ubuntu/))
- Git instalado

## Estructura del Proyecto
El proyecto ahora corre en un entorno contenerizado (Docker):
- `docker-compose.yml`: Orquesta el servicio (Backend API + Frontend estático).
- `Dockerfile`: Define la imagen del servidor Node.js.
- `deploy.sh`: Script para automatizar actualizaciones.
- `server/pos.db`: Base de datos SQLite (persistida en volumen).
- `server/uploads/`: Imágenes (persistidas en volumen).

## Pasos de Instalación Inicial

1. **Clonar el Repositorio**
   ```bash
   git clone <URL_DEL_REPO> pos-app
   cd pos-app
   ```

2. **Configurar Variables de Entorno**
   Copia el archivo de ejemplo y edítalo:
   ```bash
   cp .env.example .env
   nano .env
   ```
   Asegúrate de definir:
   - `PORT=3000`
   - `JWT_SECRET=tu_secreto_seguro`
   - `ADMIN_PASSWORD=tu_password_admin`

3. **Iniciar el Sistema**
   Ejecuta el script de despliegue:
   ```bash
   chmod +x deploy.sh
   ./deploy.sh
   ```
   
   O manualmente:
   ```bash
   docker compose up -d --build
   ```

   El sistema estará disponible en `http://TU_IP_VPS:3000`.

## Actualizaciones Posteriores

Para actualizar el sistema con los últimos cambios del repositorio, simplemente corre:
```bash
./deploy.sh
```

Este script hace automáticamente: `git pull`, reconstruye la imagen si es necesario, y reinicia el contenedor.

## Backup (Copia de Seguridad)
Para hacer backup, simplemente copia estos archivos/carpetas del servidor a un lugar seguro:
- `server/pos.db` (Toda la data)
- `server/uploads` (Todas las imágenes)
- `.env` (Configuración)

## Solución de Problemas
- **Ver Logs:** `docker logs -f pos-app`
- **Reiniciar:** `docker compose restart`
- **Reconstruir forzado:** `docker compose up -d --build --force-recreate`

## Despliegue Multi-Instancia (Usuario Maestro)

Para desplegar múltiples restaurantes sin configurar una base de datos para cada uno manualmente, puedes usar la **Master Key**.

Esta llave permite iniciar sesión como administrador en cualquier instancia, incluso si la base de datos está vacía.

1.  Define la variable `MASTER_KEY` en tu `.env` o en tu comando Docker:
    ```bash
    MASTER_KEY=SuperClaveSecreta123
    ```

2.  Inicia el contenedor.

3.  Ingresa al sistema:
    -   **Usuario**: `master` (o cualquier usuario)
    -   **Contraseña**: `SuperClaveSecreta123`

Esto te dará acceso administrativo inmediato para crear los usuarios reales del restaurante.
