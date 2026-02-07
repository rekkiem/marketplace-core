import { prisma, withTransaction } from '@/lib/db'
import { EventBus } from '@/lib/events'
import { logger } from '@/lib/logger'
import { PaymentMethod, PaymentStatus, Prisma } from '@prisma/client'

interface CreatePaymentInput {
  orderId: string
  amount: number
  method: PaymentMethod
  idempotencyKey: string
}

export class PaymentService {
  /**
   * Crear pago - IDEMPOTENTE
   */
  async createPayment(input: CreatePaymentInput) {
    // Check idempotency
    const existing = await prisma.payment.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    })
    
    if (existing) {
      logger.info('Payment already exists (idempotent)', {
        paymentId: existing.id,
        idempotencyKey: input.idempotencyKey,
      })
      return existing
    }
    
    const order = await prisma.order.findUnique({
      where: { id: input.orderId },
    })
    
    if (!order) {
      throw new Error('Order not found')
    }
    
    if (Math.abs(order.total - input.amount) > 0.01) {
      throw new Error(
        `Payment amount (${input.amount}) does not match order total (${order.total})`
      )
    }
    
    const payment = await prisma.payment.create({
      data: {
        orderId: input.orderId,
        amount: input.amount,
        currency: 'CLP',
        method: input.method,
        provider: this.getProvider(input.method),
        status: 'PENDING',
        idempotencyKey: input.idempotencyKey,
      },
    })
    
    logger.info('Payment created', {
      paymentId: payment.id,
      orderId: input.orderId,
      amount: input.amount,
    })
    
    return payment
  }
  
  /**
   * Procesar webhook - IDEMPOTENTE
   */
  async handleWebhook(
    provider: string,
    event: string,
    payload: any
  ) {
    const externalId = payload.id || payload.transaction_id
    
    // Guardar webhook primero
    const webhook = await prisma.paymentWebhook.create({
      data: {
        paymentId: '', // Se actualiza después
        provider,
        event,
        payload,
      },
    })
    
    try {
      let payment = await prisma.payment.findUnique({
        where: { externalId },
      })
      
      if (!payment) {
        logger.warn('Payment not found for webhook', { externalId, event })
        return null
      }
      
      // Actualizar webhook con paymentId
      await prisma.paymentWebhook.update({
        where: { id: webhook.id },
        data: { paymentId: payment.id },
      })
      
      // Procesar según evento
      if (event.includes('success') || event.includes('approved')) {
        payment = await this.markAsSucceeded(payment.id)
      } else if (event.includes('fail') || event.includes('rejected')) {
        payment = await this.markAsFailed(payment.id, payload.error_message)
      }
      
      // Marcar webhook como procesado
      await prisma.paymentWebhook.update({
        where: { id: webhook.id },
        data: { processed: true, processedAt: new Date() },
      })
      
      return payment
    } catch (error) {
      // Marcar webhook con error
      await prisma.paymentWebhook.update({
        where: { id: webhook.id },
        data: {
          error: error instanceof Error ? error.message : String(error),
        },
      })
      
      throw error
    }
  }
  
  async markAsSucceeded(paymentId: string) {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { order: true },
    })
    
    if (!payment) {
      throw new Error('Payment not found')
    }
    
    // Idempotencia
    if (payment.status === 'SUCCEEDED') {
      return payment
    }
    
    const updated = await prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: 'SUCCEEDED',
        capturedAt: new Date(),
      },
    })
    
    await EventBus.emit('payment.succeeded', {
      paymentId: payment.id,
      orderId: payment.orderId,
    })
    
    logger.info('Payment succeeded', {
      paymentId,
      orderId: payment.orderId,
    })
    
    return updated
  }
  
  async markAsFailed(paymentId: string, reason?: string) {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
    })
    
    if (!payment) {
      throw new Error('Payment not found')
    }
    
    const updated = await prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: 'FAILED',
        failedAt: new Date(),
        failureReason: reason,
      },
    })
    
    await EventBus.emit('payment.failed', {
      paymentId: payment.id,
      orderId: payment.orderId,
      reason,
    })
    
    logger.warn('Payment failed', {
      paymentId,
      orderId: payment.orderId,
      reason,
    })
    
    return updated
  }
  
  async refund(
    paymentId: string,
    amount: number,
    reason: string,
    tx?: Prisma.TransactionClient
  ) {
    const db = tx || prisma
    
    const payment = await db.payment.findUnique({
      where: { id: paymentId },
    })
    
    if (!payment) {
      throw new Error('Payment not found')
    }
    
    if (payment.status !== 'SUCCEEDED') {
      throw new Error('Can only refund succeeded payments')
    }
    
    const totalRefunded = payment.refundedAmount + amount
    
    if (totalRefunded > payment.amount) {
      throw new Error('Refund amount exceeds payment amount')
    }
    
    const status =
      totalRefunded === payment.amount
        ? 'REFUNDED'
        : 'PARTIALLY_REFUNDED'
    
    const updated = await db.payment.update({
      where: { id: paymentId },
      data: {
        status,
        refundedAmount: totalRefunded,
        refundedAt: totalRefunded === payment.amount ? new Date() : undefined,
        refundReason: reason,
      },
    })
    
    logger.info('Payment refunded', {
      paymentId,
      amount,
      totalRefunded,
      reason,
    })
    
    return updated
  }
  
  private getProvider(method: PaymentMethod): string {
    switch (method) {
      case 'WEBPAY':
        return 'transbank'
      case 'MERCADOPAGO':
        return 'mercadopago'
      case 'CREDIT_CARD':
      case 'DEBIT_CARD':
        return 'stripe'
      default:
        return 'manual'
    }
  }
}
