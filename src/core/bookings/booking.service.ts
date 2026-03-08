import { prisma, withTransaction } from '@/lib/db'
import { EventBus } from '@/lib/events'
import { logger } from '@/lib/logger'

interface CreateBookingInput {
  productId: string  // Service product
  userId: string
  scheduledDate: Date
  scheduledTime: string  // "09:00-12:00"
  serviceAddress: string
  linkedOrderItemId?: string  // Si viene con compra de producto
  notes?: string
}

interface AssignTechnicianInput {
  bookingId: string
  technicianId: string
}

interface CompleteServiceInput {
  bookingId: string
  workDescription: string
  afterPhotos: string[]
  materialsCost?: number
}

export class BookingService {
  /**
   * Crear booking de servicio
   */
  async createBooking(input: CreateBookingInput) {
    logger.info('Creating booking', { productId: input.productId })
    
    // Obtener producto de servicio
    const product = await prisma.product.findUnique({
      where: { id: input.productId },
      include: { seller: true }
    })
    
    if (!product) {
      throw new Error('Product not found')
    }
    
    if (product.type !== 'SERVICE' && product.type !== 'HYBRID') {
      throw new Error('Product is not a service')
    }
    
    // Verificar disponibilidad de técnicos en fecha/hora
    const availableTechnicians = await this.findAvailableTechnicians(
      product.sellerId,
      input.scheduledDate,
      input.scheduledTime,
      product.serviceDuration || 120
    )
    
    if (availableTechnicians.length === 0) {
      throw new Error('No technicians available for selected date/time')
    }
    
    // Crear booking
    const booking = await prisma.booking.create({
      data: {
        bookingNumber: this.generateBookingNumber(),
        productId: input.productId,
        userId: input.userId,
        sellerId: product.sellerId,
        linkedOrderItemId: input.linkedOrderItemId,
        scheduledDate: input.scheduledDate,
        scheduledTime: input.scheduledTime,
        duration: product.serviceDuration || 120,
        serviceAddress: input.serviceAddress,
        serviceRate: product.price,
        total: product.price,
        status: 'PENDING_CONFIRMATION',
        notes: input.notes
      }
    })
    
    await EventBus.emit('booking.created', { bookingId: booking.id })
    
    logger.info('Booking created', {
      bookingId: booking.id,
      bookingNumber: booking.bookingNumber
    })
    
    return booking
  }
  
  /**
   * Confirmar booking y asignar técnico
   */
  async confirmBooking(input: AssignTechnicianInput) {
    const booking = await prisma.booking.findUnique({
      where: { id: input.bookingId },
      include: { technician: true }
    })
    
    if (!booking) {
      throw new Error('Booking not found')
    }
    
    // Verificar disponibilidad del técnico
    const isAvailable = await this.checkTechnicianAvailability(
      input.technicianId,
      booking.scheduledDate,
      booking.scheduledTime,
      booking.duration
    )
    
    if (!isAvailable) {
      throw new Error('Technician not available')
    }
    
    // Asignar técnico en transacción
    await withTransaction(async (tx) => {
      // Actualizar booking
      await tx.booking.update({
        where: { id: input.bookingId },
        data: {
          technicianId: input.technicianId,
          status: 'CONFIRMED'
        }
      })
      
      // Bloquear disponibilidad del técnico
      const [startTime, endTime] = this.parseTimeSlot(
        booking.scheduledDate,
        booking.scheduledTime,
        booking.duration
      )
      
      await tx.technicianAvailability.create({
        data: {
          technicianId: input.technicianId,
          blockType: 'BOOKING',
          startTime,
          endTime,
          bookingId: input.bookingId
        }
      })
    })
    
    await EventBus.emit('booking.confirmed', {
      bookingId: input.bookingId,
      technicianId: input.technicianId
    })
    
    return true
  }
  
  /**
   * Marcar servicio como iniciado
   */
  async startService(bookingId: string, beforePhotos: string[]) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId }
    })
    
    if (!booking) {
      throw new Error('Booking not found')
    }
    
    if (booking.status !== 'CONFIRMED') {
      throw new Error('Booking must be confirmed first')
    }
    
    await prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: 'IN_PROGRESS',
        startedAt: new Date(),
        beforePhotos
      }
    })
    
    await EventBus.emit('service.started', { bookingId })
    
    return true
  }
  
  /**
   * Completar servicio
   */
  async completeService(input: CompleteServiceInput) {
    const booking = await prisma.booking.findUnique({
      where: { id: input.bookingId },
      include: { technician: true }
    })
    
    if (!booking) {
      throw new Error('Booking not found')
    }
    
    if (booking.status !== 'IN_PROGRESS') {
      throw new Error('Service must be in progress')
    }
    
    // Actualizar booking
    const total = booking.serviceRate + (input.materialsCost || 0)
    
    await withTransaction(async (tx) => {
      await tx.booking.update({
        where: { id: input.bookingId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          workDescription: input.workDescription,
          afterPhotos: input.afterPhotos,
          materialsCost: input.materialsCost || 0,
          total
        }
      })
      
      // Actualizar stats del técnico
      if (booking.technicianId) {
        await tx.technician.update({
          where: { id: booking.technicianId },
          data: {
            totalJobs: { increment: 1 }
          }
        })
      }
      
      // Liberar slot de disponibilidad
      await tx.technicianAvailability.deleteMany({
        where: {
          technicianId: booking.technicianId!,
          bookingId: input.bookingId
        }
      })
    })
    
    await EventBus.emit('service.completed', { bookingId: input.bookingId })
    
    logger.info('Service completed', {
      bookingId: input.bookingId,
      total
    })
    
    return true
  }
  
  /**
   * Cancelar booking
   */
  async cancelBooking(bookingId: string, reason: string) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId }
    })
    
    if (!booking) {
      throw new Error('Booking not found')
    }
    
    if (['COMPLETED', 'CANCELLED'].includes(booking.status)) {
      throw new Error('Cannot cancel booking in current status')
    }
    
    await withTransaction(async (tx) => {
      await tx.booking.update({
        where: { id: bookingId },
        data: {
          status: 'CANCELLED',
          notes: `${booking.notes || ''}\n[CANCELLED] ${reason}`
        }
      })
      
      // Liberar disponibilidad del técnico
      if (booking.technicianId) {
        await tx.technicianAvailability.deleteMany({
          where: {
            technicianId: booking.technicianId,
            bookingId: bookingId
          }
        })
      }
    })
    
    await EventBus.emit('booking.cancelled', { bookingId, reason })
    
    return true
  }
  
  /**
   * Obtener bookings de un técnico
   */
  async getTechnicianBookings(
    technicianId: string,
    startDate?: Date,
    endDate?: Date
  ) {
    return prisma.booking.findMany({
      where: {
        technicianId,
        ...(startDate && endDate && {
          scheduledDate: {
            gte: startDate,
            lte: endDate
          }
        })
      },
      orderBy: { scheduledDate: 'asc' }
    })
  }
  
  // ========== HELPERS PRIVADOS ==========
  
  private async findAvailableTechnicians(
    sellerId: string,
    date: Date,
    timeSlot: string,
    duration: number
  ) {
    // Obtener todos los técnicos del seller
    const technicians = await prisma.technician.findMany({
      where: {
        sellerId,
        isActive: true,
        isVerified: true
      }
    })
    
    // Filtrar por disponibilidad
    const available = []
    for (const tech of technicians) {
      const isAvailable = await this.checkTechnicianAvailability(
        tech.id,
        date,
        timeSlot,
        duration
      )
      
      if (isAvailable) {
        available.push(tech)
      }
    }
    
    return available
  }
  
  private async checkTechnicianAvailability(
    technicianId: string,
    date: Date,
    timeSlot: string,
    duration: number
  ): Promise<boolean> {
    const [startTime, endTime] = this.parseTimeSlot(date, timeSlot, duration)
    
    // Verificar conflictos
    const conflicts = await prisma.technicianAvailability.findMany({
      where: {
        technicianId,
        OR: [
          {
            AND: [
              { startTime: { lte: startTime } },
              { endTime: { gte: startTime } }
            ]
          },
          {
            AND: [
              { startTime: { lte: endTime } },
              { endTime: { gte: endTime } }
            ]
          },
          {
            AND: [
              { startTime: { gte: startTime } },
              { endTime: { lte: endTime } }
            ]
          }
        ]
      }
    })
    
    return conflicts.length === 0
  }
  
  private parseTimeSlot(
    date: Date,
    timeSlot: string,
    duration: number
  ): [Date, Date] {
    const [startTimeStr] = timeSlot.split('-')
    const [hours, minutes] = startTimeStr.split(':').map(Number)
    
    const startTime = new Date(date)
    startTime.setHours(hours, minutes, 0)
    
    const endTime = new Date(startTime)
    endTime.setMinutes(endTime.getMinutes() + duration)
    
    return [startTime, endTime]
  }
  
  private generateBookingNumber(): string {
    const date = new Date()
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const random = Math.random().toString(36).substring(2, 8).toUpperCase()
    
    return `BOOK-${year}${month}${day}-${random}`
  }
}
