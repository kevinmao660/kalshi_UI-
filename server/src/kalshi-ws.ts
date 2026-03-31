/**
 * Kalshi WebSocket client — connects, subscribes to orderbook_delta + trade, forwards messages
 */

import WebSocket from 'ws'
import { createWsHeaders } from './kalshi-auth.js'

const WS_URL = process.env.KALSHI_WS_URL || 'wss://api.elections.kalshi.com/trade-api/ws/v2'

export type KalshiWsMessageHandler = (data: unknown) => void

export function connectKalshiWs(
  marketTicker: string,
  onMessage: KalshiWsMessageHandler,
  apiKeyId: string,
  privateKeyPem: string
): WebSocket {
  const headers = createWsHeaders(apiKeyId, privateKeyPem)
  const ws = new WebSocket(WS_URL, {
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
  })

  let subscribed = false

  ws.on('open', () => {
    const subscribe = {
      id: 1,
      cmd: 'subscribe',
      params: {
        channels: ['orderbook_delta', 'trade'],
        market_ticker: marketTicker,
      },
    }
    ws.send(JSON.stringify(subscribe))
  })

  ws.on('message', (data: Buffer) => {
    try {
      const parsed = JSON.parse(data.toString())
      onMessage(parsed)
      if (parsed.type === 'subscribed') {
        subscribed = true
      }
    } catch {
      // ignore parse errors
    }
  })

  ws.on('error', (err) => {
    console.error('[Kalshi WS] error:', err.message)
  })

  ws.on('close', () => {
    if (subscribed) {
      console.log('[Kalshi WS] connection closed for', marketTicker)
    }
  })

  return ws
}

/**
 * Single authenticated connection for private portfolio channels (see Kalshi WS docs).
 * - user_orders: resting / executed / canceled — drives queue + resting REST refresh
 * - fill: your fills — piggyback portfolio refetch on resting_orders (see server)
 * (market_positions omitted — high volume; fill + user_order + REST cover positions.)
 */
export function connectKalshiPrivateDataWs(
  onMessage: KalshiWsMessageHandler,
  apiKeyId: string,
  privateKeyPem: string,
): WebSocket {
  const headers = createWsHeaders(apiKeyId, privateKeyPem)
  const ws = new WebSocket(WS_URL, {
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
  })

  ws.on('open', () => {
    const subscribe = {
      id: 1,
      cmd: 'subscribe',
      params: {
        channels: ['user_orders', 'fill'],
      },
    }
    ws.send(JSON.stringify(subscribe))
  })

  ws.on('message', (data: Buffer) => {
    try {
      const parsed = JSON.parse(data.toString())
      onMessage(parsed)
    } catch {
      // ignore parse errors
    }
  })

  ws.on('error', (err) => {
    console.error('[Kalshi private_data WS] error:', err.message)
  })

  ws.on('close', () => {
    console.log('[Kalshi private_data WS] connection closed')
  })

  return ws
}

/** @deprecated Use connectKalshiPrivateDataWs */
export const connectKalshiUserOrdersWs = connectKalshiPrivateDataWs
