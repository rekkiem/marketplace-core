import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding database...')
  
  // Crear admin user
  const adminPassword = await bcrypt.hash('admin123', 10)
  const admin = await prisma.user.upsert({
    where: { email: 'admin@marketplace.cl' },
    update: {},
    create: {
      email: 'admin@marketplace.cl',
      phone: '+56912345678',
      passwordHash: adminPassword,
      firstName: 'Admin',
      lastName: 'Sistema',
      role: 'ADMIN',
      emailVerified: new Date(),
    },
  })
  console.log('✅ Admin user created:', admin.email)
  
  // Crear seller user
  const sellerPassword = await bcrypt.hash('seller123', 10)
  const sellerUser = await prisma.user.upsert({
    where: { email: 'vendedor@ferreteria.cl' },
    update: {},
    create: {
      email: 'vendedor@ferreteria.cl',
      phone: '+56987654321',
      passwordHash: sellerPassword,
      firstName: 'Juan',
      lastName: 'Pérez',
      role: 'SELLER',
      emailVerified: new Date(),
    },
  })
  
  const seller = await prisma.seller.upsert({
    where: { userId: sellerUser.id },
    update: {},
    create: {
      userId: sellerUser.id,
      businessName: 'Ferretería El Constructor',
      businessType: 'PYME',
      rut: '12345678-9',
      businessEmail: 'ventas@ferreteria.cl',
      businessPhone: '+56912345678',
      legalRepName: 'Juan Pérez González',
      legalRepRut: '11111111-1',
      status: 'ACTIVE',
      verifiedAt: new Date(),
      bio: 'Ferretería con más de 20 años de experiencia',
      specialties: ['Electricidad', 'Plomería', 'Construcción'],
      serviceAreas: ['Santiago', 'Providencia', 'Las Condes'],
    },
  })
  console.log('✅ Seller created:', seller.businessName)
  
  // Crear categorías
  const electricidad = await prisma.category.upsert({
    where: { slug: 'electricidad' },
    update: {},
    create: {
      slug: 'electricidad',
      name: 'Electricidad',
      description: 'Productos y servicios eléctricos',
      isActive: true,
      isFeatured: true,
      displayOrder: 1,
    },
  })
  
  const plomeria = await prisma.category.upsert({
    where: { slug: 'plomeria' },
    update: {},
    create: {
      slug: 'plomeria',
      name: 'Plomería',
      description: 'Productos y servicios de plomería',
      isActive: true,
      isFeatured: true,
      displayOrder: 2,
    },
  })
  console.log('✅ Categories created')
  
  // Crear productos
  const taladro = await prisma.product.upsert({
    where: { sku: 'TAL-001' },
    update: {},
    create: {
      sku: 'TAL-001',
      sellerId: seller.id,
      categoryId: electricidad.id,
      name: 'Taladro Percutor 800W',
      slug: 'taladro-percutor-800w',
      description: 'Taladro profesional de 800W con percusión. Ideal para hormigón y mampostería.',
      shortDescription: 'Taladro profesional 800W',
      type: 'PHYSICAL',
      status: 'ACTIVE',
      price: 49990,
      compareAtPrice: 59990,
      weight: 2.5,
      requiresShipping: true,
      images: ['/images/taladro.jpg'],
      tags: ['herramientas', 'electricidad', 'construccion'],
      isFeatured: true,
      publishedAt: new Date(),
    },
  })
  
  const instalacion = await prisma.product.upsert({
    where: { sku: 'SRV-001' },
    update: {},
    create: {
      sku: 'SRV-001',
      sellerId: seller.id,
      categoryId: electricidad.id,
      name: 'Instalación de Luminarias',
      slug: 'instalacion-luminarias',
      description: 'Servicio profesional de instalación de luminarias y sistemas de iluminación.',
      shortDescription: 'Instalación profesional de luminarias',
      type: 'SERVICE',
      status: 'ACTIVE',
      price: 25000,
      serviceDuration: 120, // 2 horas
      requiresShipping: false,
      requiresQuote: false,
      images: ['/images/instalacion.jpg'],
      tags: ['servicio', 'electricidad', 'instalacion'],
      publishedAt: new Date(),
    },
  })
  
  const bundle = await prisma.product.upsert({
    where: { sku: 'BUN-001' },
    update: {},
    create: {
      sku: 'BUN-001',
      sellerId: seller.id,
      categoryId: plomeria.id,
      name: 'Kit Llave de Ducha + Instalación',
      slug: 'kit-llave-ducha-instalacion',
      description: 'Pack completo: Llave monomando de ducha importada + instalación profesional incluida.',
      shortDescription: 'Llave + Instalación',
      type: 'HYBRID',
      status: 'ACTIVE',
      price: 89990,
      compareAtPrice: 109990,
      weight: 1.5,
      serviceDuration: 90,
      requiresShipping: true,
      images: ['/images/bundle.jpg'],
      tags: ['plomeria', 'ducha', 'instalacion', 'pack'],
      isFeatured: true,
      publishedAt: new Date(),
    },
  })
  console.log('✅ Products created')
  
  // Crear inventario
  await prisma.inventory.create({
    data: {
      productId: taladro.id,
      sellerId: seller.id,
      quantity: 50,
      available: 50,
      reserved: 0,
      lowStockAlert: 10,
      restockThreshold: 20,
    },
  })
  
  await prisma.inventory.create({
    data: {
      productId: bundle.id,
      sellerId: seller.id,
      quantity: 30,
      available: 30,
      reserved: 0,
      lowStockAlert: 5,
      restockThreshold: 10,
    },
  })
  console.log('✅ Inventory created')
  
  // Crear user regular
  const userPassword = await bcrypt.hash('user123', 10)
  const user = await prisma.user.upsert({
    where: { email: 'cliente@email.cl' },
    update: {},
    create: {
      email: 'cliente@email.cl',
      phone: '+56911111111',
      passwordHash: userPassword,
      firstName: 'María',
      lastName: 'González',
      role: 'USER',
      emailVerified: new Date(),
    },
  })
  
  // Crear dirección
  await prisma.address.create({
    data: {
      userId: user.id,
      label: 'Casa',
      firstName: 'María',
      lastName: 'González',
      phone: '+56911111111',
      street: 'Av. Providencia',
      number: '1234',
      apartment: 'Depto 501',
      comuna: 'Providencia',
      region: 'Región Metropolitana',
      city: 'Santiago',
      isDefault: true,
    },
  })
  console.log('✅ User and address created')
  
  // Crear post de blog
  const blogCategory = await prisma.contentCategory.create({
    data: {
      slug: 'guias',
      name: 'Guías y Tutoriales',
      description: 'Aprende sobre construcción y reparaciones',
    },
  })
  
  await prisma.contentPost.create({
    data: {
      slug: 'como-elegir-taladro',
      categoryId: blogCategory.id,
      title: 'Cómo elegir el taladro perfecto para tu proyecto',
      excerpt: 'Guía completa para seleccionar el taladro adecuado según el tipo de trabajo.',
      content: `
# Cómo elegir el taladro perfecto

Elegir el taladro correcto es esencial para cualquier proyecto...

## Tipos de taladros

1. **Taladros de percusión**: Ideales para hormigón y mampostería
2. **Taladros atornilladores**: Perfectos para ensamblaje
3. **Taladros de impacto**: Para trabajos pesados

## Potencia

La potencia se mide en watts...
      `,
      coverImage: '/images/blog/taladro-guide.jpg',
      authorId: admin.id,
      status: 'PUBLISHED',
      metaTitle: 'Guía para elegir taladro - Marketplace',
      metaDescription: 'Todo lo que necesitas saber para elegir el taladro perfecto',
      keywords: ['taladro', 'herramientas', 'construccion', 'guia'],
      publishedAt: new Date(),
    },
  })
  console.log('✅ Blog post created')
  
  console.log('🎉 Seeding completed!')
}

main()
  .catch((e) => {
    console.error('❌ Error seeding:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
