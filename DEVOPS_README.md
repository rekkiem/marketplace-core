# ⚙️ CONFIGURACIÓN DEVOPS - MARKETPLACE HÍBRIDO

## 📦 ARCHIVOS DE CONFIGURACIÓN INCLUIDOS

### Docker & Containers
- ✅ `docker-compose.yml` - Orquestación completa (DB, Redis, Backend, Nginx)
- ✅ `Dockerfile` - Multi-stage build (dev/production)
- ✅ `.dockerignore` - Optimización de build
- ✅ `docker/postgres/init.sql` - Inicialización de base de datos
- ✅ `docker/nginx/nginx.conf` - Reverse proxy con SSL y caching

### Variables de Entorno
- ✅ `.env.example` - Plantilla completa con 100+ variables
  - Database configuration
  - Redis configuration
  - Payment providers (Webpay, Stripe, MercadoPago)
  - Google Maps API
  - GPS tracking
  - Email/SMTP
  - AWS S3
  - Monitoring (Sentry, Datadog)
  - Feature flags
  - Business logic config

### PM2 & Process Management
- ✅ `ecosystem.config.js` - Configuración completa de PM2
  - Cluster mode
  - Auto-restart
  - Log rotation
  - Health monitoring
  - Deploy workflows
  - Cron workers
  - Queue workers

### Package Scripts
- ✅ `package.json` - 50+ scripts útiles
  - Development: `npm run dev`, `npm run dev:turbo`
  - Production: `npm run build`, `npm start`
  - Database: `db:migrate`, `db:seed`, `db:backup`
  - Testing: `test`, `test:watch`, `test:coverage`
  - Docker: `docker:up`, `docker:down`, `docker:rebuild`
  - PM2: `pm2-start`, `pm2-logs`, `pm2-monit`
  - Quality: `lint`, `type-check`, `format`

### CI/CD
- ✅ `.github/workflows/ci-cd.yml` - GitHub Actions pipeline
  - Lint & Type checking
  - Unit tests con coverage
  - Build verification
  - Auto-deploy a staging/production

### Utilidades
- ✅ `scripts/health-check.js` - Verificación de sistema
- ✅ `scripts/backup-db.js` - Backup automático de PostgreSQL
- ✅ `Makefile` - Comandos rápidos (`make dev`, `make test`)

### API Routes
- ✅ `src/app/api/health/route.ts` - Health check endpoint
  - Database status
  - Redis status
  - System uptime

### Documentación
- ✅ `DEPLOYMENT_GUIDE.md` - **Guía paso a paso COMPLETA**
  - Despliegue local con Docker
  - Despliegue en desarrollo (sin Docker)
  - Despliegue en producción con PM2
  - Despliegue en Seenode
  - Configuración de servicios externos
  - Troubleshooting detallado

---

## 🚀 QUICK START

### Opción 1: Docker (Recomendado)

```bash
# 1. Configurar environment
cp .env.example .env
nano .env  # Editar valores

# 2. Levantar todo
docker-compose up -d

# 3. Ejecutar migraciones
docker-compose exec backend npm run db:migrate:deploy

# 4. Verificar
curl http://localhost:3000/api/health
```

### Opción 2: Local (sin Docker)

```bash
# 1. Instalar dependencias
npm install

# 2. Configurar environment
cp .env.example .env
nano .env

# 3. Setup database
npm run db:migrate
npm run db:seed

# 4. Iniciar desarrollo
npm run dev
```

### Opción 3: Producción con PM2

```bash
# 1. Build
npm run build

# 2. Ejecutar migraciones
npm run db:migrate:deploy

# 3. Iniciar con PM2
pm2 start ecosystem.config.js --env production

# 4. Guardar configuración
pm2 save
pm2 startup
```

### Opción 4: Makefile (shortcuts)

```bash
make install      # Instalar dependencias
make dev          # Modo desarrollo
make build        # Compilar
make docker-up    # Levantar con Docker
make pm2-start    # Iniciar con PM2
make test         # Ejecutar tests
make health       # Health check
make help         # Ver todos los comandos
```

---

## 📋 CHECKLIST DE DEPLOYMENT

### Pre-Deployment

- [ ] Configurar todas las variables en `.env`
- [ ] Obtener credenciales de:
  - [ ] Webpay/Transbank
  - [ ] Google Maps API
  - [ ] SMTP/Email provider
  - [ ] AWS S3 (para fotos)
- [ ] Configurar base de datos PostgreSQL
- [ ] Configurar Redis
- [ ] Obtener certificado SSL (Let's Encrypt)

### Durante Deployment

- [ ] `git pull` (si usando Git)
- [ ] `npm ci` (instalar dependencias)
- [ ] `npm run build` (compilar)
- [ ] `npm run db:migrate:deploy` (migraciones)
- [ ] `pm2 start ecosystem.config.js` (iniciar)
- [ ] Configurar Nginx reverse proxy
- [ ] Configurar SSL en Nginx

### Post-Deployment

- [ ] Verificar health check: `curl https://dominio.com/api/health`
- [ ] Verificar logs: `pm2 logs marketplace`
- [ ] Configurar monitoreo (Sentry, Uptime)
- [ ] Configurar backups automáticos
- [ ] Probar flujo completo de checkout

---

## 🔧 COMANDOS ÚTILES

### Docker

```bash
# Logs en tiempo real
docker-compose logs -f

# Reiniciar un servicio
docker-compose restart backend

# Ejecutar comando en contenedor
docker-compose exec backend npm run db:studio

# Limpiar todo (CUIDADO)
docker-compose down -v
```

### PM2

```bash
# Ver status
pm2 status

# Ver logs
pm2 logs marketplace --lines 100

# Monitoring
pm2 monit

# Reiniciar
pm2 restart marketplace

# Recargar (sin downtime)
pm2 reload marketplace

# Detener
pm2 stop marketplace
```

### Database

```bash
# Backup manual
npm run db:backup

# Ejecutar migraciones
npm run db:migrate

# Abrir Prisma Studio
npm run db:studio

# Seed de datos
npm run db:seed
```

### Health & Monitoring

```bash
# Health check completo
npm run health
# o
node scripts/health-check.js

# Ver logs
tail -f logs/*.log

# PM2 status
pm2 status
```

---

## 🌍 AMBIENTES SOPORTADOS

### Development
- Docker Compose
- Local (npm run dev)
- Debug mode disponible

### Staging
- PM2 en modo staging
- Deploy automático con GitHub Actions
- Base de datos separada

### Production
- PM2 cluster mode
- Nginx reverse proxy
- SSL/HTTPS
- Log rotation
- Auto-restart
- Health monitoring

---

## 📊 MONITOREO

### Logs

Ubicación de logs:
- PM2: `logs/pm2-*.log`
- Aplicación: `logs/*.log`
- Nginx: `/var/log/nginx/`
- PostgreSQL: `/var/log/postgresql/`

### Métricas

Ver en tiempo real:
```bash
pm2 monit
```

### Health Checks

- **API**: `GET /api/health`
- **Database**: `GET /api/health/db`
- **Redis**: `GET /api/health/redis`

---

## 🔒 SEGURIDAD

### Variables Sensibles

**NUNCA** commitear al repositorio:
- `.env` (solo `.env.example`)
- Certificados SSL
- API keys privadas
- Passwords

### Generación de Secrets

```bash
# JWT Secret (min 32 caracteres)
openssl rand -base64 32

# Session Secret
openssl rand -hex 32

# Password seguro
openssl rand -base64 24
```

### SSL/HTTPS

```bash
# Obtener certificado Let's Encrypt
sudo certbot --nginx -d dominio.com -d www.dominio.com

# Renovar automáticamente
sudo certbot renew --dry-run
```

---

## 🆘 SOPORTE

### Troubleshooting

Ver `DEPLOYMENT_GUIDE.md` sección "Troubleshooting" para soluciones detalladas a problemas comunes:
- Errores de conexión a DB
- Redis connection failed
- PM2 app crashed
- Puerto en uso
- Migraciones que fallan
- Build sin memoria
- SSL no funciona

### Logs de Debug

```bash
# Logs de PM2
pm2 logs marketplace --err --lines 200

# Logs de Docker
docker-compose logs backend --tail 200

# Logs del sistema
journalctl -u marketplace -n 100
```

---

## 📚 DOCUMENTACIÓN ADICIONAL

- `DEPLOYMENT_GUIDE.md` - Guía paso a paso completa
- `HYBRID_ARCHITECTURE.md` - Arquitectura del sistema
- `HYBRID_MARKETPLACE.md` - Funcionalidades y casos de uso
- `EXECUTIVE_SUMMARY.md` - Resumen ejecutivo del proyecto

---

## ✅ ARCHIVOS VERIFICADOS

Total de archivos de configuración: **15+**
Total de scripts: **50+**
Total de documentación: **2,500+ líneas**

**TODO listo para despliegue en producción! 🚀**
