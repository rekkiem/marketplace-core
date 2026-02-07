import { prisma, withTransaction } from '@/lib/db'
import { EventBus } from '@/lib/events'
import { logger } from '@/lib/logger'

interface CreateReviewInput {
  orderItemId: string
  userId: string
  rating: number
  title?: string
  comment?: string
  images?: string[]
}

export class ReviewService {
  /**
   * Crear review - SOLO POST-COMPRA
   */
  async createReview(input: CreateReviewInput) {
    // Validar rating
    if (input.rating < 1 || input.rating > 5) {
      throw new Error('Rating must be between 1 and 5')
    }
    
    // Obtener orderItem con relaciones
    const orderItem = await prisma.orderItem.findUnique({
      where: { id: input.orderItemId },
      include: {
        order: true,
        product: true,
      },
    })
    
    if (!orderItem) {
      throw new Error('Order item not found')
    }
    
    // REGLA CRÍTICA: Validar ownership
    if (orderItem.order.userId !== input.userId) {
      throw new Error('You can only review your own purchases')
    }
    
    // REGLA CRÍTICA: Validar que la orden esté completada
    if (orderItem.order.status !== 'COMPLETED') {
      throw new Error('You can only review completed orders')
    }
    
    // Validar que no exista ya un review
    const existing = await prisma.review.findUnique({
      where: { orderItemId: input.orderItemId },
    })
    
    if (existing) {
      throw new Error('You already reviewed this purchase')
    }
    
    // Crear review y actualizar stats en transacción
    const review = await withTransaction(async (tx) => {
      const newReview = await tx.review.create({
        data: {
          orderItemId: input.orderItemId,
          userId: input.userId,
          productId: orderItem.productId,
          sellerId: orderItem.sellerId,
          rating: input.rating,
          title: input.title,
          comment: input.comment,
          images: input.images || [],
          isVerified: true, // Siempre true porque viene de compra
        },
      })
      
      // Recalcular rating del producto
      await this.updateProductRating(orderItem.productId, tx)
      
      // Recalcular rating del seller
      await this.updateSellerRating(orderItem.sellerId, tx)
      
      return newReview
    })
    
    await EventBus.emit('review.created', {
      reviewId: review.id,
      productId: review.productId,
      sellerId: review.sellerId,
    })
    
    logger.info('Review created', {
      reviewId: review.id,
      productId: review.productId,
      rating: review.rating,
    })
    
    return review
  }
  
  /**
   * Seller responde a review
   */
  async respondToReview(
    reviewId: string,
    sellerId: string,
    response: string
  ) {
    const review = await prisma.review.findUnique({
      where: { id: reviewId },
    })
    
    if (!review) {
      throw new Error('Review not found')
    }
    
    if (review.sellerId !== sellerId) {
      throw new Error('You can only respond to your own reviews')
    }
    
    if (review.sellerResponse) {
      throw new Error('You already responded to this review')
    }
    
    const updated = await prisma.review.update({
      where: { id: reviewId },
      data: {
        sellerResponse: response,
        respondedAt: new Date(),
      },
    })
    
    await EventBus.emit('review.response', {
      reviewId,
      sellerId,
    })
    
    logger.info('Seller responded to review', { reviewId, sellerId })
    
    return updated
  }
  
  /**
   * Marcar review como útil
   */
  async markHelpful(reviewId: string, helpful: boolean) {
    return prisma.review.update({
      where: { id: reviewId },
      data: {
        ...(helpful
          ? { helpfulCount: { increment: 1 } }
          : { notHelpfulCount: { increment: 1 } }),
      },
    })
  }
  
  /**
   * Ocultar review (moderación)
   */
  async hideReview(
    reviewId: string,
    reason: string,
    moderatorId: string
  ) {
    const updated = await prisma.review.update({
      where: { id: reviewId },
      data: {
        isHidden: true,
        hiddenReason: reason,
        moderatedBy: moderatorId,
        moderatedAt: new Date(),
      },
    })
    
    logger.info('Review hidden', { reviewId, reason, moderatorId })
    
    return updated
  }
  
  /**
   * Obtener reviews de un producto
   */
  async getProductReviews(
    productId: string,
    limit: number = 20,
    offset: number = 0
  ) {
    return prisma.review.findMany({
      where: {
        productId,
        isHidden: false,
      },
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
            avatar: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    })
  }
  
  /**
   * Obtener reviews de un seller
   */
  async getSellerReviews(
    sellerId: string,
    limit: number = 20,
    offset: number = 0
  ) {
    return prisma.review.findMany({
      where: {
        sellerId,
        isHidden: false,
      },
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
            avatar: true,
          },
        },
        product: {
          select: {
            name: true,
            slug: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    })
  }
  
  // ========== HELPERS PRIVADOS ==========
  
  private async updateProductRating(productId: string, tx: any) {
    const stats = await tx.review.aggregate({
      where: {
        productId,
        isHidden: false,
      },
      _avg: {
        rating: true,
      },
      _count: true,
    })
    
    await tx.product.update({
      where: { id: productId },
      data: {
        rating: stats._avg.rating || 0,
        totalReviews: stats._count,
      },
    })
  }
  
  private async updateSellerRating(sellerId: string, tx: any) {
    const stats = await tx.review.aggregate({
      where: {
        sellerId,
        isHidden: false,
      },
      _avg: {
        rating: true,
      },
      _count: true,
    })
    
    await tx.seller.update({
      where: { id: sellerId },
      data: {
        rating: stats._avg.rating || 0,
        totalReviews: stats._count,
      },
    })
  }
}
