.PHONY: help install dev build start test docker-up docker-down clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies
	npm ci

dev: ## Start development server
	npm run dev

build: ## Build for production
	npm run build

start: ## Start production server
	npm start

test: ## Run tests
	npm test

lint: ## Run linter
	npm run lint

type-check: ## Run TypeScript type checking
	npm run type-check

db-migrate: ## Run database migrations
	npm run db:migrate

db-seed: ## Seed database
	npm run db:seed

db-studio: ## Open Prisma Studio
	npm run db:studio

docker-up: ## Start Docker containers
	docker-compose up -d

docker-down: ## Stop Docker containers
	docker-compose down

docker-logs: ## View Docker logs
	docker-compose logs -f

docker-rebuild: ## Rebuild Docker containers
	docker-compose down && docker-compose build --no-cache && docker-compose up -d

pm2-start: ## Start with PM2
	pm2 start ecosystem.config.js --env production

pm2-stop: ## Stop PM2
	pm2 stop marketplace

pm2-logs: ## View PM2 logs
	pm2 logs marketplace

pm2-monit: ## Monitor PM2
	pm2 monit

clean: ## Clean build artifacts
	rm -rf .next node_modules .turbo logs/*.log

backup-db: ## Backup database
	node scripts/backup-db.js

health: ## Check system health
	node scripts/health-check.js
