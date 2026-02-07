import { prisma } from '@/lib/db'
import { EventBus } from '@/lib/events'
import { logger } from '@/lib/logger'
import { Prisma } from '@prisma/client'

export class InventoryService {
  /**
   * Obtener stock disponible
   */
  async getAvailable(productId: string): Promise<number> {
    const inventory = await prisma.inventory.findUnique({
      where: { productId },
    })
    
    if (!inventory) {
      return 0
    }
    
    return Math.max(0, inventory.quantity - inventory.reserved)
  }
  
  /**
   * Reservar stock (durante creación de orden)
   * ATÓMICO: usa increment para evitar race conditions
   */
  async reserve(
    productId: string,
    quantity: number,
    tx?: Prisma.TransactionClient
  ) {
    const db = tx || prisma
    
    const inventory = await db.inventory.findUnique({
      where: { productId },
    })
    
    if (!inventory) {
      throw new Error(`No inventory found for product ${productId}`)
    }
    
    const available = inventory.quantity - inventory.reserved
    
    if (available < quantity) {
      throw new Error(
        `Insufficient stock for product ${productId}. ` +
        `Available: ${available}, Requested: ${quantity}`
      )
    }
    
    // Actualizar con operación atómica
    const updated = await db.inventory.update({
      where: { productId },
      data: {
        reserved: {
          increment: quantity,
        },
        available: {
          decrement: quantity,
        },
      },
    })
    
    // Registrar movimiento
    await db.stockMovement.create({
      data: {
        productId,
        type: 'RESERVATION',
        quantity: -quantity,
        balanceBefore: available,
        balanceAfter: available - quantity,
        notes: 'Stock reserved for order',
      },
    })
    
    logger.debug('Stock reserved', { productId, quantity, available: updated.available })
    
    return updated
  }
  
  /**
   * Confirmar venta (convierte reserva en venta)
   * Se llama cuando el pago es confirmado
   */
  async confirmSale(
    productId: string,
    quantity: number,
    orderId: string,
    tx?: Prisma.TransactionClient
  ) {
    const db = tx || prisma
    
    const inventory = await db.inventory.findUnique({
      where: { productId },
    })
    
    if (!inventory) {
      throw new Error(`No inventory found for product ${productId}`)
    }
    
    if (inventory.reserved < quantity) {
      throw new Error(
        `Cannot confirm sale: reserved stock (${inventory.reserved}) ` +
        `is less than quantity (${quantity})`
      )
    }
    
    // Actualizar inventario
    const updated = await db.inventory.update({
      where: { productId },
      data: {
        quantity: {
          decrement: quantity,
        },
        reserved: {
          decrement: quantity,
        },
        lastSaleAt: new Date(),
      },
    })
    
    // Registrar movimiento
    await db.stockMovement.create({
      data: {
        productId,
        type: 'SALE',
        quantity: -quantity,
        reference: orderId,
        balanceBefore: inventory.quantity,
        balanceAfter: updated.quantity,
        notes: 'Sale confirmed',
      },
    })
    
    // Actualizar estadísticas del producto
    await db.product.update({
      where: { id: productId },
      data: {
        totalSales: {
          increment: 1,
        },
      },
    })
    
    // Verificar low stock
    if (updated.available <= updated.lowStockAlert) {
      await EventBus.emit('inventory.low', {
        productId,
        quantity: updated.available,
      })
    }
    
    logger.info('Sale confirmed', {
      productId,
      quantity,
      orderId,
      remainingStock: updated.quantity,
    })
    
    return updated
  }
  
  /**
   * Liberar reserva (en caso de cancelación)
   */
  async release(
    productId: string,
    quantity: number,
    tx?: Prisma.TransactionClient
  ) {
    const db = tx || prisma
    
    const inventory = await db.inventory.findUnique({
      where: { productId },
    })
    
    if (!inventory) {
      throw new Error(`No inventory found for product ${productId}`)
    }
    
    if (inventory.reserved < quantity) {
      logger.warn('Attempting to release more than reserved', {
        productId,
        requested: quantity,
        reserved: inventory.reserved,
      })
      
      // Ajustar a lo que realmente estaba reservado
      quantity = inventory.reserved
    }
    
    const updated = await db.inventory.update({
      where: { productId },
      data: {
        reserved: {
          decrement: quantity,
        },
        available: {
          increment: quantity,
        },
      },
    })
    
    // Registrar movimiento
    await db.stockMovement.create({
      data: {
        productId,
        type: 'RELEASE',
        quantity: quantity,
        balanceBefore: inventory.quantity - inventory.reserved,
        balanceAfter: updated.available,
        notes: 'Reservation released',
      },
    })
    
    logger.debug('Stock released', { productId, quantity, available: updated.available })
    
    return updated
  }
  
  /**
   * Restock (para sellers)
   */
  async restock(
    productId: string,
    quantity: number,
    userId: string,
    notes?: string
  ) {
    if (quantity <= 0) {
      throw new Error('Restock quantity must be positive')
    }
    
    const inventory = await prisma.inventory.findUnique({
      where: { productId },
    })
    
    if (!inventory) {
      throw new Error(`No inventory found for product ${productId}`)
    }
    
    const updated = await prisma.inventory.update({
      where: { productId },
      data: {
        quantity: {
          increment: quantity,
        },
        available: {
          increment: quantity,
        },
        lastRestockAt: new Date(),
      },
    })
    
    await prisma.stockMovement.create({
      data: {
        productId,
        type: 'RESTOCK',
        quantity,
        balanceBefore: inventory.quantity,
        balanceAfter: updated.quantity,
        notes,
        createdBy: userId,
      },
    })
    
    // Actualizar estado del producto si estaba out of stock
    const product = await prisma.product.findUnique({
      where: { id: productId },
    })
    
    if (product?.status === 'OUT_OF_STOCK') {
      await prisma.product.update({
        where: { id: productId },
        data: { status: 'ACTIVE' },
      })
    }
    
    logger.info('Inventory restocked', {
      productId,
      quantity,
      newStock: updated.quantity,
      userId,
    })
    
    return updated
  }
  
  /**
   * Ajuste manual de inventario (para correcciones)
   */
  async adjust(
    productId: string,
    newQuantity: number,
    userId: string,
    reason: string
  ) {
    if (newQuantity < 0) {
      throw new Error('Quantity cannot be negative')
    }
    
    const inventory = await prisma.inventory.findUnique({
      where: { productId },
    })
    
    if (!inventory) {
      throw new Error(`No inventory found for product ${productId}`)
    }
    
    const difference = newQuantity - inventory.quantity
    
    const updated = await prisma.inventory.update({
      where: { productId },
      data: {
        quantity: newQuantity,
        available: Math.max(0, newQuantity - inventory.reserved),
      },
    })
    
    await prisma.stockMovement.create({
      data: {
        productId,
        type: 'ADJUSTMENT',
        quantity: difference,
        balanceBefore: inventory.quantity,
        balanceAfter: newQuantity,
        notes: reason,
        createdBy: userId,
      },
    })
    
    logger.info('Inventory adjusted', {
      productId,
      oldQuantity: inventory.quantity,
      newQuantity,
      difference,
      userId,
      reason,
    })
    
    return updated
  }
  
  /**
   * Crear inventario para un nuevo producto
   */
  async create(
    productId: string,
    sellerId: string,
    initialQuantity: number = 0
  ) {
    return prisma.inventory.create({
      data: {
        productId,
        sellerId,
        quantity: initialQuantity,
        available: initialQuantity,
        reserved: 0,
        lowStockAlert: 5,
        restockThreshold: 10,
      },
    })
  }
  
  /**
   * Obtener movimientos de stock
   */
  async getMovements(
    productId: string,
    limit: number = 50,
    offset: number = 0
  ) {
    return prisma.stockMovement.findMany({
      where: { productId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    })
  }
}
