import { prisma, withTransaction } from '@/lib/db'
import { EventBus } from '@/lib/events'
import { logger } from '@/lib/logger'
import { OrderService } from '../orders/order.service'
import { RentalService } from '../rentals/rental.service'
import { BookingService } from '../bookings/booking.service'
import { EscrowService } from '../escrow/escrow.service'
import { ReservationCoordinator } from '../coordination/reservation-coordinator.service'

interface CheckoutItem {
  type: 'PRODUCT' | 'SERVICE' | 'RENTAL' | 'BUNDLE'
  productId?: string
  fleetItemId?: string
  quantity?: number
  scheduledDate?: Date
  scheduledTime?: string
  rentalStartDate?: Date
  rentalEndDate?: Date
  linkedToProduct?: string
  metadata?: any
}

interface CheckoutInput {
  userId: string
  items: CheckoutItem[]
  addressId?: string
  shippingMethod?: string
  paymentMethod: string
  idempotencyKey: string
  notes?: string
}

interface CheckoutResult {
  success: boolean
  orderId?: string
  rentalIds?: string[]
  bookingIds?: string[]
  escrowHoldId?: string
  totalAmount: number
  depositAmount?: number
  errors?: string[]
}

/**
 * Servicio unificado de checkout
 * Procesa productos, servicios y arriendos en una sola transacción
 */
export class UnifiedCheckoutService {
  private orderService = new OrderService()
  private rentalService = new RentalService()
  private bookingService = new BookingService()
  private escrowService = new EscrowService()
  private coordinator = new ReservationCoordinator()
  
  /**
   * Procesar checkout completo
   */
  async processCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    logger.info('Processing unified checkout', {
      userId: input.userId,
      itemsCount: input.items.length,
      idempotencyKey: input.idempotencyKey
    })
    
    // 1. Validar idempotencia
    const existing = await this.checkIdempotency(input.idempotencyKey)
    if (existing) {
      logger.info('Checkout already processed (idempotent)', { idempotencyKey: input.idempotencyKey })
      return existing
    }
    
    // 2. Validar disponibilidad de todos los items
    const validation = await this.coordinator.validateCart(input.items)
    
    if (!validation.valid) {
      return {
        success: false,
        totalAmount: 0,
        errors: validation.errors.map(e => e.message)
      }
    }
    
    // 3. Separar items por tipo
    const grouped = this.groupItemsByType(input.items)
    
    // 4. Calcular totales
    const pricing = await this.calculatePricing(grouped)
    
    // 5. Procesar en transacción grande
    const result = await this.executeCheckout(input, grouped, pricing)
    
    // 6. Guardar resultado para idempotencia
    await this.saveCheckoutResult(input.idempotencyKey, result)
    
    logger.info('Checkout completed successfully', {
      orderId: result.orderId,
      totalAmount: result.totalAmount
    })
    
    return result
  }
  
  /**
   * Ejecutar checkout (transacción principal)
   */
  private async executeCheckout(
    input: CheckoutInput,
    grouped: GroupedItems,
    pricing: PricingBreakdown
  ): Promise<CheckoutResult> {
    const result: CheckoutResult = {
      success: false,
      totalAmount: pricing.grandTotal,
      depositAmount: pricing.totalDeposit
    }
    
    try {
      await withTransaction(async (tx) => {
        // 1. Crear Order si hay productos físicos o servicios standalone
        if (grouped.products.length > 0 || grouped.standaloneServices.length > 0) {
          const orderItems = [
            ...grouped.products.map(item => ({
              productId: item.productId!,
              quantity: item.quantity!,
              scheduledAt: undefined
            })),
            ...grouped.standaloneServices.map(item => ({
              productId: item.productId!,
              quantity: 1,
              scheduledAt: item.scheduledDate
            }))
          ]
          
          const order = await this.orderService.createOrder({
            userId: input.userId,
            items: orderItems,
            addressId: input.addressId,
            shippingMethod: input.shippingMethod,
            notes: input.notes
          })
          
          result.orderId = order.id
        }
        
        // 2. Crear Rentals
        if (grouped.rentals.length > 0) {
          result.rentalIds = []
          
          for (const rentalItem of grouped.rentals) {
            const rental = await this.rentalService.createRental({
              fleetItemId: rentalItem.fleetItemId!,
              userId: input.userId,
              startDate: rentalItem.rentalStartDate!,
              endDate: rentalItem.rentalEndDate!,
              deliveryAddress: input.addressId ? undefined : 'TBD',
              notes: input.notes
            })
            
            result.rentalIds.push(rental.id)
          }
        }
        
        // 3. Crear Bookings para servicios
        if (grouped.services.length > 0) {
          result.bookingIds = []
          
          for (const serviceItem of grouped.services) {
            const booking = await this.bookingService.createBooking({
              productId: serviceItem.productId!,
              userId: input.userId,
              scheduledDate: serviceItem.scheduledDate!,
              scheduledTime: serviceItem.scheduledTime!,
              serviceAddress: input.addressId ? 'FROM_ADDRESS' : 'TBD',
              linkedOrderItemId: serviceItem.linkedToProduct,
              notes: input.notes
            })
            
            result.bookingIds.push(booking.id)
          }
        }
        
        // 4. Crear Escrow Hold
        const escrowSplits = this.calculateEscrowSplits(
          grouped,
          pricing,
          result.orderId,
          result.rentalIds,
          result.bookingIds
        )
        
        const escrowHold = await this.escrowService.createEscrowHold({
          orderId: result.orderId,
          totalAmount: pricing.grandTotal,
          platformFeePercent: 0.10, // 10% comisión
          splits: escrowSplits
        })
        
        result.escrowHoldId = escrowHold.id
        
        // 5. Procesar pago (simulado aquí, en real llamar a payment provider)
        // await this.processPayment(input.paymentMethod, pricing.grandTotal)
        
        result.success = true
      })
      
      // Emitir evento de checkout completado
      await EventBus.emit('checkout.completed', {
        userId: input.userId,
        orderId: result.orderId,
        totalAmount: result.totalAmount
      })
      
    } catch (error) {
      logger.error('Checkout failed', error)
      result.success = false
      result.errors = [error instanceof Error ? error.message : 'Unknown error']
    }
    
    return result
  }
  
  /**
   * Agrupar items por tipo
   */
  private groupItemsByType(items: CheckoutItem[]): GroupedItems {
    return {
      products: items.filter(i => i.type === 'PRODUCT'),
      services: items.filter(i => i.type === 'SERVICE' || i.type === 'BUNDLE'),
      standaloneServices: items.filter(i => i.type === 'SERVICE' && !i.linkedToProduct),
      rentals: items.filter(i => i.type === 'RENTAL')
    }
  }
  
  /**
   * Calcular pricing completo
   */
  private async calculatePricing(grouped: GroupedItems): Promise<PricingBreakdown> {
    let productSubtotal = 0
    let serviceSubtotal = 0
    let rentalSubtotal = 0
    let totalDeposit = 0
    
    // Productos
    for (const item of grouped.products) {
      const product = await prisma.product.findUnique({
        where: { id: item.productId }
      })
      
      if (product) {
        productSubtotal += product.price * (item.quantity || 1)
      }
    }
    
    // Servicios
    for (const item of grouped.services) {
      const product = await prisma.product.findUnique({
        where: { id: item.productId }
      })
      
      if (product) {
        serviceSubtotal += product.price
      }
    }
    
    // Rentals
    for (const item of grouped.rentals) {
      const fleetItem = await prisma.fleetItem.findUnique({
        where: { id: item.fleetItemId }
      })
      
      if (fleetItem && item.rentalStartDate && item.rentalEndDate) {
        const days = Math.ceil(
          (item.rentalEndDate.getTime() - item.rentalStartDate.getTime()) / (1000 * 60 * 60 * 24)
        )
        
        const rentalCost = days * fleetItem.dailyRate
        rentalSubtotal += rentalCost
        
        // Calcular depósito
        const deposit = fleetItem.baseValue * fleetItem.depositPercent
        totalDeposit += deposit
      }
    }
    
    const subtotal = productSubtotal + serviceSubtotal + rentalSubtotal
    const shipping = grouped.products.length > 0 ? 2000 : 0 // Solo si hay productos físicos
    const tax = (subtotal + shipping) * 0.19 // IVA Chile
    const grandTotal = subtotal + shipping + tax
    
    return {
      productSubtotal,
      serviceSubtotal,
      rentalSubtotal,
      subtotal,
      shipping,
      tax,
      grandTotal,
      totalDeposit
    }
  }
  
  /**
   * Calcular splits de escrow
   */
  private calculateEscrowSplits(
    grouped: GroupedItems,
    pricing: PricingBreakdown,
    orderId?: string,
    rentalIds?: string[],
    bookingIds?: string[]
  ) {
    const splits: any[] = []
    
    // Split para productos (release on delivery)
    if (pricing.productSubtotal > 0) {
      splits.push({
        sellerId: 'SELLER_ID', // En real, obtener del producto
        amount: pricing.productSubtotal,
        releaseCondition: 'DELIVERY_CONFIRMED'
      })
    }
    
    // Split para servicios (50% on start, 50% on completion)
    if (pricing.serviceSubtotal > 0) {
      const half = pricing.serviceSubtotal / 2
      
      splits.push({
        sellerId: 'SERVICE_SELLER_ID',
        amount: half,
        releaseCondition: 'SERVICE_STARTED'
      })
      
      splits.push({
        sellerId: 'SERVICE_SELLER_ID',
        amount: half,
        releaseCondition: 'SERVICE_COMPLETED'
      })
    }
    
    // Split para rentals (release on return)
    if (pricing.rentalSubtotal > 0) {
      splits.push({
        sellerId: 'RENTAL_SELLER_ID',
        amount: pricing.rentalSubtotal,
        releaseCondition: 'RENTAL_RETURNED'
      })
    }
    
    return splits
  }
  
  /**
   * Verificar idempotencia
   */
  private async checkIdempotency(key: string): Promise<CheckoutResult | null> {
    // En producción, guardar en Redis o DB
    // Por ahora retornamos null
    return null
  }
  
  /**
   * Guardar resultado para idempotencia
   */
  private async saveCheckoutResult(key: string, result: CheckoutResult) {
    // En producción, guardar en Redis con TTL de 24 horas
    logger.debug('Saving checkout result for idempotency', { key })
  }
}

// ========== TYPES ==========

interface GroupedItems {
  products: CheckoutItem[]
  services: CheckoutItem[]
  standaloneServices: CheckoutItem[]
  rentals: CheckoutItem[]
}

interface PricingBreakdown {
  productSubtotal: number
  serviceSubtotal: number
  rentalSubtotal: number
  subtotal: number
  shipping: number
  tax: number
  grandTotal: number
  totalDeposit: number
}
