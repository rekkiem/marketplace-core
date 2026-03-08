import { prisma, withTransaction } from '@/lib/db'
import { EventBus } from '@/lib/events'
import { logger } from '@/lib/logger'
import { Prisma } from '@prisma/client'

interface CreateRentalInput {
  fleetItemId: string
  userId: string
  startDate: Date
  endDate: Date
  deliveryAddress?: string
  notes?: string
}

interface ReturnInspectionInput {
  rentalId: string
  condition: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR'
  photos: string[]
  damageReport?: {
    description: string
    estimatedCost: number
  }[]
  cleanlinessScore: number // 1-5
}

export class RentalService {
  /**
   * Crear arriendo con cálculo automático de depósito
   */
  async createRental(input: CreateRentalInput) {
    logger.info('Creating rental', { fleetItemId: input.fleetItemId })
    
    // Obtener item de la flota
    const fleetItem = await prisma.fleetItem.findUnique({
      where: { id: input.fleetItemId },
      include: { seller: true }
    })
    
    if (!fleetItem) {
      throw new Error('Fleet item not found')
    }
    
    if (fleetItem.status !== 'AVAILABLE') {
      throw new Error(`Fleet item not available. Current status: ${fleetItem.status}`)
    }
    
    // Verificar disponibilidad en fechas
    const conflicts = await this.checkAvailability(
      input.fleetItemId,
      input.startDate,
      input.endDate
    )
    
    if (conflicts.length > 0) {
      throw new Error('Fleet item has conflicts in requested dates')
    }
    
    // Calcular pricing
    const totalDays = this.calculateDays(input.startDate, input.endDate)
    const pricing = this.calculatePricing(fleetItem, totalDays)
    
    // Calcular depósito (20% del valor base + factor de riesgo)
    const userRiskFactor = await this.getUserRiskFactor(input.userId)
    const depositAmount = (fleetItem.baseValue * fleetItem.depositPercent) * userRiskFactor
    
    // Crear rental en transacción
    const rental = await withTransaction(async (tx) => {
      const newRental = await tx.rental.create({
        data: {
          rentalNumber: this.generateRentalNumber(),
          fleetItemId: input.fleetItemId,
          userId: input.userId,
          sellerId: fleetItem.sellerId,
          startDate: input.startDate,
          endDate: input.endDate,
          dailyRate: fleetItem.dailyRate,
          totalDays,
          subtotal: pricing.subtotal,
          insurance: pricing.insurance,
          delivery: pricing.delivery,
          total: pricing.total,
          depositAmount,
          depositHeld: depositAmount,
          depositStatus: 'held',
          status: 'PENDING_APPROVAL',
          deliveryAddress: input.deliveryAddress,
          notes: input.notes,
          contractTerms: {
            lateReturnPenalty: 100,
            damageDeductible: 200,
            insuranceIncluded: true,
            maxExtensionDays: 7
          }
        }
      })
      
      // Bloquear disponibilidad
      await tx.fleetAvailability.create({
        data: {
          fleetItemId: input.fleetItemId,
          blockType: 'RENTAL',
          startDate: input.startDate,
          endDate: input.endDate,
          rentalId: newRental.id,
          priority: 2 // RENTAL < MAINTENANCE
        }
      })
      
      // Actualizar estado del item
      await tx.fleetItem.update({
        where: { id: input.fleetItemId },
        data: { status: 'RENTED' }
      })
      
      return newRental
    })
    
    // Emitir evento
    await EventBus.emit('rental.created', { rentalId: rental.id })
    
    logger.info('Rental created', {
      rentalId: rental.id,
      rentalNumber: rental.rentalNumber,
      deposit: depositAmount
    })
    
    return rental
  }
  
  /**
   * Confirmar rental (después de aprobación de depósito)
   */
  async confirmRental(rentalId: string, paymentId: string) {
    const rental = await prisma.rental.findUnique({
      where: { id: rentalId }
    })
    
    if (!rental || rental.status !== 'PENDING_APPROVAL') {
      throw new Error('Invalid rental status')
    }
    
    await prisma.rental.update({
      where: { id: rentalId },
      data: {
        status: 'CONFIRMED',
        contractSigned: true,
        contractDate: new Date(),
        paymentId
      }
    })
    
    await EventBus.emit('rental.confirmed', { rentalId })
    
    return true
  }
  
  /**
   * Activar rental (fecha de inicio)
   */
  async activateRental(rentalId: string) {
    const rental = await prisma.rental.findUnique({
      where: { id: rentalId }
    })
    
    if (!rental) {
      throw new Error('Rental not found')
    }
    
    const now = new Date()
    if (now < rental.startDate) {
      throw new Error('Cannot activate rental before start date')
    }
    
    await prisma.rental.update({
      where: { id: rentalId },
      data: { status: 'ACTIVE' }
    })
    
    await EventBus.emit('rental.activated', { rentalId })
    
    return true
  }
  
  /**
   * Procesar devolución con inspección
   */
  async processReturn(
    rentalId: string,
    inspection: ReturnInspectionInput
  ) {
    const rental = await prisma.rental.findUnique({
      where: { id: rentalId },
      include: { fleetItem: true }
    })
    
    if (!rental) {
      throw new Error('Rental not found')
    }
    
    // Calcular deducciones
    const deductions = this.calculateDeductions(
      rental,
      inspection
    )
    
    const depositRefund = Math.max(
      0,
      rental.depositHeld - deductions.total
    )
    
    // Procesar en transacción
    await withTransaction(async (tx) => {
      // Actualizar rental
      await tx.rental.update({
        where: { id: rentalId },
        data: {
          status: 'COMPLETED',
          actualReturnDate: new Date(),
          postRentalCheck: {
            condition: inspection.condition,
            photos: inspection.photos,
            cleanlinessScore: inspection.cleanlinessScore
          },
          damageReport: inspection.damageReport,
          deductions: deductions.breakdown,
          totalDeducted: deductions.total,
          depositRefunded: depositRefund,
          depositStatus: depositRefund === rental.depositHeld ? 'refunded' : 'deducted'
        }
      })
      
      // Liberar fleet item
      await tx.fleetItem.update({
        where: { id: rental.fleetItemId },
        data: {
          status: inspection.condition === 'POOR' ? 'DAMAGED' : 'AVAILABLE',
          totalRentals: { increment: 1 },
          totalRevenue: { increment: rental.total }
        }
      })
      
      // Eliminar bloqueo de disponibilidad
      await tx.fleetAvailability.deleteMany({
        where: {
          fleetItemId: rental.fleetItemId,
          rentalId: rentalId
        }
      })
    })
    
    await EventBus.emit('rental.returned', {
      rentalId,
      depositRefund,
      deductions: deductions.total
    })
    
    logger.info('Rental returned', {
      rentalId,
      condition: inspection.condition,
      depositRefund,
      deductions: deductions.total
    })
    
    return {
      depositRefund,
      deductions
    }
  }
  
  /**
   * Solicitar extensión de arriendo
   */
  async requestExtension(
    rentalId: string,
    newEndDate: Date,
    userId: string
  ) {
    const rental = await prisma.rental.findUnique({
      where: { id: rentalId },
      include: { fleetItem: true }
    })
    
    if (!rental || rental.userId !== userId) {
      throw new Error('Rental not found or unauthorized')
    }
    
    if (rental.status !== 'ACTIVE') {
      throw new Error('Can only extend active rentals')
    }
    
    // Validar fecha
    const maxDate = new Date(rental.endDate)
    maxDate.setDate(maxDate.getDate() + 7) // Max 7 días
    
    if (newEndDate > maxDate) {
      throw new Error('Extension exceeds maximum allowed days')
    }
    
    // Verificar disponibilidad
    const conflicts = await this.checkAvailability(
      rental.fleetItemId,
      rental.endDate,
      newEndDate
    )
    
    if (conflicts.length > 0) {
      throw new Error('Fleet item not available for extension period')
    }
    
    // Calcular costo adicional
    const additionalDays = this.calculateDays(rental.endDate, newEndDate)
    const additionalCost = rental.dailyRate * additionalDays
    const additionalDeposit = rental.fleetItem.baseValue * 0.1 // 10% adicional
    
    // Actualizar rental
    const extensions = rental.extensions || []
    extensions.push({
      requestDate: new Date(),
      oldEndDate: rental.endDate,
      newEndDate,
      additionalCost,
      additionalDeposit
    })
    
    await withTransaction(async (tx) => {
      await tx.rental.update({
        where: { id: rentalId },
        data: {
          endDate: newEndDate,
          totalDays: rental.totalDays + additionalDays,
          total: rental.total + additionalCost,
          depositHeld: rental.depositHeld + additionalDeposit,
          extensionCount: { increment: 1 },
          extensions
        }
      })
      
      // Extender bloqueo de disponibilidad
      await tx.fleetAvailability.updateMany({
        where: {
          fleetItemId: rental.fleetItemId,
          rentalId: rentalId
        },
        data: {
          endDate: newEndDate
        }
      })
    })
    
    await EventBus.emit('rental.extended', {
      rentalId,
      newEndDate,
      additionalCost
    })
    
    return {
      additionalCost,
      additionalDeposit,
      newEndDate
    }
  }
  
  /**
   * Marcar como overdue (job automático)
   */
  async markOverdue(rentalId: string) {
    await prisma.rental.update({
      where: { id: rentalId },
      data: { status: 'OVERDUE' }
    })
    
    await EventBus.emit('rental.overdue', { rentalId })
  }
  
  // ========== HELPERS PRIVADOS ==========
  
  private async checkAvailability(
    fleetItemId: string,
    startDate: Date,
    endDate: Date
  ) {
    return prisma.fleetAvailability.findMany({
      where: {
        fleetItemId,
        OR: [
          {
            AND: [
              { startDate: { lte: startDate } },
              { endDate: { gte: startDate } }
            ]
          },
          {
            AND: [
              { startDate: { lte: endDate } },
              { endDate: { gte: endDate } }
            ]
          },
          {
            AND: [
              { startDate: { gte: startDate } },
              { endDate: { lte: endDate } }
            ]
          }
        ]
      }
    })
  }
  
  private calculateDays(start: Date, end: Date): number {
    const diff = end.getTime() - start.getTime()
    return Math.ceil(diff / (1000 * 60 * 60 * 24))
  }
  
  private calculatePricing(fleetItem: any, totalDays: number) {
    let subtotal = 0
    
    // Aplicar rates (weekly/monthly si aplica)
    if (totalDays >= 30 && fleetItem.monthlyRate) {
      const months = Math.floor(totalDays / 30)
      const remainingDays = totalDays % 30
      subtotal = (months * fleetItem.monthlyRate) + (remainingDays * fleetItem.dailyRate)
    } else if (totalDays >= 7 && fleetItem.weeklyRate) {
      const weeks = Math.floor(totalDays / 7)
      const remainingDays = totalDays % 7
      subtotal = (weeks * fleetItem.weeklyRate) + (remainingDays * fleetItem.dailyRate)
    } else {
      subtotal = totalDays * fleetItem.dailyRate
    }
    
    const insurance = subtotal * 0.05 // 5% seguro
    const delivery = 50 // Fixed delivery fee
    
    return {
      subtotal,
      insurance,
      delivery,
      total: subtotal + insurance + delivery
    }
  }
  
  private async getUserRiskFactor(userId: string): Promise<number> {
    // Obtener historial de rentals del usuario
    const history = await prisma.rental.findMany({
      where: { userId },
      select: { status: true, totalDeducted: true }
    })
    
    if (history.length === 0) {
      return 1.5 // Usuario nuevo = mayor riesgo
    }
    
    const completedRentals = history.filter(r => r.status === 'COMPLETED').length
    const avgDeductions = history.reduce((sum, r) => sum + r.totalDeducted, 0) / history.length
    
    // Factor basado en historial
    if (completedRentals >= 5 && avgDeductions < 50) {
      return 0.8 // Usuario confiable
    } else if (avgDeductions > 200) {
      return 2.0 // Usuario problemático
    }
    
    return 1.0 // Normal
  }
  
  private calculateDeductions(rental: any, inspection: ReturnInspectionInput) {
    const breakdown: any = {}
    let total = 0
    
    // Limpieza
    if (inspection.cleanlinessScore < 3) {
      const cleaningCost = (3 - inspection.cleanlinessScore) * 50
      breakdown.cleaning = cleaningCost
      total += cleaningCost
    }
    
    // Daños
    if (inspection.damageReport && inspection.damageReport.length > 0) {
      const damageCost = inspection.damageReport.reduce(
        (sum, damage) => sum + damage.estimatedCost,
        0
      )
      breakdown.damage = damageCost
      total += damageCost
    }
    
    // Late return
    if (rental.actualReturnDate && rental.actualReturnDate > rental.endDate) {
      const lateDays = this.calculateDays(rental.endDate, rental.actualReturnDate)
      const lateFee = lateDays * 100
      breakdown.lateFee = lateFee
      total += lateFee
    }
    
    return { breakdown, total }
  }
  
  private generateRentalNumber(): string {
    const date = new Date()
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const random = Math.random().toString(36).substring(2, 8).toUpperCase()
    
    return `RENT-${year}${month}${day}-${random}`
  }
}
