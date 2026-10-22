/**
 * 渲染装配：Artplayer 播放器（视频全屏形态 / 音频音乐条形态）。
 * - 播放源两级（对齐内置 media 渲染器口径）：getMediaUrl 预签名直链优先（原生 Range 拖动），
 *   无直链回落 getObject → Blob URL（revoke 于 dispose）。
 * - savedState={time}：ready 后 seek 恢复进度；getState 上报 currentTime（切 tab 续播）。
 * - 错误面：字节流拿不到/播放器 error 事件 → 内置同款提示节点（不向调用侧抛出，仍返回可清理实例）。
 * - 无未保存概念：无 beforeDispose 确认；dispose = art.destroy() + 根节点移除。
 */
import Artplayer from 'artplayer'
import { mediaKindOf } from './media-type'
import { resolveTheme } from './options'
import type { ArtplayerOptions, HostCtx, HostFile, HostInstance } from './types'

const MEDIA_LOAD_FAIL_KEY = 'app.media-load-fail'
const AUDIO_BAR_HEIGHT = '120px'
/** artplayer 内置自动重连次数上限（RECONNECT_TIME_MAX）——video:error 达到该次数才算播放终态失败 */
const RECONNECT_MAX = 5

/** 音频音乐条形态的插件级样式（一次注入）：隐藏居中大播放钮——120px 容器装不下，
 *  它垂直居中后与进度条/控制条重叠（用户反馈）；控制条自带播放键，功能无损失 */
let audioStyleInjected = false
function injectAudioStyles(): void {
  if (audioStyleInjected) return
  audioStyleInjected = true
  const st = document.createElement('style')
  st.textContent = `.ap-stage.is-audio .art-state { display: none !important; }`
  document.head.appendChild(st)
}

interface ArtplayerLike {
  on(event: string, cb: (arg?: unknown) => void): void
  seek(time: number): void
  destroy(removeHtml?: boolean): void
  readonly currentTime: number
}

/** 错误提示节点（文案走宿主词典；样式对齐内置 media 渲染器口径） */
function buildFailTip(ctx: HostCtx): HTMLDivElement {
  const tip = document.createElement('div')
  tip.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:16px;color:#94a3b8;font-size:13px'
  tip.textContent = ctx.t(MEDIA_LOAD_FAIL_KEY)
  return tip
}

/** 播放语言自适应：宿主 <html lang> 前缀 zh → Artplayer 中文，否则英文 */
function artLang(): 'zh-cn' | 'en' {
  try {
    return (document.documentElement.getAttribute('lang') ?? '').toLowerCase().startsWith('zh') ? 'zh-cn' : 'en'
  } catch {
    return 'en'
  }
}

export async function renderPlayer(
  el: HTMLElement,
  file: HostFile,
  ctx: HostCtx,
  options: Required<ArtplayerOptions>,
  savedState?: unknown,
): Promise<HostInstance> {
  const kind = mediaKindOf(file.name) ?? 'video' // matcher 已挡白名单；此处防御缺省
  const isVideo = kind === 'video'
  const prevPos = el.style.position
  el.style.position = 'relative'

  const root = document.createElement('div')
  root.className = 'ap-root'
  root.style.cssText =
    'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#000;z-index:0'
  const stage = document.createElement('div')
  stage.className = isVideo ? 'ap-stage' : 'ap-stage is-audio'
  if (!isVideo) injectAudioStyles()
  stage.style.cssText = isVideo
    ? 'width:100%;height:100%'
    : `width:min(680px,100%);height:${AUDIO_BAR_HEIGHT}`
  root.appendChild(stage)
  el.appendChild(root)

  let disposed = false
  let degraded = false
  let art: ArtplayerLike | null = null
  let objectUrl: string | null = null

  /** 降级：销毁播放器、落错误提示节点。幂等；setTimeout(0) 与事件派发解耦
   *  （复审 P2-2：事件回调内同步 destroy 会留下 artplayer 在途重连续体在已销毁实例上执行） */
  const degrade = (): void => {
    if (degraded || disposed) return
    degraded = true
    setTimeout(() => {
      try {
        art?.destroy(true)
      } catch {
        // 播放器未完成初始化等竞态静默——root.replaceChildren 兜底
      }
      art = null
      root.replaceChildren(buildFailTip(ctx))
    }, 0)
  }

  const instance: HostInstance = {
    dispose: () => {
      if (disposed) return
      disposed = true
      try {
        art?.destroy(true)
      } catch {
        // destroy 竞态（播放器未完成初始化）静默——根节点移除已兜底
      }
      art = null
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      root.remove()
      el.style.position = prevPos
    },
    getState: () => {
      let time = 0
      try {
        time = art?.currentTime ?? 0
      } catch {
        time = 0
      }
      return { time }
    },
  }

  // 播放源：直链优先（Range 拖动），无直链回落字节流（blob: 无 Range 语义，整读）
  let url: string
  const directUrl = ctx.getMediaUrl?.(file.key)
  if (directUrl) {
    url = directUrl
  } else {
    try {
      const blob = await ctx.getObject(file.key)
      objectUrl = URL.createObjectURL(blob)
      url = objectUrl
    } catch {
      degrade()
      return instance
    }
  }

  try {
    const theme = resolveTheme(options)
    art = new Artplayer({
      container: stage,
      url,
      lang: artLang(),
      theme,
      autoplay: options.autoplay,
      volume: 0.7,
      setting: true,
      playbackRate: true,
      aspectRatio: true,
      flip: true,
      fullscreen: isVideo,
      fullscreenWeb: true,
      pip: isVideo,
      screenshot: isVideo,
      miniProgressBar: true,
      hotkey: true,
      mutex: true,
      backdrop: true,
      moreVideoAttr: { playsInline: true, 'webkit-playsinline': true },
    }) as unknown as ArtplayerLike

    // 进度恢复（切 tab 回来）：ready 后 seek；非法 savedState 静默跳过
    const saved = (savedState ?? {}) as { time?: unknown }
    if (typeof saved.time === 'number' && saved.time > 0) {
      art.on('ready', () => {
        try {
          art?.seek(saved.time as number)
        } catch {
          // seek 失败（媒体时长未知等）静默——不阻塞播放
        }
      })
    }
    // 播放失败判定（复审 P2-1）：artplayer 的 'error' 事件是「每次重连尝试」发一次（瞬时网络/签名
    // 抖动会自愈），重连耗尽反而不发——监听原始 'video:error' 计次，达内置重连上限才算终态失败降级
    let videoErrCount = 0
    art.on('video:error', () => {
      videoErrCount += 1
      if (videoErrCount >= RECONNECT_MAX) degrade()
    })
  } catch (err) {
    console.warn('ARTPLAYER_MOUNT_ERR', String(err)?.slice(0, 200))
    degrade()
  }

  return instance
}
