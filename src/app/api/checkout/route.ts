import { NextRequest, NextResponse } from 'next/server'
import { UnifiedCheckoutService } from '@/core/checkout/unified-checkout.service'
import { z } from 'zod'
import { logger } from '@/lib/logger'

const checkoutItemSchema = z.object({
  type: z.enum(['PRODUCT', 'SERVICE', 'RENTAL', 'BUNDLE']),
  productId: z.string().cuid().optional(),
  fleetItemId: z.string().cuid().optional(),
  quantity: z.number().int().positive().optional(),
  scheduledDate: z.string().datetime().optional(),
  scheduledTime: z.string().optional(),
  rentalStartDate: z.string().datetime().optional(),
  rentalEndDate: z.string().datetime().optional(),
  linkedToProduct: z.string().cuid().optional(),
  metadata: z.any().optional()
})

const checkoutSchema = z.object({
  items: z.array(checkoutItemSchema).min(1),
  addressId: z.string().cuid().optional(),
  shippingMethod: z.enum(['STANDARD', 'EXPRESS', 'PICKUP']).optional(),
  paymentMethod: z.string(),
  idempotencyKey: z.string().min(10),
  notes: z.string().max(1000).optional()
})

/**
 * POST /api/checkout
 * Procesar checkout unificado (productos + servicios + arriendos)
 */
export async function POST(req: NextRequest) {
  try {
    const userId = req.headers.get('x-user-id')
    
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }
    
    const body = await req.json()
    const validated = checkoutSchema.parse(body)
    
    // Transformar fechas
    const items = validated.items.map(item => ({
      ...item,
      scheduledDate: item.scheduledDate ? new Date(item.scheduledDate) : undefined,
      rentalStartDate: item.rentalStartDate ? new Date(item.rentalStartDate) : undefined,
      rentalEndDate: item.rentalEndDate ? new Date(item.rentalEndDate) : undefined
    }))
    
    const checkoutService = new UnifiedCheckoutService()
    const result = await checkoutService.processCheckout({
      userId,
      items,
      addressId: validated.addressId,
      shippingMethod: validated.shippingMethod,
      paymentMethod: validated.paymentMethod,
      idempotencyKey: validated.idempotencyKey,
      notes: validated.notes
    })
    
    if (!result.success) {
      return NextResponse.json(
        { 
          error: 'Checkout failed', 
          details: result.errors 
        },
        { status: 400 }
      )
    }
    
    return NextResponse.json(result, { status: 201 })
    
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }
    
    logger.error('Error processing checkout', error)
    
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/checkout/validate
 * Validar carrito sin procesar pago
 */
export async function PUT(req: NextRequest) {
  try {
    const userId = req.headers.get('x-user-id')
    
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }
    
    const body = await req.json()
    const { items } = body
    
    if (!items || !Array.isArray(items)) {
      return NextResponse.json(
        { error: 'Items array required' },
        { status: 400 }
      )
    }
    
    const checkoutService = new UnifiedCheckoutService()
    const coordinator = checkoutService['coordinator'] // Access private prop (not ideal, but for demo)
    
    // Transformar fechas
    const transformedItems = items.map((item: any) => ({
      ...item,
      scheduledDate: item.scheduledDate ? new Date(item.scheduledDate) : undefined,
      rentalStartDate: item.rentalStartDate ? new Date(item.rentalStartDate) : undefined,
      rentalEndDate: item.rentalEndDate ? new Date(item.rentalEndDate) : undefined
    }))
    
    const validation = await coordinator.validateCart(transformedItems)
    
    return NextResponse.json(validation)
    
  } catch (error) {
    logger.error('Error validating cart', error)
    
    return NextResponse.json(
      { error: 'Validation failed' },
      { status: 500 }
    )
  }
}
