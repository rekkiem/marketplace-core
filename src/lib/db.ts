import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'error', 'warn']
        : ['error'],
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}

// Helper para transacciones con retry
export async function withTransaction<T>(
  callback: (tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use'>) => Promise<T>,
  maxRetries = 3
): Promise<T> {
  let lastError: Error | undefined
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await prisma.$transaction(callback, {
        maxWait: 5000, // 5 segundos
        timeout: 10000, // 10 segundos
      })
    } catch (error) {
      lastError = error as Error
      
      // Si es un error de serialización, reintenta
      if (
        error instanceof Error &&
        (error.message.includes('serialization') ||
          error.message.includes('deadlock'))
      ) {
        if (attempt < maxRetries) {
          // Backoff exponencial
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 100))
          continue
        }
      }
      
      throw error
    }
  }
  
  throw lastError
}
