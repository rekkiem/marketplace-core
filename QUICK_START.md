# 🚀 Quick Start - Marketplace Core

## Inicio Rápido en 5 Minutos

### 1. Descomprimir el Proyecto
```bash
tar -xzf marketplace-core.tar.gz
cd marketplace-core
```

### 2. Instalar Dependencias
```bash
npm install
# o
pnpm install
```

### 3. Configurar Base de Datos Local

#### Con Docker (Recomendado)
```bash
# PostgreSQL
docker run --name marketplace-postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=marketplace \
  -p 5432:5432 \
  -d postgres:14

# Redis
docker run --name marketplace-redis \
  -p 6379:6379 \
  -d redis:6
```

#### Sin Docker
- Instala PostgreSQL 14+ localmente
- Instala Redis 6+ localmente

### 4. Configurar Variables de Entorno
```bash
cp .env.example .env

# Editar .env con tus valores:
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/marketplace"
REDIS_URL="redis://localhost:6379"
JWT_SECRET="dev-secret-change-in-production"
```

### 5. Ejecutar Migraciones
```bash
# Generar Prisma Client
npm run db:generate

# Ejecutar migraciones
npm run db:migrate

# Seed con datos de prueba
npm run db:seed
```

### 6. Iniciar Servidor de Desarrollo
```bash
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000) 🎉

---

## Usuarios de Prueba (Seeded)

### Admin
- **Email**: admin@marketplace.cl
- **Password**: admin123

### Vendedor
- **Email**: vendedor@ferreteria.cl
- **Password**: seller123
- **Empresa**: Ferretería El Constructor

### Cliente
- **Email**: cliente@email.cl
- **Password**: user123

---

## Probar los APIs

### 1. Crear Orden
```bash
curl -X POST http://localhost:3000/api/orders \
  -H "Content-Type: application/json" \
  -H "x-user-id: [USER_ID]" \
  -d '{
    "items": [
      {
        "productId": "[PRODUCT_ID]",
        "quantity": 2
      }
    ],
    "shippingMethod": "STANDARD"
  }'
```

### 2. Listar Órdenes
```bash
curl http://localhost:3000/api/orders \
  -H "x-user-id: [USER_ID]"
```

### 3. Crear Review
```bash
curl -X POST http://localhost:3000/api/reviews \
  -H "Content-Type: application/json" \
  -H "x-user-id: [USER_ID]" \
  -d '{
    "orderItemId": "[ORDER_ITEM_ID]",
    "rating": 5,
    "title": "Excelente producto",
    "comment": "Muy buena calidad"
  }'
```

---

## Explorar la Base de Datos

```bash
# Abrir Prisma Studio
npm run db:studio
```

Abre [http://localhost:5555](http://localhost:5555)

---

## Estructura del Proyecto

```
marketplace-core/
├── src/
│   ├── app/              # Next.js routes
│   │   ├── api/          # API endpoints
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── core/             # Business logic
│   │   ├── orders/
│   │   ├── inventory/
│   │   ├── payments/
│   │   └── reviews/
│   ├── lib/              # Infrastructure
│   │   ├── db.ts
│   │   ├── redis.ts
│   │   ├── logger.ts
│   │   └── events.ts
│   └── types/
├── prisma/
│   ├── schema.prisma     # Database schema
│   └── seed.ts
├── README.md             # Documentación completa
├── ARCHITECTURE.md       # Decisiones técnicas
└── DEPLOYMENT.md         # Guía de deploy
```

---

## Siguiente Paso

Lee [README.md](./README.md) para documentación completa.

---

## Problemas Comunes

### Error: "Can't reach database server"
- Verifica que PostgreSQL esté corriendo
- Verifica el DATABASE_URL en .env

### Error: "Redis connection failed"
- Verifica que Redis esté corriendo
- Verifica el REDIS_URL en .env

### Error en migraciones
```bash
# Reset completo (cuidado: borra datos)
npx prisma migrate reset
npm run db:seed
```

---

## Comandos Útiles

```bash
# Ver logs estructurados
npm run dev

# Type checking
npm run type-check

# Tests
npm test

# Linting
npm run lint

# Build para producción
npm run build
npm start
```

---

**¿Todo funcionando?** ✅ 

Lee la documentación completa en `README.md` y comienza a construir tu marketplace.
