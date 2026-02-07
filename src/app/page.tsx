export default function Home() {
  return (
    <main style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
      <h1>🏗️ Marketplace Core</h1>
      <p style={{ marginTop: '1rem', fontSize: '1.2rem' }}>
        Sistema Core de Marketplace de Construcción y Servicios Técnicos
      </p>
      
      <div style={{ marginTop: '2rem' }}>
        <h2>🚀 Quick Start</h2>
        <ol style={{ marginTop: '1rem', lineHeight: '1.8' }}>
          <li>Configura tu base de datos en <code>.env</code></li>
          <li>Ejecuta <code>npm run db:migrate</code></li>
          <li>Ejecuta <code>npm run db:seed</code> para datos de prueba</li>
          <li>Revisa la documentación en <code>README.md</code></li>
        </ol>
      </div>
      
      <div style={{ marginTop: '2rem' }}>
        <h2>📚 API Endpoints</h2>
        <ul style={{ marginTop: '1rem', lineHeight: '1.8' }}>
          <li><code>POST /api/orders</code> - Crear orden</li>
          <li><code>GET /api/orders</code> - Listar órdenes</li>
          <li><code>POST /api/reviews</code> - Crear review</li>
          <li><code>GET /api/reviews</code> - Listar reviews</li>
          <li><code>POST /api/payments/webhooks</code> - Webhooks de pago</li>
        </ul>
      </div>
      
      <div style={{ marginTop: '2rem' }}>
        <h2>🔧 Servicios Core</h2>
        <ul style={{ marginTop: '1rem', lineHeight: '1.8' }}>
          <li><strong>OrderService:</strong> Gestión de órdenes con reserva de inventario</li>
          <li><strong>InventoryService:</strong> Control de stock atómico</li>
          <li><strong>PaymentService:</strong> Pagos idempotentes</li>
          <li><strong>ReviewService:</strong> Reviews verificados post-compra</li>
        </ul>
      </div>
      
      <div style={{ marginTop: '2rem', padding: '1rem', background: '#f5f5f5', borderRadius: '8px' }}>
        <h3>📖 Documentación Completa</h3>
        <p style={{ marginTop: '0.5rem' }}>
          Lee el <code>README.md</code> para instrucciones detalladas de instalación,
          uso de servicios, decisiones arquitectónicas y roadmap.
        </p>
      </div>
      
      <div style={{ marginTop: '2rem' }}>
        <h2>🎯 Usuarios de Prueba</h2>
        <div style={{ marginTop: '1rem' }}>
          <h3>Admin</h3>
          <p>Email: <code>admin@marketplace.cl</code></p>
          <p>Password: <code>admin123</code></p>
        </div>
        <div style={{ marginTop: '1rem' }}>
          <h3>Vendedor</h3>
          <p>Email: <code>vendedor@ferreteria.cl</code></p>
          <p>Password: <code>seller123</code></p>
        </div>
        <div style={{ marginTop: '1rem' }}>
          <h3>Cliente</h3>
          <p>Email: <code>cliente@email.cl</code></p>
          <p>Password: <code>user123</code></p>
        </div>
      </div>
    </main>
  )
}
