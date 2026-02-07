import { NextRequest, NextResponse } from 'next/server'
import { OrderService } from '@/core/orders/order.service'
import { z } from 'zod'
import { logger } from '@/lib/logger'

// Schema de validación
const createOrderSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().cuid(),
        quantity: z.number().int().positive(),
        scheduledAt: z.string().datetime().optional(),
      })
    )
    .min(1, 'Order must have at least one item'),
  addressId: z.string().cuid().optional(),
  shippingMethod: z
    .enum(['STANDARD', 'EXPRESS', 'PICKUP'])
    .optional(),
  notes: z.string().max(1000).optional(),
})

/**
 * POST /api/orders
 * Crear una nueva orden
 */
export async function POST(req: NextRequest) {
  try {
    // TODO: Obtener userId del session/token
    const userId = req.headers.get('x-user-id')
    
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }
    
    const body = await req.json()
    const validated = createOrderSchema.parse(body)
    
    const orderService = new OrderService()
    const order = await orderService.createOrder({
      userId,
      items: validated.items.map((item) => ({
        ...item,
        scheduledAt: item.scheduledAt
          ? new Date(item.scheduledAt)
          : undefined,
      })),
      addressId: validated.addressId,
      shippingMethod: validated.shippingMethod,
      notes: validated.notes,
    })
    
    return NextResponse.json(order, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: 'Validation error',
          details: error.errors,
        },
        { status: 400 }
      )
    }
    
    logger.error('Error creating order', error)
    
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Internal error',
      },
      { status: 500 }
    )
  }
}

/**
 * GET /api/orders
 * Obtener órdenes del usuario
 */
export async function GET(req: NextRequest) {
  try {
    const userId = req.headers.get('x-user-id')
    
    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }
    
    const searchParams = req.nextUrl.searchParams
    const limit = parseInt(searchParams.get('limit') || '20')
    const offset = parseInt(searchParams.get('offset') || '0')
    
    const orderService = new OrderService()
    const orders = await orderService.getUserOrders(
      userId,
      limit,
      offset
    )
    
    return NextResponse.json({
      orders,
      pagination: {
        limit,
        offset,
        total: orders.length,
      },
    })
  } catch (error) {
    logger.error('Error fetching orders', error)
    
    return NextResponse.json(
      { error: 'Internal error' },
      { status: 500 }
    )
  }
}
