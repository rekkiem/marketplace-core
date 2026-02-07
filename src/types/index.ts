import type {
  User,
  Seller,
  Product,
  Order,
  OrderItem,
  Payment,
  Review,
  Inventory,
} from '@prisma/client'

// User types
export type UserWithSeller = User & {
  seller?: Seller | null
}

// Product types
export type ProductWithRelations = Product & {
  seller: Seller
  category: {
    id: string
    name: string
    slug: string
  }
  inventory?: Inventory | null
}

// Order types
export type OrderWithRelations = Order & {
  items: (OrderItem & {
    product: Product
    seller: Seller
  })[]
  user?: {
    firstName: string
    lastName: string
    email: string
  }
  address?: {
    street: string
    number: string
    comuna: string
    region: string
  } | null
}

export type OrderItemWithRelations = OrderItem & {
  product: Product
  seller: Seller
}

// Review types
export type ReviewWithRelations = Review & {
  user: {
    firstName: string
    lastName: string
    avatar: string | null
  }
  product?: {
    name: string
    slug: string
  }
}

// API Response types
export interface ApiResponse<T = any> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

export interface PaginatedResponse<T> {
  data: T[]
  pagination: {
    total: number
    limit: number
    offset: number
    hasMore: boolean
  }
}

// Business Logic types
export interface OrderSummary {
  subtotal: number
  shippingCost: number
  tax: number
  discount: number
  total: number
}

export interface InventoryStatus {
  productId: string
  quantity: number
  reserved: number
  available: number
  status: 'in_stock' | 'low_stock' | 'out_of_stock'
}

export interface SellerStats {
  sellerId: string
  rating: number
  totalReviews: number
  totalSales: number
  totalRevenue: number
  completionRate: number
}

// Event types
export interface DomainEventData {
  'order.created': { orderId: string }
  'order.paid': { orderId: string }
  'order.confirmed': { orderId: string; sellerId: string }
  'order.cancelled': { orderId: string; reason: string }
  'order.completed': { orderId: string }
  'payment.succeeded': { paymentId: string; orderId: string }
  'payment.failed': { paymentId: string; orderId: string; reason?: string }
  'review.created': { reviewId: string; productId: string; sellerId: string }
  'review.response': { reviewId: string; sellerId: string }
  'inventory.low': { productId: string; quantity: number }
  'seller.verified': { sellerId: string }
  'user.registered': { userId: string }
}

// Utility types
export type RequireAtLeastOne<T, Keys extends keyof T = keyof T> = Pick<
  T,
  Exclude<keyof T, Keys>
> &
  {
    [K in Keys]-?: Required<Pick<T, K>> & Partial<Pick<T, Exclude<Keys, K>>>
  }[Keys]

export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>
