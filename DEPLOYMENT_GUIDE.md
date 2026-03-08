# 🚀 GUÍA COMPLETA DE DESPLIEGUE - MARKETPLACE HÍBRIDO
## Desde Cero en Terminal Limpia

---

## 📋 ÍNDICE

1. [Requisitos Previos](#requisitos-previos)
2. [Despliegue Local con Docker](#despliegue-local-con-docker)
3. [Despliegue en Desarrollo (sin Docker)](#despliegue-en-desarrollo-sin-docker)
4. [Despliegue en Producción con PM2](#despliegue-en-producción-con-pm2)
5. [Despliegue en Seenode](#despliegue-en-seenode)
6. [Configuración de Servicios Externos](#configuración-de-servicios-externos)
7. [Troubleshooting](#troubleshooting)

---

## 🔧 REQUISITOS PREVIOS

### Software Necesario

```bash
# Node.js 18+ y npm
node --version  # v18.0.0 o superior
npm --version   # v9.0.0 o superior

# Git
git --version

# Docker y Docker Compose (opcional pero recomendado)
docker --version
docker-compose --version

# PostgreSQL 16 (si no usas Docker)
psql --version

# Redis (si no usas Docker)
redis-cli --version

# PM2 para producción
npm install -g pm2
```

### Puertos Requeridos

Asegúrate de que estos puertos estén disponibles:
- `3000` - Aplicación Next.js
- `5432` - PostgreSQL
- `6379` - Redis
- `5050` - PgAdmin (opcional, desarrollo)
- `8081` - Redis Commander (opcional, desarrollo)

---

## 🐳 DESPLIEGUE LOCAL CON DOCKER

### Paso 1: Clonar/Descomprimir el Proyecto

```bash
# Si tienes el tar.gz
tar -xzf marketplace-hybrid-FINAL.tar.gz
cd marketplace-core

# O si lo clonaste de Git
git clone <tu-repo>
cd marketplace-core
```

### Paso 2: Configurar Variables de Entorno

```bash
# Copiar archivo de ejemplo
cp .env.example .env

# Editar con tus valores
nano .env  # o vim .env o code .env
```

**Configuración mínima requerida:**

```bash
# .env
DATABASE_URL="postgresql://marketplace_user:tu_password_seguro@localhost:5432/marketplace?schema=public"
REDIS_URL="redis://:redis_password@localhost:6379"
JWT_SECRET="genera-un-secret-de-minimo-32-caracteres-aqui"
```

### Paso 3: Levantar con Docker Compose

```bash
# Construir imágenes
docker-compose build

# Levantar servicios
docker-compose up -d

# Ver logs
docker-compose logs -f

# Verificar estado
docker-compose ps
```

**Salida esperada:**

```
NAME                    COMMAND                  SERVICE             STATUS
marketplace-backend     "docker-entrypoint.s…"   backend             Up
marketplace-db          "docker-entrypoint.s…"   db                  Up (healthy)
marketplace-redis       "docker-entrypoint.s…"   redis               Up (healthy)
```

### Paso 4: Ejecutar Migraciones

```bash
# Entrar al contenedor del backend
docker-compose exec backend sh

# Ejecutar migraciones
npm run db:migrate:deploy

# Generar Prisma Client
npm run db:generate

# (Opcional) Seed de datos de prueba
npm run db:seed

# Salir del contenedor
exit
```

### Paso 5: Verificar Funcionamiento

```bash
# Health check
curl http://localhost:3000/api/health

# Deberías ver:
# {"status":"ok","timestamp":"2024-03-08T..."}

# Abrir en navegador
open http://localhost:3000
```

### Comandos Útiles de Docker

```bash
# Ver logs en tiempo real
docker-compose logs -f backend

# Reiniciar un servicio
docker-compose restart backend

# Detener todo
docker-compose down

# Detener y eliminar volúmenes (CUIDADO: borra la DB)
docker-compose down -v

# Rebuild completo
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

---

## 💻 DESPLIEGUE EN DESARROLLO (sin Docker)

### Paso 1: Instalar PostgreSQL y Redis

**En macOS:**

```bash
brew install postgresql@16 redis
brew services start postgresql@16
brew services start redis
```

**En Ubuntu/Debian:**

```bash
# PostgreSQL
sudo apt update
sudo apt install postgresql-16 postgresql-contrib

# Redis
sudo apt install redis-server

# Iniciar servicios
sudo systemctl start postgresql
sudo systemctl start redis-server
```

**En Windows:**

- Descargar PostgreSQL de https://www.postgresql.org/download/windows/
- Descargar Redis de https://github.com/microsoftarchive/redis/releases

### Paso 2: Crear Base de Datos

```bash
# Conectar a PostgreSQL
psql -U postgres

# Crear usuario y base de datos
CREATE USER marketplace_user WITH PASSWORD 'tu_password';
CREATE DATABASE marketplace OWNER marketplace_user;
GRANT ALL PRIVILEGES ON DATABASE marketplace TO marketplace_user;

# Salir
\q
```

### Paso 3: Configurar Redis

```bash
# Editar configuración (opcional)
# En Linux: sudo nano /etc/redis/redis.conf
# En macOS: /usr/local/etc/redis.conf

# Establecer password
# requirepass tu_redis_password

# Reiniciar Redis
sudo systemctl restart redis-server  # Linux
brew services restart redis           # macOS
```

### Paso 4: Instalar Dependencias del Proyecto

```bash
cd marketplace-core

# Instalar dependencias
npm install

# O con npm ci (más rápido en CI/CD)
npm ci
```

### Paso 5: Configurar Variables de Entorno

```bash
cp .env.example .env

# Editar .env con tus valores locales
nano .env
```

**Ejemplo de .env para desarrollo local:**

```bash
NODE_ENV=development
DATABASE_URL="postgresql://marketplace_user:tu_password@localhost:5432/marketplace?schema=public"
REDIS_URL="redis://:tu_redis_password@localhost:6379"
JWT_SECRET="dev-secret-key-change-in-production-min-32-chars"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
LOG_LEVEL=debug
```

### Paso 6: Ejecutar Migraciones y Seed

```bash
# Generar Prisma Client
npm run db:generate

# Ejecutar migraciones
npm run db:migrate

# Seed de datos de prueba
npm run db:seed
```

### Paso 7: Iniciar Servidor de Desarrollo

```bash
# Modo normal
npm run dev

# Modo Turbo (más rápido)
npm run dev:turbo

# Con debug
npm run dev:debug
```

**Salida esperada:**

```
  ▲ Next.js 14.x.x
  - Local:        http://localhost:3000
  - Network:      http://192.168.1.x:3000

 ✓ Ready in 2.3s
```

### Paso 8: Abrir Herramientas de Desarrollo (Opcional)

```bash
# Terminal 1: Prisma Studio
npm run db:studio
# Abre en http://localhost:5555

# Terminal 2: Redis Commander (instalar primero)
npm install -g redis-commander
redis-commander --redis-password tu_redis_password
# Abre en http://localhost:8081
```

---

## 🏭 DESPLIEGUE EN PRODUCCIÓN CON PM2

### Paso 1: Preparar Servidor

**Servidor Ubuntu 22.04 LTS recomendado**

```bash
# Actualizar sistema
sudo apt update && sudo apt upgrade -y

# Instalar Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Instalar build tools
sudo apt install -y build-essential git curl wget

# Instalar PM2
sudo npm install -g pm2

# Instalar PostgreSQL 16
sudo apt install postgresql-16 postgresql-contrib

# Instalar Redis
sudo apt install redis-server

# Instalar Nginx (opcional pero recomendado)
sudo apt install nginx
```

### Paso 2: Configurar Firewall

```bash
# Permitir SSH, HTTP, HTTPS
sudo ufw allow 22
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable
```

### Paso 3: Crear Usuario de Deploy

```bash
# Crear usuario
sudo adduser deploy

# Agregar a sudoers (opcional)
sudo usermod -aG sudo deploy

# Cambiar a usuario deploy
su - deploy
```

### Paso 4: Clonar Proyecto

```bash
# Crear directorio
mkdir -p /var/www
cd /var/www

# Clonar o copiar proyecto
git clone <tu-repo> marketplace
cd marketplace

# O subir con rsync/scp
# rsync -avz marketplace-core/ deploy@servidor:/var/www/marketplace/
```

### Paso 5: Configurar Base de Datos

```bash
# Crear usuario y base de datos
sudo -u postgres psql

CREATE USER marketplace_prod WITH PASSWORD 'password_super_seguro';
CREATE DATABASE marketplace_prod OWNER marketplace_prod;
GRANT ALL PRIVILEGES ON DATABASE marketplace_prod TO marketplace_prod;
\q
```

### Paso 6: Configurar Variables de Entorno de Producción

```bash
cd /var/www/marketplace

# Copiar .env.example
cp .env.example .env

# Editar con valores de producción
nano .env
```

**Variables críticas para producción:**

```bash
NODE_ENV=production
DATABASE_URL="postgresql://marketplace_prod:password_super_seguro@localhost:5432/marketplace_prod?schema=public"
REDIS_URL="redis://:redis_prod_password@localhost:6379"
JWT_SECRET="$(openssl rand -base64 32)"
NEXT_PUBLIC_APP_URL="https://tu-dominio.com"

# Webpay Producción
WEBPAY_ENVIRONMENT=production
WEBPAY_COMMERCE_CODE="tu_codigo_comercio"
WEBPAY_API_KEY="tu_api_key_produccion"

# Otros servicios
GOOGLE_MAPS_API_KEY="tu_google_maps_key"
SMTP_HOST="smtp.gmail.com"
SMTP_USER="tu_email@gmail.com"
SMTP_PASSWORD="tu_app_password"
```

### Paso 7: Instalar y Compilar

```bash
# Instalar dependencias de producción
npm ci --only=production

# Compilar Next.js
npm run build

# Ejecutar migraciones
npm run db:migrate:deploy
```

### Paso 8: Configurar PM2

```bash
# Iniciar con PM2
pm2 start ecosystem.config.js --env production

# Guardar configuración para auto-inicio
pm2 save

# Configurar startup (auto-inicio en reboot)
pm2 startup
# Ejecutar el comando que PM2 te muestra

# Verificar estado
pm2 status
pm2 logs marketplace

# Monitoreo en tiempo real
pm2 monit
```

**Salida esperada de `pm2 status`:**

```
┌─────┬──────────────┬─────────┬─────────┬─────────┬──────────┐
│ id  │ name         │ mode    │ status  │ cpu     │ memory   │
├─────┼──────────────┼─────────┼─────────┼─────────┼──────────┤
│ 0   │ marketplace  │ cluster │ online  │ 0%      │ 145.2mb  │
│ 1   │ marketplace  │ cluster │ online  │ 0%      │ 142.8mb  │
│ 2   │ marketplace  │ cluster │ online  │ 0%      │ 148.5mb  │
│ 3   │ marketplace  │ cluster │ online  │ 0%      │ 141.2mb  │
└─────┴──────────────┴─────────┴─────────┴─────────┴──────────┘
```

### Paso 9: Configurar Nginx como Reverse Proxy

```bash
# Crear configuración
sudo nano /etc/nginx/sites-available/marketplace
```

**Contenido:**

```nginx
server {
    listen 80;
    server_name tu-dominio.com www.tu-dominio.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
# Habilitar sitio
sudo ln -s /etc/nginx/sites-available/marketplace /etc/nginx/sites-enabled/

# Probar configuración
sudo nginx -t

# Recargar Nginx
sudo systemctl reload nginx
```

### Paso 10: Configurar SSL con Let's Encrypt

```bash
# Instalar Certbot
sudo apt install certbot python3-certbot-nginx

# Obtener certificado
sudo certbot --nginx -d tu-dominio.com -d www.tu-dominio.com

# Renovación automática (ya configurado)
sudo certbot renew --dry-run
```

### Paso 11: Configurar Logs y Monitoreo

```bash
# Crear directorio de logs
mkdir -p /var/www/marketplace/logs

# Rotar logs de PM2
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 100M
pm2 set pm2-logrotate:retain 30

# Ver logs
pm2 logs marketplace --lines 100
```

---

## 🌐 DESPLIEGUE EN SEENODE

### Paso 1: Crear Proyecto en Seenode

1. Accede a tu panel de Seenode
2. Crear nuevo proyecto Node.js
3. Seleccionar Node.js 20.x
4. Configurar recursos (mín: 2 GB RAM, 2 CPU cores)

### Paso 2: Conectar Repositorio

```bash
# En tu máquina local
git init
git add .
git commit -m "Initial commit"
git remote add origin <seenode-git-url>
git push -u origin main
```

### Paso 3: Configurar Variables de Entorno en Seenode

En el panel de Seenode, agregar todas las variables de `.env`:

```
NODE_ENV=production
DATABASE_URL=<proporcionado por Seenode>
REDIS_URL=<proporcionado por Seenode>
JWT_SECRET=<generar uno seguro>
NEXT_PUBLIC_APP_URL=https://tu-app.seenode.app
...
```

### Paso 4: Configurar Build en Seenode

**Build Command:**
```bash
npm ci && npm run build && npx prisma generate && npx prisma migrate deploy
```

**Start Command:**
```bash
npm start
```

**Port:** `3000`

### Paso 5: Deploy

```bash
# Push para deploy automático
git push origin main

# O usar el botón "Deploy" en el panel de Seenode
```

### Paso 6: Configurar Base de Datos

Si Seenode no proporciona PostgreSQL:

1. Usar PostgreSQL managed (DigitalOcean, AWS RDS, etc.)
2. Actualizar `DATABASE_URL` en variables de entorno
3. Ejecutar migraciones manualmente:

```bash
# Conectar por SSH a Seenode
seenode ssh

# Ejecutar migraciones
npm run db:migrate:deploy
```

---

## 🔧 CONFIGURACIÓN DE SERVICIOS EXTERNOS

### Webpay (Transbank - Chile)

1. Registro en https://www.transbank.cl/
2. Obtener credenciales de ambiente de integración
3. Para producción: certificación requerida

```bash
# .env
WEBPAY_COMMERCE_CODE="597055555532"  # Ejemplo integración
WEBPAY_API_KEY="579B532A7440BB0C9079DED94D31EA1615BACEB56610332264630D42D0A36B1C"
WEBPAY_ENVIRONMENT="integration"  # o "production"
```

### Google Maps API

1. Ir a https://console.cloud.google.com/
2. Crear proyecto
3. Habilitar APIs:
   - Maps JavaScript API
   - Geocoding API
   - Places API
4. Crear API Key

```bash
# .env
GOOGLE_MAPS_API_KEY="AIza..."
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY="AIza..."
```

### AWS S3 (para fotos de inspección)

```bash
# Instalar AWS CLI
sudo apt install awscli

# Configurar credenciales
aws configure

# .env
AWS_REGION="us-east-1"
AWS_ACCESS_KEY_ID="AKIA..."
AWS_SECRET_ACCESS_KEY="..."
S3_BUCKET_NAME="marketplace-inspections"
```

### SMTP (Gmail)

1. Activar verificación en 2 pasos en Gmail
2. Generar App Password en https://myaccount.google.com/apppasswords

```bash
# .env
SMTP_HOST="smtp.gmail.com"
SMTP_PORT="587"
SMTP_USER="tu_email@gmail.com"
SMTP_PASSWORD="app_password_generado"
```

---

## 🔍 TROUBLESHOOTING

### Error: "Cannot connect to database"

```bash
# Verificar que PostgreSQL esté corriendo
sudo systemctl status postgresql

# Verificar conexión
psql -U marketplace_user -d marketplace -h localhost

# Ver logs
sudo journalctl -u postgresql -n 50
```

### Error: "Redis connection failed"

```bash
# Verificar que Redis esté corriendo
sudo systemctl status redis-server

# Probar conexión
redis-cli -a tu_password ping
# Debe responder: PONG

# Ver logs
sudo journalctl -u redis-server -n 50
```

### Error: "PM2 app crashed"

```bash
# Ver logs de error
pm2 logs marketplace --err --lines 100

# Reiniciar
pm2 restart marketplace

# Si persiste, rebuild
cd /var/www/marketplace
git pull
npm install
npm run build
pm2 restart marketplace
```

### Puerto 3000 ya en uso

```bash
# Encontrar proceso
sudo lsof -i :3000

# Matar proceso
kill -9 <PID>

# O cambiar puerto en .env
APP_PORT=3001
```

### Migraciones de Prisma fallan

```bash
# Reset completo (CUIDADO: borra datos)
npm run db:migrate:reset

# O manual
psql -U marketplace_user -d marketplace
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO marketplace_user;
\q

npm run db:migrate:deploy
```

### Build de Next.js falla por memoria

```bash
# Aumentar memoria de Node.js
NODE_OPTIONS="--max-old-space-size=4096" npm run build

# O en production
export NODE_OPTIONS="--max-old-space-size=4096"
npm run build
```

### SSL/HTTPS no funciona

```bash
# Verificar certificado
sudo certbot certificates

# Renovar manualmente
sudo certbot renew

# Verificar Nginx
sudo nginx -t
sudo systemctl status nginx
```

---

## 📊 VERIFICACIÓN POST-DEPLOY

### Checklist de Verificación

```bash
# 1. Health check
curl https://tu-dominio.com/api/health

# 2. Database connection
curl https://tu-dominio.com/api/health/db

# 3. Redis connection
curl https://tu-dominio.com/api/health/redis

# 4. PM2 status
pm2 status

# 5. Nginx status
sudo systemctl status nginx

# 6. SSL certificate
curl -I https://tu-dominio.com | grep "HTTP"
# Debe mostrar: HTTP/2 200

# 7. Logs sin errores
pm2 logs marketplace --lines 50 --nostream
```

### Monitoreo Continuo

```bash
# PM2 Monit (en tiempo real)
pm2 monit

# Logs en vivo
pm2 logs marketplace -f

# Métricas
pm2 show marketplace
```

---

## 🎉 ¡DEPLOYMENT EXITOSO!

Si llegaste hasta aquí y todos los checks pasaron, **¡felicidades!** 🚀

Tu marketplace híbrido está corriendo en producción.

### Próximos Pasos

1. ✅ Configurar backups automáticos de base de datos
2. ✅ Configurar monitoreo (Sentry, Datadog)
3. ✅ Implementar CI/CD con GitHub Actions
4. ✅ Configurar alertas de uptime (UptimeRobot, Pingdom)
5. ✅ Optimizar performance (CDN, caching)

### Soporte

Si encuentras problemas:
1. Revisar logs: `pm2 logs marketplace`
2. Consultar documentación técnica en `/docs`
3. Abrir issue en el repositorio

---

**¡Éxito con tu marketplace! 🏗️**
