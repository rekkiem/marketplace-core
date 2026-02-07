import { prisma, withTransaction } from '@/lib/db'
import { EventBus } from '@/lib/events'
import { logger } from '@/lib/logger'
import { InventoryService } from './inventory.service'
import { OrderStatus, ProductType, Prisma } from '@prisma/client'

interface CreateOrderInput {
  userId: string
  items: Array<{
    productId: string
    quantity: number
    scheduledAt?: Date
  }>
  addressId?: string
  shippingMethod?: string
  notes?: string
}

interface UpdateOrderStatusInput {
  orderId: string
  status: OrderStatus
  notes?: string
  userId?: string
}

export class OrderService {
  private inventoryService = new InventoryService()
  
  /**
   * Crear orden con reserva de inventario
   * TRANSACCIÓN CRÍTICA
   */
  async createOrder(input: CreateOrderInput) {
    logger.info('Creating order', { userId: input.userId, itemsCount: input.items.length })
    
    // Validación básica
    if (!input.items || input.items.length === 0) {
      throw new Error('Order must have at least one item')
    }
    
    if (input.items.some(i => i.quantity <= 0)) {
      throw new Error('Item quantity must be positive')
    }
    
    // Obtener productos con información completa
    const productIds = input.items.map(i => i.productId)
    const products = await prisma.product.findMany({
      where: {
        id: { in: productIds },
        status: 'ACTIVE',
        deletedAt: null,
      },
      include: {
        seller: true,
        inventory: true,
      },
    })
    
    if (products.length !== input.items.length) {
      const foundIds = products.map(p => p.id)
      const missingIds = productIds.filter(id => !foundIds.includes(id))
      throw new Error(`Products not available: ${missingIds.join(', ')}`)
    }
    
    // Validar stock para productos físicos
    for (const item of input.items) {
      const product = products.find(p => p.id === item.productId)!
      
      if (product.type === 'PHYSICAL' || product.type === 'HYBRID') {
        const available = await this.inventoryService.getAvailable(product.id)
        
        if (available < item.quantity) {
          throw new Error(
            `Insufficient stock for "${product.name}". Available: ${available}, Requested: ${item.quantity}`
          )
        }
      }
    }
    
    // Calcular totales
    const { subtotal, orderItems, orderType } = this.calculateOrderTotals(
      products,
      input.items
    )
    
    const shippingCost = this.calculateShipping(input.shippingMethod, orderItems)
    const tax = this.calculateTax(subtotal + shippingCost)
    const total = subtotal + shippingCost + tax
    
    // Crear orden en transacción
    const order = await withTransaction(async (tx) => {
      // 1. Reservar inventario
      for (const item of input.items) {
        const product = products.find(p => p.id === item.productId)!
        
        if (product.type === 'PHYSICAL' || product.type === 'HYBRID') {
          await this.inventoryService.reserve(
            item.productId,
            item.quantity,
            tx
          )
        }
      }
      
      // 2. Crear orden
      const orderNumber = this.generateOrderNumber()
      
      const newOrder = await tx.order.create({
        data: {
          orderNumber,
          userId: input.userId,
          type: orderType,
          status: 'PENDING',
          addressId: input.addressId,
          shippingMethod: input.shippingMethod,
          subtotal,
          shippingCost,
          tax,
          total,
          notes: input.notes,
          items: {
            create: orderItems,
          },
        },
        include: {
          items: {
            include: {
              product: true,
              seller: true,
            },
          },
          address: true,
        },
      })
      
      // 3. Registrar en historial
      await tx.orderStatusHistory.create({
        data: {
          orderId: newOrder.id,
          status: 'PENDING',
          notes: 'Order created',
        },
      })
      
      return newOrder
    })
    
    // Emitir evento
    await EventBus.emit('order.created', { orderId: order.id })
    
    logger.info('Order created successfully', {
      orderId: order.id,
      orderNumber: order.orderNumber,
      total: order.total,
    })
    
    return order
  }
  
  /**
   * Confirmar pago (webhook o callback)
   * IDEMPOTENTE
   */
  async confirmPayment(orderId: string, paymentId: string) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { payment: true, items: true },
    })
    
    if (!order) {
      throw new Error('Order not found')
    }
    
    // Si ya está procesado, retornar
    if (order.status !== 'PENDING') {
      logger.info('Order already processed', { orderId, status: order.status })
      return order
    }
    
    // Verificar pago
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
    })
    
    if (!payment || payment.status !== 'SUCCEEDED') {
      throw new Error('Payment not confirmed')
    }
    
    // Actualizar orden
    const updated = await withTransaction(async (tx) => {
      const updatedOrder = await tx.order.update({
        where: { id: orderId },
        data: {
          status: 'PAID',
          paidAt: new Date(),
        },
      })
      
      await tx.orderStatusHistory.create({
        data: {
          orderId,
          status: 'PAID',
          notes: `Payment confirmed: ${paymentId}`,
        },
      })
      
      // Convertir reservas en ventas confirmadas
      for (const item of order.items) {
        if (item.type === 'PHYSICAL' || item.type === 'HYBRID') {
          await this.inventoryService.confirmSale(
            item.productId,
            item.quantity,
            orderId,
            tx
          )
        }
      }
      
      return updatedOrder
    })
    
    await EventBus.emit('order.paid', { orderId: order.id })
    
    logger.info('Order payment confirmed', { orderId, paymentId })
    
    return updated
  }
  
  /**
   * Actualizar estado de orden
   */
  async updateStatus(input: UpdateOrderStatusInput) {
    const { orderId, status, notes, userId } = input
    
    const order = await prisma.order.findUnique({
      where: { id: orderId },
    })
    
    if (!order) {
      throw new Error('Order not found')
    }
    
    // Validar transición de estado
    this.validateStatusTransition(order.status, status)
    
    const updated = await withTransaction(async (tx) => {
      const updatedOrder = await tx.order.update({
        where: { id: orderId },
        data: {
          status,
          ...(status === 'CONFIRMED' && { confirmedAt: new Date() }),
          ...(status === 'SHIPPED' && { shippedAt: new Date() }),
          ...(status === 'DELIVERED' && { deliveredAt: new Date() }),
          ...(status === 'COMPLETED' && { completedAt: new Date() }),
          ...(status === 'CANCELLED' && { cancelledAt: new Date() }),
        },
      })
      
      await tx.orderStatusHistory.create({
        data: {
          orderId,
          status,
          notes,
          createdBy: userId,
        },
      })
      
      return updatedOrder
    })
    
    // Emitir eventos según estado
    if (status === 'CONFIRMED') {
      await EventBus.emit('order.confirmed', { orderId, sellerId: order.userId })
    } else if (status === 'COMPLETED') {
      await EventBus.emit('order.completed', { orderId })
    }
    
    logger.info('Order status updated', { orderId, status })
    
    return updated
  }
  
  /**
   * Cancelar orden
   */
  async cancelOrder(orderId: string, reason: string, userId?: string) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true, payment: true },
    })
    
    if (!order) {
      throw new Error('Order not found')
    }
    
    // Validar que se puede cancelar
    const nonCancellableStatuses: OrderStatus[] = [
      'SHIPPED',
      'IN_TRANSIT',
      'DELIVERED',
      'COMPLETED',
      'CANCELLED',
      'REFUNDED',
    ]
    
    if (nonCancellableStatuses.includes(order.status)) {
      throw new Error(`Cannot cancel order with status: ${order.status}`)
    }
    
    await withTransaction(async (tx) => {
      // Liberar inventario reservado
      for (const item of order.items) {
        if (item.type === 'PHYSICAL' || item.type === 'HYBRID') {
          await this.inventoryService.release(
            item.productId,
            item.quantity,
            tx
          )
        }
      }
      
      // Actualizar orden
      await tx.order.update({
        where: { id: orderId },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
        },
      })
      
      await tx.orderStatusHistory.create({
        data: {
          orderId,
          status: 'CANCELLED',
          notes: reason,
          createdBy: userId,
        },
      })
      
      // Si ya pagó, marcar payment para reembolso
      if (order.payment && order.payment.status === 'SUCCEEDED') {
        await tx.payment.update({
          where: { id: order.payment.id },
          data: {
            status: 'REFUNDED',
            refundedAmount: order.total,
            refundedAt: new Date(),
            refundReason: reason,
          },
        })
      }
    })
    
    await EventBus.emit('order.cancelled', { orderId, reason })
    
    logger.info('Order cancelled', { orderId, reason })
    
    return true
  }
  
  /**
   * Obtener órdenes de un usuario
   */
  async getUserOrders(userId: string, limit: number = 20, offset: number = 0) {
    return prisma.order.findMany({
      where: { userId },
      include: {
        items: {
          include: {
            product: true,
            seller: true,
          },
        },
        address: true,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    })
  }
  
  /**
   * Obtener órdenes de un seller
   */
  async getSellerOrders(sellerId: string, limit: number = 20, offset: number = 0) {
    return prisma.order.findMany({
      where: {
        items: {
          some: {
            sellerId,
          },
        },
      },
      include: {
        items: {
          where: {
            sellerId,
          },
          include: {
            product: true,
          },
        },
        user: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        address: true,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    })
  }
  
  // ========== HELPERS PRIVADOS ==========
  
  private calculateOrderTotals(
    products: any[],
    items: CreateOrderInput['items']
  ) {
    let subtotal = 0
    const orderItems: any[] = []
    const types = new Set<ProductType>()
    
    for (const item of items) {
      const product = products.find(p => p.id === item.productId)!
      types.add(product.type)
      
      const itemSubtotal = product.price * item.quantity
      subtotal += itemSubtotal
      
      orderItems.push({
        productId: product.id,
        sellerId: product.sellerId,
        name: product.name,
        sku: product.sku,
        type: product.type,
        quantity: item.quantity,
        unitPrice: product.price,
        subtotal: itemSubtotal,
        commissionRate: product.seller.commissionRate,
        commissionAmount: itemSubtotal * product.seller.commissionRate,
        scheduledAt: item.scheduledAt,
      })
    }
    
    // Determinar tipo de orden
    let orderType: 'PRODUCT_ONLY' | 'SERVICE_ONLY' | 'HYBRID'
    if (types.has('HYBRID')) {
      orderType = 'HYBRID'
    } else if (types.has('SERVICE') && !types.has('PHYSICAL')) {
      orderType = 'SERVICE_ONLY'
    } else {
      orderType = 'PRODUCT_ONLY'
    }
    
    return { subtotal, orderItems, orderType }
  }
  
  private calculateShipping(method?: string, items?: any[]): number {
    // TODO: Integrar con courier real (Chilexpress, Correos, etc)
    if (!method || method === 'PICKUP') {
      return 0
    }
    
    switch (method) {
      case 'EXPRESS':
        return 5000 // CLP
      case 'STANDARD':
        return 2000
      default:
        return 2000
    }
  }
  
  private calculateTax(amount: number): number {
    return amount * 0.19 // IVA 19% Chile
  }
  
  private generateOrderNumber(): string {
    const date = new Date()
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const random = Math.random().toString(36).substring(2, 8).toUpperCase()
    
    return `ORD-${year}${month}${day}-${random}`
  }
  
  private validateStatusTransition(
    currentStatus: OrderStatus,
    newStatus: OrderStatus
  ) {
    const validTransitions: Record<OrderStatus, OrderStatus[]> = {
      PENDING: ['PAID', 'CANCELLED'],
      PAID: ['CONFIRMED', 'CANCELLED'],
      CONFIRMED: ['PREPARING', 'CANCELLED'],
      PREPARING: ['READY_TO_SHIP', 'CANCELLED'],
      READY_TO_SHIP: ['SHIPPED'],
      SHIPPED: ['IN_TRANSIT'],
      IN_TRANSIT: ['DELIVERED'],
      DELIVERED: ['COMPLETED', 'DISPUTED'],
      COMPLETED: ['DISPUTED'],
      CANCELLED: [],
      REFUNDED: [],
      DISPUTED: ['COMPLETED', 'REFUNDED'],
    }
    
    const allowed = validTransitions[currentStatus]
    
    if (!allowed.includes(newStatus)) {
      throw new Error(
        `Invalid status transition: ${currentStatus} -> ${newStatus}`
      )
    }
  }
}
