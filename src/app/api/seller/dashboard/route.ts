import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'

/**
 * GET /api/seller/dashboard
 * Dashboard completo del vendedor (productos + servicios + arriendos)
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
    
    // Obtener seller
    const seller = await prisma.seller.findUnique({
      where: { userId }
    })
    
    if (!seller) {
      return NextResponse.json(
        { error: 'Seller not found' },
        { status: 404 }
      )
    }
    
    // Obtener datos en paralelo
    const [
      products,
      fleetItems,
      technicians,
      recentOrders,
      activeRentals,
      upcomingBookings,
      escrowBalance
    ] = await Promise.all([
      // Productos
      prisma.product.findMany({
        where: { sellerId: seller.id },
        include: { inventory: true },
        take: 10,
        orderBy: { createdAt: 'desc' }
      }),
      
      // Fleet items
      prisma.fleetItem.findMany({
        where: { sellerId: seller.id },
        include: {
          rentals: {
            where: { status: 'ACTIVE' },
            take: 1
          }
        },
        orderBy: { createdAt: 'desc' }
      }),
      
      // Técnicos
      prisma.technician.findMany({
        where: { sellerId: seller.id, isActive: true }
      }),
      
      // Órdenes recientes
      prisma.order.findMany({
        where: {
          items: {
            some: { sellerId: seller.id }
          }
        },
        include: {
          items: {
            where: { sellerId: seller.id }
          },
          user: {
            select: {
              firstName: true,
              lastName: true,
              email: true
            }
          }
        },
        take: 10,
        orderBy: { createdAt: 'desc' }
      }),
      
      // Arriendos activos
      prisma.rental.findMany({
        where: {
          sellerId: seller.id,
          status: { in: ['ACTIVE', 'PENDING_RETURN'] }
        },
        include: {
          fleetItem: {
            select: {
              name: true,
              images: true
            }
          }
        },
        orderBy: { endDate: 'asc' }
      }),
      
      // Bookings próximos
      prisma.booking.findMany({
        where: {
          sellerId: seller.id,
          status: { in: ['CONFIRMED', 'ASSIGNED'] },
          scheduledDate: { gte: new Date() }
        },
        include: {
          technician: {
            select: {
              firstName: true,
              lastName: true
            }
          }
        },
        take: 10,
        orderBy: { scheduledDate: 'asc' }
      }),
      
      // Balance de escrow
      getSellerEscrowBalance(seller.id)
    ])
    
    // Calcular métricas
    const metrics = await calculateSellerMetrics(seller.id)
    
    // Compilar dashboard
    const dashboard = {
      seller: {
        id: seller.id,
        businessName: seller.businessName,
        rating: seller.rating,
        totalReviews: seller.totalReviews,
        totalSales: seller.totalSales,
        status: seller.status
      },
      
      // Inventario de productos
      inventory: {
        totalProducts: products.length,
        lowStock: products.filter(p => 
          p.inventory && p.inventory.available <= p.inventory.lowStockAlert
        ),
        outOfStock: products.filter(p => 
          p.inventory && p.inventory.available === 0
        )
      },
      
      // Fleet management
      fleet: {
        total: fleetItems.length,
        available: fleetItems.filter(f => f.status === 'AVAILABLE').length,
        rented: fleetItems.filter(f => f.status === 'RENTED').length,
        maintenance: fleetItems.filter(f => f.status === 'MAINTENANCE').length,
        items: fleetItems
      },
      
      // Técnicos
      technicians: {
        total: technicians.length,
        active: technicians.filter(t => t.isActive).length,
        verified: technicians.filter(t => t.isVerified).length,
        list: technicians
      },
      
      // Actividad reciente
      activity: {
        recentOrders,
        activeRentals,
        upcomingBookings
      },
      
      // Financiero
      financials: {
        escrowBalance,
        metrics
      }
    }
    
    return NextResponse.json(dashboard)
    
  } catch (error) {
    logger.error('Error fetching seller dashboard', error)
    
    return NextResponse.json(
      { error: 'Internal error' },
      { status: 500 }
    )
  }
}

/**
 * Obtener balance de escrow del seller
 */
async function getSellerEscrowBalance(sellerId: string) {
  const [pending, available] = await Promise.all([
    // Pendiente (held)
    prisma.escrowSplit.aggregate({
      where: {
        sellerId,
        status: 'HELD'
      },
      _sum: {
        amount: true
      }
    }),
    
    // Disponible (released)
    prisma.escrowSplit.aggregate({
      where: {
        sellerId,
        status: 'RELEASED'
        // TODO: Agregar filtro de "no retirado"
      },
      _sum: {
        amount: true
      }
    })
  ])
  
  return {
    pending: pending._sum.amount || 0,
    available: available._sum.amount || 0
  }
}

/**
 * Calcular métricas del seller
 */
async function calculateSellerMetrics(sellerId: string) {
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  
  const [
    ordersThisMonth,
    rentalsThisMonth,
    bookingsThisMonth
  ] = await Promise.all([
    // Órdenes
    prisma.orderItem.aggregate({
      where: {
        sellerId,
        createdAt: { gte: thirtyDaysAgo }
      },
      _sum: {
        subtotal: true
      },
      _count: true
    }),
    
    // Arriendos
    prisma.rental.aggregate({
      where: {
        sellerId,
        createdAt: { gte: thirtyDaysAgo }
      },
      _sum: {
        total: true
      },
      _count: true
    }),
    
    // Servicios
    prisma.booking.aggregate({
      where: {
        sellerId,
        createdAt: { gte: thirtyDaysAgo }
      },
      _sum: {
        total: true
      },
      _count: true
    })
  ])
  
  const totalRevenue = 
    (ordersThisMonth._sum.subtotal || 0) +
    (rentalsThisMonth._sum.total || 0) +
    (bookingsThisMonth._sum.total || 0)
  
  return {
    thisMonth: {
      orders: ordersThisMonth._count,
      rentals: rentalsThisMonth._count,
      bookings: bookingsThisMonth._count,
      totalRevenue
    }
  }
}
