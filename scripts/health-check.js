#!/usr/bin/env node

/**
 * Health Check Script
 * Verifica el estado del sistema completo
 */

const http = require('http');

const checks = [
  {
    name: 'API Server',
    url: 'http://localhost:3000/api/health',
    critical: true
  },
  {
    name: 'Database',
    url: 'http://localhost:3000/api/health/db',
    critical: true
  },
  {
    name: 'Redis',
    url: 'http://localhost:3000/api/health/redis',
    critical: true
  }
];

async function checkEndpoint(check) {
  return new Promise((resolve) => {
    const req = http.get(check.url, (res) => {
      const healthy = res.statusCode === 200;
      resolve({
        ...check,
        status: healthy ? 'OK' : 'FAIL',
        statusCode: res.statusCode,
        healthy
      });
    });

    req.on('error', (err) => {
      resolve({
        ...check,
        status: 'ERROR',
        error: err.message,
        healthy: false
      });
    });

    req.setTimeout(5000, () => {
      req.destroy();
      resolve({
        ...check,
        status: 'TIMEOUT',
        healthy: false
      });
    });
  });
}

async function runHealthChecks() {
  console.log('🏥 Running health checks...\n');

  const results = await Promise.all(checks.map(checkEndpoint));

  let allHealthy = true;

  results.forEach(result => {
    const icon = result.healthy ? '✅' : '❌';
    console.log(`${icon} ${result.name}: ${result.status}`);
    
    if (!result.healthy && result.critical) {
      allHealthy = false;
    }
    
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
  });

  console.log(`\n${allHealthy ? '✅ All systems operational' : '❌ System unhealthy'}`);
  process.exit(allHealthy ? 0 : 1);
}

runHealthChecks();
