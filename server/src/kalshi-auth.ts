/**
 * Kalshi API request signing for Node.js
 * Message: timestamp + method + path (e.g. "GET" + "/trade-api/v2/...")
 */

import crypto from 'node:crypto'

const SIGN_PATH_PREFIX = '/trade-api/v2'

/** Normalize PEM: handle \\n from .env, trim, fix line endings */
function normalizePem(pem: string): string {
  return pem
    .replace(/\\n/g, '\n')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()
}

export function signRequest(
  privateKeyPem: string,
  method: string,
  path: string,
  timestamp: string
): string {
  const signPath = path.startsWith('/trade-api') ? path : SIGN_PATH_PREFIX + path
  /** Kalshi: sign path only — no query string (see API Keys docs). */
  const pathWithoutQuery = signPath.split('?')[0] ?? signPath
  const message = timestamp + method + pathWithoutQuery
  const pem = normalizePem(privateKeyPem)
  let key: crypto.KeyObject
  try {
    key = crypto.createPrivateKey(pem)
  } catch (err) {
    throw new Error(
      'Invalid KALSHI_PRIVATE_KEY_PEM. In .env use actual newlines or \\n. ' +
        (err instanceof Error ? err.message : String(err))
    )
  }
  const sig = crypto.sign('RSA-SHA256', Buffer.from(message, 'utf8'), {
    key,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
  })
  return sig.toString('base64')
}

export function createWsHeaders(
  apiKeyId: string,
  privateKeyPem: string
): Record<string, string> {
  const timestamp = Date.now().toString()
  const path = '/trade-api/ws/v2'
  const signature = signRequest(privateKeyPem, 'GET', path, timestamp)
  return {
    'KALSHI-ACCESS-KEY': apiKeyId,
    'KALSHI-ACCESS-SIGNATURE': signature,
    'KALSHI-ACCESS-TIMESTAMP': timestamp,
  }
}
