/**
 * OEM 白标配置 — 前端静态配置文件。
 *
 * 历史上 OEM 配置从后端 `/api/v1/oem/config` 拉取 (按域名多租户匹配)。
 * 现改为前端配置文件直接内置默认值, 不再发起网络请求:
 *  - 启动零延迟、离线可用、无首屏闪烁
 *  - 如需按环境差异化, 可在此读取 import.meta.env 或构建期注入
 *
 * 使用方式:
 *   import { OEM_CONFIG, type OemConfig } from '@/config/oem'
 */

/** OEM 配置类型 (原 api/oem.ts 的 OemConfig, 接口取消后迁移至此) */
export interface OemConfig {
  logoUrl?: string
  logoDarkUrl?: string
  companyName?: string
  title?: string
  subtitle?: string
  brand?: 'ldx2' | 'mchuan' | 'apple' | 'google' | 'manyun' | 'acme' | string
  theme?: 'light' | 'dark'
  primaryColor?: string
  successColor?: string
  warningColor?: string
  dangerColor?: string
  locale?: 'zh-CN' | 'en-US' | string
  faviconUrl?: string
  footerText?: string
  supportUrl?: string
  loginBgUrl?: string
}

/** 默认 OEM 配置 (前端内置, 不依赖后端) */
export const OEM_CONFIG: OemConfig = {
  logoUrl: '/logo.svg',
  companyName: 'ACME 微剧场 DEMO',
  title: 'ACME 微剧场',
  subtitle: '微中台接入演示',
  brand: 'acme',
  theme: 'light',
  locale: 'zh-CN',
  footerText: '',
}
