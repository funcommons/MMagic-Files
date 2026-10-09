/**
 * 工作台 UI 测试（Wave2-T2；Lane F5 交互面改版同步）。
 * - TreePanel：列表渲染、面包屑；交互模型（对齐手册「双击/回车打开」）：
 *   单击=仅选中（ctrl/cmd 切换、shift 范围）；双击文件/回车=emit open；目录双击=进入；
 *   右键菜单（openWithMenu 门控、open-with 多应用、动作派发、Esc 关闭）；拖拽上传 emit drop-files
 * - Toolbar：多选数组语义（下载批量启用/emit 数组、无选中禁用）、features 门控、上传入队、刷新
 * - workspace-ops：mkdir/rename/remove（单选/多选确认文案）/ingestFiles 拒收 toast（Toolbar 与右键菜单共用链）
 * - UploadPanel：任务渲染（名/进度/状态）、取消、清除、无任务不渲染
 * - SessionBanner：正常/预警/到期（保持既有覆盖）
 * controller/queue/session 以最小 fake 注入（组件 props 面向接口，不依赖 setup 单例）。
 */
import { describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { ElMessageBox } from 'element-plus'
import { AppRegistry } from '@/apps/registry'
import { toast } from '@/components/sdk'
import type { DirBucket, FileTreeController } from '../tree-store'
import type { S3ObjectSummary } from '@/sdk/types'
import type { SessionController } from '@/sdk/session'
import { createWorkspaceOps } from '../ui/workspace-ops'
import TreePanel from '../ui/TreePanel.vue'
import Toolbar from '../ui/Toolbar.vue'
import UploadPanel from '../ui/UploadPanel.vue'
import SessionBanner from '../ui/SessionBanner.vue'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 测试词典：t 返回 'key'（无参）或 'key:{"n":2}' 形态（有参），便于断言用的键与参数 */
const t = vi.fn((key: string, params?: Record<string, unknown>) =>
  params === undefined ? key : `${key}:${JSON.stringify(params)}`,
)

function fakeTree(opts: { bucket?: DirBucket; loading?: boolean } = {}): FileTreeController {
  const nodes = new Map<string, DirBucket>()
  if (opts.bucket) nodes.set('root/', opts.bucket)
  return reactive({
    currentPath: 'root/',
    loading: opts.loading ?? false,
    error: null,
    nodes,
    loadDir: vi.fn(async () => {}),
    mkdir: vi.fn(async (_p: string, name: string) => `root/${name}/`),
    rename: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  }) as unknown as FileTreeController
}

const dir = (key: string, name: string): S3ObjectSummary => ({ key, name, size: 0, isDir: true })
const file = (key: string, name: string, size = 12): S3ObjectSummary => ({ key, name, size, isDir: false })

function buttonByText(w: VueWrapper, text: string) {
  return w.findAll('button').find((b) => b.text().includes(text))
}

/** 目录+文件混合桶（a/ 目录、b.txt、c.txt、d.txt 四行） */
const mixedBucket = (): DirBucket => ({
  dirs: [dir('root/a/', 'a')],
  files: [file('root/a/b.txt', 'b.txt'), file('root/a/c.txt', 'c.txt'), file('root/a/d.txt', 'd.txt')],
  loaded: true,
})

describe('TreePanel', () => {
  it('渲染目录+文件行（名称/大小/类型），挂载即 loadDir 当前目录', () => {
    const tree = fakeTree({
      bucket: {
        dirs: [dir('root/a/', 'a')],
        files: [file('root/a/b.txt', 'b.txt', 2048)],
        loaded: true,
      },
    })
    const w = mount(TreePanel, { props: { controller: tree } })
    expect(tree.loadDir).toHaveBeenCalledWith('root/')
    expect(w.text()).toContain('a')
    expect(w.text()).toContain('b.txt')
    expect(w.text()).toContain('2.0 KB')
    w.unmount()
  })

  it('目录名点击深入 loadDir；行单击=仅选中（emit select 数组）', async () => {
    const tree = fakeTree({ bucket: mixedBucket() })
    const w = mount(TreePanel, { props: { controller: tree } })
    await w.find('[data-testid="dir-name"]').trigger('click')
    expect(tree.loadDir).toHaveBeenCalledWith('root/a/')
    await w.findAll('[data-testid="row"]')[1]!.trigger('click') // b.txt
    expect(w.emitted('select')?.[0]?.[0]).toEqual([expect.objectContaining({ key: 'root/a/b.txt', isDir: false })])
    w.unmount()
  })

  it('双击文件=emit open；双击目录=进入（不 emit open）', async () => {
    const tree = fakeTree({ bucket: mixedBucket() })
    const w = mount(TreePanel, { props: { controller: tree } })
    const rows = w.findAll('[data-testid="row"]')
    await rows[1]!.trigger('dblclick') // b.txt
    expect(w.emitted('open')?.[0]?.[0]).toMatchObject({ key: 'root/a/b.txt' })
    await rows[0]!.trigger('dblclick') // a/
    expect(tree.loadDir).toHaveBeenCalledWith('root/a/')
    expect(w.emitted('open')).toHaveLength(1) // 目录双击不 emit open
    w.unmount()
  })

  it('回车=打开首个选中文件；目录选中回车=进入', async () => {
    const tree = fakeTree({ bucket: mixedBucket() })
    const w = mount(TreePanel, {
      props: { controller: tree, selected: [file('root/a/b.txt', 'b.txt')] },
    })
    await w.find('[data-testid="tree-list"]').trigger('keydown', { key: 'Enter' })
    expect(w.emitted('open')?.[0]?.[0]).toMatchObject({ key: 'root/a/b.txt' })
    w.unmount()

    const tree2 = fakeTree({ bucket: mixedBucket() })
    const w2 = mount(TreePanel, { props: { controller: tree2, selected: [dir('root/a/', 'a')] } })
    await w2.find('[data-testid="tree-list"]').trigger('keydown', { key: 'Enter' })
    expect(w2.emitted('open')).toBeUndefined()
    expect(tree2.loadDir).toHaveBeenCalledWith('root/a/')
    w2.unmount()
  })

  it('多选：ctrl/cmd 点击切换；shift 点击取范围', async () => {
    const tree = fakeTree({ bucket: mixedBucket() })
    const w = mount(TreePanel, { props: { controller: tree } })
    const rows = w.findAll('[data-testid="row"]')
    const lastSelect = (): S3ObjectSummary[] => {
      const all = w.emitted('select') ?? []
      return all[all.length - 1]![0] as S3ObjectSummary[]
    }
    await rows[1]!.trigger('click') // 锚点 b.txt → [b]
    await w.setProps({ selected: lastSelect() }) // 父层回传（Home 同款单向流）
    await rows[2]!.trigger('click', { ctrlKey: true }) // +c → [b,c]
    expect(lastSelect()).toEqual([
      expect.objectContaining({ key: 'root/a/b.txt' }),
      expect.objectContaining({ key: 'root/a/c.txt' }),
    ])
    await w.setProps({ selected: lastSelect() })
    await rows[1]!.trigger('click', { metaKey: true }) // 切换 b → [c]（锚点随最近一次点击移至 idx1）
    expect(lastSelect()).toEqual([expect.objectContaining({ key: 'root/a/c.txt' })])
    await w.setProps({ selected: lastSelect() })
    await rows[3]!.trigger('click', { shiftKey: true }) // 锚点 idx1 → 范围 [b,c,d]
    expect(lastSelect()).toEqual([
      expect.objectContaining({ key: 'root/a/b.txt' }),
      expect.objectContaining({ key: 'root/a/c.txt' }),
      expect.objectContaining({ key: 'root/a/d.txt' }),
    ])
    w.unmount()
  })

  it('选中高亮：selected 数组内行带 is-selected', () => {
    const tree = fakeTree({ bucket: mixedBucket() })
    const w = mount(TreePanel, {
      props: { controller: tree, selected: [file('root/a/c.txt', 'c.txt')] },
    })
    const row = w.findAll('[data-testid="row"]')[2]!
    expect(row.classes()).toContain('is-selected')
    w.unmount()
  })

  it('拖拽：dragenter 高亮、dragleave 复原、drop emit drop-files 携 files+当前目录', async () => {
    const tree = fakeTree({ bucket: mixedBucket() })
    const w = mount(TreePanel, { props: { controller: tree } })
    const root = w.find('.tree-panel')
    const f = new File(['hi'], 'drop.txt')
    await root.trigger('dragenter')
    expect(root.classes()).toContain('is-dragover')
    await root.trigger('dragleave')
    expect(root.classes()).not.toContain('is-dragover')
    await root.trigger('drop', { dataTransfer: { files: [f] } })
    expect(w.emitted('drop-files')?.[0]?.[0]).toEqual({ files: [f], path: 'root/' })
    w.unmount()
  })

  it('右键菜单：行 contextmenu 打开菜单（打开/重命名/删除/新建目录），点删除 emit menu-action', async () => {
    const tree = fakeTree({ bucket: mixedBucket() })
    const w = mount(TreePanel, {
      props: { controller: tree },
      global: { stubs: { teleport: true } },
    })
    await w.findAll('[data-testid="row"]')[1]!.trigger('contextmenu', { clientX: 30, clientY: 40 })
    const menu = w.find('.fc-menu')
    expect(menu.exists()).toBe(true)
    expect(menu.text()).toContain('files.menu.open')
    expect(menu.text()).toContain('files.menu.rename')
    expect(menu.text()).toContain('files.menu.delete')
    expect(menu.text()).toContain('files.menu.mkdir')
    await menu.findAll('button').find((b) => b.text().includes('files.menu.delete'))!.trigger('click')
    expect(w.emitted('menu-action')?.[0]?.[0]).toEqual({ action: 'delete', entry: expect.objectContaining({ key: 'root/a/b.txt' }) })
    w.unmount()
  })

  it('右键菜单：listMatches>1 时列出全部命中应用，点击 emit open-with；单命中不出应用子列', async () => {
    const registry = new AppRegistry()
    registry.register({ id: 'csv-table', matcher: { ext: ['csv'] }, renderer: vi.fn() })
    registry.register({ id: 'code-editor', matcher: { ext: ['csv', 'txt'] }, renderer: vi.fn() })
    const tree = fakeTree({
      bucket: { dirs: [], files: [file('root/a/data.csv', 'data.csv'), file('root/a/b.txt', 'b.txt')], loaded: true },
    })
    const w = mount(TreePanel, {
      props: { controller: tree, registry },
      global: { stubs: { teleport: true } },
    })
    const rows = w.findAll('[data-testid="row"]')
    await rows[0]!.trigger('contextmenu') // data.csv：双命中
    let menu = w.find('.fc-menu')
    expect(menu.text()).toContain('app.csv-table')
    expect(menu.text()).toContain('app.code-editor')
    await menu.findAll('button').find((b) => b.text().includes('app.code-editor'))!.trigger('click')
    expect(w.emitted('open-with')?.[0]?.[0]).toEqual({
      entry: expect.objectContaining({ key: 'root/a/data.csv' }),
      appId: 'code-editor',
    })
    expect(w.find('.fc-menu').exists()).toBe(false) // 选中后自动关

    await rows[1]!.trigger('contextmenu') // b.txt：单命中不出「打开方式」应用子列
    menu = w.find('.fc-menu')
    expect(menu.text()).not.toContain('app.code-editor')
    w.unmount()
  })

  it('打开方式子列：def.label 优先（复审②：动态插件 manifest 自带名），无 label 回退 t(app.<id>)', async () => {
    const registry = new AppRegistry()
    registry.register({ id: 'builtin-a', matcher: { ext: ['xyz'] }, renderer: vi.fn() })
    registry.register({ id: 'plugin-b', label: 'My Plugin App', matcher: { ext: ['xyz'] }, renderer: vi.fn() })
    const tree = fakeTree({
      bucket: { dirs: [], files: [file('root/a/thing.xyz', 'thing.xyz')], loaded: true },
    })
    const w = mount(TreePanel, {
      props: { controller: tree, registry },
      global: { stubs: { teleport: true } },
    })
    await w.findAll('[data-testid="row"]')[0]!.trigger('contextmenu')
    const menu = w.find('.fc-menu')
    expect(menu.text()).toContain('My Plugin App') // manifest label 优先
    expect(menu.text()).toContain('app.builtin-a') // 无 label 回退词典键（测试 t 直返 key 原文）
    w.unmount()
  })

  it('右键菜单：Esc 关闭；features.openWithMenu=false 时不拦截默认菜单（不打开菜单）', async () => {
    const tree = fakeTree({ bucket: mixedBucket() })
    const w = mount(TreePanel, {
      props: { controller: tree },
      global: { stubs: { teleport: true } },
    })
    await w.findAll('[data-testid="row"]')[0]!.trigger('contextmenu')
    expect(w.find('.fc-menu').exists()).toBe(true)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await sleep(0)
    expect(w.find('.fc-menu').exists()).toBe(false)
    w.unmount()

    const off = mount(TreePanel, {
      props: { controller: fakeTree({ bucket: mixedBucket() }), features: { openWithMenu: false } },
      global: { stubs: { teleport: true } },
    })
    await off.findAll('[data-testid="row"]')[0]!.trigger('contextmenu')
    expect(off.find('.fc-menu').exists()).toBe(false)
    off.unmount()
  })

  it('未加载/加载中显示骨架；已加载空目录显示空态', () => {
    const loading = mount(TreePanel, { props: { controller: fakeTree({ loading: true }) } })
    expect(loading.find('.fc-skeleton').exists()).toBe(true)
    loading.unmount()

    const empty = mount(TreePanel, {
      props: { controller: fakeTree({ bucket: { dirs: [], files: [], loaded: true } }) },
    })
    expect(empty.find('.fc-empty').exists()).toBe(true)
    empty.unmount()
  })

  it('面包屑可回跳：根 crumb 点击 loadDir 根前缀', async () => {
    const tree = fakeTree({
      bucket: { dirs: [], files: [file('root/a/b.txt', 'b.txt')], loaded: true },
    })
    const w = mount(TreePanel, { props: { controller: tree, rootPrefix: '' } })
    // crumbs = [根, 'root/']；最后一个为当前态（非按钮），根 crumb 可点回跳
    const crumbs = w.findAll('[data-testid="crumb"]')
    expect(crumbs.length).toBe(1)
    await crumbs[0]!.trigger('click')
    expect(tree.loadDir).toHaveBeenCalledWith('')
    w.unmount()
  })
})

describe('Toolbar（多选语义）', () => {
  const fakeQueue = () => ({ enqueue: vi.fn(() => ({ accepted: [], rejected: [] })) })

  it('上传：隐藏 input change → queue.enqueue(files, 当前目录)', async () => {
    const queue = fakeQueue()
    const tree = fakeTree()
    const w = mount(Toolbar, { props: { controller: tree, queue } })
    const input = w.find('input[type="file"]')
    expect(input.exists()).toBe(true)
    const f = new File(['hi'], 'x.txt')
    Object.defineProperty(input.element, 'files', { value: [f] })
    await input.trigger('change')
    expect(queue.enqueue).toHaveBeenCalledWith([f], 'root/')
    w.unmount()
  })

  it('刷新：loadDir 当前目录 force', async () => {
    const tree = fakeTree()
    const w = mount(Toolbar, { props: { controller: tree, queue: fakeQueue() } })
    const refresh = buttonByText(w, 'refresh')
    expect(refresh).toBeTruthy()
    await refresh!.trigger('click')
    expect(tree.loadDir).toHaveBeenCalledWith('root/', { force: true })
    w.unmount()
  })

  it('无选中：删除/重命名/下载禁用；单文件选中：全部启用', () => {
    const common = { controller: fakeTree(), queue: fakeQueue() }
    const w0 = mount(Toolbar, { props: { ...common, selected: [] } })
    expect(buttonByText(w0, 'delete')!.attributes('disabled')).toBeDefined()
    expect(buttonByText(w0, 'rename')!.attributes('disabled')).toBeDefined()
    expect(buttonByText(w0, 'download')!.attributes('disabled')).toBeDefined()
    w0.unmount()

    const w1 = mount(Toolbar, { props: { ...common, selected: [file('root/a/b.txt', 'b.txt')] } })
    expect(buttonByText(w1, 'delete')!.attributes('disabled')).toBeUndefined()
    expect(buttonByText(w1, 'rename')!.attributes('disabled')).toBeUndefined()
    expect(buttonByText(w1, 'download')!.attributes('disabled')).toBeUndefined()
    w1.unmount()
  })

  it('目录选中：下载禁用；多文件选中：下载启用且点击 emit download 数组（批量打包语义）', async () => {
    const common = { controller: fakeTree(), queue: fakeQueue() }
    const wd = mount(Toolbar, { props: { ...common, selected: [dir('root/a/', 'a')] } })
    expect(buttonByText(wd, 'download')!.attributes('disabled')).toBeDefined()
    wd.unmount()

    const entries = [file('root/a/b.txt', 'b.txt'), file('root/a/c.txt', 'c.txt')]
    const wm = mount(Toolbar, { props: { ...common, selected: entries } })
    const dl = buttonByText(wm, 'download')!
    expect(dl.attributes('disabled')).toBeUndefined()
    await dl.trigger('click')
    expect(wm.emitted('download')?.[0]?.[0]).toEqual(entries)
    // 多文件（含目录混合）→ 下载禁用（打包仅收文件）
    const wmix = mount(Toolbar, { props: { ...common, selected: [dir('root/a/', 'a'), ...entries] } })
    expect(buttonByText(wmix, 'download')!.attributes('disabled')).toBeDefined()
    wmix.unmount()
    wm.unmount()
  })

  // F1 门控（UI 隐藏层）：features 显式 false → 对应操作入口不渲染；未列出的键与刷新不受影响
  it('features 显式 false → 对应按钮隐藏；缺省键与刷新不受门控', () => {
    const w = mount(Toolbar, {
      props: {
        controller: fakeTree(),
        queue: fakeQueue(),
        features: { upload: false, mkdir: false, rename: false, delete: false },
      },
    })
    expect(buttonByText(w, 'upload')).toBeUndefined()
    expect(buttonByText(w, 'mkdir')).toBeUndefined()
    expect(buttonByText(w, 'rename')).toBeUndefined()
    expect(buttonByText(w, 'delete')).toBeUndefined()
    expect(buttonByText(w, 'refresh')).toBeTruthy()
    w.unmount()

    const w2 = mount(Toolbar, {
      props: {
        controller: fakeTree(),
        queue: fakeQueue(),
        features: { delete: false },
      },
    })
    expect(buttonByText(w2, 'delete')).toBeUndefined()
    expect(buttonByText(w2, 'upload')).toBeTruthy()
    expect(buttonByText(w2, 'rename')).toBeTruthy()
    w2.unmount()
  })

  it('features.download=false → 下载按钮隐藏；其余按钮不受影响', () => {
    const w = mount(Toolbar, {
      props: {
        controller: fakeTree(),
        queue: fakeQueue(),
        features: { download: false },
      },
    })
    expect(buttonByText(w, 'download')).toBeUndefined()
    expect(buttonByText(w, 'upload')).toBeTruthy()
    expect(buttonByText(w, 'delete')).toBeTruthy()
    w.unmount()
  })
})

describe('workspace-ops（Toolbar 与右键菜单共用操作链）', () => {
  const setup = () => {
    // mockReset：清调用历史（spy 跨用例共享同一 mock）并移除上例的 resolved/rejected 值
    vi.spyOn(ElMessageBox, 'prompt').mockReset()
    vi.spyOn(toast, 'confirm').mockReset()
    vi.spyOn(toast, 'error').mockReset()
    vi.spyOn(toast, 'warning').mockReset()
  }

  it('createDir：prompt 成功 → mkdir 当前目录；cancel 静默返回 null', async () => {
    setup()
    const tree = fakeTree()
    const ops = createWorkspaceOps({ tree, t })
    vi.mocked(ElMessageBox.prompt).mockResolvedValue({ value: ' newdir ' } as never)
    expect(await ops.createDir()).toBe('root/newdir/')
    expect(tree.mkdir).toHaveBeenCalledWith('root/', 'newdir')

    vi.mocked(ElMessageBox.prompt).mockRejectedValue('cancel')
    expect(await ops.createDir()).toBeNull()
    expect(toast.error).not.toHaveBeenCalled()

    vi.mocked(ElMessageBox.prompt).mockRejectedValue(new Error('boom'))
    expect(await ops.createDir()).toBeNull()
    expect(toast.error).toHaveBeenCalledWith('boom')
  })

  it('renameEntry：成功返回 {from,to}（目录保尾 /）；取消返回 null', async () => {
    setup()
    const tree = fakeTree()
    const ops = createWorkspaceOps({ tree, t })
    vi.mocked(ElMessageBox.prompt).mockResolvedValue({ value: 'z.txt' } as never)
    expect(await ops.renameEntry(file('root/a/b.txt', 'b.txt'))).toEqual({ from: 'root/a/b.txt', to: 'root/a/z.txt' })
    expect(await ops.renameEntry(dir('root/a/', 'a'))).toEqual({ from: 'root/a/', to: 'root/z.txt/' })

    vi.mocked(ElMessageBox.prompt).mockRejectedValue('close')
    expect(await ops.renameEntry(file('root/a/b.txt', 'b.txt'))).toBeNull()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('removeEntries：单选用 delete-confirm(名称)、多选用 delete-multi-confirm({n})；取消/成功语义', async () => {
    setup()
    const tree = fakeTree()
    const ops = createWorkspaceOps({ tree, t })

    vi.mocked(toast.confirm).mockResolvedValue(undefined)
    expect(await ops.removeEntries([file('root/a/b.txt', 'b.txt')])).toEqual(['root/a/b.txt'])
    expect(toast.confirm).toHaveBeenCalledWith(expect.objectContaining({ message: 'files.msg.delete-confirm:{"name":"b.txt"}' }))
    expect(tree.remove).toHaveBeenCalledWith(['root/a/b.txt'])

    const multi = [file('root/a/b.txt', 'b.txt'), file('root/a/c.txt', 'c.txt'), dir('root/a/', 'a')]
    expect(await ops.removeEntries(multi)).toEqual(multi.map((e) => e.key))
    expect(toast.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ message: `files.msg.delete-multi-confirm:${JSON.stringify({ n: 3 })}` }),
    )
    expect(tree.remove).toHaveBeenCalledWith(['root/a/b.txt', 'root/a/c.txt', 'root/a/'])

    vi.mocked(toast.confirm).mockRejectedValue('cancel')
    expect(await ops.removeEntries(multi)).toBeNull()
    expect(tree.remove).toHaveBeenCalledTimes(2)
  })

  it('ingestFiles：enqueue 透传 + 拒收汇总 toast', () => {
    setup()
    const ops = createWorkspaceOps({ tree: fakeTree(), t })
    const enqueue = vi.fn(() => ({ accepted: [{ id: 'u1' }], rejected: [{ name: 'evil.exe', reason: 'ext' as const }] }))
    const f = new File(['x'], 'ok.txt')
    ops.ingestFiles(enqueue, [f], 'root/')
    expect(enqueue).toHaveBeenCalledWith([f], 'root/')
    expect(toast.warning).toHaveBeenCalledWith(`files.msg.upload-rejected:${JSON.stringify({ n: 1 })}`)

    const enqueueOk = vi.fn(() => ({ accepted: [{ id: 'u2' }], rejected: [] }))
    ops.ingestFiles(enqueueOk, [f], 'root/')
    expect(toast.warning).toHaveBeenCalledTimes(1)
  })
})

describe('UploadPanel', () => {
  const task = (over: Partial<{ id: string; name: string; loaded: number; total: number; status: 'uploading' | 'done' | 'failed' | 'cancelled' }> = {}) => ({
    id: 'u1',
    name: 'a.txt',
    loaded: 40,
    total: 100,
    status: 'uploading' as const,
    ...over,
  })

  it('无任务时不渲染', () => {
    const w = mount(UploadPanel, { props: { tasks: [] } })
    expect(w.find('[data-testid="upload-panel"]').exists()).toBe(false)
    w.unmount()
  })

  it('渲染任务（名/进度/状态）；取消钮仅上传中出现；点击 emit cancel(id)', async () => {
    const w = mount(UploadPanel, {
      props: {
        tasks: [
          task(),
          task({ id: 'u2', name: 'b.txt', loaded: 100, total: 100, status: 'done' }),
          task({ id: 'u3', name: 'c.txt', status: 'failed' }),
        ],
      },
    })
    expect(w.find('[data-testid="upload-panel"]').exists()).toBe(true)
    expect(w.text()).toContain('a.txt')
    expect(w.text()).toContain('40%')
    expect(w.text()).toContain('b.txt')
    expect(w.text()).toContain('c.txt')
    expect(w.findAll('[data-testid="upload-item"]').length).toBe(3)
    // 状态文案（测试 i18n 透传 key）
    expect(w.text()).toContain('files.upload.uploading')
    expect(w.text()).toContain('files.upload.done')
    expect(w.text()).toContain('files.upload.failed')
    // 取消钮：仅 uploading 项
    const cancels = w.findAll('[data-testid="upload-cancel"]')
    expect(cancels.length).toBe(1)
    await cancels[0]!.trigger('click')
    expect(w.emitted('cancel')?.[0]).toEqual(['u1'])
    w.unmount()
  })

  it('存在终态任务时显示清除钮；点击 emit clear', async () => {
    const w0 = mount(UploadPanel, { props: { tasks: [task()] } })
    expect(w0.find('[data-testid="upload-clear"]').exists()).toBe(false)
    w0.unmount()

    const w = mount(UploadPanel, { props: { tasks: [task({ status: 'cancelled' })] } })
    await w.find('[data-testid="upload-clear"]').trigger('click')
    expect(w.emitted('clear')).toHaveLength(1)
    w.unmount()
  })
})

describe('SessionBanner', () => {
  function fakeSession(state: { warned: boolean; expired: boolean }): SessionController {
    return {
      get warnedOnce() {
        return state.warned
      },
      isExpired: () => state.expired,
    } as unknown as SessionController
  }

  it('正常态不渲染横幅与整屏终态', async () => {
    const state = { warned: false, expired: false }
    const w = mount(SessionBanner, { props: { session: fakeSession(state), intervalMs: 5 } })
    await sleep(20)
    expect(w.find('.el-alert').exists()).toBe(false)
    expect(w.find('[data-testid="expired-mask"]').exists()).toBe(false)
    w.unmount()
  })

  it('轮询捕获 warned → 预警横幅；expired → 整屏终态（含重新加载按钮）', async () => {
    const state = { warned: false, expired: false }
    const w = mount(SessionBanner, { props: { session: fakeSession(state), intervalMs: 5 } })
    state.warned = true
    await sleep(20)
    expect(w.find('.el-alert').exists()).toBe(true)
    state.expired = true
    await sleep(20)
    expect(w.find('[data-testid="expired-mask"]').exists()).toBe(true)
    expect(buttonByText(w, 'reload')).toBeTruthy()
    w.unmount()
  })
})
