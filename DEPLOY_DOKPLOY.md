# DigiRest v2 — Guía de Despliegue en Dokploy (VPS)

> **Requisito**: Servidor VPS con Dokploy instalado.
> DigiRest v2 corre como un contenedor Docker ultra-ligero (Node.js 18 + SQLite + Vue 3 compilado).

---

## 1. Configuración de la Aplicación en Dokploy

1. En el panel de Dokploy, ve a tu Proyecto y haz clic en **Create Application**.
2. **Nombre**: `digirest-<nombre-cliente>` (ej: `digirest-sushibar`).
3. **Source**: Selecciona **GitHub**.
   - **Repository**: `digidan-co/DigiRest-v2`
   - **Branch**: `main`
   - **Build Type**: `Dockerfile`
4. **Ports**:
   - Mapea el puerto del contenedor `3000` al puerto expuesto o déjalo administrado por Traefik/Dokploy.

---

## 2. Volúmenes Persistentes (CRÍTICO)

Para que los datos de los pedidos, productos y las imágenes subidas no se borren cuando el contenedor se actualice o reinicie, debes configurar **2 volúmenes persistentes** en la pestaña **Volumes / Mounts** de la aplicación en Dokploy:

| Tipo | Host Path / Volume Name | Mount Path (Dentro del Contenedor) | Propósito |
| :--- | :--- | :--- | :--- |
| **Bind / Named Volume** | `digirest_data` | `/app/server/data` | Base de datos SQLite (`pos.sqlite`) |
| **Bind / Named Volume** | `digirest_uploads` | `/app/server/uploads` | Fotos de platos y comprobantes |

---

## 3. Variables de Entorno en Dokploy

En la pestaña **Environment Variables** de tu aplicación en Dokploy, agrega las siguientes variables:

```bash
# Entorno
NODE_ENV=production
PORT=3000

# Clave secreta para firmar tokens JWT (genera una cadena aleatoria segura)
JWT_SECRET=pon_aqui_una_cadena_larga_y_segura_de_al_menos_32_caracteres

# ── Enlace SaaS Central con panel.digidan.co ──
# URL de tu panel maestro
SAAS_MANAGER_URL=https://panel.digidan.co

# Token / API Key de la instancia generada en panel.digidan.co (Módulo Clientes / SaaS)
SAAS_TENANT_KEY=pon_aqui_el_tenant_secret_key_generado_en_el_panel

# CORS
ALLOWED_ORIGINS=*

# (Opcional) Master Key de rescate si necesitas entrar sin credenciales
MASTER_KEY=
```

---

## 4. Usuario Maestro por Defecto

Al desplegar una nueva instancia con la base de datos limpia del repositorio:
- **Usuario**: `digidanMasterAdmin`
- **Contraseña**: `3264`
- **Rol**: Administrador Maestro (oculto en la lista de usuarios para clientes).
- **Cambio de clave**: Al iniciar sesión con este usuario, haz clic en la foto de perfil / logo del menú lateral para cambiar la contraseña maestra directamente.
