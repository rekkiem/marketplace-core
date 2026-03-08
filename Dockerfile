FROM node:20-alpine

# 1. Crear directorio
WORKDIR /app

# 2. Copiar manifests
COPY package*.json ./

# 3. Instalar dependencias
RUN npm install

# 4. Copiar código
COPY . .

# 5. Generar cliente Prisma
RUN npx prisma generate

# 6. Exponer puerto
EXPOSE 3000

# 7. Arrancar en modo dev (demo)
CMD ["npm", "run", "dev"]
