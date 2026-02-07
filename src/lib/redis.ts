import Redis from 'ioredis'

const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined
}

export const redis =
  globalForRedis.redis ??
  new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      const delay = Math.min(times * 50, 2000)
      return delay
    },
  })

if (process.env.NODE_ENV !== 'production') {
  globalForRedis.redis = redis
}

// Cache helpers
export class CacheService {
  /**
   * Get con fallback a DB
   */
  static async getOrSet<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttl: number = 300 // 5 minutos default
  ): Promise<T> {
    const cached = await redis.get(key)
    
    if (cached) {
      try {
        return JSON.parse(cached)
      } catch {
        // Si falla el parse, ignorar cache
      }
    }
    
    const data = await fetcher()
    
    if (data) {
      await redis.setex(key, ttl, JSON.stringify(data))
    }
    
    return data
  }
  
  /**
   * Invalidar un patrón de keys
   */
  static async invalidate(pattern: string): Promise<void> {
    const keys = await redis.keys(pattern)
    
    if (keys.length > 0) {
      await redis.del(...keys)
    }
  }
  
  /**
   * Rate limiting por IP/User
   */
  static async checkRateLimit(
    key: string,
    limit: number,
    window: number
  ): Promise<{ allowed: boolean; remaining: number; reset: number }> {
    const current = await redis.incr(key)
    
    if (current === 1) {
      await redis.expire(key, window)
    }
    
    const ttl = await redis.ttl(key)
    
    return {
      allowed: current <= limit,
      remaining: Math.max(0, limit - current),
      reset: Date.now() + ttl * 1000,
    }
  }
  
  /**
   * Lock distribuido (para operaciones críticas)
   */
  static async acquireLock(
    key: string,
    ttl: number = 10
  ): Promise<boolean> {
    const result = await redis.set(
      `lock:${key}`,
      '1',
      'EX',
      ttl,
      'NX'
    )
    
    return result === 'OK'
  }
  
  static async releaseLock(key: string): Promise<void> {
    await redis.del(`lock:${key}`)
  }
}
