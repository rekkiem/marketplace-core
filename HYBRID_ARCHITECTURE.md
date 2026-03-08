# ARQUITECTURA AVANZADA - MARKETPLACE HÍBRIDO
## Productos + Servicios + Arriendos

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         FRONTEND LAYER (Next.js 14)                         │
│                                                                             │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐  ┌──────────────────┐  │
│  │   Buyer     │  │   Seller     │  │   Admin    │  │   Technician     │  │
│  │  Dashboard  │  │  Dashboard   │  │  Dashboard │  │    Portal        │  │
│  └──────┬──────┘  └──────┬───────┘  └─────┬──────┘  └─────────┬────────┘  │
│         │                 │                │                    │           │
└─────────┼─────────────────┼────────────────┼────────────────────┼───────────┘
          │                 │                │                    │
┌─────────▼─────────────────▼────────────────▼────────────────────▼───────────┐
│                        API GATEWAY / NEXT.JS API ROUTES                     │
│                                                                             │
│  Rate Limiting │ Auth Middleware │ Request Validation │ Response Caching   │
└─────────┬───────────────────────────────────────────────────────────────────┘
          │
          ├──────────────────────┬──────────────────────┬─────────────────────┐
          │                      │                      │                     │
┌─────────▼─────────┐  ┌─────────▼─────────┐  ┌───────▼──────────┐  ┌──────▼──────┐
│  CATALOG MODULE   │  │  BOOKING MODULE   │  │  RENTAL MODULE   │  │ ORDER MODULE│
│                   │  │                   │  │                  │  │             │
│ • Products        │  │ • Availability    │  │ • Fleet Mgmt     │  │ • Cart      │
│ • Services        │  │ • Scheduling      │  │ • Contracts      │  │ • Checkout  │
│ • Inventory       │  │ • Technicians     │  │ • Deposits       │  │ • Escrow    │
│ • Categories      │  │ • Time Slots      │  │ • Insurance      │  │ • Shipping  │
└─────────┬─────────┘  └─────────┬─────────┘  └────────┬─────────┘  └──────┬──────┘
          │                      │                      │                   │
          │      ┌───────────────▼──────────────────────▼───────────┐       │
          │      │           RESERVATION COORDINATOR                │       │
          │      │                                                   │       │
          │      │  • Cross-module availability check                │       │
          │      │  • Conflict detection (product + service + rental)│       │
          │      │  • Calendar sync (unified view)                   │       │
          │      └───────────────┬──────────────────────┬────────────┘       │
          │                      │                      │                    │
┌─────────▼──────────────────────▼──────────────────────▼────────────────────▼─┐
│                           PAYMENT & ESCROW ENGINE                            │
│                                                                              │
│  ┌──────────────┐  ┌─────────────┐  ┌────────────────┐  ┌────────────────┐ │
│  │ Payment      │  │  Escrow     │  │  Deposit       │  │  Commission    │ │
│  │ Processing   │  │  Holding    │  │  Management    │  │  Calculation   │ │
│  └──────┬───────┘  └──────┬──────┘  └────────┬───────┘  └────────┬───────┘ │
│         │                  │                  │                    │         │
└─────────┼──────────────────┼──────────────────┼────────────────────┼─────────┘
          │                  │                  │                    │
┌─────────▼──────────────────▼──────────────────▼────────────────────▼─────────┐
│                      EVENT BUS & WORKFLOW ENGINE                             │
│                                                                              │
│  Events:                                                                     │
│  • rental.reserved → Lock inventory + Hold deposit                           │
│  • service.scheduled → Assign technician + Block calendar                    │
│  • order.completed → Release escrow + Update reputation                      │
│  • rental.returned → Inspect + Release deposit + Update availability         │
│  • service.finished → Mark complete + Allow review                           │
└─────────┬────────────────────────────────────────────────────────────────────┘
          │
┌─────────▼────────────────────────────────────────────────────────────────────┐
│                      PERSISTENCE LAYER (PostgreSQL)                          │
│                                                                              │
│  ┌────────────┐  ┌────────────┐  ┌─────────────┐  ┌──────────────────────┐ │
│  │  Products  │  │  Bookings  │  │   Rentals   │  │   Escrow_Holds       │ │
│  │  (Polymor) │  │  TimeSlots │  │   Contracts │  │   Milestone_Payments │ │
│  └────────────┘  └────────────┘  └─────────────┘  └──────────────────────┘ │
│                                                                              │
│  ┌────────────┐  ┌────────────┐  ┌─────────────┐  ┌──────────────────────┐ │
│  │ Inventory  │  │Technicians │  │ Fleet_Items │  │   Availability       │ │
│  │ (Stock)    │  │ (Skills)   │  │ (Equipment) │  │   Calendar           │ │
│  └────────────┘  └────────────┘  └─────────────┘  └──────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 🔐 VALIDACIONES DE SEGURIDAD PARA ARRIENDOS

### 1. Pre-Rental Validations
```typescript
interface RentalSecurityChecks {
  // Verificación de usuario
  userVerification: {
    identityVerified: boolean      // KYC completo
    creditScore?: number            // Score crediticio (opcional)
    previousRentals: number         // Historial de arriendos
    blacklisted: boolean            // Lista negra
  }
  
  // Depósito de garantía
  deposit: {
    minimumAmount: number           // Calculado por algoritmo
    collectedAmount: number
    paymentMethod: 'hold' | 'charge' // Hold en tarjeta vs cargo
    refundableDate: Date
  }
  
  // Disponibilidad real
  availability: {
    itemId: string
    requestedDates: { start: Date; end: Date }
    conflicts: Conflict[]           // Reservas superpuestas
    maintenanceSchedule: Date[]     // Mantenimientos programados
  }
}
```

### 2. Durante el Arriendo
```typescript
interface ActiveRentalMonitoring {
  // Seguimiento GPS (para equipos de alto valor)
  tracking?: {
    lastKnownLocation: GeoPoint
    geofenceViolation: boolean
    movementAlerts: Alert[]
  }
  
  // Comunicación con cliente
  checkIns: {
    scheduled: Date[]
    completed: Date[]
    issues: Issue[]
  }
  
  // Extensiones
  extensionRequests: {
    originalEndDate: Date
    requestedEndDate: Date
    additionalDeposit: number
    approvalRequired: boolean
  }
}
```

### 3. Post-Rental (Devolución)
```typescript
interface ReturnInspection {
  // Inspección física
  condition: {
    preRentalPhotos: string[]
    postRentalPhotos: string[]
    damageAssessment: DamageReport[]
    cleanlinessScore: number        // 1-5
  }
  
  // Cálculo de deducciones
  deductions: {
    cleaning: number
    minorRepairs: number
    majorDamage: number
    lateReturn: number
    total: number
  }
  
  // Liberación de depósito
  depositRefund: {
    originalDeposit: number
    deductions: number
    refundAmount: number
    processingTime: number          // Días
    status: 'pending' | 'approved' | 'disputed'
  }
}
```

---

## 🔄 COMUNICACIÓN ENTRE MÓDULOS

### Escenario 1: Compra de Producto + Servicio de Instalación

```typescript
// FLUJO:
// 1. Usuario agrega al carrito: Aire Acondicionado ($500) + Instalación ($150)
// 2. Sistema verifica:
const transaction = await ReservationCoordinator.validate({
  items: [
    { 
      type: 'PRODUCT',
      productId: 'ac-001',
      quantity: 1,
      requiresService: true  // ← Flag crítico
    },
    {
      type: 'SERVICE',
      serviceId: 'install-ac',
      linkedToProduct: 'ac-001',  // ← Vinculación
      scheduledDate: '2024-03-15',
      timeSlot: '09:00-12:00'
    }
  ]
})

// 3. Validaciones cruzadas:
// ✓ Inventario tiene stock del AC
// ✓ Técnico disponible en fecha/hora
// ✓ Servicio compatible con producto
// ✓ Zona geográfica cubierta

// 4. Checkout:
await CheckoutEngine.process({
  subtotal: 650,
  shipping: 20,  // Solo producto físico
  tax: 127,      // 19% IVA Chile
  escrowSplit: [
    { 
      seller: 'seller-001', 
      amount: 500, 
      releaseOn: 'delivery_confirmed' 
    },
    { 
      seller: 'technician-002', 
      amount: 150, 
      releaseOn: 'service_completed' 
    }
  ]
})
```

### Escenario 2: Arriendo de Maquinaria

```typescript
// Usuario arrienda un Taladro Industrial por 7 días
const rental = await RentalModule.create({
  fleetItemId: 'drill-heavy-001',
  userId: 'user-123',
  startDate: '2024-03-10',
  endDate: '2024-03-17',
  
  // Cálculo automático de depósito
  depositCalculation: {
    baseValue: 2000,        // Valor del equipo
    riskFactor: 1.2,        // Usuario nuevo = mayor riesgo
    dailyRate: 50,
    rentalDays: 7,
    suggestedDeposit: 400   // 20% del valor + días de arriendo
  },
  
  // Términos del contrato
  terms: {
    lateReturnPenalty: 100,  // Por día
    damageDeductible: 200,
    insuranceIncluded: true,
    maxExtensionDays: 7
  }
})

// Sistema:
// 1. Hold en tarjeta: deposit (400) + rental (350) = 750
// 2. Cargo inmediato: rental (350)
// 3. Bloqueo de calendario: 10-17 marzo
// 4. Asignación de inventario: drill-heavy-001 → RENTED
```

---

## 💰 SISTEMA DE ESCROW & MILESTONE PAYMENTS

### Arquitectura de Pagos Escalonados

```typescript
enum ReleaseCondition {
  IMMEDIATE = 'immediate',                    // Productos digitales
  DELIVERY_CONFIRMED = 'delivery_confirmed',  // Productos físicos
  SERVICE_STARTED = 'service_started',        // 50% al inicio
  SERVICE_COMPLETED = 'service_completed',    // 50% al terminar
  RENTAL_RETURNED = 'rental_returned',        // Inspección OK
  MILESTONE_REACHED = 'milestone_reached',    // Proyectos grandes
  DISPUTE_RESOLVED = 'dispute_resolved'       // Mediación
}

interface EscrowHold {
  id: string
  orderId: string
  totalAmount: number
  
  // Distribución por vendedor
  splits: {
    sellerId: string
    amount: number
    releaseCondition: ReleaseCondition
    releaseDate?: Date
    status: 'held' | 'released' | 'disputed'
    
    // Para servicios/arriendos complejos
    milestones?: {
      description: string
      percentage: number        // % del total
      condition: string
      dueDate?: Date
      completed: boolean
    }[]
  }[]
  
  // Comisión de plataforma
  platformFee: {
    percentage: number          // Variable por tipo
    amount: number
    collected: boolean
  }
}
```

### Ejemplo: Proyecto de Instalación Eléctrica Compleja

```typescript
const complexProject = {
  total: 5000,
  milestones: [
    {
      name: 'Inspección inicial',
      percentage: 10,      // $500
      release: 'service_started',
      seller: 'electrician-001'
    },
    {
      name: 'Materiales comprados',
      percentage: 30,      // $1500
      release: 'milestone_reached',
      seller: 'supplier-002',
      evidence: ['receipt-001', 'receipt-002']
    },
    {
      name: 'Cableado completado',
      percentage: 30,      // $1500
      release: 'milestone_reached',
      seller: 'electrician-001',
      evidence: ['photo-001', 'photo-002']
    },
    {
      name: 'Inspección final',
      percentage: 30,      // $1500
      release: 'service_completed',
      seller: 'electrician-001'
    }
  ]
}

// Usuario puede disputar en cada milestone
// Plataforma retiene hasta resolución
```

---

## 🎯 DASHBOARD MULTI-TENANT

### Segmentación por Rol

```typescript
// VENDEDOR DE PRODUCTOS
interface SellerProductDashboard {
  inventory: {
    totalProducts: number
    lowStock: Product[]
    outOfStock: Product[]
    reorderAlerts: Alert[]
  }
  
  sales: {
    totalRevenue: number
    pendingEscrow: number       // En hold
    availableForWithdrawal: number
    orders: {
      pending: Order[]
      shipped: Order[]
      completed: Order[]
    }
  }
  
  // Si también ofrece servicios
  services?: SellerServiceDashboard
}

// PROVEEDOR DE SERVICIOS
interface SellerServiceDashboard {
  technicians: {
    total: number
    available: Technician[]
    onJob: Technician[]
    schedule: CalendarView
  }
  
  bookings: {
    upcoming: Booking[]
    inProgress: Booking[]
    completed: Booking[]
    cancelled: Booking[]
  }
  
  revenue: {
    escrowHeld: number
    releasedThisMonth: number
    avgJobValue: number
  }
}

// PROVEEDOR DE ARRIENDOS
interface RentalProviderDashboard {
  fleet: {
    total: FleetItem[]
    available: FleetItem[]
    rented: FleetItem[]
    maintenance: FleetItem[]
    damaged: FleetItem[]
  }
  
  rentals: {
    active: Rental[]
    overdue: Rental[]
    upcoming: Rental[]
    pendingReturn: Rental[]
  }
  
  deposits: {
    totalHeld: number
    pendingRefund: number
    deductionsThisMonth: number
  }
  
  utilization: {
    avgUtilizationRate: number  // % tiempo rentado
    mostRentedItem: string
    seasonalTrends: ChartData
  }
}
```

---

## 🔧 MOTOR DE DISPONIBILIDAD (Availability Engine)

### Unified Calendar System

```typescript
interface AvailabilitySlot {
  id: string
  resourceType: 'PRODUCT' | 'TECHNICIAN' | 'FLEET_ITEM'
  resourceId: string
  
  // Bloqueos
  blocks: {
    type: 'RENTAL' | 'SERVICE' | 'MAINTENANCE' | 'MANUAL'
    startDate: Date
    endDate: Date
    orderId?: string
    reason?: string
    priority: number  // Para resolver conflictos
  }[]
  
  // Disponibilidad calculada
  availableSlots: {
    date: Date
    available: boolean
    reason?: string
  }[]
}

// Algoritmo de detección de conflictos
class ConflictDetector {
  async checkAvailability(request: BookingRequest): Promise<ConflictResult> {
    // 1. Obtener todos los bloqueos para el recurso
    const blocks = await this.getBlocks(request.resourceId)
    
    // 2. Detectar superposiciones
    const conflicts = blocks.filter(block => 
      this.isOverlapping(request.dates, { 
        start: block.startDate, 
        end: block.endDate 
      })
    )
    
    // 3. Validar prioridades (ej: mantenimiento > arriendo)
    const criticalConflicts = conflicts.filter(c => c.priority >= request.priority)
    
    return {
      available: criticalConflicts.length === 0,
      conflicts: criticalConflicts,
      alternativeDates: await this.suggestAlternatives(request)
    }
  }
}
```

---

## 📊 MÉTRICAS Y KPIs DEL SISTEMA

```typescript
interface MarketplaceMetrics {
  // Transaccionales
  gmv: number                    // Gross Merchandise Value
  escrowBalance: number          // Total retenido
  avgOrderValue: number
  
  // Por tipo de transacción
  breakdown: {
    products: { count: number; value: number }
    services: { count: number; value: number }
    rentals: { count: number; value: number }
  }
  
  // Eficiencia operacional
  fulfillment: {
    avgDeliveryTime: number      // Días
    avgServiceCompletionTime: number
    rentalReturnOnTime: number   // %
  }
  
  // Salud financiera
  deposits: {
    totalHeld: number
    avgRefundTime: number        // Días
    disputeRate: number          // %
  }
}
```

---

## 🚨 DECISIONES CRÍTICAS DE ARQUITECTURA

### ¿Por qué NO microservicios completos?

1. **Transacciones Cross-Module**: Checkout necesita coordinar inventory + booking + rental en una sola transacción ACID
2. **Complejidad Operacional**: Microservicios = kafka/rabbitmq + service mesh + circuit breakers
3. **Latencia**: Llamadas inter-servicios añaden 50-200ms por hop

### ¿Qué SÍ usamos?

- **Modular Monolith**: Módulos bien definidos dentro de una app
- **Shared Database con Bounded Contexts**: Cada módulo "owns" sus tablas
- **Event Bus In-Process**: Eventos asíncronos sin overhead de red
- **Future-Ready**: Fácil extraer un módulo cuando necesite escalar independiente

---

## PRÓXIMO PASO

Voy a implementar:
1. ✅ Schema Prisma polimórfico (Productos + Servicios + Arriendos)
2. ✅ Servicios core (Rental, Booking, Escrow)
3. ✅ API endpoints completos
4. ✅ Dashboard components (React)
5. ✅ Checkout unificado

¿Procedemos con la implementación del código?
