// OEM / 接入配置（形态 copy 自 opencut-embed-demo config/oem.ts）

/** S3 凭据类 env 的读取（.env.local，gitignore——真实凭据不进仓库） */
function env(name: string): string {
  return (import.meta.env[name] as string | undefined) ?? "";
}

export const OEM_CONFIG = {
  /** 产品名（专有名词，不随 locale；页面副标题走 i18n demo.app.subtitle） */
  appName: "MMagic-Files",
  /**
   * 被嵌 SPA（MMagic-Files，本仓 frontend/）地址。
   * 联调口径：frontend 以 5199 起（`pnpm exec vite --port 5199 --strictPort`，与
   * frontend/playwright.config.ts 同端口）；生产换你的部署域。
   */
  filesBase: import.meta.env.VITE_MMFILES_BASE ?? "http://localhost:5199/",
  /** 以下 S3 表单缺省值读 .env.local（VITE_S3_*），全部缺省留空=演示「零凭据」起点 */
  s3: {
    endpoint: env("VITE_S3_ENDPOINT"),
    region: env("VITE_S3_REGION"),
    bucket: env("VITE_S3_BUCKET"),
    prefix: env("VITE_S3_PREFIX"),
    accessKeyId: env("VITE_S3_ACCESS_KEY_ID"),
    accessKeySecret: env("VITE_S3_ACCESS_KEY_SECRET"),
    sessionToken: env("VITE_S3_SESSION_TOKEN"),
  },
  /** demo 自带样例文件（public/ 下，同源可直链——#file 模式的零依赖演示素材） */
  sampleBase: `${window.location.origin}/sample-data/`,
};

export type OemConfig = typeof OEM_CONFIG;
