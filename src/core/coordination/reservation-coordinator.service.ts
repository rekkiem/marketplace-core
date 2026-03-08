import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import { RentalService } from '../rentals/rental.service'
import { BookingService } from '../bookings/booking.service'
import { InventoryService } from '../inventory/inventory.service'

type ItemType = 'PRODUCT' | 'SERVICE' | 'RENTAL' | 'BUNDLE'

interface CartValidationItem {
  type: ItemType
  productId?: string
  fleetItemId?: string
  quantity?: number
  scheduledDate?: Date
  scheduledTime?: string
  rentalStartDate?: Date
  rentalEndDate?: Date
  linkedToProduct?: string  // Para BUNDLE
}

interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
  warnings: ValidationWarning[]
  suggestions?: Suggestion[]
}

interface ValidationError {
  itemIndex: number
  field: string
  message: string
  severity: 'error' | 'critical'
}

interface ValidationWarning {
  itemIndex: number
  message: string
}

interface Suggestion {
  itemIndex: number
  type: 'alternative_date' | 'alternative_product' | 'split_order'
  data: any
}

/**
 * Coordinador central de reservas
 * Maneja validación cross-module de disponibilidad
 */
export class ReservationCoordinator {
  private rentalService = new RentalService()
  private bookingService = new BookingService()
  private inventoryService = new InventoryService()
  
  /**
   * Validar un carrito completo con múltiples tipos de items
   */
  async validateCart(items: CartValidationItem[]): Promise<ValidationResult> {
    logger.info('Validating cart', { itemsCount: items.length })
    
    const errors: ValidationError[] = []
    const warnings: ValidationWarning[] = []
    const suggestions: Suggestion[] = []
    
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      
      try {
        switch (item.type) {
          case 'PRODUCT':
            await this.validateProduct(i, item, errors, warnings)
            break
          
          case 'SERVICE':
            await this.validateService(i, item, errors, warnings, suggestions)
            break
          
          case 'RENTAL':
            await this.validateRental(i, item, errors, warnings, suggestions)
            break
          
          case 'BUNDLE':
            await this.validateBundle(i, item, items, errors, warnings)
            break
        }
      } catch (error) {
        errors.push({
          itemIndex: i,
          field: 'general',
          message: error instanceof Error ? error.message : 'Unknown error',
          severity: 'critical'
        })
      }
    }
    
    // Validaciones cross-item
    await this.validateCrossItemConstraints(items, errors, warnings)
    
    return {
      valid: errors.length === 0,
      errors,
      warnings,
      suggestions
    }
  }
  
  /**
   * Validar producto físico
   */
  private async validateProduct(
    index: number,
    item: CartValidationItem,
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ) {
    if (!item.productId || !item.quantity) {
      errors.push({
        itemIndex: index,
        field: 'product',
        message: 'Product ID and quantity required',
        severity: 'critical'
      })
      return
    }
    
    // Verificar que existe y está activo
    const product = await prisma.product.findUnique({
      where: { id: item.productId },
      include: { inventory: true }
    })
    
    if (!product) {
      errors.push({
        itemIndex: index,
        field: 'productId',
        message: 'Product not found',
        severity: 'critical'
      })
      return
    }
    
    if (product.status !== 'ACTIVE') {
      errors.push({
        itemIndex: index,
        field: 'status',
        message: `Product not available (status: ${product.status})`,
        severity: 'error'
      })
      return
    }
    
    // Verificar stock
    if (product.type === 'PHYSICAL' || product.type === 'HYBRID') {
      const available = await this.inventoryService.getAvailable(item.productId)
      
      if (available < item.quantity) {
        errors.push({
          itemIndex: index,
          field: 'quantity',
          message: `Insufficient stock. Available: ${available}, requested: ${item.quantity}`,
          severity: 'error'
        })
      } else if (available < item.quantity * 1.5) {
        warnings.push({
          itemIndex: index,
          message: `Low stock warning. Only ${available} units available`
        })
      }
    }
  }
  
  /**
   * Validar servicio
   */
  private async validateService(
    index: number,
    item: CartValidationItem,
    errors: ValidationError[],
    warnings: ValidationWarning[],
    suggestions: Suggestion[]
  ) {
    if (!item.productId || !item.scheduledDate || !item.scheduledTime) {
      errors.push({
        itemIndex: index,
        field: 'service',
        message: 'Service requires product ID, date and time',
        severity: 'critical'
      })
      return
    }
    
    // Verificar producto de servicio
    const product = await prisma.product.findUnique({
      where: { id: item.productId },
      include: { seller: true }
    })
    
    if (!product) {
      errors.push({
        itemIndex: index,
        field: 'productId',
        message: 'Service product not found',
        severity: 'critical'
      })
      return
    }
    
    if (product.type !== 'SERVICE' && product.type !== 'HYBRID') {
      errors.push({
        itemIndex: index,
        field: 'type',
        message: 'Product is not a service',
        severity: 'critical'
      })
      return
    }
    
    // Verificar fecha no sea en el pasado
    if (item.scheduledDate < new Date()) {
      errors.push({
        itemIndex: index,
        field: 'scheduledDate',
        message: 'Scheduled date cannot be in the past',
        severity: 'error'
      })
      return
    }
    
    // Verificar disponibilidad de técnicos
    const technicians = await prisma.technician.findMany({
      where: {
        sellerId: product.sellerId,
        isActive: true,
        isVerified: true
      }
    })
    
    if (technicians.length === 0) {
      errors.push({
        itemIndex: index,
        field: 'availability',
        message: 'No technicians available for this service',
        severity: 'error'
      })
      return
    }
    
    // Verificar disponibilidad en fecha específica
    let hasAvailableTech = false
    for (const tech of technicians) {
      const isAvailable = await this.checkTechnicianAvailability(
        tech.id,
        item.scheduledDate,
        item.scheduledTime!,
        product.serviceDuration || 120
      )
      
      if (isAvailable) {
        hasAvailableTech = true
        break
      }
    }
    
    if (!hasAvailableTech) {
      errors.push({
        itemIndex: index,
        field: 'scheduledTime',
        message: 'No technicians available at selected date/time',
        severity: 'error'
      })
      
      // Sugerir fechas alternativas
      const alternatives = await this.findAlternativeServiceDates(
        product.sellerId,
        item.scheduledDate,
        product.serviceDuration || 120
      )
      
      if (alternatives.length > 0) {
        suggestions.push({
          itemIndex: index,
          type: 'alternative_date',
          data: alternatives
        })
      }
    }
  }
  
  /**
   * Validar arriendo
   */
  private async validateRental(
    index: number,
    item: CartValidationItem,
    errors: ValidationError[],
    warnings: ValidationWarning[],
    suggestions: Suggestion[]
  ) {
    if (!item.fleetItemId || !item.rentalStartDate || !item.rentalEndDate) {
      errors.push({
        itemIndex: index,
        field: 'rental',
        message: 'Rental requires fleet item ID and date range',
        severity: 'critical'
      })
      return
    }
    
    // Verificar fleet item
    const fleetItem = await prisma.fleetItem.findUnique({
      where: { id: item.fleetItemId }
    })
    
    if (!fleetItem) {
      errors.push({
        itemIndex: index,
        field: 'fleetItemId',
        message: 'Fleet item not found',
        severity: 'critical'
      })
      return
    }
    
    if (fleetItem.status !== 'AVAILABLE') {
      errors.push({
        itemIndex: index,
        field: 'status',
        message: `Fleet item not available (status: ${fleetItem.status})`,
        severity: 'error'
      })
      return
    }
    
    // Validar fechas
    if (item.rentalStartDate < new Date()) {
      errors.push({
        itemIndex: index,
        field: 'rentalStartDate',
        message: 'Start date cannot be in the past',
        severity: 'error'
      })
      return
    }
    
    if (item.rentalEndDate <= item.rentalStartDate) {
      errors.push({
        itemIndex: index,
        field: 'rentalEndDate',
        message: 'End date must be after start date',
        severity: 'error'
      })
      return
    }
    
    // Verificar disponibilidad
    const conflicts = await prisma.fleetAvailability.findMany({
      where: {
        fleetItemId: item.fleetItemId,
        OR: [
          {
            AND: [
              { startDate: { lte: item.rentalStartDate } },
              { endDate: { gte: item.rentalStartDate } }
            ]
          },
          {
            AND: [
              { startDate: { lte: item.rentalEndDate } },
              { endDate: { gte: item.rentalEndDate } }
            ]
          }
        ]
      }
    })
    
    if (conflicts.length > 0) {
      errors.push({
        itemIndex: index,
        field: 'dates',
        message: 'Fleet item not available in requested date range',
        severity: 'error'
      })
      
      // Sugerir fechas alternativas
      const alternatives = await this.findAlternativeRentalDates(
        item.fleetItemId,
        item.rentalStartDate,
        item.rentalEndDate
      )
      
      if (alternatives.length > 0) {
        suggestions.push({
          itemIndex: index,
          type: 'alternative_date',
          data: alternatives
        })
      }
    }
  }
  
  /**
   * Validar bundle (producto + servicio)
   */
  private async validateBundle(
    index: number,
    item: CartValidationItem,
    allItems: CartValidationItem[],
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ) {
    if (!item.linkedToProduct) {
      errors.push({
        itemIndex: index,
        field: 'linkedToProduct',
        message: 'Bundle service must be linked to a product',
        severity: 'critical'
      })
      return
    }
    
    // Verificar que el producto vinculado existe en el carrito
    const linkedProductIndex = allItems.findIndex(
      i => i.type === 'PRODUCT' && i.productId === item.linkedToProduct
    )
    
    if (linkedProductIndex === -1) {
      errors.push({
        itemIndex: index,
        field: 'linkedToProduct',
        message: 'Linked product not found in cart',
        severity: 'error'
      })
      return
    }
    
    // Verificar que el servicio es compatible con el producto
    const product = await prisma.product.findUnique({
      where: { id: item.linkedToProduct }
    })
    
    const service = await prisma.product.findUnique({
      where: { id: item.productId }
    })
    
    if (!product || !service) {
      errors.push({
        itemIndex: index,
        field: 'compatibility',
        message: 'Cannot verify product-service compatibility',
        severity: 'error'
      })
      return
    }
    
    // Aquí podrías agregar lógica de compatibilidad específica
    // Por ejemplo: servicio de instalación solo para ciertos tipos de productos
  }
  
  /**
   * Validaciones que cruzan items
   */
  private async validateCrossItemConstraints(
    items: CartValidationItem[],
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ) {
    // Verificar que no hay duplicados
    const productIds = new Set<string>()
    const fleetIds = new Set<string>()
    
    items.forEach((item, index) => {
      if (item.type === 'PRODUCT' && item.productId) {
        if (productIds.has(item.productId)) {
          warnings.push({
            itemIndex: index,
            message: 'Duplicate product in cart. Consider increasing quantity.'
          })
        }
        productIds.add(item.productId)
      }
      
      if (item.type === 'RENTAL' && item.fleetItemId) {
        if (fleetIds.has(item.fleetItemId)) {
          errors.push({
            itemIndex: index,
            field: 'fleetItemId',
            message: 'Cannot rent the same item multiple times in one order',
            severity: 'error'
          })
        }
        fleetIds.add(item.fleetItemId)
      }
    })
  }
  
  // ========== HELPERS PRIVADOS ==========
  
  private async checkTechnicianAvailability(
    technicianId: string,
    date: Date,
    timeSlot: string,
    duration: number
  ): Promise<boolean> {
    const [startTime, endTime] = this.parseTimeSlot(date, timeSlot, duration)
    
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
          }
        ]
      }
    })
    
    return conflicts.length === 0
  }
  
  private parseTimeSlot(date: Date, timeSlot: string, duration: number): [Date, Date] {
    const [startTimeStr] = timeSlot.split('-')
    const [hours, minutes] = startTimeStr.split(':').map(Number)
    
    const startTime = new Date(date)
    startTime.setHours(hours, minutes, 0)
    
    const endTime = new Date(startTime)
    endTime.setMinutes(endTime.getMinutes() + duration)
    
    return [startTime, endTime]
  }
  
  private async findAlternativeServiceDates(
    sellerId: string,
    preferredDate: Date,
    duration: number
  ) {
    // Buscar en los próximos 7 días
    const alternatives = []
    const timeSlots = ['09:00-12:00', '12:00-15:00', '15:00-18:00']
    
    for (let day = 0; day < 7; day++) {
      const date = new Date(preferredDate)
      date.setDate(date.getDate() + day)
      
      for (const slot of timeSlots) {
        // Verificar si hay técnicos disponibles
        const technicians = await prisma.technician.findMany({
          where: { sellerId, isActive: true }
        })
        
        for (const tech of technicians) {
          const isAvailable = await this.checkTechnicianAvailability(
            tech.id,
            date,
            slot,
            duration
          )
          
          if (isAvailable) {
            alternatives.push({
              date,
              timeSlot: slot,
              technicianId: tech.id
            })
            break // Solo necesitamos uno disponible
          }
        }
      }
    }
    
    return alternatives.slice(0, 3) // Top 3 alternativas
  }
  
  private async findAlternativeRentalDates(
    fleetItemId: string,
    startDate: Date,
    endDate: Date
  ) {
    // Buscar gaps en la disponibilidad
    const rentalDays = Math.ceil(
      (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
    )
    
    const alternatives = []
    
    // Buscar en los próximos 30 días
    for (let offset = 1; offset <= 30; offset++) {
      const newStart = new Date(startDate)
      newStart.setDate(newStart.getDate() + offset)
      
      const newEnd = new Date(newStart)
      newEnd.setDate(newEnd.getDate() + rentalDays)
      
      const conflicts = await prisma.fleetAvailability.findMany({
        where: {
          fleetItemId,
          OR: [
            {
              AND: [
                { startDate: { lte: newStart } },
                { endDate: { gte: newStart } }
              ]
            },
            {
              AND: [
                { startDate: { lte: newEnd } },
                { endDate: { gte: newEnd } }
              ]
            }
          ]
        }
      })
      
      if (conflicts.length === 0) {
        alternatives.push({
          startDate: newStart,
          endDate: newEnd
        })
        
        if (alternatives.length >= 3) break
      }
    }
    
    return alternatives
  }
}
