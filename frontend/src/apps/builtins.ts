/**
 * 内置应用预置表——正本：《documents/第一期文件类型支持计划.md》§一应用清单
 * code=registry id（与计划表列一致）；label=i18n key（词典在 locales，M2 收口）；
 * renderer 由 M2 注入（registerBuiltins 的 renderers 参数），缺位时占位渲染。
 * fallback-download 不入 registry（空 matcher 语义=不命中，防吞所有类型）——
 * 由解析链「registry 无命中 → fallback」显式处理（见 resolveOrFallback）。
 */
import { AppRegistry } from './registry'
import type { AppAction, AppDefinition, AppMatcher } from '../sdk/types'

export const FALLBACK_APP_ID = 'fallback-download'

export interface BuiltinAppSpec {
  code: string
  labelKey: string
  type: 'view' | 'edit'
  matcher: AppMatcher
  actions: AppAction[]
}

export const BUILTIN_APP_SPECS: BuiltinAppSpec[] = [
  { code: 'image-viewer', labelKey: 'app.image-viewer', type: 'view', matcher: { ext: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'] }, actions: ['preview'] },
  { code: 'image-painter', labelKey: 'app.image-painter', type: 'edit', matcher: { ext: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'] }, actions: ['edit'] },
  { code: 'video-player', labelKey: 'app.video-player', type: 'view', matcher: { ext: ['mp4', 'webm', 'mov'] }, actions: ['preview'] },
  { code: 'audio-player', labelKey: 'app.audio-player', type: 'view', matcher: { ext: ['mp3', 'wav', 'ogg', 'flac', 'm4a'] }, actions: ['preview'] },
  { code: 'pdf-viewer', labelKey: 'app.pdf-viewer', type: 'view', matcher: { ext: ['pdf'] }, actions: ['preview'] },
  { code: 'markdown-renderer', labelKey: 'app.markdown-renderer', type: 'view', matcher: { ext: ['md', 'markdown'] }, actions: ['preview'] },
  // F3：渲染类应用先于 code-editor 注册（注册序=默认应用优先级）——
  // csv/tsv 默认进 csv-table 表格预览，code-editor 的文本态经「打开方式」可达（不再抢占默认）。
  { code: 'csv-table', labelKey: 'app.csv-table', type: 'view', matcher: { ext: ['csv', 'tsv'] }, actions: ['preview'] },
  {
    code: 'code-editor',
    labelKey: 'app.code-editor',
    type: 'edit',
    matcher: {
      ext: [
        'txt', 'log', 'conf', 'ini', 'env',
        'js', 'ts', 'jsx', 'tsx', 'py', 'java', 'go', 'rs', 'c', 'cpp', 'h', 'cs', 'php', 'rb', 'swift', 'kt',
        'sql', 'sh', 'yaml', 'yml', 'json', 'xml', 'html', 'css', 'scss', 'vue',
        'md', 'markdown', 'csv', // 源码态/文本态（与渲染类应用并列「打开方式」）
      ],
    },
    actions: ['edit'],
  },
  { code: 'heic-viewer', labelKey: 'app.heic-viewer', type: 'view', matcher: { ext: ['heic', 'heif'] }, actions: ['preview'] },
  { code: 'docx-viewer', labelKey: 'app.docx-viewer', type: 'view', matcher: { ext: ['docx'] }, actions: ['preview'] },
  { code: 'xlsx-viewer', labelKey: 'app.xlsx-viewer', type: 'view', matcher: { ext: ['xlsx', 'xls'] }, actions: ['preview'] },
]

/** 占位渲染器（M2 逐应用替换；保证注册表先通、渲染后行） */
function placeholderRenderer(code: string): AppDefinition['renderer'] {
  return (el) => {
    const tip = document.createElement('div')
    tip.textContent = `[${code}] renderer pending (M2)`
    tip.style.padding = '16px'
    tip.style.color = 'var(--app-text-secondary, #888)'
    el.appendChild(tip)
    return { dispose: () => tip.remove() }
  }
}

/**
 * 注册内置应用到 registry。
 * renderers: code → renderer（M2 渐进补齐；未提供的 code 用占位渲染器）。
 * 返回实际注册成功的 code 集（requiresSdk/id 冲突拒载会被过滤——正常应为全集）。
 */
export function registerBuiltins(
  registry: AppRegistry,
  renderers: Partial<Record<string, AppDefinition['renderer']>> = {},
): string[] {
  const registered: string[] = []
  for (const spec of BUILTIN_APP_SPECS) {
    const def: AppDefinition = {
      id: spec.code,
      matcher: spec.matcher,
      actions: spec.actions,
      label: spec.labelKey,
      version: '1.0.0',
      requiresSdk: 1,
      renderer: renderers[spec.code] ?? placeholderRenderer(spec.code),
    }
    const result = registry.register(def)
    if (result.ok) registered.push(spec.code)
  }
  return registered
}
