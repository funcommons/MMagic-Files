/**
 * StatusBar 测试（Lane G3：状态栏 + 只读降级双轨）。
 * - 位置段：bucket[/prefix]（prefix 空→仅 bucket；父层响应式推 prefix → setProps 跟随）
 * - 传输段：0 隐藏；>0 显示计数；点击 emit transfers-click
 * - 只读徽章：readonly=true 显示（警示色形态，非报错）+ el-tooltip content=statusbar.readonly-hint；false 双双隐藏
 * - 会话段：session null / remainingMs=Infinity 隐藏；1s 心跳驱动倒计时文本变化（fake timers 走 2s——
 *   formatRemaining 纯函数已单独测过，这里测「心跳→重算」接线）；父层推新值锚点重置；负值钳 0；点击 emit session-click
 * 测试环境 i18n 为空词典（setup.ts），t 回退返回 key 本身，断言即用 key。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { ElTooltip } from 'element-plus'
import StatusBar from '../ui/StatusBar.vue'

/** fake timers 下推进时钟并刷 Vue 渲染（interval 回调同步触发 → nextTick 刷 DOM） */
async function advance(ms: number): Promise<void> {
  vi.advanceTimersByTime(ms)
  await nextTick()
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

function mountBar(props: {
  bucket?: string
  prefix?: string
  transfers?: number
  readonly?: boolean
  session?: { remainingMs: number } | null
}) {
  return mount(StatusBar, {
    props: {
      bucket: props.bucket ?? 'media',
      prefix: props.prefix ?? '',
      transfers: props.transfers ?? 0,
      readonly: props.readonly ?? false,
      session: props.session ?? null,
    },
  })
}

describe('StatusBar', () => {
  it('根节点常驻（data-testid=statusbar）；位置段显示 bucket，prefix 空不拼接', () => {
    const w = mountBar({ bucket: 'media', prefix: '' })
    expect(w.find('[data-testid="statusbar"]').exists()).toBe(true)
    expect(w.text()).toContain('statusbar.bucket')
    expect(w.text()).toContain('media')
    expect(w.text()).not.toContain('/')
    w.unmount()
  })

  it('位置段：prefix 非空拼接为 bucket/prefix，且随父层响应式推新而更新', async () => {
    const w = mountBar({ bucket: 'media', prefix: 'docs/' })
    expect(w.text()).toContain('media/docs')
    await w.setProps({ prefix: 'media-2026/raw' })
    expect(w.text()).toContain('media/media-2026/raw')
    w.unmount()
  })

  it('传输段：0 隐藏；>0 显示标签+计数；点击 emit transfers-click', async () => {
    const w = mountBar({ transfers: 0 })
    expect(w.find('[data-testid="statusbar-transfers"]').exists()).toBe(false)
    await w.setProps({ transfers: 3 })
    const seg = w.find('[data-testid="statusbar-transfers"]')
    expect(seg.exists()).toBe(true)
    expect(seg.text()).toContain('statusbar.transfers')
    expect(seg.text()).toContain('3')
    await seg.trigger('click')
    expect(w.emitted('transfers-click')).toHaveLength(1)
    w.unmount()
  })

  it('只读徽章：readonly=false 徽章与 tooltip 均不渲染', () => {
    const w = mountBar({ readonly: false })
    expect(w.find('[data-testid="statusbar-readonly"]').exists()).toBe(false)
    expect(w.findComponent(ElTooltip).exists()).toBe(false)
    w.unmount()
  })

  it('只读徽章：readonly=true 渲染警示徽章 + tooltip 内容为 statusbar.readonly-hint', async () => {
    const w0 = mountBar({ readonly: false })
    w0.unmount()
    const w = mountBar({ readonly: true })
    const badge = w.find('[data-testid="statusbar-readonly"]')
    expect(badge.exists()).toBe(true)
    expect(badge.classes()).toContain('stbar__readonly') // 警示色形态（非报错样式类）
    expect(badge.text()).toContain('statusbar.readonly')
    const tip = w.findComponent(ElTooltip)
    expect(tip.exists()).toBe(true)
    expect(tip.props('content')).toBe('statusbar.readonly-hint')
    await badge.trigger('click')
    expect(w.emitted('transfers-click')).toBeUndefined() // 只读徽章非动作入口
    w.unmount()
  })

  it('会话段：session=null 与 remainingMs=Infinity 均隐藏', () => {
    const w0 = mountBar({ session: null })
    expect(w0.find('[data-testid="statusbar-session"]').exists()).toBe(false)
    w0.unmount()
    const w = mountBar({ session: { remainingMs: Number.POSITIVE_INFINITY } })
    expect(w.find('[data-testid="statusbar-session"]').exists()).toBe(false)
    w.unmount()
  })

  it('会话倒计时：1s 心跳驱动文本变化（90s→走 2s→1:28）；父层推新值锚点重置；负值钳 0；点击 emit session-click', async () => {
    const w = mountBar({ session: { remainingMs: 90_000 } })
    const text = () => w.find('[data-testid="statusbar-session"]').text()
    expect(w.find('[data-testid="statusbar-session"]').exists()).toBe(true)
    expect(text()).toContain('statusbar.session')
    expect(text()).toContain('1:30')
    await advance(2000)
    expect(text()).toContain('1:28') // 心跳接线生效（formatRemaining 本体已另测）
    await w.setProps({ session: { remainingMs: 300_000 } }) // 父层推新 → 锚点重置
    expect(text()).toContain('5 min')
    await w.setProps({ session: { remainingMs: -1 } }) // 过期后父层迟到推送 → 钳 0
    expect(text()).toContain('0:00')
    await w.find('[data-testid="statusbar-session"]').trigger('click')
    expect(w.emitted('session-click')).toHaveLength(1)
    w.unmount()
  })
})
