# Arquitectura del Sistema

## Visión General

Este documento detalla las decisiones arquitectónicas del Marketplace Core, explicando el **por qué** detrás de cada elección técnica.

## Principios Arquitectónicos

### 1. Pragmatismo sobre Pureza
- **Decisión**: Monolito modular sobre microservicios
- **Razón**: Los marketplaces requieren transacciones que cruzan múltiples dominios (orden → pago → inventario). Microservicios prematuros añaden complejidad distribuida sin beneficios reales a esta escala.
- **Cuándo cambiar**: Cuando un módulo específico (ej: search) necesite escalar 10x más que el resto.

### 2. Transacciones ACID First
- **Decisión**: PostgreSQL como source of truth
- **Razón**: No puedes perder un pago. No puedes vender lo que no tienes. ACID guarantees son no-negociables.
- **Trade-off**: Menos "web-scale", más corrección.

### 3. Idempotencia donde importa
- **Decisión**: Idempotency keys en pagos, webhooks procesados solo una vez
- **Razón**: Los webhooks de pago pueden llegar duplicados. Los usuarios pueden hacer doble-click. La red falla.
- **Implementación**: `idempotencyKey` único + validación al inicio de operaciones críticas.

## Modelo de Datos

### Soft Deletes
```prisma
deletedAt DateTime?
```

**Por qué**: 
- Compliance y auditoría
- Recuperación de datos
- Análisis histórico

**Costo**: 
- Queries más complejas (`WHERE deletedAt IS NULL`)
- Espacio en disco

**Mitigación**: Índices en `deletedAt`, archivado periódico a cold storage.

### Denormalización de Ratings
```prisma
model Product {
  rating       Float @default(0)
  totalReviews Int   @default(0)
}
```

**Por qué**:
- Evitar `JOIN` + `AVG()` en cada listado de productos
- Performance crítico en read-heavy workloads

**Costo**:
- Debe recalcularse consistentemente
- Riesgo de drift

**Mitigación**: 
- Recálculo en transacción al crear/editar review
- Job periódico de reconciliación (semanal)

### Inventario con Reservas
```prisma
model Inventory {
  quantity  Int
  reserved  Int
  available Int  // computed: quantity - reserved
}
```

**Por qué**:
- Prevenir overselling en alta concurrencia
- Separar "lo que tengo" vs "lo que puedo vender"

**Flujo**:
1. Order created → `reserved++`
2. Payment confirmed → `quantity--, reserved--`
3. Order cancelled → `reserved--`

**Implementación crítica**: Operaciones atómicas con `increment/decrement`.

## Servicios Core

### OrderService

**Responsabilidades**:
- Creación de órdenes con validaciones de negocio
- Reserva de inventario en transacción
- Gestión de estados con validación de transiciones
- Cancelación con rollback de inventario

**Por qué transacciones**:
```typescript
await withTransaction(async (tx) => {
  // 1. Reservar inventario
  await inventoryService.reserve(productId, qty, tx)
  
  // 2. Crear orden
  await tx.order.create(...)
  
  // 3. Si algo falla → rollback automático
})
```

Sin transacciones: inventario reservado + orden sin crear = stock "fantasma".

### PaymentService

**Idempotencia crítica**:
```typescript
const existing = await prisma.payment.findUnique({
  where: { idempotencyKey }
})

if (existing) return existing  // NO crear duplicado
```

**Webhooks**:
- Guardar payload raw (debugging)
- Marcar como procesado (prevenir re-proceso)
- Retornar 200 incluso en error (evitar reintentos)

### InventoryService

**Operaciones atómicas**:
```typescript
await db.inventory.update({
  where: { productId },
  data: {
    reserved: { increment: quantity }  // ← Atómico
  }
})
```

**Por qué no `reserved = reserved + quantity`**:
- Race condition entre read y write
- Prisma `increment` usa UPDATE atómico en DB

## Event Bus

### Implementación Simple
```typescript
class EventBusClass {
  private handlers: Map<string, EventHandler[]>
  
  async emit(event, data) {
    // Ejecutar handlers en paralelo
    await Promise.allSettled(...)
  }
}
```

**Por qué no un message queue desde día 1**:
- Overhead operacional (RabbitMQ, Kafka, SQS)
- Eventos actuales son fire-and-forget
- Fácil migrar después

**Cuándo migrar a queue**:
- Necesitas garantías de delivery
- Necesitas retry automático
- Eventos críticos (emails, notificaciones)

**Evolución**:
1. MVP: Event bus in-memory
2. V2: Redis pub/sub
3. V3: BullMQ o SQS

## Caching Strategy

### Layer 1: Application Cache
```typescript
CacheService.getOrSet('product:123', 
  () => fetchFromDB(), 
  300  // 5 min TTL
)
```

**Qué cachear**:
- Productos (read-heavy, cambian poco)
- Categorías (casi estáticos)
- Configuración

**Qué NO cachear**:
- Inventario (cambia constantemente)
- Precios en promoción
- Datos de sesión

### Layer 2: Database Query Cache
- Prisma tiene query cache built-in
- PostgreSQL tiene buffer pool

### Invalidación
```typescript
// Al actualizar producto
await CacheService.invalidate(`product:${id}`)
await CacheService.invalidate('products:list:*')
```

**Patrón**:
- Cache específico (`product:123`)
- Cache de listados (`products:list:category-5`)
- Wildcard invalidation con cuidado

## Performance Patterns

### N+1 Query Prevention
```typescript
// ❌ MAL: N+1
const orders = await prisma.order.findMany()
for (const order of orders) {
  order.items = await prisma.orderItem.findMany({ where: { orderId: order.id } })
}

// ✅ BIEN: Include
const orders = await prisma.order.findMany({
  include: { items: true }
})
```

### Pagination
```typescript
// Siempre incluir límite
take: 20,
skip: offset,

// Cursor-based para alto throughput
cursor: { id: lastId },
take: 20
```

### Select Específico
```typescript
// No cargar todo si no lo necesitas
select: {
  id: true,
  name: true,
  // Omitir description, images, etc.
}
```

## Seguridad

### Server-side Validation SIEMPRE
```typescript
// Cliente puede mentir
const validated = createOrderSchema.parse(body)

// Verificar ownership
if (order.userId !== currentUser.id) {
  throw new Error('Unauthorized')
}
```

### Rate Limiting
```typescript
const { allowed } = await CacheService.checkRateLimit(
  `api:${userId}`,
  100,  // requests
  60    // window
)
```

**Aplicar en**:
- APIs públicas
- Endpoints costosos
- Operaciones de escritura

### Sensible Data
```typescript
// NUNCA enviar al cliente
select: {
  password: false,
  bankAccount: false,
}

// Encriptar en DB
bankAccount: Json  // Encrypted JSON
```

## Escalabilidad

### Horizontal Scaling Ready
- Stateless API (sesión en JWT/Redis)
- Database connection pool
- Cache distribuido (Redis)

### Vertical Scaling First
- PostgreSQL escala bien hasta TB de datos
- Redis maneja millones de ops/seg
- CPU/RAM más barato que arquitectura distribuida

### Cuando Extraer Servicios
1. **Search**: Meilisearch/Elastic cuando >100k productos
2. **Recommendations**: Python/ML cuando tengas datos suficientes
3. **Analytics**: ClickHouse para time-series

## Testing Strategy

### Unit Tests
```typescript
describe('OrderService', () => {
  it('should reserve inventory on order creation', async () => {
    // Test lógica crítica
  })
})
```

### Integration Tests
```typescript
it('should handle payment webhook idempotently', async () => {
  // Test flujos end-to-end
})
```

### NO Testing
- Getters/setters triviales
- Configuración
- Third-party integrations (mock)

## Deployment

### Database Migrations
```bash
# Development
npm run db:migrate

# Production
npm run db:migrate -- --create-only
# Review migration
npm run db:migrate -- --deploy
```

**NUNCA auto-migrate en producción**.

### Environment Variables
```bash
# Development: .env.local
# Staging: .env.staging  
# Production: Secrets manager (AWS SSM, Vault)
```

### Monitoring
- Logs: JSON structured → CloudWatch/Datadog
- Metrics: Orden conversion, revenue, errors
- Alerts: Payment failures, low inventory, errors

## Trade-offs Explícitos

| Decisión | Beneficio | Costo | Cuándo Revisar |
|----------|-----------|-------|----------------|
| Monolito modular | Simple, transacciones, debugging fácil | Escala limitada | >1M requests/día |
| Denormalización ratings | Performance en listados | Complejidad en updates | Si drift es problema |
| Event bus simple | Sin overhead operacional | Sin garantías delivery | Cuando eventos sean críticos |
| Soft deletes | Auditoría, recuperación | Queries más complejas | Si performance sufre |

## Roadmap Técnico

### Trimestre 1
- [ ] Authentication (NextAuth)
- [ ] File upload (S3/Cloudinary)
- [ ] Email service (SendGrid/SES)

### Trimestre 2
- [ ] Search (Meilisearch)
- [ ] CDN para assets
- [ ] Monitoring (Sentry/Datadog)

### Trimestre 3
- [ ] Recommendations (Python/FastAPI)
- [ ] Message queue (BullMQ)
- [ ] Analytics dashboard

### Trimestre 4
- [ ] Read replicas
- [ ] Event sourcing parcial
- [ ] A/B testing

## Conclusión

Esta arquitectura está diseñada para:
- ✅ Funcionar en producción real desde día 1
- ✅ Escalar de 100 a 100,000 órdenes/mes
- ✅ Evolucionar sin reescrituras
- ✅ Ser mantenible por equipos pequeños

**No** está diseñada para:
- ❌ Academicismo o pureza arquitectónica
- ❌ Escala de Amazon (no la necesitas)
- ❌ Impresionar en conferencias

Cada decisión tiene un **por qué** basado en sistemas reales en producción.
