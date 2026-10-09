/**
 * imageViewRenderer 单测（M2-R3）
 * 契约正本：image.ts 文件头注释——ctx.getObject→Blob→objectURL→<img> + viewerjs 查看；
 * 加载失败（error 事件）→ ctx.t('app.image-load-fail') 提示；dispose=viewer.destroy+revokeObjectURL
 *
 * 覆盖点：
 *  1. 成功路径——img.src=stub 的 objectURL、max-width:100%、alt=文件名
 *  2. viewerjs（vi.mock 假 Viewer）——img load 事件后实例化（挂在图片容器上，
 *     options={navbar:false,toolbar:true}）；dispose 触发 destroy 且仅一次
 *  3. 失败路径——img 派发 error → 换提示节点（ctx.t('app.image-load-fail')），img 撤下
 *  4. dispose——revokeObjectURL 以同一 URL 调用、DOM 还原；load 前 dispose 后再 load 不再实例化
 *  5. 双重 dispose 幂等
 *
 * jsdom 注记：URL.createObjectURL/revokeObjectURL 未实现 → 逐用例 stub；
 * img 不真实加载 → load/error 由测试手动派发（renderer 用 addEventListener 挂接）
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { imageViewRenderer } from '../image'
import type { AppCtx, AppInstance } from '../../../sdk/types'

/** 假 Viewer：记录实例化实参（el/options）与 destroy 次数；vi.hoisted 先于 vi.mock 工厂可用 */
const viewerMock = vi.hoisted(() => {
  const instances: FakeViewer[] = []
  class FakeViewer {
    el: HTMLElement
    options: Record<string, unknown> | undefined
    destroyCalls = 0
    constructor(el: HTMLElement, options?: Record<string, unknown>) {
      this.el = el
      this.options = options
      instances.push(this)
    }
    destroy(): FakeViewer {
      this.destroyCalls++
      return this
    }
  }
  return { instances, FakeViewer }
})

vi.mock('viewerjs', () => ({ default: viewerMock.FakeViewer }))

/** AppCtx 桩：t 恒等返回 key；getObject 返回注入 Blob */
function makeCtx(blob: Blob): AppCtx {
  return {
    getObject: vi.fn(async () => blob),
    putObject: vi.fn(async () => undefined),
    t: (key: string) => key,
    notify: vi.fn(),
    theme: {},
  }
}

const FILE = { key: 'dir/a.png', name: 'a.png', size: 7 }
const IMAGE_BLOB = new Blob([new Uint8Array([0x89, 0x50])], { type: 'image/png' })

async function render(el: HTMLElement, blob = IMAGE_BLOB): Promise<AppInstance> {
  const ret = await imageViewRenderer(el, FILE, makeCtx(blob))
  expect(ret && typeof (ret as AppInstance).dispose === 'function').toBe(true)
  return ret as AppInstance
}

/** 每用例重建 URL.createObjectURL/revokeObjectURL stub（jsdom 未实现） */
let createObjectURL: ReturnType<typeof vi.fn>
let revokeObjectURL: ReturnType<typeof vi.fn>

beforeEach(() => {
  createObjectURL = vi.fn(() => 'blob:mock-1')
  revokeObjectURL = vi.fn()
  Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true, writable: true })
  Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true, writable: true })
  viewerMock.instances.length = 0
})

function imgOf(el: HTMLElement): HTMLImageElement {
  const img = el.querySelector('img')
  expect(img, '渲染后 el 内有 <img>').not.toBeNull()
  return img!
}

describe('imageViewRenderer 成功路径', () => {
  it('getObject→objectURL→<img>：src/max-width/alt 到位，Viewer 在 load 前不实例化', async () => {
    const el = document.createElement('div')
    await render(el)

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(createObjectURL).toHaveBeenCalledWith(IMAGE_BLOB)
    const img = imgOf(el)
    expect(img.src).toBe('blob:mock-1')
    expect(img.style.maxWidth).toBe('100%')
    expect(img.alt).toBe('a.png')
    expect(viewerMock.instances).toHaveLength(0) // 尚未 load
  })

  it('img load → 实例化 Viewer（挂图片容器，navbar:false toolbar:true）', async () => {
    const el = document.createElement('div')
    await render(el)
    const img = imgOf(el)

    img.dispatchEvent(new Event('load'))
    expect(viewerMock.instances).toHaveLength(1)
    const inst = viewerMock.instances[0]!
    expect(inst.el).toBe(img.parentElement)
    expect(inst.options).toEqual({ navbar: false, toolbar: true })
  })
})

describe('imageViewRenderer 失败路径', () => {
  it('img 派发 error：撤下图片，换 app.image-load-fail 提示节点', async () => {
    const el = document.createElement('div')
    await render(el)
    const img = imgOf(el)

    img.dispatchEvent(new Event('error'))
    expect(el.querySelector('img')).toBeNull()
    expect(el.textContent).toContain('app.image-load-fail')
    expect(viewerMock.instances).toHaveLength(0) // 失败不建 Viewer
  })

  it('error 后 dispose 仍可安全收尾（无 Viewer 可 destroy，URL 正常回收）', async () => {
    const el = document.createElement('div')
    const inst = await render(el)
    imgOf(el).dispatchEvent(new Event('error'))

    inst.dispose()
    expect(el.childElementCount).toBe(0)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-1')
  })
})

describe('imageViewRenderer dispose', () => {
  it('dispose：viewer.destroy 恰一次、revokeObjectURL 用同一 URL、DOM 还原', async () => {
    const el = document.createElement('div')
    const inst = await render(el)
    imgOf(el).dispatchEvent(new Event('load'))
    expect(viewerMock.instances).toHaveLength(1)

    inst.dispose()
    expect(viewerMock.instances[0]!.destroyCalls).toBe(1)
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-1')
    expect(el.childElementCount).toBe(0)
  })

  it('load 前 dispose：之后再派发 load 不再实例化 Viewer（守卫 disposed）', async () => {
    const el = document.createElement('div')
    const inst = await render(el)
    const img = imgOf(el)

    inst.dispose()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-1')
    img.dispatchEvent(new Event('load'))
    expect(viewerMock.instances).toHaveLength(0)
  })

  it('双重 dispose 幂等：destroy/revoke 各只一次', async () => {
    const el = document.createElement('div')
    const inst = await render(el)
    imgOf(el).dispatchEvent(new Event('load'))

    inst.dispose()
    expect(() => inst.dispose()).not.toThrow()
    expect(viewerMock.instances[0]!.destroyCalls).toBe(1)
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)
    expect(el.childElementCount).toBe(0)
  })
})
