/**
 * Kalshi REST API proxy — signed requests for order placement, etc.
 * Rate limits (Kalshi trade API): read 20/s, write 10/s — enforced here for all outbound calls.
 */

import { signRequest } from './kalshi-auth.js'

const KALSHI_BASE = 'https://api.elections.kalshi.com/trade-api/v2'

/** GET and HEAD count as read; POST/PUT/PATCH/DELETE as write. */
const READ_PER_SECOND = 20
const WRITE_PER_SECOND = 10

class TokenBucket {
  private tokens: number
  private lastRefill: number
  private readonly capacity: number
  private readonly refillPerMs: number

  constructor(tokensPerSecond: number) {
    this.capacity = tokensPerSecond
    this.tokens = tokensPerSecond
    this.refillPerMs = tokensPerSecond / 1000
    this.lastRefill = Date.now()
  }

  private refill(): void {
    const now = Date.now()
    const elapsed = now - this.lastRefill
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs)
    this.lastRefill = now
  }

  async acquire(): Promise<void> {
    for (;;) {
      this.refill()
      if (this.tokens >= 1) {
        this.tokens -= 1
        return
      }
      const deficit = 1 - this.tokens
      const waitMs = Math.ceil(deficit / this.refillPerMs)
      await new Promise((r) => setTimeout(r, Math.min(Math.max(waitMs, 1), 100)))
    }
  }
}

const readBucket = new TokenBucket(READ_PER_SECOND)
const writeBucket = new TokenBucket(WRITE_PER_SECOND)

function isWriteMethod(method: string): boolean {
  const m = method.toUpperCase()
  return m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE'
}

export async function kalshiFetch(
  path: string,
  options: { method?: string; body?: object },
  apiKeyId: string,
  privateKeyPem: string
): Promise<Response> {
  const method = options.method || 'GET'
  if (isWriteMethod(method)) await writeBucket.acquire()
  else await readBucket.acquire()

  const timestamp = Date.now().toString()
  const signature = signRequest(privateKeyPem, method, path, timestamp)

  const url = KALSHI_BASE + path
  const headers: Record<string, string> = {
    'KALSHI-ACCESS-KEY': apiKeyId,
    'KALSHI-ACCESS-SIGNATURE': signature,
    'KALSHI-ACCESS-TIMESTAMP': timestamp,
  }
  if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
    headers['Content-Type'] = 'application/json'
  }

  const init: RequestInit = { method, headers }
  if (options.body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
    init.body = JSON.stringify(options.body)
  }

  return fetch(url, init)
}
