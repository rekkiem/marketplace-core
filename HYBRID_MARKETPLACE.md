# MARKETPLACE HÍBRIDO - DOCUMENTACIÓN COMPLETA
## Productos + Servicios + Arriendos Integrados

---

## 📋 TABLA DE CONTENIDOS

1. [Visión General](#visión-general)
2. [Arquitectura del Sistema](#arquitectura-del-sistema)
3. [Modelos de Datos](#modelos-de-datos)
4. [Servicios Core](#servicios-core)
5. [API Endpoints](#api-endpoints)
6. [Flujos de Usuario](#flujos-de-usuario)
7. [Casos de Uso](#casos-de-uso)
8. [Configuración y Deploy](#configuración-y-deploy)

---

## 🎯 VISIÓN GENERAL

### ¿Qué es este Marketplace?

Un marketplace híbrido de construcción y ferretería que permite:

- **Venta de Productos Físicos**: Taladros, cemento, herramientas
- **Servicios Técnicos Agendables**: Instalación, reparación, consultoría
- **Arriendo de Maquinaria**: Grúas, mezcladoras, andamios
- **Bundles Híbridos**: Producto + Instalación en una sola compra

### Diferencial Competitivo

| Feature | Tradicional | Este Marketplace |
|---------|-------------|------------------|
| Compra de taladro | ✅ | ✅ |
| Agendar instalación | ❌ (otro sitio) | ✅ (mismo checkout) |
| Arrendar andamio | ❌ (empresa especializada) | ✅ (mismo catálogo) |
| Pago escalonado | ❌ | ✅ (escrow + milestones) |
| Depósitos de garantía | ❌ | ✅ (automático) |

---

## 🏗️ ARQUITECTURA DEL SISTEMA

### Componentes Principales

```
┌──────────────────────────────────────────────────────────────┐
│                    FRONTEND (Next.js)                        │
└───────────────────────┬──────────────────────────────────────┘
                        │
┌───────────────────────▼──────────────────────────────────────┐
│              RESERVATION COORDINATOR                         │
│   (Valida disponibilidad cross-module)                       │
└───────────┬───────────┬──────────────┬───────────────────────┘
            │           │              │
    ┌───────▼───┐  ┌────▼────┐  ┌─────▼──────┐
    │  RENTAL   │  │ BOOKING │  │   ORDER    │
    │  SERVICE  │  │ SERVICE │  │  SERVICE   │
    └───────┬───┘  └────┬────┘  └─────┬──────┘
            │           │              │
            └───────────┴──────────────┘
                        │
            ┌───────────▼────────────┐
            │   ESCROW SERVICE       │
            │ (Pagos escalonados)    │
            └────────────────────────┘
```

### Módulos

1. **Rental Module**: Gestiona arriendos de maquinaria
2. **Booking Module**: Servicios técnicos agendables
3. **Escrow Module**: Retención y liberación de pagos
4. **Coordination Module**: Validación cross-module

---

## 📊 MODELOS DE DATOS

### FleetItem (Maquinaria para Arriendo)

```typescript
{
  id: "fleet_001",
  name: "Grúa Telescópica 50T",
  dailyRate: 150000,       // CLP por día
  weeklyRate: 900000,      // Descuento semanal
  baseValue: 50000000,     // Valor del equipo
  depositPercent: 0.20,    // 20% como depósito
  status: "AVAILABLE",     // AVAILABLE | RENTED | MAINTENANCE
  gpsEnabled: true,        // Tracking GPS
  specifications: {
    capacity: "50 ton",
    reach: "40 metros"
  }
}
```

### Rental (Arriendo Activo)

```typescript
{
  id: "rent_001",
  rentalNumber: "RENT-20240310-ABC123",
  fleetItemId: "fleet_001",
  userId: "user_001",
  startDate: "2024-03-15",
  endDate: "2024-03-22",
  totalDays: 7,
  dailyRate: 150000,
  subtotal: 1050000,
  depositAmount: 10000000,   // 20% del valor base
  depositHeld: 10000000,      // Monto retenido
  status: "ACTIVE",           // PENDING_APPROVAL | ACTIVE | RETURNED
  contractTerms: {
    lateReturnPenalty: 100000,  // Por día
    damageDeductible: 200000
  }
}
```

### Booking (Servicio Agendado)

```typescript
{
  id: "book_001",
  bookingNumber: "BOOK-20240315-XYZ789",
  productId: "service_installation",
  userId: "user_001",
  technicianId: "tech_001",
  scheduledDate: "2024-03-20",
  scheduledTime: "09:00-12:00",
  duration: 180,              // Minutos
  serviceAddress: "Av. Providencia 1234",
  status: "CONFIRMED",        // PENDING | CONFIRMED | IN_PROGRESS | COMPLETED
  linkedOrderItemId: "item_001"  // Si viene con compra de producto
}
```

### EscrowHold (Retención de Pago)

```typescript
{
  id: "escrow_001",
  totalAmount: 500000,
  releasedAmount: 250000,
  status: "HELD",             // HELD | RELEASED | DISPUTED
  splits: [
    {
      sellerId: "seller_001",
      amount: 250000,
      releaseCondition: "SERVICE_STARTED",
      status: "RELEASED"
    },
    {
      sellerId: "seller_001",
      amount: 250000,
      releaseCondition: "SERVICE_COMPLETED",
      status: "HELD"
    }
  ],
  milestones: [
    {
      name: "Inspección inicial",
      percentage: 10,
      status: "COMPLETED"
    },
    {
      name: "Materiales comprados",
      percentage: 30,
      status: "PENDING",
      evidenceRequired: true
    }
  ]
}
```

---

## ⚙️ SERVICIOS CORE

### 1. RentalService

**Funcionalidades:**
- Crear arriendo con cálculo automático de depósito
- Confirmar rental (después de aprobación de pago)
- Activar rental (en fecha de inicio)
- Procesar devolución con inspección
- Solicitar extensión
- Marcar como overdue (job automático)

**Ejemplo de Uso:**

```typescript
import { RentalService } from '@/core/rentals/rental.service'

const rentalService = new RentalService()

// Crear arriendo
const rental = await rentalService.createRental({
  fleetItemId: 'fleet_001',
  userId: 'user_123',
  startDate: new Date('2024-03-15'),
  endDate: new Date('2024-03-22'),
  deliveryAddress: 'Obra en construcción, Av. Apoquindo 4500'
})

// Procesar devolución
const result = await rentalService.processReturn('rent_001', {
  condition: 'GOOD',
  photos: ['url1', 'url2'],
  cleanlinessScore: 4,
  damageReport: [
    {
      description: 'Raspón en lateral',
      estimatedCost: 50000
    }
  ]
})

console.log('Depósito refundado:', result.depositRefund)
console.log('Deducciones:', result.deductions)
```

### 2. BookingService

**Funcionalidades:**
- Crear booking de servicio
- Confirmar y asignar técnico
- Marcar servicio como iniciado
- Completar servicio con evidencia
- Cancelar booking

**Ejemplo de Uso:**

```typescript
import { BookingService } from '@/core/bookings/booking.service'

const bookingService = new BookingService()

// Crear booking
const booking = await bookingService.createBooking({
  productId: 'service_electrical',
  userId: 'user_123',
  scheduledDate: new Date('2024-03-20'),
  scheduledTime: '09:00-12:00',
  serviceAddress: 'Oficina nueva, Las Condes',
  linkedOrderItemId: 'item_456' // Si viene con compra
})

// Confirmar y asignar técnico
await bookingService.confirmBooking({
  bookingId: booking.id,
  technicianId: 'tech_001'
})

// Completar servicio
await bookingService.completeService({
  bookingId: booking.id,
  workDescription: 'Instalación de circuito eléctrico completa',
  afterPhotos: ['photo1.jpg', 'photo2.jpg'],
  materialsCost: 50000
})
```

### 3. EscrowService

**Funcionalidades:**
- Crear hold de escrow con splits
- Liberar split específico
- Liberar por condición (ej: todos los "SERVICE_COMPLETED")
- Completar y aprobar milestones
- Reembolsar escrow
- Obtener balance del seller

**Ejemplo de Uso:**

```typescript
import { EscrowService } from '@/core/escrow/escrow.service'

const escrowService = new EscrowService()

// Crear hold con milestones
const escrow = await escrowService.createEscrowHold({
  orderId: 'order_001',
  totalAmount: 5000000,
  platformFeePercent: 0.10,
  splits: [
    {
      sellerId: 'seller_001',
      amount: 2500000,
      releaseCondition: 'SERVICE_STARTED'
    },
    {
      sellerId: 'seller_001',
      amount: 2500000,
      releaseCondition: 'SERVICE_COMPLETED'
    }
  ],
  milestones: [
    {
      name: 'Materiales comprados',
      description: 'Compra de materiales eléctricos',
      percentage: 30,
      completionCondition: 'EVIDENCE_SUBMITTED',
      dueDate: new Date('2024-03-25')
    }
  ]
})

// Liberar cuando servicio inicia
await escrowService.releaseByCondition(
  escrow.id,
  'SERVICE_STARTED'
)

// Completar milestone
await escrowService.completeMilestone({
  milestoneId: 'milestone_001',
  evidenceUrls: ['receipt1.pdf', 'receipt2.pdf'],
  completedBy: 'seller_001'
})
```

### 4. UnifiedCheckoutService

**Funcionalidad:**
Procesa checkout con productos, servicios y arriendos en una sola transacción.

**Ejemplo de Uso:**

```typescript
import { UnifiedCheckoutService } from '@/core/checkout/unified-checkout.service'

const checkoutService = new UnifiedCheckoutService()

const result = await checkoutService.processCheckout({
  userId: 'user_123',
  items: [
    // Producto físico
    {
      type: 'PRODUCT',
      productId: 'ac_unit_001',
      quantity: 1
    },
    // Servicio de instalación (bundle)
    {
      type: 'BUNDLE',
      productId: 'service_ac_install',
      scheduledDate: new Date('2024-03-20'),
      scheduledTime: '09:00-12:00',
      linkedToProduct: 'ac_unit_001'
    },
    // Arriendo de andamio
    {
      type: 'RENTAL',
      fleetItemId: 'scaffold_001',
      rentalStartDate: new Date('2024-03-18'),
      rentalEndDate: new Date('2024-03-25')
    }
  ],
  addressId: 'addr_001',
  shippingMethod: 'STANDARD',
  paymentMethod: 'CREDIT_CARD',
  idempotencyKey: 'unique_123456',
  notes: 'Entregar en recepción'
})

console.log('Order ID:', result.orderId)
console.log('Rental IDs:', result.rentalIds)
console.log('Booking IDs:', result.bookingIds)
console.log('Total:', result.totalAmount)
console.log('Depósito:', result.depositAmount)
```

---

## 🌐 API ENDPOINTS

### Rentals

#### `POST /api/rentals`
Crear arriendo

```json
{
  "fleetItemId": "fleet_001",
  "startDate": "2024-03-15T00:00:00Z",
  "endDate": "2024-03-22T00:00:00Z",
  "deliveryAddress": "Av. Providencia 1234",
  "notes": "Necesito entrega temprano"
}
```

#### `GET /api/rentals?status=ACTIVE`
Obtener arriendos del usuario

### Checkout Unificado

#### `POST /api/checkout`
Procesar checkout híbrido

```json
{
  "items": [
    {
      "type": "PRODUCT",
      "productId": "prod_001",
      "quantity": 2
    },
    {
      "type": "SERVICE",
      "productId": "service_001",
      "scheduledDate": "2024-03-20T00:00:00Z",
      "scheduledTime": "09:00-12:00"
    },
    {
      "type": "RENTAL",
      "fleetItemId": "fleet_001",
      "rentalStartDate": "2024-03-15T00:00:00Z",
      "rentalEndDate": "2024-03-22T00:00:00Z"
    }
  ],
  "addressId": "addr_001",
  "shippingMethod": "STANDARD",
  "paymentMethod": "CREDIT_CARD",
  "idempotencyKey": "unique_abc123"
}
```

**Response:**
```json
{
  "success": true,
  "orderId": "order_001",
  "rentalIds": ["rent_001"],
  "bookingIds": [],
  "escrowHoldId": "escrow_001",
  "totalAmount": 1500000,
  "depositAmount": 500000
}
```

#### `PUT /api/checkout/validate`
Validar carrito sin procesar

```json
{
  "items": [ /* mismo formato */ ]
}
```

**Response:**
```json
{
  "valid": false,
  "errors": [
    {
      "itemIndex": 2,
      "field": "dates",
      "message": "Fleet item not available in requested date range",
      "severity": "error"
    }
  ],
  "warnings": [],
  "suggestions": [
    {
      "itemIndex": 2,
      "type": "alternative_date",
      "data": [
        {
          "startDate": "2024-03-16",
          "endDate": "2024-03-23"
        }
      ]
    }
  ]
}
```

### Seller Dashboard

#### `GET /api/seller/dashboard`
Dashboard completo del vendedor

**Response:**
```json
{
  "seller": {
    "id": "seller_001",
    "businessName": "Ferretería El Constructor",
    "rating": 4.7,
    "totalSales": 150
  },
  "inventory": {
    "totalProducts": 45,
    "lowStock": [ /* productos */ ],
    "outOfStock": []
  },
  "fleet": {
    "total": 12,
    "available": 8,
    "rented": 3,
    "maintenance": 1,
    "items": [ /* fleet items */ ]
  },
  "technicians": {
    "total": 5,
    "active": 4,
    "verified": 4,
    "list": [ /* técnicos */ ]
  },
  "activity": {
    "recentOrders": [ /* órdenes */ ],
    "activeRentals": [ /* arriendos activos */ ],
    "upcomingBookings": [ /* servicios próximos */ ]
  },
  "financials": {
    "escrowBalance": {
      "pending": 2500000,
      "available": 1500000
    },
    "metrics": {
      "thisMonth": {
        "orders": 12,
        "rentals": 5,
        "bookings": 8,
        "totalRevenue": 4500000
      }
    }
  }
}
```

---

## 🎭 FLUJOS DE USUARIO

### Flujo 1: Compra de Producto + Instalación

```
1. Usuario busca "Aire Acondicionado"
2. Selecciona producto + checkbox "Incluir instalación"
3. Sistema muestra:
   - Precio producto: $500,000
   - Precio instalación: $150,000
   - Total: $650,000
4. Usuario agenda fecha/hora para instalación
5. Sistema valida disponibilidad de técnicos
6. Checkout procesa:
   - Orden para producto
   - Booking para servicio (linked)
   - Escrow hold con 2 splits:
     * $500k liberado en entrega
     * $150k: 50% al iniciar servicio, 50% al completar
```

### Flujo 2: Arriendo de Maquinaria

```
1. Usuario busca "Grúa Telescópica"
2. Selecciona fechas (15-22 marzo)
3. Sistema:
   - Calcula 7 días × $150,000 = $1,050,000
   - Calcula depósito: $10,000,000 (20% del valor base)
   - Verifica disponibilidad
4. Checkout:
   - Hold en tarjeta: $11,050,000 ($1M rental + $10M depósito)
   - Cargo inmediato: $1,050,000
   - Depósito: Hold, se libera al devolver
5. Al devolver (22 marzo):
   - Inspección con fotos
   - Deducciones automáticas si hay daños
   - Refund de depósito (menos deducciones)
```

### Flujo 3: Proyecto Complejo (Múltiples Milestones)

```
1. Cliente solicita instalación eléctrica completa ($5,000,000)
2. Seller define milestones:
   - 10% Inspección inicial
   - 30% Materiales comprados
   - 30% Cableado completado
   - 30% Inspección final
3. Sistema crea escrow con 4 milestones
4. Cada milestone requiere:
   - Seller marca como completado
   - Seller sube evidencia (fotos, recibos)
   - Cliente/Admin aprueba
   - Sistema libera pago
5. Cliente puede disputar en cualquier milestone
```

---

## 💡 CASOS DE USO REALES

### Caso 1: Constructor Pequeño

**Necesidad:**
- Comprar herramientas (taladros, sierras)
- Arrendar andamio por 2 semanas
- Contratar electricista para cableado

**Solución en el Marketplace:**
```typescript
await checkoutService.processCheckout({
  items: [
    { type: 'PRODUCT', productId: 'taladro_001', quantity: 2 },
    { type: 'PRODUCT', productId: 'sierra_001', quantity: 1 },
    { 
      type: 'RENTAL', 
      fleetItemId: 'andamio_001',
      rentalStartDate: new Date('2024-03-10'),
      rentalEndDate: new Date('2024-03-24')
    },
    {
      type: 'SERVICE',
      productId: 'servicio_electrico',
      scheduledDate: new Date('2024-03-15'),
      scheduledTime: '08:00-17:00'
    }
  ],
  // ...
})
```

**Beneficios:**
- Todo en un checkout
- Pago escalonado para servicio
- Depósito automático para andamio
- Seguimiento unificado

### Caso 2: Empresa Constructora

**Necesidad:**
- Arrendar grúa por 1 mes
- Servicio de operador especializado
- Seguro incluido

**Implementación:**
```typescript
const rental = await rentalService.createRental({
  fleetItemId: 'grua_50t',
  startDate: new Date('2024-03-01'),
  endDate: new Date('2024-03-31'),
  // ...
})

// Pago mensual con descuento
// Rental: 30 días × $150,000 = $4,500,000
// Monthly rate: $4,000,000 (descuento)
// Depósito: $10,000,000
// Seguro: 5% = $200,000
```

### Caso 3: Homeowner

**Necesidad:**
- Comprar sistema de calefacción
- Instalación profesional
- Mantenimiento anual

**Flujo:**
```typescript
// Checkout inicial
const checkout = await checkoutService.processCheckout({
  items: [
    { type: 'PRODUCT', productId: 'calefactor_001', quantity: 1 },
    {
      type: 'BUNDLE',
      productId: 'instalacion_calefaccion',
      scheduledDate: new Date('2024-03-20'),
      linkedToProduct: 'calefactor_001'
    }
  ]
})

// Después, agendar mantenimiento anual
const booking = await bookingService.createBooking({
  productId: 'mantenimiento_calefaccion',
  scheduledDate: new Date('2025-03-20')
})
```

---

## 🚀 CONFIGURACIÓN Y DEPLOY

### Setup Inicial

```bash
# 1. Instalar dependencias
npm install

# 2. Configurar .env
cp .env.example .env
# Editar DATABASE_URL, REDIS_URL, etc

# 3. Aplicar schema extendido
# Copiar contenido de prisma/schema-hybrid-extension.prisma
# al final de prisma/schema.prisma

# 4. Ejecutar migraciones
npx prisma migrate dev --name add_hybrid_features

# 5. Generar Prisma Client
npx prisma generate

# 6. Seed data de prueba (opcional)
npm run db:seed
```

### Testing

```bash
# Test de validación de carrito
curl -X PUT http://localhost:3000/api/checkout/validate \
  -H "Content-Type: application/json" \
  -H "x-user-id: user_123" \
  -d '{
    "items": [
      {
        "type": "RENTAL",
        "fleetItemId": "fleet_001",
        "rentalStartDate": "2024-03-15T00:00:00Z",
        "rentalEndDate": "2024-03-22T00:00:00Z"
      }
    ]
  }'

# Test de checkout
curl -X POST http://localhost:3000/api/checkout \
  -H "Content-Type: application/json" \
  -H "x-user-id: user_123" \
  -d '{
    "items": [ /* ... */ ],
    "paymentMethod": "CREDIT_CARD",
    "idempotencyKey": "test_123456"
  }'
```

---

## 📚 RECURSOS ADICIONALES

- **Arquitectura**: Ver `HYBRID_ARCHITECTURE.md`
- **Schema completo**: Ver `prisma/schema-hybrid-extension.prisma`
- **Deployment**: Ver `DEPLOYMENT.md`

---

## 🎯 PRÓXIMOS PASOS

1. ✅ Implementar autenticación real (NextAuth)
2. ✅ Integrar payment providers (Webpay, Stripe)
3. ✅ Agregar tracking GPS para fleet items
4. ✅ Implementar sistema de notificaciones en tiempo real
5. ✅ Crear dashboard React para sellers
6. ✅ Agregar analytics y reportes

---

**¿Preguntas?** Revisa la documentación técnica completa en los archivos del proyecto.
