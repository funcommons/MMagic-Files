/**
 * 预览生命周期单测（Wave Lane F1）
 * 契约正本：《documents/动态插件方案.md》§五（dispose/恢复/beforeDispose）、
 *          《documents/第一期文件类型支持计划.md》缺口 7（渲染失败/超时 10s 错误边界）
 * 覆盖点：
 *  1. 向后兼容——open/clear/current 既有语义不变（stage 渲染、fallback、切换先 dispose）
 *  2. beforeDispose gate——open 切换/close 询问：false=暂缓（实例与容器完整保留）、3s 超时强制放行、
 *     true/无=放行；clear 强制语义（unmount）；expire 通知式（'expired' 只通知不等待，立即销毁）
 *  3. savedState——dispose 前 getState 采集进 per-key Map（容量 32 淘汰最旧），重开时 renderer 第 4 参回注
 *  4. 错误边界——renderer 同步抛/拒绝/10s 超时 → 错误节点（标题+信息+重试+下载门控）；
 *     超时后迟到结算 dispose 且忽略；重试钮重跑同一 open；canDownload:false 时无下载钮
 *  5. 指定应用——open(entry, { appId })：registry.require 既有 not-found 语义，未命中=错误节点不抛裸异常
 *  6. 状态一致性——并发 open（gate 挂起期间被新链接管）无半更新
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppRegistry } from '@/apps/registry'
import { createPreview } from '../preview'
import type { PreviewOptions } from '../preview'
import type { AppDataSource } from '@/apps/datasource'
import type { AppDefinition, AppInstance, S3ObjectSummary } from '@/sdk/types'

/** jsdom 微任务冲刷：click 处理器里的异步 open 链在一次宏任务内全部结算 */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function makeRegistry(...defs: AppDefinition[]): AppRegistry {
  const reg = new AppRegistry()
  for (const def of defs) {
    const r = reg.register(def)
    if (!r.ok) throw new Error(`register 失败：${def.id}（${r.reason}）`)
  }
  return reg
}

function instanceOf(overrides: Partial<AppInstance> = {}): AppInstance {
  return { dispose: vi.fn(), ...overrides }
}

/** 命中 .txt 的应用：renderer 默认写入 file.name（可断言「渲染的是谁」），返回预置实例 */
function renderApp(
  id: string,
  result: AppInstance | null = null,
  render: (el: HTMLElement, file: { key: string; name: string; size: number }) => void = (el, file) => {
    el.textContent = file.name
  },
): AppDefinition {
  return {
    id,
    matcher: { ext: ['txt'] },
    renderer: vi.fn((el: HTMLElement, file: { key: string; name: string; size: number }) => {
      render(el, file)
      return result ?? undefined // renderer 契约无 null（void | AppInstance）
    }),
  }
}

function noopDatasource(): AppDataSource {
  return {
    getObject: vi.fn(async () => new Blob()),
    putObject: vi.fn(async () => undefined),
  }
}

function baseOpts(container: HTMLElement, registry: AppRegistry, extra: Partial<PreviewOptions> = {}): PreviewOptions {
  return {
    container,
    registry,
    datasource: noopDatasource(),
    t: (key: string) => key,
    theme: {},
    notifyFileChanged: vi.fn(),
    ...extra,
  }
}

const A: S3ObjectSummary = { key: 'dir/a.txt', name: 'a.txt', size: 1, isDir: false }
const B: S3ObjectSummary = { key: 'dir/b.txt', name: 'b.txt', size: 2, isDir: false }

function makePreview(registry: AppRegistry, extra: Partial<PreviewOptions> = {}) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  return { container, preview: createPreview(baseOpts(container, registry, extra)) }
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.useRealTimers()
})

describe('向后兼容（open/clear/current 既有语义不变）', () => {
  it('open：命中应用 → stage 渲染、current()=entry', async () => {
    const app = renderApp('app1')
    const { container, preview } = makePreview(makeRegistry(app))
    await preview.open(A)
    expect(container.querySelector('.mmf-preview-stage')?.textContent).toBe('a.txt')
    expect(preview.current()).toBe(A)
  })

  it('open：registry 无命中 → fallback 下载提示（有 onDownload 时带下载钮且可触发）', async () => {
    const onDownload = vi.fn()
    const { container, preview } = makePreview(makeRegistry(), { onDownload })
    await preview.open(A)
    expect(container.querySelector('.mmf-preview-fallback')).not.toBeNull()
    const btn = container.querySelector<HTMLButtonElement>('.mmf-preview-fallback button')
    expect(btn?.textContent).toBe('files.preview-download')
    btn?.click()
    expect(onDownload).toHaveBeenCalledWith(A)
  })

  it('切换文件：旧实例先 dispose，容器替换为新内容', async () => {
    const inst = instanceOf()
    const app = renderApp('app1', inst)
    const { container, preview } = makePreview(makeRegistry(app))
    await preview.open(A)
    expect(vi.mocked(inst.dispose)).not.toHaveBeenCalled()
    await preview.open(B)
    expect(vi.mocked(inst.dispose)).toHaveBeenCalledTimes(1)
    expect(preview.current()).toBe(B)
    expect(container.querySelector('.mmf-preview-stage')?.textContent).toBe('b.txt')
  })
})

describe('beforeDispose gate（契约 §五）', () => {
  it('open 切换：beforeDispose=false → 本次 open 不生效（实例不 dispose、容器与 current 保留）', async () => {
    const gate = vi.fn(() => false)
    const inst = instanceOf({ beforeDispose: gate })
    const app = renderApp('app1', inst)
    const { container, preview } = makePreview(makeRegistry(app))
    await preview.open(A)
    await preview.open(B)
    expect(gate).toHaveBeenCalledTimes(1)
    expect(vi.mocked(inst.dispose)).not.toHaveBeenCalled()
    expect(preview.current()).toBe(A)
    expect(container.querySelector('.mmf-preview-stage')?.textContent).toBe('a.txt')
  })

  it('open 切换：beforeDispose=true → 放行（dispose 调用、渲染新内容）', async () => {
    const gate = vi.fn(() => true)
    const inst = instanceOf({ beforeDispose: gate })
    const app = renderApp('app1', inst)
    const { container, preview } = makePreview(makeRegistry(app))
    await preview.open(A)
    await preview.open(B)
    expect(gate).toHaveBeenCalledTimes(1)
    expect(vi.mocked(inst.dispose)).toHaveBeenCalledTimes(1)
    expect(container.querySelector('.mmf-preview-stage')?.textContent).toBe('b.txt')
  })

  it('无 beforeDispose → 直接放行（既有路径不回归）', async () => {
    const inst = instanceOf()
    const app = renderApp('app1', inst)
    const { preview } = makePreview(makeRegistry(app))
    await preview.open(A)
    await preview.open(B)
    expect(vi.mocked(inst.dispose)).toHaveBeenCalledTimes(1)
  })

  it('gate 3 秒超时 → 强制放行', async () => {
    vi.useFakeTimers()
    const gate = vi.fn(() => new Promise<boolean>(() => {}))
    const inst = instanceOf({ beforeDispose: gate })
    const app = renderApp('app1', inst)
    const { container, preview } = makePreview(makeRegistry(app))
    await preview.open(A)
    const p = preview.open(B)
    await vi.advanceTimersByTimeAsync(2999)
    expect(vi.mocked(inst.dispose)).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await p
    expect(vi.mocked(inst.dispose)).toHaveBeenCalledTimes(1)
    expect(preview.current()).toBe(B)
    expect(container.querySelector('.mmf-preview-stage')?.textContent).toBe('b.txt')
  })

  it('close：gate 放行 → 返回 true、dispose、容器清空、current=null', async () => {
    const inst = instanceOf()
    const app = renderApp('app1', inst)
    const { container, preview } = makePreview(makeRegistry(app))
    await preview.open(A)
    await expect(preview.close()).resolves.toBe(true)
    expect(vi.mocked(inst.dispose)).toHaveBeenCalledTimes(1)
    expect(container.innerHTML).toBe('')
    expect(preview.current()).toBeNull()
  })

  it('close：beforeDispose=false → 返回 false（被暂缓），状态完整保留', async () => {
    const inst = instanceOf({ beforeDispose: () => false })
    const app = renderApp('app1', inst)
    const { container, preview } = makePreview(makeRegistry(app))
    await preview.open(A)
    await expect(preview.close()).resolves.toBe(false)
    expect(vi.mocked(inst.dispose)).not.toHaveBeenCalled()
    expect(container.querySelector('.mmf-preview-stage')?.textContent).toBe('a.txt')
    expect(preview.current()).toBe(A)
  })

  it('clear：强制语义——beforeDispose=false 仍销毁并清空（unmount 用，不询问）', async () => {
    const gate = vi.fn(() => false)
    const inst = instanceOf({ beforeDispose: gate })
    const app = renderApp('app1', inst)
    const { container, preview } = makePreview(makeRegistry(app))
    await preview.open(A)
    preview.clear()
    expect(gate).not.toHaveBeenCalled()
    expect(vi.mocked(inst.dispose)).toHaveBeenCalledTimes(1)
    expect(container.innerHTML).toBe('')
    expect(preview.current()).toBeNull()
  })

  it('expire：通知式——beforeDispose 收到 \'expired\'，立即 dispose 清容器，不等其结算', async () => {
    const gate = vi.fn(() => new Promise<boolean>(() => {})) // 永不结算也必须立即销毁
    const inst = instanceOf({ beforeDispose: gate })
    const app = renderApp('app1', inst)
    const { container, preview } = makePreview(makeRegistry(app))
    await preview.open(A)
    preview.expire()
    expect(gate).toHaveBeenCalledWith('expired')
    expect(vi.mocked(inst.dispose)).toHaveBeenCalledTimes(1)
    expect(container.innerHTML).toBe('')
    expect(preview.current()).toBeNull()
  })

  it('无实例时 close/expire 安全（no-op，close 仍返回 true）', async () => {
    const { preview } = makePreview(makeRegistry())
    expect(preview.expire()).toBeUndefined()
    await expect(preview.close()).resolves.toBe(true)
    expect(preview.current()).toBeNull()
  })
})

describe('savedState（dispose 前采集，切回=重跑+状态恢复）', () => {
  it('dispose 前 getState 采集；重开时 renderer 第 4 参回注采集值', async () => {
    const order: string[] = []
    const inst = instanceOf({
      getState: vi.fn(() => {
        order.push('getState')
        return { n: 1 }
      }),
      dispose: vi.fn(() => {
        order.push('dispose')
      }),
    })
    const app: AppDefinition = {
      id: 'app1',
      matcher: { ext: ['txt'] },
      renderer: vi.fn((el: HTMLElement, file: { key: string; name: string; size: number }) => {
        el.textContent = file.name
        return inst
      }),
    }
    const { preview } = makePreview(makeRegistry(app))
    await preview.open(A)
    expect(vi.mocked(app.renderer)).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      { key: A.key, name: A.name, size: A.size },
      expect.anything(),
      undefined,
    )
    await preview.open(B)
    await preview.open(A)
    // 采集时机：getState 先于 dispose（契约「dispose 前」）
    expect(order).toEqual(['getState', 'dispose', 'getState', 'dispose'])
    expect(vi.mocked(app.renderer)).toHaveBeenLastCalledWith(
      expect.anything(),
      { key: A.key, name: A.name, size: A.size },
      expect.anything(),
      { n: 1 },
    )
  })

  it('未声明 getState → renderer 第 4 参恒 undefined（不抛错）', async () => {
    const app = renderApp('app1')
    const { preview } = makePreview(makeRegistry(app))
    await preview.open(A)
    await preview.open(B)
    await preview.open(A)
    expect(vi.mocked(app.renderer)).toHaveBeenCalledTimes(3)
    expect(vi.mocked(app.renderer)).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), expect.anything(), undefined)
  })

  it('容量上限 32：超出淘汰最旧（最旧回注 undefined、新鲜仍回注）', async () => {
    const restoredByKey = new Map<string, unknown>()
    const renderer = vi.fn(
      (_el: HTMLElement, file: { key: string; name: string; size: number }, _ctx: unknown, saved: unknown) => {
        restoredByKey.set(file.key, saved)
        return instanceOf({ getState: () => `s-${file.key}` })
      },
    )
    const app: AppDefinition = { id: 'app1', matcher: { ext: ['txt'] }, renderer }
    const { preview } = makePreview(makeRegistry(app))
    const mk = (k: string): S3ObjectSummary => ({ key: `d/${k}.txt`, name: `${k}.txt`, size: 1, isDir: false })
    // 34 次 open → 33 次 capture（k0..k32）→ 超限淘汰最旧 k0
    for (let i = 0; i < 34; i++) await preview.open(mk(`k${i}`))
    await preview.open(mk('k0'))
    expect(restoredByKey.get('d/k0.txt')).toBeUndefined()
    await preview.open(mk('k33'))
    expect(restoredByKey.get('d/k33.txt')).toBe('s-d/k33.txt')
  })
})

describe('错误边界（缺口 7：渲染失败/超时 10s）', () => {
  it('renderer 同步抛错 → 错误节点（标题+message+重试钮+下载钮），无 stage，current 已切换，不抛裸异常', async () => {
    const onDownload = vi.fn()
    const app: AppDefinition = {
      id: 'app1',
      matcher: { ext: ['txt'] },
      renderer: vi.fn(() => {
        throw new Error('boom')
      }),
    }
    const { container, preview } = makePreview(makeRegistry(app), { onDownload })
    await expect(preview.open(A)).resolves.toBeUndefined()
    const err = container.querySelector('.mmf-preview-error')
    expect(err).not.toBeNull()
    expect(err?.querySelector('.mmf-preview-error__title')?.textContent).toBe('files.preview-error-title')
    expect(err?.querySelector('.mmf-preview-error__message')?.textContent).toBe('boom')
    expect(container.querySelector('.mmf-preview-stage')).toBeNull()
    expect(preview.current()).toBe(A)
    const buttons = err?.querySelectorAll('button') ?? []
    expect(buttons[0]?.textContent).toBe('files.preview-error-retry')
    expect(buttons[1]?.textContent).toBe('files.preview-download')
    buttons[1]?.click()
    expect(onDownload).toHaveBeenCalledWith(A)
  })

  it('renderer 返回 rejected promise → 错误节点展示拒绝信息', async () => {
    const app: AppDefinition = {
      id: 'app1',
      matcher: { ext: ['txt'] },
      renderer: vi.fn(() => Promise.reject(new Error('async boom'))),
    }
    const { container, preview } = makePreview(makeRegistry(app))
    await preview.open(A)
    expect(container.querySelector('.mmf-preview-error__message')?.textContent).toBe('async boom')
  })

  it('10s 超时 → 错误节点；迟到结算的实例被 dispose 且容器不被成功内容覆盖', async () => {
    vi.useFakeTimers()
    // 容器对象：闭包内赋值，属性窄化在函数调用后自动重置（避免 let 变量的 CFA 误窄化）
    const late = { settle: (_v: AppInstance) => {} }
    const app: AppDefinition = {
      id: 'app1',
      matcher: { ext: ['txt'] },
      renderer: vi.fn(
        () =>
          new Promise<AppInstance>((resolve) => {
            late.settle = resolve
          }),
      ),
    }
    const { container, preview } = makePreview(makeRegistry(app))
    const p = preview.open(A)
    await vi.advanceTimersByTimeAsync(9999)
    expect(container.querySelector('.mmf-preview-error')).toBeNull() // 9.999s 仍等待
    await vi.advanceTimersByTimeAsync(1)
    await p
    expect(container.querySelector('.mmf-preview-error')).not.toBeNull()
    expect(container.querySelector('.mmf-preview-stage')).toBeNull()
    const lateInst = instanceOf()
    late.settle(lateInst) // 迟到结算
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.mocked(lateInst.dispose)).toHaveBeenCalledTimes(1) // 结果被销毁
    expect(container.querySelector('.mmf-preview-error')).not.toBeNull() // 容器不被覆盖
  })

  it('重试钮重跑同一 open：先败后成 → stage 渲染、错误节点清除', async () => {
    let calls = 0
    const app: AppDefinition = {
      id: 'app1',
      matcher: { ext: ['txt'] },
      renderer: vi.fn((el: HTMLElement) => {
        calls++
        if (calls === 1) throw new Error('first-fail')
        el.textContent = 'ok'
      }),
    }
    const { container, preview } = makePreview(makeRegistry(app))
    await preview.open(A)
    expect(container.querySelector('.mmf-preview-error')).not.toBeNull()
    const retry = container.querySelector<HTMLButtonElement>('.mmf-preview-error button')
    expect(retry?.textContent).toBe('files.preview-error-retry')
    retry?.click()
    await flush()
    expect(container.querySelector('.mmf-preview-stage')?.textContent).toBe('ok')
    expect(container.querySelector('.mmf-preview-error')).toBeNull()
  })

  it('下载门 canDownload:false：错误节点与 fallback 均不出下载钮（缺省 true 不受影响）', async () => {
    const onDownload = vi.fn()
    const app: AppDefinition = {
      id: 'app1',
      matcher: { ext: ['txt'] },
      renderer: vi.fn(() => {
        throw new Error('boom')
      }),
    }
    const { container, preview } = makePreview(makeRegistry(app), { onDownload, canDownload: false })
    await preview.open(A)
    expect(container.querySelectorAll('.mmf-preview-error button')).toHaveLength(1) // 仅重试钮
    // fallback 同门
    const other: S3ObjectSummary = { key: 'd/x.unknown', name: 'x.unknown', size: 1, isDir: false }
    await preview.open(other)
    expect(container.querySelector('.mmf-preview-fallback')).not.toBeNull()
    expect(container.querySelector('.mmf-preview-fallback button')).toBeNull()
  })
})

describe('指定应用 open(entry, { appId })', () => {
  it('指定存在的应用：绕过注册序默认应用与 matcher 直接用它渲染', async () => {
    const def1 = renderApp('app1') // 注册序第一=默认命中 .txt
    const def2: AppDefinition = {
      id: 'app2',
      matcher: { ext: ['md'] }, // matcher 不含 txt——指定 appId 时仍放行（「打开方式」语义）
      renderer: vi.fn((el: HTMLElement) => {
        el.textContent = 'by-id'
      }),
    }
    const { container, preview } = makePreview(makeRegistry(def1, def2))
    await preview.open(A, { appId: 'app2' })
    expect(container.querySelector('.mmf-preview-stage')?.textContent).toBe('by-id')
    expect(vi.mocked(def1.renderer)).not.toHaveBeenCalled()
  })

  it('指定不存在的应用：错误节点带原因信息（registry.require 的 not-found 语义），不抛裸异常', async () => {
    const def1 = renderApp('app1')
    const { container, preview } = makePreview(makeRegistry(def1))
    await expect(preview.open(A, { appId: 'nope' })).resolves.toBeUndefined()
    const err = container.querySelector('.mmf-preview-error')
    expect(err).not.toBeNull()
    expect(err?.querySelector('.mmf-preview-error__title')?.textContent).toBe('files.preview-error-title')
    expect(err?.querySelector('.mmf-preview-error__message')?.textContent).toContain('nope')
    expect(preview.current()).toBe(A)
  })
})

describe('状态一致性（无半更新）', () => {
  it('并发 open：gate 挂起期间被新链接管 → 仅最新链生效，容器/current/实例无半更新', async () => {
    let release!: (v: boolean) => void
    const gateP = new Promise<boolean>((resolve) => {
      release = resolve
    })
    const gate = vi.fn(() => gateP)
    const inst = instanceOf({ beforeDispose: gate })
    const app1 = renderApp('app1', inst)
    const app2: AppDefinition = {
      id: 'app2',
      matcher: { ext: ['md'] },
      renderer: vi.fn((el: HTMLElement) => {
        el.textContent = 'b.txt'
      }),
    }
    const { container, preview } = makePreview(makeRegistry(app1, app2))
    await preview.open(A) // 先挂载实例（app1 默认命中）
    const p1 = preview.open(A) // 再切换：gate 挂起（beforeDispose 返回共享 pending promise）
    const p2 = preview.open(B, { appId: 'app2' }) // 后发链
    release(true)
    await Promise.all([p1, p2])
    // 先发链整体让位：app1 只渲染过初次挂载这一次，旧实例只被后发链销毁一次
    expect(vi.mocked(app1.renderer)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(app2.renderer)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(inst.dispose)).toHaveBeenCalledTimes(1)
    expect(container.querySelectorAll('.mmf-preview-stage')).toHaveLength(1)
    expect(container.querySelector('.mmf-preview-stage')?.textContent).toBe('b.txt')
    expect(preview.current()).toBe(B)
  })
})
