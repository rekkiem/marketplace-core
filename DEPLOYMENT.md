# Guía de Despliegue - Marketplace Core

## Pre-requisitos de Infraestructura

### Servicios Requeridos
- **Base de Datos**: PostgreSQL 14+ 
  - Recomendado: AWS RDS, Google Cloud SQL, o Supabase
  - Mínimo: 2 vCPU, 4GB RAM para producción
  
- **Cache**: Redis 6+
  - Recomendado: AWS ElastiCache, Redis Cloud
  - Mínimo: 1GB RAM
  
- **Hosting**: Plataforma con soporte Next.js
  - Recomendado: Vercel, AWS (ECS/Lambda), Railway
  - Mínimo: 2 vCPU, 2GB RAM

### Servicios Opcionales (Futura Integración)
- CDN para assets (CloudFront, Cloudflare)
- File Storage (S3, Cloudinary)
- Email Service (SendGrid, AWS SES)
- Monitoring (Sentry, Datadog)

## Opción 1: Vercel (Más Simple)

### Paso 1: Setup Base de Datos

```bash
# Crear DB en Supabase o Railway
# Obtener DATABASE_URL

# Ejecutar migraciones
DATABASE_URL="postgresql://..." npx prisma migrate deploy
```

### Paso 2: Setup Redis

```bash
# Opción A: Upstash (Serverless)
# Crear DB en https://upstash.com
# Obtener REDIS_URL

# Opción B: Redis Cloud
# Crear DB en https://redis.com
```

### Paso 3: Deploy a Vercel

```bash
# Instalar Vercel CLI
npm i -g vercel

# Deploy
vercel --prod

# Configurar variables de entorno en Vercel Dashboard:
# - DATABASE_URL
# - REDIS_URL
# - JWT_SECRET
```

### Variables de Entorno en Vercel
```
Settings → Environment Variables

DATABASE_URL = postgresql://...
REDIS_URL = redis://...
JWT_SECRET = [generar secreto seguro]
NODE_ENV = production
```

## Opción 2: AWS (Más Control)

### Arquitectura Recomendada
```
┌─────────────┐
│ CloudFront  │ (CDN)
└──────┬──────┘
       │
┌──────▼──────┐
│   ALB       │ (Load Balancer)
└──────┬──────┘
       │
┌──────▼──────┐
│   ECS       │ (Containers)
│  Fargate    │
└──────┬──────┘
       │
   ┌───▼───┬────────┬─────────┐
   │       │        │         │
┌──▼──┐ ┌─▼──┐  ┌──▼──┐   ┌──▼──┐
│ RDS │ │S3  │  │Redis│   │SES  │
│     │ │    │  │     │   │     │
└─────┘ └────┘  └─────┘   └─────┘
```

### Paso 1: Crear Infraestructura

```bash
# RDS PostgreSQL
aws rds create-db-instance \
  --db-instance-identifier marketplace-db \
  --db-instance-class db.t3.medium \
  --engine postgres \
  --master-username admin \
  --master-user-password [PASSWORD] \
  --allocated-storage 100

# ElastiCache Redis
aws elasticache create-cache-cluster \
  --cache-cluster-id marketplace-redis \
  --cache-node-type cache.t3.micro \
  --engine redis \
  --num-cache-nodes 1
```

### Paso 2: Dockerfile

```dockerfile
FROM node:18-alpine AS base

# Dependencies
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package*.json ./
RUN npm ci

# Builder
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

# Runner
FROM base AS runner
WORKDIR /app
ENV NODE_ENV production
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT 3000

CMD ["node", "server.js"]
```

### Paso 3: ECS Task Definition

```json
{
  "family": "marketplace-core",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "1024",
  "memory": "2048",
  "containerDefinitions": [
    {
      "name": "marketplace-app",
      "image": "[ACCOUNT_ID].dkr.ecr.[REGION].amazonaws.com/marketplace:latest",
      "portMappings": [
        {
          "containerPort": 3000,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {
          "name": "NODE_ENV",
          "value": "production"
        }
      ],
      "secrets": [
        {
          "name": "DATABASE_URL",
          "valueFrom": "arn:aws:ssm:region:account:parameter/marketplace/db-url"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/marketplace",
          "awslogs-region": "[REGION]",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ]
}
```

## Opción 3: Railway (Balance)

```bash
# Instalar Railway CLI
npm i -g @railway/cli

# Login
railway login

# Crear proyecto
railway init

# Agregar PostgreSQL
railway add --plugin postgresql

# Agregar Redis
railway add --plugin redis

# Deploy
railway up
```

## Configuración de Variables de Entorno

### Desarrollo
```bash
cp .env.example .env.local
# Editar .env.local con valores locales
```

### Staging
```bash
# .env.staging
DATABASE_URL="postgresql://staging..."
REDIS_URL="redis://staging..."
JWT_SECRET="staging-secret-change-me"
NEXT_PUBLIC_APP_URL="https://staging.marketplace.com"
NODE_ENV="staging"
```

### Producción
```bash
# NUNCA commitear .env.production
# Usar secrets manager (AWS SSM, HashiCorp Vault)

# Ejemplo AWS SSM
aws ssm put-parameter \
  --name /marketplace/database-url \
  --value "postgresql://..." \
  --type SecureString
```

## Migraciones de Base de Datos

### Desarrollo
```bash
# Crear migración
npm run db:migrate

# Preview cambios
npx prisma migrate diff \
  --from-schema-datamodel prisma/schema.prisma \
  --to-schema-datasource prisma/schema.prisma
```

### Producción
```bash
# 1. Crear migración (dev)
npm run db:migrate -- --create-only

# 2. Revisar SQL generado
cat prisma/migrations/[timestamp]_[name]/migration.sql

# 3. Deploy en producción
DATABASE_URL="postgresql://prod..." \
  npx prisma migrate deploy
```

### Zero-Downtime Migrations

Para cambios que requieren zero-downtime:

```sql
-- Ejemplo: Agregar columna nueva
-- Paso 1: Agregar columna nullable
ALTER TABLE products ADD COLUMN new_field VARCHAR(255);

-- Paso 2: Backfill data (batch)
UPDATE products SET new_field = old_field WHERE new_field IS NULL LIMIT 1000;

-- Paso 3: Deploy código que usa new_field

-- Paso 4: Hacer NOT NULL
ALTER TABLE products ALTER COLUMN new_field SET NOT NULL;

-- Paso 5: Drop old_field
ALTER TABLE products DROP COLUMN old_field;
```

## Monitoring y Logging

### Sentry (Error Tracking)

```bash
npm install @sentry/nextjs

# Configurar en next.config.js
const { withSentryConfig } = require('@sentry/nextjs')

module.exports = withSentryConfig(
  nextConfig,
  { silent: true }
)
```

### CloudWatch (AWS)

```javascript
// src/lib/logger.ts
if (process.env.NODE_ENV === 'production') {
  // Logs van a CloudWatch automáticamente
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'info',
    message: 'Order created',
    orderId: '123'
  }))
}
```

### Métricas Clave

```typescript
// Custom metrics para negocio
- order.created (count)
- payment.succeeded (count, amount)
- payment.failed (count)
- inventory.low (gauge)
- api.response_time (histogram)
```

## Health Checks

```typescript
// src/app/api/health/route.ts
export async function GET() {
  const checks = {
    database: await checkDatabase(),
    redis: await checkRedis(),
    timestamp: new Date().toISOString()
  }
  
  const healthy = Object.values(checks).every(c => c === true)
  
  return Response.json(checks, { 
    status: healthy ? 200 : 503 
  })
}

async function checkDatabase() {
  try {
    await prisma.$queryRaw`SELECT 1`
    return true
  } catch {
    return false
  }
}
```

## Backups

### Base de Datos

```bash
# Automated backups en RDS (AWS)
aws rds modify-db-instance \
  --db-instance-identifier marketplace-db \
  --backup-retention-period 7 \
  --preferred-backup-window "03:00-04:00"

# Manual backup
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d).sql

# Restore
psql $DATABASE_URL < backup_20240206.sql
```

### Estrategia de Backup
- Diario automático (retention 7 días)
- Semanal (retention 1 mes)
- Mensual (retention 1 año)
- Pre-deploy manual

## Rollback Strategy

### Rollback de Código
```bash
# Vercel
vercel rollback

# AWS ECS
aws ecs update-service \
  --cluster marketplace \
  --service marketplace-app \
  --task-definition marketplace-core:PREVIOUS_VERSION
```

### Rollback de Migraciones

```bash
# Prisma NO soporta rollback automático
# Debes tener migration down manual

# Opción 1: Restore backup
psql $DATABASE_URL < backup_before_migration.sql

# Opción 2: Escribir migration down
-- migrations/[timestamp]_rollback/migration.sql
DROP TABLE new_table;
ALTER TABLE old_table ...
```

## Scaling

### Horizontal Scaling

```bash
# AWS ECS
aws ecs update-service \
  --cluster marketplace \
  --service marketplace-app \
  --desired-count 4  # Scale a 4 instancias
```

### Auto-scaling

```json
{
  "autoScalingGroupName": "marketplace-asg",
  "minSize": 2,
  "maxSize": 10,
  "targetTrackingScalingPolicies": [
    {
      "targetValue": 70.0,
      "predefinedMetricType": "ECSServiceAverageCPUUtilization"
    }
  ]
}
```

### Database Scaling

```bash
# Read Replicas
aws rds create-db-instance-read-replica \
  --db-instance-identifier marketplace-db-read \
  --source-db-instance-identifier marketplace-db

# Connection pooling (PgBouncer)
# Reducir conexiones activas a DB
```

## Security Checklist

- [ ] Usar HTTPS (SSL/TLS)
- [ ] Rate limiting habilitado
- [ ] Secrets en secrets manager
- [ ] Database en VPC privada
- [ ] IAM roles con least privilege
- [ ] Logs no contienen info sensible
- [ ] Dependencies actualizadas (`npm audit`)
- [ ] CORS configurado correctamente
- [ ] Headers de seguridad (CSP, HSTS)

## Troubleshooting

### High CPU
```bash
# Identificar queries lentas
SELECT pid, query, state 
FROM pg_stat_activity 
WHERE state = 'active' 
ORDER BY query_start;

# Analizar query plan
EXPLAIN ANALYZE SELECT ...
```

### Memory Leaks
```bash
# Node.js heap snapshot
node --inspect server.js
# Chrome DevTools → Memory → Take snapshot
```

### Database Locks
```sql
SELECT 
  blocked_locks.pid AS blocked_pid,
  blocking_locks.pid AS blocking_pid,
  blocked_activity.query AS blocked_query
FROM pg_locks blocked_locks
JOIN pg_stat_activity blocked_activity ON blocked_activity.pid = blocked_locks.pid
JOIN pg_locks blocking_locks ON blocking_locks.locktype = blocked_locks.locktype
WHERE NOT blocked_locks.granted;
```

## Contacto y Soporte

Para problemas de despliegue:
- Revisa logs: CloudWatch, Vercel Logs
- Health check: `/api/health`
- Métricas: Dashboard de monitoring

---

**Última actualización**: Febrero 2024
