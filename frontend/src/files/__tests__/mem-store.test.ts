/** mem-store 单测：键域/更新/删除/opener hook（内存文件通路，用户口径「上传文件·内存中处理」） */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  MEM_PREFIX,
  isMemKey,
  memPut,
  memGet,
  memUpdate,
  memDelete,
  memClear,
  setMemFileOpener,
  notifyMemFileAdded,
} from '../mem-store'

beforeEach(() => memClear())

describe('memPut / memGet', () => {
  it('File 入库：key=mem://<seq> 递增、name/mime/size 透传', () => {
    const f = new File(['hello'], 'a.png', { type: 'image/png' })
    const e1 = memPut(f)
    const e2 = memPut(new File(['x'], 'b.txt', { type: 'text/plain' }))
    expect(e1.key).toBe(`${MEM_PREFIX}1`)
    expect(e2.key).toBe(`${MEM_PREFIX}2`)
    expect(e1.name).toBe('a.png')
    expect(e1.mime).toBe('image/png')
    expect(e1.size).toBe(5)
    expect(memGet(e1.key)?.blob).toBe(f)
  })

  it('Blob 无名入库：name 兜底 mem-<seq>、mime 兜底 octet-stream', () => {
    const e = memPut(new Blob([new Uint8Array([1, 2])]))
    expect(e.name).toMatch(/^mem-\d+$/)
    expect(e.mime).toBe('application/octet-stream')
  })

  it('isMemKey：仅 mem:// 前缀为真（S3 key 不误伤）', () => {
    expect(isMemKey('mem://3')).toBe(true)
    expect(isMemKey('dir/a.png')).toBe(false)
    expect(isMemKey('memory://x')).toBe(false)
  })
})

describe('memUpdate / memDelete', () => {
  it('更新：blob/size 替换、mime 缺省保留原值；未存在键抛错', () => {
    const e = memPut(new File(['aaa'], 'x.png', { type: 'image/png' }))
    const nb = new Blob(['bbbb'])
    const u = memUpdate(e.key, nb)
    expect(u.size).toBe(4)
    expect(u.mime).toBe('image/png')
    expect(memGet(e.key)?.size).toBe(4)
    expect(() => memUpdate('mem://999', nb)).toThrow('mem key not found')
  })

  it('删除：memGet 返回 undefined', () => {
    const e = memPut(new File(['z'], 'z.txt'))
    memDelete(e.key)
    expect(memGet(e.key)).toBeUndefined()
  })
})

describe('opener hook', () => {
  it('notifyMemFileAdded：回调收到 entry；opener 抛错不外泄（上传链不阻断）', () => {
    const cb = vi.fn()
    setMemFileOpener(cb)
    const e = memPut(new File(['q'], 'q.png'))
    notifyMemFileAdded(e)
    expect(cb).toHaveBeenCalledWith(e, undefined)
    setMemFileOpener(() => {
      throw new Error('boom')
    })
    expect(() => notifyMemFileAdded(e)).not.toThrow()
    setMemFileOpener(null)
  })

  it('opener 未注册：通知暂存（文件仍在 store），注册时按序 flush（含 hint）', () => {
    // 时序背景：ready 早于 app.mount——uploadFiles 通知可在 Home.vue 挂载前到达，暂存防「上传 ✓ 但静默不打开」
    setMemFileOpener(null)
    const e1 = memPut(new File(['w'], 'w.png'))
    const e2 = memPut(new File(['v'], 'v.md'))
    notifyMemFileAdded(e1)
    notifyMemFileAdded(e2, { appId: 'markdown-editor' })
    expect(memGet(e1.key)).toBeDefined()
    expect(memGet(e2.key)).toBeDefined()

    const cb = vi.fn()
    setMemFileOpener(cb)
    expect(cb).toHaveBeenCalledTimes(2)
    expect(cb).toHaveBeenNthCalledWith(1, e1, undefined)
    expect(cb).toHaveBeenNthCalledWith(2, e2, { appId: 'markdown-editor' })
    setMemFileOpener(null)
  })

  it('flush 单条抛错不阻断其余；注册后新通知直通不再暂存', () => {
    setMemFileOpener(null)
    const e1 = memPut(new File(['1'], 'a.png'))
    const e2 = memPut(new File(['2'], 'b.png'))
    const e3 = memPut(new File(['3'], 'c.png'))
    notifyMemFileAdded(e1)
    notifyMemFileAdded(e2)

    const calls: string[] = []
    setMemFileOpener((entry) => {
      calls.push(entry.name)
      if (calls.length === 1) throw new Error('first boom') // flush 首条抛错
    })
    // e1 抛错被吞、e2 仍补打开；e3 注册后直通
    notifyMemFileAdded(e3)
    expect(calls).toEqual(['a.png', 'b.png', 'c.png'])
    setMemFileOpener(null)
  })
})
