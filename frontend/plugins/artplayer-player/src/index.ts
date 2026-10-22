/**
 * Artplayer 媒体播放器插件（mmagix-files 动态应用）：视频/音频「打开方式」增强。
 * 契约：`export activate(sdk, options?)` + sdk.registerApp（options=v1.1 参数通道）。
 * 不抢内置 video-player/audio-player 的默认 view 位——registry 默认解析按**注册序**（builtins 先入册
 * 恒居首），本插件后入册仅进「打开方式」菜单（actions:['preview'] 归类为查看项）。
 * 播放源直链优先（预签名 URL，原生 Range 拖动），Blob 兜底——对齐内置 media 渲染器口径。
 */
import { normalizeOptions } from './options'
import { renderPlayer } from './render'
import type { ArtplayerOptions, HostSdk } from './types'

let activeOptions: Required<ArtplayerOptions> = normalizeOptions(undefined)

export function activate(sdk: HostSdk, rawOptions?: Record<string, unknown>): void {
  activeOptions = normalizeOptions(rawOptions)
  sdk.registerApp({
    id: 'artplayer-media',
    matcher: { ext: ['mp4', 'webm', 'mov', 'mp3', 'wav', 'ogg', 'flac', 'm4a'] },
    label: 'app.artplayer',
    actions: ['preview'],
    version: '1.0.0',
    requiresSdk: 1,
    // 无 maxBytes：对齐内置 media；实际拒绝线=全局预览闸 50MB（preview.ts 拒绝线取 min(50MB, spec.maxBytes)）
    renderer: (el, file, ctx, savedState) => renderPlayer(el, file, ctx, activeOptions, savedState),
  })
}
