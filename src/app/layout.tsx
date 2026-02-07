import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Marketplace - Construcción y Servicios',
  description: 'Marketplace de productos de ferretería y servicios técnicos',
  keywords: ['ferretería', 'construcción', 'servicios', 'chile'],
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  )
}
