/**
 * imagePainterRenderer 单测（M2-R6，计划表最后一个内置应用）
 * 被测：src/apps/renderers/painter.ts——Canvas 画板（白底 + 工具条 + 手绘 + 保存链）
 * 覆盖：挂载/工具条、底图（load 绘制 / error / getObject 拒绝→空白可画）、手绘序列与换色换宽、
 *       清空置 dirty、保存链（putObject png→notify→dirty 复位、导出失败/上传失败保持 dirty、防重入）、
 *       保存格式降级确认（R2-08：svg/webp 等非 png|jpg|jpeg 先 confirm，取消=不保存）、
 *       工具条 fc-button 全局类（R2-12）、
 *       beforeDispose 契约（非 dirty 放行 / confirm false / 3s 超时）、getContext null 分支、dispose 清理。
 * jsdom 注记：无 2d context→stub getContext 返回 fake ctx；toBlob/createObjectURL/revokeObjectURL 未实现→
 *       逐用例 stub；img 不真实解码→load/error 手动派发；pointer 事件用 MouseEvent 按对应类型派发。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { imagePainterRenderer, needsFormatConfirm, pickExportFormat } from '../painter'
import type { AppInstance } from '../../../sdk/types'

// ── fake 2d：与 painter.ts 触达面一一对应；calls 记录方法调用先后（stroke 序列断言锚）──
interface Fake2D {
  beginPath: ReturnType<typeof vi.fn>; closePath: ReturnType<typeof vi.fn>; moveTo: ReturnType<typeof vi.fn>
  lineTo: ReturnType<typeof vi.fn>; stroke: ReturnType<typeof vi.fn>; fillRect: ReturnType<typeof vi.fn>
  drawImage: ReturnType<typeof vi.fn>
  strokeStyle: string; lineWidth: number; lineCap: string; lineJoin: string; fillStyle: string
  calls: string[]
}

function makeFake2D(): Fake2D {
  const calls: string[] = []
  const tracked = (name: string) => vi.fn(() => { calls.push(name) })
  return {
    beginPath: tracked('beginPath'), closePath: tracked('closePath'), moveTo: tracked('moveTo'),
    lineTo: tracked('lineTo'), stroke: tracked('stroke'), fillRect: tracked('fillRect'),
    drawImage: tracked('drawImage'),
    strokeStyle: '', lineWidth: 0, lineCap: '', lineJoin: '', fillStyle: '', calls,
  }
}

// ── 测试基建 ──

const FILE = { key: 'dir/a.png', name: 'a.png', size: 7 }
const IMAGE_BLOB = new Blob([new Uint8Array([0x89, 0x50])], { type: 'image/png' })
const PNG_BLOB = new Blob([new Uint8Array([0x89, 0x50])], { type: 'image/png' })

/** fake ctx：getObject 返回注入 Blob；putObject/t/notify 为 spy（保留 vi.fn 类型便于断言/改写） */
function makeCtx(blob: Blob) {
  return {
    getObject: vi.fn(async (_key: string) => blob),
    putObject: vi.fn(async (): Promise<void> => undefined),
    t: vi.fn((key: string) => key),
    notify: vi.fn(),
    theme: {},
  }
}

/** 本渲染器保证 dispose/getState/beforeDispose 三件套齐备 */
type PainterInstance = AppInstance & Required<Pick<AppInstance, 'beforeDispose' | 'getState'>>

/** 微任务冲刷：让底图异步链（getObject→objectURL→img 挂载）与保存链跑完 */
const flush = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** 渲染助手：容器 + fake ctx → 跑渲染器（底图链不挡返回，冲刷后 img 才入 DOM） */
async function render(blob = IMAGE_BLOB): Promise<{ el: HTMLElement; ctx: ReturnType<typeof makeCtx>; inst: PainterInstance }> {
  const el = document.createElement('div')
  const ctx = makeCtx(blob)
  const inst = (await imagePainterRenderer(el, FILE, ctx)) as PainterInstance
  await flush()
  return { el, ctx, inst }
}

function canvasOf(el: HTMLElement): HTMLCanvasElement {
  const c = el.querySelector('canvas')
  expect(c, '渲染后 el 内有 <canvas>').not.toBeNull()
  return c!
}

function imgOf(el: HTMLElement): HTMLImageElement {
  const img = el.querySelector('img')
  expect(img, '底图 <img> 已挂载（隐藏）').not.toBeNull()
  return img!
}

/** 按 data 属性定位工具条按钮（测试锚 data-*，可见文案不依赖词典） */
function btnOf(el: HTMLElement, selector: string): HTMLButtonElement {
  const btn = el.querySelector<HTMLButtonElement>(selector)
  expect(btn, `按钮存在：${selector}`).not.toBeNull()
  return btn!
}

/** 派发 pointer 事件（jsdom 无 PointerEvent 构造器，用 MouseEvent 以对应类型派发） */
function pointer(canvas: HTMLCanvasElement, type: string, x: number, y: number): void {
  canvas.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true }))
}

/** 画一笔：down→up（最简手绘序列） */
function drawDot(canvas: HTMLCanvasElement, x: number, y: number): void {
  pointer(canvas, 'pointerdown', x, y)
  pointer(canvas, 'pointerup', x, y)
}

// ── 全局 stub 装卸（getContext/toBlob 挂原型；objectURL/confirm 逐用例重建）──
const origGetContext = HTMLCanvasElement.prototype.getContext
const origToBlob = HTMLCanvasElement.prototype.toBlob
let fake: Fake2D
let toBlobMock: ReturnType<typeof vi.fn>
let createObjectURL: ReturnType<typeof vi.fn>
let revokeObjectURL: ReturnType<typeof vi.fn>
let confirmSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  fake = makeFake2D()
  HTMLCanvasElement.prototype.getContext = vi.fn(() => fake) as unknown as typeof origGetContext
  toBlobMock = vi.fn((cb: BlobCallback) => { cb(PNG_BLOB) })
  HTMLCanvasElement.prototype.toBlob = toBlobMock as unknown as typeof origToBlob
  createObjectURL = vi.fn(() => 'blob:painter-mock')
  revokeObjectURL = vi.fn()
  Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true, writable: true })
  Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true, writable: true })
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true) // jsdom 无 confirm：默认=确认关闭
})

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = origGetContext
  HTMLCanvasElement.prototype.toBlob = origToBlob
  confirmSpy.mockRestore()
  vi.useRealTimers()
})

describe('imagePainterRenderer：挂载与工具条', () => {
  it('canvas 白底就位：fillRect 铺白（0,0,800,600）、CSS 白底兜底、底图链启动（getObject 以 file.key）', async () => {
    const { el, ctx } = await render()
    const canvas = canvasOf(el)
    expect(ctx.getObject).toHaveBeenCalledWith('dir/a.png')
    expect(createObjectURL).toHaveBeenCalledWith(IMAGE_BLOB) // 底图 objectURL 已建
    expect(canvas.width).toBe(800) // jsdom clientWidth=0 → 兜底尺寸
    expect(canvas.height).toBe(600)
    expect(canvas.style.background).toBe('rgb(255, 255, 255)') // jsdom 将 #ffffff 归一化为 rgb()
    expect(fake.fillStyle).toBe('#ffffff')
    expect(fake.fillRect).toHaveBeenCalledWith(0, 0, 800, 600) // 位图白底（导出非透明）
    expect(imgOf(el).style.display).toBe('none') // 底图只作解码源，不参与布局
  })

  it('工具条：色板×4（黑红蓝绿）+ 笔宽×3 + 清空/保存钮；保存钮文案走 ctx.t', async () => {
    const { el, ctx } = await render()
    expect(el.querySelectorAll('button[data-color]')).toHaveLength(4)
    for (const c of ['#000000', '#ff0000', '#0000ff', '#008000']) {
      expect(el.querySelector<HTMLButtonElement>(`button[data-color="${c}"]`), c).not.toBeNull()
    }
    expect(el.querySelectorAll('button[data-width]')).toHaveLength(3)
    expect(btnOf(el, 'button[data-action="clear"]').textContent).toBe('common.clear') // 复用宿主通用键
    expect(btnOf(el, 'button[data-action="save"]').textContent).toBe('app.painter-save')
    expect(ctx.t).toHaveBeenCalledWith('app.painter-save')
  })

  it('默认选中态：黑 + 中档笔宽（aria-pressed 标记）', async () => {
    const { el } = await render()
    const swatches = el.querySelectorAll<HTMLButtonElement>('button[data-color]')
    const widths = el.querySelectorAll<HTMLButtonElement>('button[data-width]')
    expect(swatches[0]!.getAttribute('aria-pressed')).toBe('true')
    expect(swatches[1]!.getAttribute('aria-pressed')).toBe('false')
    expect(widths[1]!.getAttribute('aria-pressed')).toBe('true')
    expect(widths[0]!.getAttribute('aria-pressed')).toBe('false')
  })
})

describe('imagePainterRenderer：底图', () => {
  it('img load → 等比居中绘制为底（natural 400×300 → 画布 800×600 中央）', async () => {
    const { el } = await render()
    const img = imgOf(el)
    Object.defineProperty(img, 'naturalWidth', { value: 400, configurable: true })
    Object.defineProperty(img, 'naturalHeight', { value: 300, configurable: true })
    img.dispatchEvent(new Event('load'))
    await flush()
    expect(fake.drawImage).toHaveBeenCalledTimes(1)
    expect(fake.drawImage).toHaveBeenCalledWith(img, 200, 150, 400, 300)
  })

  it('img error → 撤底图节点，空白画布仍可从零画（不抛）', async () => {
    const { el } = await render()
    imgOf(el).dispatchEvent(new Event('error'))
    await flush()
    expect(el.querySelector('img')).toBeNull() // 解码失败撤底图
    expect(fake.drawImage).not.toHaveBeenCalled()
    expect(() => drawDot(canvasOf(el), 5, 5)).not.toThrow()
    expect(fake.stroke).toHaveBeenCalled() // 仍可画
  })

  it('getObject 拒绝 → 无底图、drawImage 未调，画布仍可用', async () => {
    const el = document.createElement('div')
    const ctx = makeCtx(IMAGE_BLOB)
    ctx.getObject.mockRejectedValueOnce(new Error('boom'))
    const inst = (await imagePainterRenderer(el, FILE, ctx)) as PainterInstance
    await flush()
    expect(el.querySelector('img')).toBeNull()
    expect(fake.drawImage).not.toHaveBeenCalled()
    expect(() => drawDot(canvasOf(el), 3, 3)).not.toThrow()
    expect(fake.stroke).toHaveBeenCalled()
    inst.dispose()
  })
})

describe('imagePainterRenderer：手绘', () => {
  it('down→move→move→up：调用序列 beginPath/moveTo/lineTo×3/stroke×3/closePath，坐标与 round 样式正确，置 dirty', async () => {
    const { el, inst } = await render()
    const canvas = canvasOf(el)
    fake.calls.length = 0 // 撇开挂载期白铺 fillRect，只看本笔画序列
    pointer(canvas, 'pointerdown', 10, 20)
    pointer(canvas, 'pointermove', 30, 40)
    pointer(canvas, 'pointermove', 50, 60)
    pointer(canvas, 'pointerup', 50, 60)

    const SEQ = ['beginPath', 'moveTo', 'lineTo', 'stroke', 'lineTo', 'stroke', 'lineTo', 'stroke', 'closePath']
    expect(fake.calls).toEqual(SEQ)
    expect(fake.moveTo).toHaveBeenCalledWith(10, 20)
    expect(fake.lineTo).toHaveBeenLastCalledWith(50, 60)
    expect(fake.strokeStyle).toBe('#000000') // 默认黑
    expect(fake.lineWidth).toBe(5) // 默认中档
    expect(fake.lineCap).toBe('round')
    expect(fake.lineJoin).toBe('round')
    expect(inst.getState()).toEqual({ dirty: true })
  })

  it('非绘制态 move/up 忽略（未 down 不出 beginPath；up 后 move 不再 lineTo）', async () => {
    const { el } = await render()
    const canvas = canvasOf(el)

    pointer(canvas, 'pointermove', 1, 1)
    pointer(canvas, 'pointerup', 1, 1)
    expect(fake.beginPath).not.toHaveBeenCalled()

    drawDot(canvas, 2, 2)
    const lineTos = fake.lineTo.mock.calls.length
    pointer(canvas, 'pointermove', 3, 3)
    expect(fake.lineTo.mock.calls.length).toBe(lineTos)
  })

  it('换色/换宽生效：点红色板→strokeStyle #ff0000；点 10 宽→lineWidth 10；aria-pressed 跟随', async () => {
    const { el } = await render()
    const red = btnOf(el, 'button[data-color="#ff0000"]')
    const w10 = btnOf(el, 'button[data-width="10"]')
    red.click()
    w10.click()
    expect(red.getAttribute('aria-pressed')).toBe('true')
    expect(w10.getAttribute('aria-pressed')).toBe('true')
    drawDot(canvasOf(el), 1, 1)
    expect(fake.strokeStyle).toBe('#ff0000')
    expect(fake.lineWidth).toBe(10)
  })
})

describe('imagePainterRenderer：清空', () => {
  it('点击清空：白铺重铺（fillRect 全幅）+ dirty 置位（beforeDispose 走 confirm）', async () => {
    const { el, inst } = await render()
    const n0 = fake.fillRect.mock.calls.length

    btnOf(el, 'button[data-action="clear"]').click()
    expect(fake.fillRect.mock.calls.length).toBe(n0 + 1)
    expect(fake.fillRect).toHaveBeenLastCalledWith(0, 0, 800, 600)
    expect(inst.getState()).toEqual({ dirty: true })
    await expect(inst.beforeDispose()).resolves.toBe(true) // confirm 默认 true=确认关闭
    expect(confirmSpy).toHaveBeenCalledTimes(1)
  })
})

describe('imagePainterRenderer：保存链', () => {
  it('点保存：toBlob(png)→putObject(key,blob,"image/png")→notify(saved)→dirty 复位（confirm 不弹）', async () => {
    const { el, ctx, inst } = await render()
    drawDot(canvasOf(el), 1, 1)

    btnOf(el, 'button[data-action="save"]').click()
    await flush()
    // 断言变化（Lane F6 格式保留改造）：quality 实参显式透传（png 无 quality → undefined），故补第三实参
    expect(toBlobMock).toHaveBeenCalledWith(expect.any(Function), 'image/png', undefined)
    expect(ctx.putObject).toHaveBeenCalledTimes(1)
    const [key, data, type] = ctx.putObject.mock.calls[0] as unknown as [string, Blob, string]
    expect(key).toBe('dir/a.png')
    expect(data).toBe(PNG_BLOB)
    expect(type).toBe('image/png') // 决策：PNG 覆盖原 key（原格式可能非 png，契约未禁止）
    expect(ctx.notify).toHaveBeenCalledWith('saved', { key: 'dir/a.png' })
    expect(inst.getState()).toEqual({ dirty: false })
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(inst.beforeDispose()).toBe(true)
  })

  it('toBlob 回调 null（导出失败）：不 putObject、不 notify、dirty 保持', async () => {
    const { el, ctx, inst } = await render()
    drawDot(canvasOf(el), 1, 1)
    toBlobMock.mockImplementation((cb: BlobCallback) => { cb(null) })

    btnOf(el, 'button[data-action="save"]').click()
    await flush()
    expect(ctx.putObject).not.toHaveBeenCalled()
    expect(ctx.notify).not.toHaveBeenCalled()
    expect(inst.getState()).toEqual({ dirty: true })
  })

  it('putObject 拒绝：不 notify、dirty 保持（不误报已保存）', async () => {
    const { el, ctx, inst } = await render()
    drawDot(canvasOf(el), 1, 1)
    ctx.putObject.mockRejectedValueOnce(new Error('network'))

    btnOf(el, 'button[data-action="save"]').click()
    await flush()
    expect(ctx.notify).not.toHaveBeenCalled()
    expect(inst.getState()).toEqual({ dirty: true })
  })

  it('保存中防重入：putObject 未决期间重复点保存只触发一次', async () => {
    const { el, ctx } = await render()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    ctx.putObject.mockReturnValueOnce(gate)

    btnOf(el, 'button[data-action="save"]').click()
    await flush() // 让首个保存走到 putObject（导出 promise 已决、上传闸未决）
    btnOf(el, 'button[data-action="save"]').click()
    expect(ctx.putObject).toHaveBeenCalledTimes(1)
    release()
    await flush()
    expect(ctx.putObject).toHaveBeenCalledTimes(1) // 放行后不补发
    expect(ctx.notify).toHaveBeenCalledTimes(1)
  })
})

describe('imagePainterRenderer：beforeDispose 契约', () => {
  it('非 dirty：同步放行 true，不弹 confirm', async () => {
    const { inst } = await render()
    expect(inst.beforeDispose()).toBe(true)
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  it('dirty：弹 confirm（app.painter-unsaved），用户取消=false=暂缓关闭', async () => {
    const { el, inst } = await render()
    confirmSpy.mockReturnValue(false)
    drawDot(canvasOf(el), 1, 1)
    await expect(inst.beforeDispose()).resolves.toBe(false)
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(confirmSpy).toHaveBeenCalledWith('app.painter-unsaved')
  })

  it('dirty 且 confirm 未决：3s 超时强制放行 true（Promise.race 契约）', async () => {
    vi.useFakeTimers()
    // 不走 render() 助手（其 flush 依赖 setTimeout，fake timers 下不走）；DOM 同步就绪，无碍
    const el = document.createElement('div')
    const inst = (await imagePainterRenderer(el, FILE, makeCtx(IMAGE_BLOB))) as PainterInstance
    confirmSpy.mockImplementation(() => new Promise<boolean>(() => undefined) as unknown as boolean)
    drawDot(canvasOf(el), 1, 1)

    let result: boolean | undefined
    void Promise.resolve(inst.beforeDispose()).then((v) => { result = v })

    await vi.advanceTimersByTimeAsync(2999)
    await Promise.resolve()
    expect(result).toBeUndefined() // 未到 3s：不决出
    await vi.advanceTimersByTimeAsync(1)
    await Promise.resolve()
    expect(result).toBe(true) // 3s 到：强制放行
  })
})

describe('imagePainterRenderer：getContext("2d") 为 null（jsdom/老环境）', () => {
  it('显示错误提示节点（app.painter-unsupported），不建画布、不拉字节流、不抛；dispose 清容器', async () => {
    HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as unknown as typeof origGetContext
    const el = document.createElement('div')
    const ctx = makeCtx(IMAGE_BLOB)

    const inst = (await imagePainterRenderer(el, FILE, ctx)) as AppInstance
    expect(el.textContent).toContain('app.painter-unsupported')
    expect(el.querySelector('canvas')).toBeNull()
    expect(ctx.getObject).not.toHaveBeenCalled() // 探测先行：不白拉字节流
    expect(typeof inst.dispose).toBe('function')
    expect(inst.beforeDispose).toBeUndefined() // 最小实例（无可保护状态）
    expect(inst.getState).toBeUndefined()
    inst.dispose()
    expect(el.childElementCount).toBe(0)
  })
})

describe('imagePainterRenderer：getState 与 dispose', () => {
  it('getState 初始 {dirty:false}，绘制后 {dirty:true}', async () => {
    const { el, inst } = await render()
    expect(inst.getState()).toEqual({ dirty: false })
    drawDot(canvasOf(el), 1, 1)
    expect(inst.getState()).toEqual({ dirty: true })
  })

  it('dispose：摘监听（再 pointerdown 无 beginPath）、revokeObjectURL、清容器；双重 dispose 幂等', async () => {
    const { el, inst } = await render()
    const canvas = canvasOf(el)
    drawDot(canvas, 1, 1)
    const beginPaths = fake.beginPath.mock.calls.length

    inst.dispose()
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:painter-mock')
    expect(el.childElementCount).toBe(0)
    pointer(canvas, 'pointerdown', 9, 9) // 监听已摘：不再响应
    expect(fake.beginPath.mock.calls.length).toBe(beginPaths)
    expect(() => inst.dispose()).not.toThrow() // 幂等
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)
  })
})

// ───────────────────────── 保存格式保留（Lane F6：导出 mime 按原文件格式） ─────────────────────────

describe('pickExportFormat（保存导出 mime 纯函数）', () => {
  it('png → image/png（无 quality）；jpg/jpeg → image/jpeg(0.92)，扩展名大小写不敏感', () => {
    expect(pickExportFormat('a.png')).toEqual({ mime: 'image/png' })
    expect(pickExportFormat('b.jpg')).toEqual({ mime: 'image/jpeg', quality: 0.92 })
    expect(pickExportFormat('c.jpeg')).toEqual({ mime: 'image/jpeg', quality: 0.92 })
    expect(pickExportFormat('D.JPG')).toEqual({ mime: 'image/jpeg', quality: 0.92 })
  })

  it('其余扩展（svg/webp/gif/bmp）与无扩展名 → 维持 image/png（canvas 光栅化，svg 矢量不可回写）', () => {
    expect(pickExportFormat('e.svg')).toEqual({ mime: 'image/png' })
    expect(pickExportFormat('f.webp')).toEqual({ mime: 'image/png' })
    expect(pickExportFormat('g.bmp')).toEqual({ mime: 'image/png' })
    expect(pickExportFormat('noext')).toEqual({ mime: 'image/png' })
  })
})

/** 按指定文件名渲染（导出 mime 跟随原文件格式；模块级——R2-08 与 Lane F6 两个 describe 共用） */
async function renderNamed(name: string): Promise<{ el: HTMLElement; ctx: ReturnType<typeof makeCtx>; inst: PainterInstance }> {
  const el = document.createElement('div')
  const ctx = makeCtx(IMAGE_BLOB)
  const inst = (await imagePainterRenderer(el, { key: `dir/${name}`, name, size: 7 }, ctx)) as PainterInstance
  await flush()
  return { el, ctx, inst }
}

describe('imagePainterRenderer：保存格式降级确认（R2-08）与工具条样式（R2-12）', () => {
  it('svg 保存：先 confirm（app.painter-format-hint），确认后仍按 png 导出覆盖原 key', async () => {
    const { el, ctx } = await renderNamed('c.svg')
    drawDot(canvasOf(el), 1, 1)
    expect(confirmSpy).not.toHaveBeenCalled() // 绘制阶段不弹

    btnOf(el, 'button[data-action="save"]').click()
    await flush()
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(confirmSpy).toHaveBeenCalledWith('app.painter-format-hint') // ctx.t 恒等回键名
    expect(ctx.t).toHaveBeenCalledWith('app.painter-format-hint')
    expect(toBlobMock).toHaveBeenCalledWith(expect.any(Function), 'image/png', undefined)
    expect(ctx.putObject).toHaveBeenCalledWith('dir/c.svg', PNG_BLOB, 'image/png')
    expect(ctx.notify).toHaveBeenCalledWith('saved', { key: 'dir/c.svg' })
  })

  it('svg 保存：confirm=false → 取消保存（toBlob/putObject/notify 不触，dirty 保持，可重问）', async () => {
    const { el, ctx, inst } = await renderNamed('c.svg')
    drawDot(canvasOf(el), 1, 1)
    confirmSpy.mockReturnValue(false)

    btnOf(el, 'button[data-action="save"]').click()
    await flush()
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(toBlobMock).not.toHaveBeenCalled()
    expect(ctx.putObject).not.toHaveBeenCalled()
    expect(ctx.notify).not.toHaveBeenCalled()
    expect(inst.getState()).toEqual({ dirty: true })

    // 改主意后再点保存：再次询问、确认后正常走保存链
    confirmSpy.mockReturnValue(true)
    btnOf(el, 'button[data-action="save"]').click()
    await flush()
    expect(confirmSpy).toHaveBeenCalledTimes(2)
    expect(ctx.putObject).toHaveBeenCalledTimes(1)
  })

  it('降级判定：png/jpg/jpeg 原格式保留不询问；svg/webp/gif/bmp/无扩展名均视为降级', () => {
    for (const kept of ['a.png', 'A.PNG', 'b.jpg', 'c.jpeg']) {
      expect(needsFormatConfirm(kept), `${kept}: 原格式保留`).toBe(false)
    }
    for (const downgraded of ['d.svg', 'e.webp', 'f.gif', 'g.bmp', 'noext']) {
      expect(needsFormatConfirm(downgraded), `${downgraded}: 降级 PNG 需确认`).toBe(true)
    }
  })

  it('webp 保存：同样先确认再导出 png（confirm 默认 true → putObject image/png）', async () => {
    const { el, ctx } = await renderNamed('e.webp')
    drawDot(canvasOf(el), 1, 1)
    btnOf(el, 'button[data-action="save"]').click()
    await flush()
    expect(confirmSpy).toHaveBeenCalledWith('app.painter-format-hint')
    expect(ctx.putObject).toHaveBeenCalledWith('dir/e.webp', PNG_BLOB, 'image/png')
  })

  it('png 保存：无格式降级，全程不 confirm（原格式保留路径零打扰）', async () => {
    const { el } = await renderNamed('a.png')
    drawDot(canvasOf(el), 1, 1)
    btnOf(el, 'button[data-action="save"]').click()
    await flush()
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  it('工具条按钮套 fc-button 全局类（R2-12：保存=primary、清空=outline、笔宽=outline、色板=icon）', async () => {
    const { el } = await render()
    const save = btnOf(el, 'button[data-action="save"]')
    const clear = btnOf(el, 'button[data-action="clear"]')
    const width = el.querySelector<HTMLButtonElement>('button[data-width]')!
    const swatch = el.querySelector<HTMLButtonElement>('button[data-color]')!
    expect(save.className).toContain('fc-button')
    expect(save.className).toContain('fc-button-primary')
    expect(save.className).toContain('fc-button-xs')
    expect(clear.className).toContain('fc-button')
    expect(clear.className).toContain('fc-button-outline')
    expect(clear.className).toContain('fc-button-xs')
    expect(width.className).toContain('fc-button')
    expect(width.className).toContain('fc-button-xs')
    expect(swatch.className).toContain('fc-button')
    expect(swatch.className).toContain('fc-button-xs')
  })
})

describe('imagePainterRenderer：保存格式保留（Lane F6）', () => {
  it('jpg：toBlob(image/jpeg, 0.92) 且 putObject 按 image/jpeg 覆盖原 key', async () => {
    const { el, ctx, inst } = await renderNamed('b.jpg')
    drawDot(canvasOf(el), 1, 1)

    btnOf(el, 'button[data-action="save"]').click()
    await flush()
    expect(toBlobMock).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.92)
    expect(ctx.putObject).toHaveBeenCalledWith('dir/b.jpg', PNG_BLOB, 'image/jpeg')
    expect(ctx.notify).toHaveBeenCalledWith('saved', { key: 'dir/b.jpg' })
    expect(inst.getState()).toEqual({ dirty: false })
  })

  it('svg：维持 image/png 导出（canvas 位图无法回写 svg 矢量，见实现注释）', async () => {
    const { el, ctx } = await renderNamed('c.svg')
    drawDot(canvasOf(el), 1, 1)

    btnOf(el, 'button[data-action="save"]').click()
    await flush()
    expect(toBlobMock).toHaveBeenCalledWith(expect.any(Function), 'image/png', undefined)
    expect(ctx.putObject).toHaveBeenCalledWith('dir/c.svg', PNG_BLOB, 'image/png')
  })

  it('大写扩展名 B.JPG 同样命中 jpeg 通道（归一化不区分大小写）', async () => {
    const { el, ctx } = await renderNamed('B.JPG')
    drawDot(canvasOf(el), 1, 1)

    btnOf(el, 'button[data-action="save"]').click()
    await flush()
    expect(toBlobMock).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.92)
    expect(ctx.putObject).toHaveBeenCalledWith('dir/B.JPG', PNG_BLOB, 'image/jpeg')
  })
})
