# Marketplace Core - Construcción y Servicios Técnicos

Sistema core de marketplace B2C/B2B para productos de ferretería y servicios técnicos, diseñado para escalar de 0 a 100k productos sin reescrituras.

## 🎯 Características Principales

### Funcionalidades Core
- ✅ **Catálogo Multi-Tipo**: Productos físicos, servicios puros y bundles híbridos
- ✅ **Multi-Vendedor**: Empresas, PYMEs y maestros independientes
- ✅ **Sistema de Órdenes Robusto**: Manejo de inventario con reservas, pagos idempotentes
- ✅ **Reviews Verificados**: Solo post-compra, con rating ponderado
- ✅ **Eventos de Dominio**: Event bus para integración y evolución
- ✅ **Observabilidad**: Logging estructurado, métricas de negocio

### Decisiones Arquitectónicas
- **Monolito Modular**: Next.js 14 + App Router
- **Base de Datos**: PostgreSQL + Prisma ORM
- **Cache**: Redis para performance y rate limiting
- **Transacciones ACID**: Para operaciones críticas (órdenes, pagos)
- **Idempotencia**: En pagos y webhooks
- **Soft Deletes**: Para auditoría y compliance

## 🏗️ Arquitectura

```
marketplace-core/
├── src/
│   ├── app/                    # Next.js App Router
│   │   └── api/                # API Routes
│   │       ├── orders/
│   │       ├── payments/
│   │       └── reviews/
│   ├── core/                   # Business Logic
│   │   ├── orders/
│   │   │   └── order.service.ts
│   │   ├── inventory/
│   │   │   └── inventory.service.ts
│   │   ├── payments/
│   │   │   └── payment.service.ts
│   │   └── reviews/
│   │       └── review.service.ts
│   └── lib/                    # Infrastructure
│       ├── db.ts               # Prisma client
│       ├── redis.ts            # Redis client
│       ├── logger.ts           # Structured logging
│       └── events.ts           # Event bus
└── prisma/
    └── schema.prisma           # Database schema
```

## 🚀 Instalación

### Prerequisitos
- Node.js 18+
- PostgreSQL 14+
- Redis 6+

### 1. Clonar e Instalar

```bash
# Instalar dependencias
npm install

# O con pnpm (recomendado)
pnpm install
```

### 2. Configurar Variables de Entorno

```bash
cp .env.example .env
```

Edita `.env` con tus credenciales:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/marketplace"
REDIS_URL="redis://localhost:6379"
JWT_SECRET="tu-secret-super-seguro"
```

### 3. Setup Base de Datos

```bash
# Generar Prisma Client
npm run db:generate

# Ejecutar migraciones
npm run db:migrate

# (Opcional) Seed data de prueba
npm run db:seed
```

### 4. Iniciar Desarrollo

```bash
npm run dev
```

La app estará disponible en `http://localhost:3000`

## 📊 Modelo de Datos

### Entidades Principales

#### User & Seller
- `User`: Usuario base con roles (ADMIN, USER, SELLER)
- `Seller`: Extensión de User con info de negocio, reputación y comisiones

#### Catalog
- `Category`: Jerarquía de categorías con multi-nivel
- `Product`: Productos con tipos (PHYSICAL, SERVICE, HYBRID)
- `Inventory`: Control de stock con reservas atómicas

#### Orders & Payments
- `Order`: Órdenes con estados transicionables
- `OrderItem`: Items individuales con snapshot de precios
- `Payment`: Pagos idempotentes con webhooks
- `OrderStatusHistory`: Auditoría completa de cambios

#### Reviews
- `Review`: Solo post-compra verificada
- Rating denormalizado en Product y Seller para performance

## 🔧 Uso de Servicios Core

### OrderService

```typescript
import { OrderService } from '@/core/orders/order.service'

const orderService = new OrderService()

// Crear orden
const order = await orderService.createOrder({
  userId: 'user_123',
  items: [
    { productId: 'prod_456', quantity: 2 },
    { productId: 'prod_789', quantity: 1, scheduledAt: new Date() }
  ],
  addressId: 'addr_012',
  shippingMethod: 'EXPRESS'
})

// Confirmar pago
await orderService.confirmPayment(order.id, payment.id)

// Cancelar orden
await orderService.cancelOrder(order.id, 'Cliente solicitó cancelación')
```

### InventoryService

```typescript
import { InventoryService } from '@/core/inventory/inventory.service'

const inventoryService = new InventoryService()

// Verificar disponibilidad
const available = await inventoryService.getAvailable('prod_123')

// Restock
await inventoryService.restock('prod_123', 50, 'seller_456', 'Compra proveedor')

// Ajuste manual
await inventoryService.adjust('prod_123', 100, 'admin_789', 'Corrección inventario')
```

### PaymentService

```typescript
import { PaymentService } from '@/core/payments/payment.service'

const paymentService = new PaymentService()

// Crear pago (idempotente)
const payment = await paymentService.createPayment({
  orderId: 'ord_123',
  amount: 50000,
  method: 'WEBPAY',
  idempotencyKey: 'unique_key_123'
})

// Procesar webhook
await paymentService.handleWebhook('transbank', 'payment.success', payload)
```

### ReviewService

```typescript
import { ReviewService } from '@/core/reviews/review.service'

const reviewService = new ReviewService()

// Crear review (solo si compró)
const review = await reviewService.createReview({
  orderItemId: 'item_123',
  userId: 'user_456',
  rating: 5,
  title: 'Excelente producto',
  comment: 'Llegó rápido y funciona perfecto'
})

// Seller responde
await reviewService.respondToReview(review.id, 'seller_789', '¡Gracias por tu compra!')
```

## 🔐 Seguridad

### Autenticación
- JWT-based authentication (implementar con NextAuth o similar)
- Headers: `x-user-id` para identificar usuario en requests

### Autorización
- Validación server-side en todos los endpoints
- Políticas por rol (ADMIN, SELLER, USER)
- Ownership validation en operaciones sensibles

### Rate Limiting
```typescript
import { CacheService } from '@/lib/redis'

const { allowed } = await CacheService.checkRateLimit(
  `api:${userId}`,
  100, // requests
  60   // window en segundos
)

if (!allowed) {
  return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
}
```

## 📈 Performance

### Caching Strategy
```typescript
import { CacheService } from '@/lib/redis'

// Get con fallback
const product = await CacheService.getOrSet(
  `product:${id}`,
  () => prisma.product.findUnique({ where: { id } }),
  300 // TTL 5 minutos
)

// Invalidar cache
await CacheService.invalidate('product:*')
```

### Query Optimization
- Índices compuestos en queries frecuentes
- `select` específico para reducir payload
- Paginación en listados
- Denormalización estratégica (ratings, stats)

## 🎯 Próximos Pasos

### Fase 1: MVP (1-3 meses)
- [ ] Implementar autenticación (NextAuth)
- [ ] UI básica con React
- [ ] Integración con payment provider (Webpay/Stripe)
- [ ] Sistema de notificaciones
- [ ] Admin dashboard básico

### Fase 2: Performance (4-6 meses)
- [ ] Meilisearch para búsqueda avanzada
- [ ] CDN para imágenes
- [ ] Monitoring (Sentry/Datadog)
- [ ] Analytics dashboard
- [ ] Optimización de queries

### Fase 3: Features Avanzadas (7-9 meses)
- [ ] Sistema de recomendaciones (Python/ML)
- [ ] Matching proveedor-servicio
- [ ] Chat en tiempo real
- [ ] Seller dashboard avanzado
- [ ] Reportes y analytics

### Fase 4: Escala (10-12 meses)
- [ ] Read replicas
- [ ] Background jobs (BullMQ)
- [ ] Event sourcing para auditoría
- [ ] A/B testing
- [ ] Fraud detection

## 🐛 Testing

```bash
# Unit tests
npm test

# Watch mode
npm run test:watch

# Coverage
npm test -- --coverage
```

## 🔍 Debugging

### Ver logs estructurados
```bash
# Development
Los logs se muestran en consola con colores

# Production
Los logs están en formato JSON para parseo
```

### Prisma Studio
```bash
npm run db:studio
```

### Event History
```typescript
import { EventBus } from '@/lib/events'

// Ver últimos 50 eventos
const history = EventBus.getHistory(50)
console.log(history)
```

## 📝 Convenciones

### Commits
- `feat:` Nueva funcionalidad
- `fix:` Bug fix
- `refactor:` Refactorización sin cambio funcional
- `perf:` Mejora de performance
- `docs:` Documentación
- `test:` Tests

### Código
- TypeScript strict mode
- Prettier para formateo
- ESLint para linting
- Comentarios en funciones críticas

## 🤝 Contribuir

1. Fork el proyecto
2. Crea tu feature branch (`git checkout -b feat/amazing-feature`)
3. Commit cambios (`git commit -m 'feat: add amazing feature'`)
4. Push al branch (`git push origin feat/amazing-feature`)
5. Abre un Pull Request

## 📄 Licencia

Este proyecto es privado y propietario.

## 🆘 Soporte

- Email: soporte@marketplace.com
- Documentación: `/docs`
- Issues: GitHub Issues

---

**Nota**: Este es un sistema core de producción. Cada decisión arquitectónica fue tomada basada en experiencia real escalando marketplaces. No es un tutorial ni un ejemplo académico.
