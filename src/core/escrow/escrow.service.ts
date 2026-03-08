import { prisma, withTransaction } from '@/lib/db'
import { EventBus } from '@/lib/events'
import { logger } from '@/lib/logger'

type ReleaseCondition = 
  | 'IMMEDIATE'
  | 'DELIVERY_CONFIRMED'
  | 'SERVICE_STARTED'
  | 'SERVICE_COMPLETED'
  | 'RENTAL_RETURNED'
  | 'MILESTONE_REACHED'
  | 'DISPUTE_RESOLVED'

interface CreateEscrowInput {
  orderId?: string
  rentalId?: string
  bookingId?: string
  totalAmount: number
  platformFeePercent: number
  splits: {
    sellerId: string
    amount: number
    releaseCondition: ReleaseCondition
  }[]
  milestones?: {
    name: string
    description: string
    percentage: number
    completionCondition: string
    dueDate?: Date
  }[]
}

interface ReleaseSplitInput {
  escrowHoldId: string
  splitIndex: number
  reason?: string
}

interface CompleteMilestoneInput {
  milestoneId: string
  evidenceUrls?: string[]
  completedBy: string
}

export class EscrowService {
  /**
   * Crear hold de escrow
   */
  async createEscrowHold(input: CreateEscrowInput) {
    logger.info('Creating escrow hold', {
      amount: input.totalAmount,
      splitsCount: input.splits.length
    })
    
    // Validar montos
    const totalSplits = input.splits.reduce((sum, s) => sum + s.amount, 0)
    if (Math.abs(totalSplits - input.totalAmount) > 0.01) {
      throw new Error('Split amounts do not match total amount')
    }
    
    // Calcular fee de plataforma
    const platformFee = input.totalAmount * input.platformFeePercent
    
    // Crear en transacción
    const escrowHold = await withTransaction(async (tx) => {
      const hold = await tx.escrowHold.create({
        data: {
          orderId: input.orderId,
          rentalId: input.rentalId,
          bookingId: input.bookingId,
          totalAmount: input.totalAmount,
          status: 'HELD',
          releaseCondition: input.splits[0].releaseCondition, // Default del primer split
          platformFee,
          splits: {
            create: input.splits.map(split => ({
              sellerId: split.sellerId,
              amount: split.amount,
              releaseCondition: split.releaseCondition,
              status: 'HELD'
            }))
          }
        },
        include: {
          splits: true
        }
      })
      
      // Crear milestones si existen
      if (input.milestones && input.milestones.length > 0) {
        for (let i = 0; i < input.milestones.length; i++) {
          const milestone = input.milestones[i]
          await tx.paymentMilestone.create({
            data: {
              escrowHoldId: hold.id,
              name: milestone.name,
              description: milestone.description,
              percentage: milestone.percentage,
              amount: (input.totalAmount * milestone.percentage) / 100,
              order: i + 1,
              completionCondition: milestone.completionCondition,
              dueDate: milestone.dueDate,
              status: 'PENDING'
            }
          })
        }
      }
      
      return hold
    })
    
    await EventBus.emit('escrow.created', { escrowHoldId: escrowHold.id })
    
    logger.info('Escrow hold created', {
      escrowHoldId: escrowHold.id,
      amount: input.totalAmount
    })
    
    return escrowHold
  }
  
  /**
   * Liberar un split específico
   */
  async releaseSplit(input: ReleaseSplitInput) {
    const escrowHold = await prisma.escrowHold.findUnique({
      where: { id: input.escrowHoldId },
      include: { splits: true }
    })
    
    if (!escrowHold) {
      throw new Error('Escrow hold not found')
    }
    
    const split = escrowHold.splits[input.splitIndex]
    if (!split) {
      throw new Error('Split not found')
    }
    
    if (split.status !== 'HELD') {
      throw new Error('Split already released')
    }
    
    // Liberar en transacción
    await withTransaction(async (tx) => {
      // Actualizar split
      await tx.escrowSplit.update({
        where: { id: split.id },
        data: {
          status: 'RELEASED',
          releasedAt: new Date()
        }
      })
      
      // Actualizar escrow hold
      await tx.escrowHold.update({
        where: { id: input.escrowHoldId },
        data: {
          releasedAmount: {
            increment: split.amount
          }
        }
      })
      
      // TODO: Transferir fondos al seller
      // await this.transferToSeller(split.sellerId, split.amount)
    })
    
    await EventBus.emit('escrow.split_released', {
      escrowHoldId: input.escrowHoldId,
      sellerId: split.sellerId,
      amount: split.amount
    })
    
    logger.info('Escrow split released', {
      escrowHoldId: input.escrowHoldId,
      sellerId: split.sellerId,
      amount: split.amount
    })
    
    return true
  }
  
  /**
   * Liberar todos los splits según condición
   */
  async releaseByCondition(
    escrowHoldId: string,
    condition: ReleaseCondition
  ) {
    const escrowHold = await prisma.escrowHold.findUnique({
      where: { id: escrowHoldId },
      include: { splits: true }
    })
    
    if (!escrowHold) {
      throw new Error('Escrow hold not found')
    }
    
    // Encontrar splits que coinciden con la condición
    const matchingSplits = escrowHold.splits.filter(
      s => s.releaseCondition === condition && s.status === 'HELD'
    )
    
    if (matchingSplits.length === 0) {
      logger.warn('No splits match release condition', { condition })
      return 0
    }
    
    // Liberar todos
    let released = 0
    for (const split of matchingSplits) {
      const index = escrowHold.splits.findIndex(s => s.id === split.id)
      await this.releaseSplit({ escrowHoldId, splitIndex: index })
      released++
    }
    
    return released
  }
  
  /**
   * Completar un milestone
   */
  async completeMilestone(input: CompleteMilestoneInput) {
    const milestone = await prisma.paymentMilestone.findUnique({
      where: { id: input.milestoneId },
      include: { escrowHold: true }
    })
    
    if (!milestone) {
      throw new Error('Milestone not found')
    }
    
    if (milestone.status !== 'PENDING') {
      throw new Error('Milestone already processed')
    }
    
    // Marcar como completado
    await prisma.paymentMilestone.update({
      where: { id: input.milestoneId },
      data: {
        status: 'COMPLETED',
        markedCompleteAt: new Date(),
        evidenceUrls: input.evidenceUrls || []
      }
    })
    
    await EventBus.emit('milestone.completed', {
      milestoneId: input.milestoneId,
      escrowHoldId: milestone.escrowHoldId
    })
    
    logger.info('Milestone completed', {
      milestoneId: input.milestoneId,
      name: milestone.name
    })
    
    return true
  }
  
  /**
   * Aprobar milestone y liberar pago
   */
  async approveMilestone(
    milestoneId: string,
    approvedBy: string
  ) {
    const milestone = await prisma.paymentMilestone.findUnique({
      where: { id: input.milestoneId },
      include: { escrowHold: true }
    })
    
    if (!milestone) {
      throw new Error('Milestone not found')
    }
    
    if (milestone.status !== 'COMPLETED') {
      throw new Error('Milestone must be completed first')
    }
    
    await withTransaction(async (tx) => {
      // Aprobar milestone
      await tx.paymentMilestone.update({
        where: { id: milestoneId },
        data: {
          status: 'APPROVED',
          approvedAt: new Date(),
          approvedBy,
          paidAt: new Date()
        }
      })
      
      // Liberar pago
      // TODO: Transferir fondos
    })
    
    await EventBus.emit('milestone.approved', {
      milestoneId,
      escrowHoldId: milestone.escrowHoldId
    })
    
    return true
  }
  
  /**
   * Reembolsar escrow (en caso de cancelación)
   */
  async refundEscrow(escrowHoldId: string, reason: string) {
    const escrowHold = await prisma.escrowHold.findUnique({
      where: { id: escrowHoldId },
      include: { splits: true }
    })
    
    if (!escrowHold) {
      throw new Error('Escrow hold not found')
    }
    
    if (escrowHold.status !== 'HELD') {
      throw new Error('Escrow already processed')
    }
    
    // Calcular monto a reembolsar
    const refundAmount = escrowHold.totalAmount - escrowHold.releasedAmount
    
    await withTransaction(async (tx) => {
      // Actualizar escrow
      await tx.escrowHold.update({
        where: { id: escrowHoldId },
        data: {
          status: 'REFUNDED',
          refundedAmount: refundAmount
        }
      })
      
      // Actualizar splits
      await tx.escrowSplit.updateMany({
        where: {
          escrowHoldId,
          status: 'HELD'
        },
        data: {
          status: 'REFUNDED'
        }
      })
      
      // TODO: Procesar reembolso al cliente
    })
    
    await EventBus.emit('escrow.refunded', {
      escrowHoldId,
      amount: refundAmount,
      reason
    })
    
    logger.info('Escrow refunded', {
      escrowHoldId,
      amount: refundAmount
    })
    
    return refundAmount
  }
  
  /**
   * Marcar como disputado
   */
  async markDisputed(escrowHoldId: string, disputeId: string) {
    await prisma.escrowHold.update({
      where: { id: escrowHoldId },
      data: {
        status: 'DISPUTED',
        metadata: {
          disputeId
        }
      }
    })
    
    await EventBus.emit('escrow.disputed', { escrowHoldId, disputeId })
    
    return true
  }
  
  /**
   * Obtener balance pendiente de un seller
   */
  async getSellerPendingBalance(sellerId: string) {
    const splits = await prisma.escrowSplit.findMany({
      where: {
        sellerId,
        status: 'HELD'
      }
    })
    
    const totalPending = splits.reduce((sum, split) => sum + split.amount, 0)
    
    return {
      totalPending,
      splitsCount: splits.length,
      splits
    }
  }
  
  /**
   * Obtener balance disponible para retiro
   */
  async getSellerAvailableBalance(sellerId: string) {
    const splits = await prisma.escrowSplit.findMany({
      where: {
        sellerId,
        status: 'RELEASED',
        // TODO: Agregar filtro de "no retirado aún"
      }
    })
    
    const totalAvailable = splits.reduce((sum, split) => sum + split.amount, 0)
    
    return {
      totalAvailable,
      splitsCount: splits.length,
      splits
    }
  }
}
