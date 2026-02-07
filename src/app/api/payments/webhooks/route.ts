import { NextRequest, NextResponse } from 'next/server'
import { PaymentService } from '@/core/payments/payment.service'
import { OrderService } from '@/core/orders/order.service'
import { logger } from '@/lib/logger'

/**
 * POST /api/payments/webhooks
 * Procesar webhooks de payment providers
 */
export async function POST(req: NextRequest) {
  try {
    const provider = req.headers.get('x-provider') || 'unknown'
    const signature = req.headers.get('x-signature')
    
    const body = await req.json()
    
    // TODO: Verificar firma del webhook
    // if (!verifyWebhookSignature(signature, body, provider)) {
    //   return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    // }
    
    const paymentService = new PaymentService()
    const orderService = new OrderService()
    
    // Determinar el tipo de evento
    const event = body.event || body.type || body.event_type
    
    logger.info('Webhook received', { provider, event })
    
    // Procesar webhook
    const payment = await paymentService.handleWebhook(
      provider,
      event,
      body
    )
    
    if (payment && payment.status === 'SUCCEEDED') {
      // Confirmar orden
      await orderService.confirmPayment(
        payment.orderId,
        payment.id
      )
    }
    
    return NextResponse.json({
      success: true,
      processed: true,
    })
  } catch (error) {
    logger.error('Error processing webhook', error, {
      headers: Object.fromEntries(req.headers.entries()),
    })
    
    // Retornar 200 para evitar reintentos del provider
    // pero loggear el error
    return NextResponse.json({
      success: false,
      error:
        error instanceof Error ? error.message : 'Unknown error',
    })
  }
}
