/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 被嵌 SPA 基址（缺省 http://localhost:5199/） */
  readonly VITE_MMFILES_BASE?: string
  readonly VITE_S3_ENDPOINT?: string
  readonly VITE_S3_REGION?: string
  readonly VITE_S3_BUCKET?: string
  readonly VITE_S3_PREFIX?: string
  readonly VITE_S3_ACCESS_KEY_ID?: string
  readonly VITE_S3_ACCESS_KEY_SECRET?: string
  readonly VITE_S3_SESSION_TOKEN?: string
}
