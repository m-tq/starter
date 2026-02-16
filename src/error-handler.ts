/**
 * Advanced Error Handling Utilities
 * Implements retry logic and error recovery patterns
 */

export interface RetryOptions {
  maxAttempts?: number;
  delayMs?: number;
  backoffMultiplier?: number;
  maxDelayMs?: number;
  retryableErrors?: string[];
  onRetry?: (attempt: number, error: Error) => void;
}

const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
  maxAttempts: 3,
  delayMs: 1000,
  backoffMultiplier: 2,
  maxDelayMs: 10000,
  retryableErrors: [
    'TIMEOUT',
    'NETWORK_ERROR',
    'CONNECTION_ERROR',
    'RATE_LIMIT',
  ],
  onRetry: () => {},
};

/**
 * Check if error is retryable based on error code or message
 */
export function isRetryableError(error: Error, retryableErrors: string[]): boolean {
  const errorAny = error as { code?: string; retryable?: boolean };
  
  // Check explicit retryable flag
  if (errorAny.retryable === true) return true;
  if (errorAny.retryable === false) return false;
  
  // Check error code
  if (errorAny.code && retryableErrors.includes(errorAny.code)) {
    return true;
  }
  
  // Check error message
  const message = error.message.toLowerCase();
  return retryableErrors.some(pattern => 
    message.includes(pattern.toLowerCase())
  );
}

/**
 * Execute function with retry logic and exponential backoff
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: Error;
  let currentDelay = opts.delayMs;
  
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Don't retry if not retryable or last attempt
      if (attempt === opts.maxAttempts || !isRetryableError(lastError, opts.retryableErrors)) {
        throw lastError;
      }
      
      // Call retry callback
      opts.onRetry(attempt, lastError);
      
      // Wait before retry with exponential backoff
      await new Promise(resolve => setTimeout(resolve, currentDelay));
      currentDelay = Math.min(currentDelay * opts.backoffMultiplier, opts.maxDelayMs);
    }
  }
  
  throw lastError!;
}

/**
 * Execute function with timeout
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  timeoutMessage = 'Operation timed out'
): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<T>((_, reject) => 
      setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
    ),
  ]);
}

/**
 * Circuit breaker pattern for preventing cascading failures
 */
export class CircuitBreaker {
  private failureCount = 0;
  private lastFailureTime = 0;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  
  constructor(
    private threshold: number = 5,
    private resetTimeMs: number = 60000
  ) {}
  
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      // Check if we should try half-open
      if (Date.now() - this.lastFailureTime >= this.resetTimeMs) {
        this.state = 'HALF_OPEN';
      } else {
        throw new Error('Circuit breaker is OPEN - too many failures');
      }
    }
    
    try {
      const result = await fn();
      
      // Success - reset if half-open
      if (this.state === 'HALF_OPEN') {
        this.reset();
      }
      
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }
  
  private recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    if (this.failureCount >= this.threshold) {
      this.state = 'OPEN';
    }
  }
  
  private reset(): void {
    this.failureCount = 0;
    this.state = 'CLOSED';
  }
  
  getState(): string {
    return this.state;
  }
}

/**
 * Fallback pattern - try primary, fallback to secondary on failure
 */
export async function withFallback<T>(
  primary: () => Promise<T>,
  fallback: () => Promise<T>,
  shouldFallback: (error: Error) => boolean = () => true
): Promise<T> {
  try {
    return await primary();
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    if (shouldFallback(err)) {
      return await fallback();
    }
    throw error;
  }
}

/**
 * Batch operations with error handling
 */
export async function batchWithErrorHandling<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  options: {
    concurrency?: number;
    continueOnError?: boolean;
    onError?: (item: T, error: Error) => void;
  } = {}
): Promise<Array<{ success: boolean; result?: R; error?: Error; item: T }>> {
  const { concurrency = 5, continueOnError = true, onError } = options;
  const results: Array<{ success: boolean; result?: R; error?: Error; item: T }> = [];
  
  // Process in batches
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map(item => fn(item))
    );
    
    batchResults.forEach((result, index) => {
      const item = batch[index];
      if (result.status === 'fulfilled') {
        results.push({ success: true, result: result.value, item });
      } else {
        const error = result.reason instanceof Error ? result.reason : new Error(String(result.reason));
        results.push({ success: false, error, item });
        
        if (onError) {
          onError(item, error);
        }
        
        if (!continueOnError) {
          throw error;
        }
      }
    });
  }
  
  return results;
}
