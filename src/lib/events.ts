import { logger } from './logger'

type EventHandler<T = any> = (data: T) => void | Promise<void>

interface EventMetadata {
  timestamp: Date
  eventId: string
}

export type DomainEvent =
  | { type: 'order.created'; data: { orderId: string } }
  | { type: 'order.paid'; data: { orderId: string } }
  | { type: 'order.confirmed'; data: { orderId: string; sellerId: string } }
  | { type: 'order.cancelled'; data: { orderId: string; reason: string } }
  | { type: 'order.completed'; data: { orderId: string } }
  | { type: 'payment.succeeded'; data: { paymentId: string; orderId: string } }
  | { type: 'payment.failed'; data: { paymentId: string; orderId: string; reason?: string } }
  | { type: 'review.created'; data: { reviewId: string; productId: string; sellerId: string } }
  | { type: 'review.response'; data: { reviewId: string; sellerId: string } }
  | { type: 'inventory.low'; data: { productId: string; quantity: number } }
  | { type: 'seller.verified'; data: { sellerId: string } }
  | { type: 'user.registered'; data: { userId: string } }

class EventBusClass {
  private handlers: Map<string, EventHandler[]> = new Map()
  private eventHistory: Array<DomainEvent & EventMetadata> = []
  
  /**
   * Registrar un handler para un tipo de evento
   */
  on<T extends DomainEvent['type']>(
    eventType: T,
    handler: EventHandler<Extract<DomainEvent, { type: T }>['data']>
  ) {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, [])
    }
    
    this.handlers.get(eventType)!.push(handler)
    
    logger.debug(`Event handler registered: ${eventType}`)
  }
  
  /**
   * Emitir un evento
   */
  async emit<T extends DomainEvent['type']>(
    eventType: T,
    data: Extract<DomainEvent, { type: T }>['data']
  ) {
    const eventId = this.generateEventId()
    const event = {
      type: eventType,
      data,
      timestamp: new Date(),
      eventId,
    }
    
    // Guardar en historial (en producción esto iría a una queue o event store)
    this.eventHistory.push(event as any)
    
    logger.info(`Event emitted: ${eventType}`, { eventId, data })
    
    const handlers = this.handlers.get(eventType) || []
    
    // Ejecutar handlers en paralelo
    const results = await Promise.allSettled(
      handlers.map(handler =>
        this.executeHandler(handler, data, eventType, eventId)
      )
    )
    
    // Log errores
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        logger.error(
          `Event handler failed: ${eventType}`,
          result.reason,
          { eventId, handlerIndex: index }
        )
      }
    })
  }
  
  private async executeHandler(
    handler: EventHandler,
    data: any,
    eventType: string,
    eventId: string
  ) {
    try {
      await handler(data)
      logger.debug(`Event handler succeeded: ${eventType}`, { eventId })
    } catch (error) {
      logger.error(
        `Event handler error: ${eventType}`,
        error,
        { eventId }
      )
      throw error
    }
  }
  
  private generateEventId(): string {
    return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }
  
  /**
   * Obtener historial de eventos (útil para debugging)
   */
  getHistory(limit: number = 100) {
    return this.eventHistory.slice(-limit)
  }
  
  /**
   * Limpiar historial
   */
  clearHistory() {
    this.eventHistory = []
  }
}

export const EventBus = new EventBusClass()

// Registrar handlers por defecto
EventBus.on('order.created', async ({ orderId }) => {
  logger.info('Order created', { orderId })
  // TODO: Enviar email de confirmación
})

EventBus.on('order.paid', async ({ orderId }) => {
  logger.info('Order paid', { orderId })
  // TODO: Notificar al seller
})

EventBus.on('payment.failed', async ({ orderId, reason }) => {
  logger.warn('Payment failed', { orderId, reason })
  // TODO: Liberar inventario automáticamente
})

EventBus.on('inventory.low', async ({ productId, quantity }) => {
  logger.warn('Low stock alert', { productId, quantity })
  // TODO: Notificar al seller
})

EventBus.on('review.created', async ({ reviewId, productId, sellerId }) => {
  logger.info('Review created', { reviewId, productId, sellerId })
  // TODO: Notificar al seller
})
