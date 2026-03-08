import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import Redis from 'ioredis'

/**
 * GET /api/health
 * Health check endpoint para monitoring y load balancers
 */
export async function GET() {
  const checks = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
    checks: {
      database: 'unknown',
      redis: 'unknown',
    }
  }

  try {
    // Check database
    await prisma.$queryRaw`SELECT 1`
    checks.checks.database = 'healthy'
  } catch (error) {
    checks.checks.database = 'unhealthy'
    checks.status = 'degraded'
  }

  try {
    // Check Redis
    const redis = new Redis(process.env.REDIS_URL!)
    await redis.ping()
    checks.checks.redis = 'healthy'
    redis.disconnect()
  } catch (error) {
    checks.checks.redis = 'unhealthy'
    checks.status = 'degraded'
  }

  const statusCode = checks.status === 'healthy' ? 200 : 503

  return NextResponse.json(checks, { status: statusCode })
}
