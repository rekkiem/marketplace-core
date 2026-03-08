import { NextRequest, NextResponse } from 'next/server'
import { RentalService } from '@/core/rentals/rental.service'
import { z } from 'zod'
import { logger } from '@/lib/logger'

const createRentalSchema = z.object({
  fleetItemId: z.string().cuid(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  deliveryAddress: z.string().optional(),
  notes: z.string().max(1000).optional()
})

const returnInspectionSchema = z.object({
  condition: z.enum(['EXCELLENT', 'GOOD', 'FAIR', 'POOR']),
  photos: z.array(z.string().url()).min(1),
  cleanlinessScore: z.number().int().min(1).max(5),
  damageReport: z.array(z.object({
    description: z.string(),
    estimatedCost: z.number().positive()
  })).optional()
})

/**
 * POST /api/rentals
 * Crear un arriendo
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
    const validated = createRentalSchema.parse(body)
    
    const rentalService = new RentalService()
    const rental = await rentalService.createRental({
      ...validated,
      userId,
      startDate: new Date(validated.startDate),
      endDate: new Date(validated.endDate)
    })
    
    return NextResponse.json(rental, { status: 201 })
    
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }
    
    logger.error('Error creating rental', error)
    
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/rentals
 * Obtener rentals del usuario
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
    const status = searchParams.get('status')
    
    const rentals = await prisma.rental.findMany({
      where: {
        userId,
        ...(status && { status })
      },
      include: {
        fleetItem: {
          select: {
            name: true,
            images: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    })
    
    return NextResponse.json({ rentals })
    
  } catch (error) {
    logger.error('Error fetching rentals', error)
    return NextResponse.json(
      { error: 'Internal error' },
      { status: 500 }
    )
  }
}
