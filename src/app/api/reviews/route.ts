import { NextRequest, NextResponse } from 'next/server'
import { ReviewService } from '@/core/reviews/review.service'
import { z } from 'zod'
import { logger } from '@/lib/logger'

const createReviewSchema = z.object({
  orderItemId: z.string().cuid(),
  rating: z.number().int().min(1).max(5),
  title: z.string().max(100).optional(),
  comment: z.string().max(2000).optional(),
  images: z.array(z.string().url()).max(5).optional(),
})

/**
 * POST /api/reviews
 * Crear una review
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
    const validated = createReviewSchema.parse(body)
    
    const reviewService = new ReviewService()
    const review = await reviewService.createReview({
      ...validated,
      userId,
    })
    
    return NextResponse.json(review, { status: 201 })
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
    
    logger.error('Error creating review', error)
    
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
 * GET /api/reviews?productId=xxx
 * Obtener reviews de un producto
 */
export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams
    const productId = searchParams.get('productId')
    const sellerId = searchParams.get('sellerId')
    const limit = parseInt(searchParams.get('limit') || '20')
    const offset = parseInt(searchParams.get('offset') || '0')
    
    if (!productId && !sellerId) {
      return NextResponse.json(
        { error: 'productId or sellerId required' },
        { status: 400 }
      )
    }
    
    const reviewService = new ReviewService()
    
    const reviews = productId
      ? await reviewService.getProductReviews(
          productId,
          limit,
          offset
        )
      : await reviewService.getSellerReviews(
          sellerId!,
          limit,
          offset
        )
    
    return NextResponse.json({
      reviews,
      pagination: {
        limit,
        offset,
        total: reviews.length,
      },
    })
  } catch (error) {
    logger.error('Error fetching reviews', error)
    
    return NextResponse.json(
      { error: 'Internal error' },
      { status: 500 }
    )
  }
}
