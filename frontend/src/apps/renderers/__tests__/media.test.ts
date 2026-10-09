/**
 * 媒体渲染器（video/audio）单测（M2-R2）
 * 契约正本：renderers/media.ts 头注释——getObject→Blob→objectURL→<video|audio controls>；
 * dispose=remove+revoke；getObject 拒绝→el 内错误提示节点且不向调用侧抛出。
 * 环境：jsdom 无 createObjectURL/revokeObjectURL——Object.defineProperty 挂桩，afterEach 还原。
 *
 * 覆盖点：
 *  1. videoRenderer——挂 <video controls>、src=桩 blob URL、getObject 以 file.key 调用、
 *     createObjectURL 收到 Blob；dispose 前 revoke 不被调（泄漏检查）
 *  2. audioRenderer——挂 <audio controls>，链路同上
 *  3. dispose——媒体元素移除 + revokeObjectURL 以同一 URL 调用
 *  4. 失败面——getObject 拒绝：renderer 正常 resolve（不抛出）、el 内错误提示节点
 *     （文案=ctx.t(key)）、无媒体元素、revoke 不被调、dispose 移除提示节点
 *  5. （Lane F6）媒体直链分支——ctx.getMediaUrl 能力存在时优先作 src（浏览器原生 Range 拖动），
 *     零字节流（getObject/createObjectURL 不触达、dispose 无 revoke）；空串回落 Blob 路径
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { audioRenderer, videoRenderer } from '../media'
import type { AppCtx, AppInstance } from '../../../sdk/types'

/** 渲染文件实参（media 链路只用 key；其余字段满足签名） */
const FILE = { key: 'media/a.mp4', name: 'a.mp4', size: 4 }
const BYTES = new Uint8Array([0x01, 0x02, 0x03, 0x04])
/** 错误提示 i18n key（契约：ctx.t('app.media-load-fail')） */
const FAIL_KEY = 'app.media-load-fail'

// ───────────────────────── URL blob 存根 ─────────────────────────
let createMock: ReturnType<typeof vi.fn<() => string>>
let revokeMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  let seq = 0
  createMock = vi.fn(() => `blob:mock-${++seq}`)
  revokeMock = vi.fn()
  // jsdom 未实现两 API——可配置挂桩（value+writable+configurable），afterEach 删除还原
  Object.defineProperty(URL, 'createObjectURL', { value: createMock, configurable: true, writable: true })
  Object.defineProperty(URL, 'revokeObjectURL', { value: revokeMock, configurable: true, writable: true })
})

afterEach(() => {
  delete (URL as unknown as Record<string, unknown>).createObjectURL
  delete (URL as unknown as Record<string, unknown>).revokeObjectURL
  vi.restoreAllMocks()
})

// ───────────────────────── 桩具 ─────────────────────────
/** fake ctx：getObject 可注入成功 Blob / 拒绝；t 加前缀以便断言文案确实走词典 */
function makeCtx(getObjectImpl: (key: string) => Promise<Blob>): AppCtx {
  return {
    getObject: vi.fn(getObjectImpl),
    putObject: vi.fn(async () => undefined),
    t: (key: string) => `T:${key}`,
    notify: vi.fn(),
    theme: {},
  }
}
const okCtx = (mime: string) => makeCtx(async () => new Blob([BYTES], { type: mime }))
const failCtx = () => makeCtx(async () => {
  throw new Error('sigv4 404')
})

describe('videoRenderer', () => {
  it('挂 <video controls> 且 src=objectURL；getObject 以 file.key 调用、createObjectURL 收 Blob', async () => {
    const ctx = okCtx('video/mp4')
    const el = document.createElement('div')

    const ret = await videoRenderer(el, FILE, ctx)
    const inst = ret as AppInstance
    expect(typeof inst.dispose).toBe('function')

    const video = el.querySelector('video')
    expect(video, 'el 内挂了 video 元素').not.toBeNull()
    expect(video!.controls).toBe(true)
    expect(video!.getAttribute('src')).toBe('blob:mock-1')
    expect(vi.mocked(ctx.getObject).mock.calls[0]?.[0]).toBe('media/a.mp4')
    expect(createMock).toHaveBeenCalledTimes(1)
    expect(createMock).toHaveBeenCalledWith(expect.any(Blob))
    // dispose 前 revoke 不被调（释放只发生在 dispose）
    expect(revokeMock).not.toHaveBeenCalled()
  })

  it('dispose：video 元素移除 + revokeObjectURL 以同一 URL 调用', async () => {
    const el = document.createElement('div')
    const inst = (await videoRenderer(el, FILE, okCtx('video/mp4'))) as AppInstance

    inst.dispose()
    expect(el.querySelector('video')).toBeNull()
    expect(el.childElementCount).toBe(0)
    expect(revokeMock).toHaveBeenCalledTimes(1)
    expect(revokeMock).toHaveBeenCalledWith('blob:mock-1')
  })

  it('getObject 拒绝：不抛出，el 内错误提示节点（文案=ctx.t），dispose 移除提示且 revoke 不被调', async () => {
    const ctx = failCtx()
    const el = document.createElement('div')

    const ret = await videoRenderer(el, FILE, ctx)
    expect(ret, '失败面也返回实例（调用侧可无脑 dispose）').toBeDefined()

    expect(el.querySelector('video')).toBeNull()
    expect(el.childElementCount).toBe(1)
    expect(el.children[0]!.textContent).toBe(`T:${FAIL_KEY}`)
    expect(createMock).not.toHaveBeenCalled()
    expect(revokeMock).not.toHaveBeenCalled()

    ;(ret as AppInstance).dispose()
    expect(el.childElementCount).toBe(0)
  })
})

describe('audioRenderer', () => {
  it('挂 <audio controls> 且 src=objectURL；dispose 移除并 revoke 同一 URL', async () => {
    const ctx = okCtx('audio/mpeg')
    const el = document.createElement('div')

    const ret = await audioRenderer(el, FILE, ctx)
    const inst = ret as AppInstance

    const audio = el.querySelector('audio')
    expect(audio, 'el 内挂了 audio 元素').not.toBeNull()
    expect(audio!.controls).toBe(true)
    expect(audio!.getAttribute('src')).toBe('blob:mock-1')
    expect(vi.mocked(ctx.getObject).mock.calls[0]?.[0]).toBe('media/a.mp4')
    expect(createMock).toHaveBeenCalledWith(expect.any(Blob))
    expect(revokeMock).not.toHaveBeenCalled()

    inst.dispose()
    expect(el.querySelector('audio')).toBeNull()
    expect(revokeMock).toHaveBeenCalledTimes(1)
    expect(revokeMock).toHaveBeenCalledWith('blob:mock-1')
  })

  it('getObject 拒绝：不抛出，错误提示节点（audio 路径失败面同 video）', async () => {
    const el = document.createElement('div')

    const ret = await audioRenderer(el, FILE, failCtx())
    expect(ret).toBeDefined()
    expect(el.querySelector('audio')).toBeNull()
    expect(el.children[0]!.textContent).toBe(`T:${FAIL_KEY}`)
    expect(createMock).not.toHaveBeenCalled()
    expect(revokeMock).not.toHaveBeenCalled()
  })
})

// ───────────────────────── 媒体直链（Lane F6：预签名 URL → 浏览器原生 Range 拖动） ─────────────────────────

/** ctx 附带 getMediaUrl 能力（装配层透传 datasource.getMediaUrl 时生效） */
function ctxWithMediaUrl(getMediaUrl: (key: string) => string): AppCtx {
  return { ...okCtx('video/mp4'), getMediaUrl } as AppCtx
}

describe('媒体直链分支（getMediaUrl 能力存在时优先于 Blob 路径）', () => {
  it('video：src=getMediaUrl(key) 预签名直链；不拉字节流、不建 objectURL；dispose 移除且不 revoke', async () => {
    const presign = vi.fn((key: string) => `https://s3.test/bkt/${key}?X-Amz-Signature=abc`)
    const ctx = ctxWithMediaUrl(presign)
    const el = document.createElement('div')

    const ret = await videoRenderer(el, FILE, ctx)
    const inst = ret as AppInstance

    const video = el.querySelector('video')
    expect(video, 'el 内挂了 video 元素').not.toBeNull()
    expect(video!.controls).toBe(true)
    expect(video!.getAttribute('src')).toBe('https://s3.test/bkt/media/a.mp4?X-Amz-Signature=abc')
    expect(presign).toHaveBeenCalledWith('media/a.mp4')
    // 直链路径零字节流：getObject/createObjectURL 均不触达（Range 拖动=浏览器按需请求，不整读入内存）
    expect(ctx.getObject).not.toHaveBeenCalled()
    expect(createMock).not.toHaveBeenCalled()

    inst.dispose()
    expect(el.querySelector('video')).toBeNull()
    expect(el.childElementCount).toBe(0)
    expect(revokeMock).not.toHaveBeenCalled() // 无 objectURL 可回收
  })

  it('audio：同上（src=直链，零 Blob 链路）', async () => {
    const ctx = ctxWithMediaUrl(() => 'https://s3.test/bkt/a.mp3?sig=1')
    const el = document.createElement('div')

    const inst = (await audioRenderer(el, FILE, ctx)) as AppInstance
    expect(el.querySelector('audio')!.getAttribute('src')).toBe('https://s3.test/bkt/a.mp3?sig=1')
    expect(ctx.getObject).not.toHaveBeenCalled()
    expect(createMock).not.toHaveBeenCalled()

    inst.dispose()
    expect(el.querySelector('audio')).toBeNull()
    expect(revokeMock).not.toHaveBeenCalled()
  })

  it('getMediaUrl 返回空串（能力存在但拿不到直链）→ 回落 Blob 路径', async () => {
    const ctx = ctxWithMediaUrl(() => '')
    const el = document.createElement('div')

    await videoRenderer(el, FILE, ctx)
    expect(el.querySelector('video')!.getAttribute('src')).toBe('blob:mock-1')
    expect(ctx.getObject).toHaveBeenCalledTimes(1)
    expect(createMock).toHaveBeenCalledTimes(1)
  })

  it('getObject 拒绝且能力存在：仍以直链优先（先于字节流判定），错误面不触发', async () => {
    const ctx = makeCtx(async () => {
      throw new Error('should not be reached')
    }) as AppCtx & { getMediaUrl: (key: string) => string }
    ctx.getMediaUrl = () => 'https://s3.test/direct.mp4'
    const el = document.createElement('div')

    await videoRenderer(el, FILE, ctx)
    expect(el.querySelector('video')!.getAttribute('src')).toBe('https://s3.test/direct.mp4')
    expect(el.textContent).not.toContain(FAIL_KEY)
  })
})
