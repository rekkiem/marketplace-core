/**
 * PM2 Ecosystem Configuration
 * Para deployment en Seenode o cualquier servidor VPS
 * 
 * Comandos útiles:
 * - pm2 start ecosystem.config.js --env production
 * - pm2 reload marketplace
 * - pm2 logs marketplace
 * - pm2 monit
 * - pm2 stop marketplace
 */

module.exports = {
  apps: [
    {
      // ============================================
      // MAIN APPLICATION
      // ============================================
      name: 'marketplace',
      script: 'node_modules/.bin/next',
      args: 'start -p 3000',
      cwd: './',
      instances: process.env.PM2_INSTANCES || 'max',
      exec_mode: 'cluster',
      
      // Auto-restart
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      
      // Environment variables
      env: {
        NODE_ENV: 'development',
        PORT: 3000,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      
      // Logging
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_file: './logs/pm2-combined.log',
      time: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      
      // Advanced features
      min_uptime: '10s',
      max_restarts: 10,
      restart_delay: 4000,
      
      // Graceful shutdown
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 10000,
      
      // Health monitoring
      vizion: false,
      post_update: ['npm install', 'npm run build'],
    },
    
    // ============================================
    // CRON JOBS WORKER (opcional)
    // ============================================
    {
      name: 'marketplace-cron',
      script: './scripts/cron-worker.js',
      cwd: './',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
      },
      
      error_file: './logs/cron-error.log',
      out_file: './logs/cron-out.log',
      time: true,
      
      cron_restart: '0 0 * * *',
    },
    
    // ============================================
    // QUEUE WORKER (opcional - para BullMQ)
    // ============================================
    {
      name: 'marketplace-queue',
      script: './scripts/queue-worker.js',
      cwd: './',
      instances: 2,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
      },
      
      error_file: './logs/queue-error.log',
      out_file: './logs/queue-out.log',
      time: true,
    },
  ],
  
  // ============================================
  // DEPLOYMENT CONFIGURATION
  // ============================================
  deploy: {
    // Production environment
    production: {
      user: 'deploy',
      host: ['your-server.com'],
      ref: 'origin/main',
      repo: 'git@github.com:your-repo/marketplace.git',
      path: '/var/www/marketplace',
      
      'pre-deploy-local': '',
      'post-deploy': 'npm install && npm run build && pm2 reload ecosystem.config.js --env production',
      'pre-setup': '',
      
      ssh_options: 'StrictHostKeyChecking=no',
    },
    
    // Staging environment
    staging: {
      user: 'deploy',
      host: ['staging-server.com'],
      ref: 'origin/develop',
      repo: 'git@github.com:your-repo/marketplace.git',
      path: '/var/www/marketplace-staging',
      
      'post-deploy': 'npm install && npm run build && pm2 reload ecosystem.config.js --env staging',
      
      ssh_options: 'StrictHostKeyChecking=no',
      env: {
        NODE_ENV: 'staging',
      },
    },
  },
};
