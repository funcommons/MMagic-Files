import { describe, it, expect } from 'vitest'
import { mountFc } from '../__tests__/helpers/mount'
import FcFilterBar from './FcFilterBar.vue'

describe('FcFilterBar', () => {
  it('默认渲染 fc-filter-bar + 默认 slot', () => {
    const w = mountFc(FcFilterBar, { slots: { default: '<button class="x">x</button>' } })
    expect(w.find('.fc-filter-bar').exists()).toBe(true)
    expect(w.find('.fc-filter-bar.is-block').exists()).toBe(false)
    expect(w.find('button.x').exists()).toBe(true)
  })

  it('block=true → 加 is-block', () => {
    const w = mountFc(FcFilterBar, { props: { block: true } })
    expect(w.find('.fc-filter-bar.is-block').exists()).toBe(true)
  })

  it('多个子节点全部渲染', () => {
    const w = mountFc(FcFilterBar, {
      slots: { default: '<button>a</button><button>b</button><span>c</span>' },
    })
    expect(w.findAll('button').length).toBe(2)
    expect(w.findAll('span').length).toBe(1)
  })
})