import { z } from 'zod'

// User schemas
export const createUserSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(8, 'Contraseña debe tener al menos 8 caracteres'),
  firstName: z.string().min(2, 'Nombre muy corto'),
  lastName: z.string().min(2, 'Apellido muy corto'),
  phone: z.string().regex(/^\+56\d{9}$/, 'Formato de teléfono chileno inválido').optional(),
})

export const loginSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(1, 'Contraseña requerida'),
})

// Product schemas
export const createProductSchema = z.object({
  name: z.string().min(3, 'Nombre muy corto').max(200),
  description: z.string().min(10, 'Descripción muy corta'),
  shortDescription: z.string().max(500).optional(),
  categoryId: z.string().cuid('ID de categoría inválido'),
  type: z.enum(['PHYSICAL', 'SERVICE', 'HYBRID']),
  price: z.number().positive('Precio debe ser positivo'),
  compareAtPrice: z.number().positive().optional(),
  images: z.array(z.string().url()).min(1, 'Al menos una imagen requerida'),
  weight: z.number().positive().optional(),
  serviceDuration: z.number().int().positive().optional(),
  tags: z.array(z.string()).optional(),
})

export const updateProductSchema = createProductSchema.partial()

// Order schemas
export const createOrderSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().cuid(),
        quantity: z.number().int().positive(),
        scheduledAt: z.string().datetime().optional(),
      })
    )
    .min(1, 'Orden debe tener al menos un item'),
  addressId: z.string().cuid().optional(),
  shippingMethod: z.enum(['STANDARD', 'EXPRESS', 'PICKUP']).optional(),
  notes: z.string().max(1000).optional(),
})

// Review schemas
export const createReviewSchema = z.object({
  orderItemId: z.string().cuid(),
  rating: z.number().int().min(1).max(5),
  title: z.string().max(100).optional(),
  comment: z.string().max(2000).optional(),
  images: z.array(z.string().url()).max(5).optional(),
})

export const respondToReviewSchema = z.object({
  response: z.string().min(10, 'Respuesta muy corta').max(1000),
})

// Address schemas
export const createAddressSchema = z.object({
  label: z.string().min(1, 'Etiqueta requerida'),
  firstName: z.string().min(2),
  lastName: z.string().min(2),
  phone: z.string().regex(/^\+56\d{9}$/),
  street: z.string().min(3),
  number: z.string().min(1),
  apartment: z.string().optional(),
  comuna: z.string().min(2),
  region: z.string().min(2),
  city: z.string().min(2),
  zipCode: z.string().optional(),
  isDefault: z.boolean().optional(),
})

// Seller schemas
export const createSellerSchema = z.object({
  businessName: z.string().min(3, 'Nombre de empresa muy corto'),
  businessType: z.enum(['EMPRESA', 'PYME', 'INDEPENDIENTE']),
  rut: z.string().regex(/^\d{7,8}-[\dkK]$/, 'RUT inválido'),
  businessEmail: z.string().email(),
  businessPhone: z.string().regex(/^\+56\d{9}$/),
  legalRepName: z.string().min(3).optional(),
  legalRepRut: z.string().regex(/^\d{7,8}-[\dkK]$/).optional(),
  bio: z.string().max(2000).optional(),
  specialties: z.array(z.string()).optional(),
  serviceAreas: z.array(z.string()).optional(),
})

// Payment schemas
export const createPaymentSchema = z.object({
  orderId: z.string().cuid(),
  amount: z.number().positive(),
  method: z.enum(['CREDIT_CARD', 'DEBIT_CARD', 'TRANSFER', 'WEBPAY', 'MERCADOPAGO']),
  idempotencyKey: z.string().min(10),
})

// Inventory schemas
export const restockSchema = z.object({
  quantity: z.number().int().positive('Cantidad debe ser positiva'),
  notes: z.string().max(500).optional(),
})

export const adjustInventorySchema = z.object({
  newQuantity: z.number().int().min(0, 'Cantidad no puede ser negativa'),
  reason: z.string().min(5, 'Razón requerida'),
})

// Pagination
export const paginationSchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
})

// Helper para validar RUT chileno
export function validateRUT(rut: string): boolean {
  // Remover puntos y guión
  const cleanRut = rut.replace(/[.-]/g, '')
  
  if (cleanRut.length < 8) return false
  
  const body = cleanRut.slice(0, -1)
  const dv = cleanRut.slice(-1).toUpperCase()
  
  let sum = 0
  let multiplier = 2
  
  for (let i = body.length - 1; i >= 0; i--) {
    sum += parseInt(body[i]) * multiplier
    multiplier = multiplier === 7 ? 2 : multiplier + 1
  }
  
  const expectedDV = 11 - (sum % 11)
  const calculatedDV = expectedDV === 11 ? '0' : expectedDV === 10 ? 'K' : String(expectedDV)
  
  return dv === calculatedDV
}

// Helper para formatear RUT
export function formatRUT(rut: string): string {
  const clean = rut.replace(/[^0-9kK]/g, '')
  const body = clean.slice(0, -1)
  const dv = clean.slice(-1)
  
  return body.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '-' + dv
}
