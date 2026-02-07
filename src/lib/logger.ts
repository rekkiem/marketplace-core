type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogContext {
  [key: string]: any
}

class Logger {
  private level: LogLevel
  
  constructor() {
    this.level = (process.env.LOG_LEVEL as LogLevel) || 'info'
  }
  
  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error']
    return levels.indexOf(level) >= levels.indexOf(this.level)
  }
  
  private log(level: LogLevel, message: string, context?: LogContext) {
    if (!this.shouldLog(level)) return
    
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...context,
    }
    
    // En producción, enviar a servicio de logging (Datadog, CloudWatch, etc)
    if (process.env.NODE_ENV === 'production') {
      console.log(JSON.stringify(entry))
    } else {
      const color = {
        debug: '\x1b[36m',
        info: '\x1b[32m',
        warn: '\x1b[33m',
        error: '\x1b[31m',
      }[level]
      
      console.log(
        `${color}[${level.toUpperCase()}]\x1b[0m ${message}`,
        context ? context : ''
      )
    }
  }
  
  debug(message: string, context?: LogContext) {
    this.log('debug', message, context)
  }
  
  info(message: string, context?: LogContext) {
    this.log('info', message, context)
  }
  
  warn(message: string, context?: LogContext) {
    this.log('warn', message, context)
  }
  
  error(message: string, error?: Error | unknown, context?: LogContext) {
    const errorContext = error instanceof Error
      ? {
          error: error.message,
          stack: error.stack,
          ...context,
        }
      : { error: String(error), ...context }
    
    this.log('error', message, errorContext)
  }
}

export const logger = new Logger()

// Helper para medir performance de operaciones
export async function measurePerformance<T>(
  name: string,
  operation: () => Promise<T>
): Promise<T> {
  const start = Date.now()
  
  try {
    const result = await operation()
    const duration = Date.now() - start
    
    logger.debug(`Performance: ${name}`, { duration })
    
    return result
  } catch (error) {
    const duration = Date.now() - start
    
    logger.error(`Performance: ${name} (failed)`, error, { duration })
    
    throw error
  }
}
