/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_KALSHI_API_KEY_ID: string
  readonly VITE_KALSHI_API_PRIVATE_KEY: string
  readonly VITE_KALSHI_API_BASE: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
