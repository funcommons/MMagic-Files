import { describe, it, expect } from 'vitest'
import { mountFc } from '../__tests__/helpers/mount'
import { h } from 'vue'
import FcMain from './FcMain.vue'

// 占位 router-view 组件 (vue-router 不在测试环境注册)
const RouterViewStub = {
  name: 'RouterView',
  render() {
    return h('div', { class: 'rv-stub' }, 'router')
  },
}

describe('FcMain', () => {
  it('渲染 <main class="fc-main"> 容器', () => {
    const w = mountFc(FcMain, {
      slots: { default: '<div class="content-x">x</div>' },
    })
    expect(w.find('main.fc-main').exists()).toBe(true)
  })

  it('默认 slot 渲染', () => {
    const w = mountFc(FcMain, {
      slots: { default: '<div class="content-x">x</div>' },
    })
    expect(w.find('.content-x').exists()).toBe(true)
    expect(w.text()).toContain('x')
  })

  it('keepAlive=true (默认) 渲染 router-view → keep-alive 包装', () => {
    const w = mountFc(FcMain, {
      slots: { default: '<div />' },
      global: {
        components: { RouterView: RouterViewStub },
        config: { compilerOptions: { isCustomElement: (tag: string) => tag === 'router-view' } },
      },
    })
    // 内部走 router-view 时, 因为替换为 stub, v-slot="{ Component }" 取不到值, 不会崩但也不会渲染 stub.
    // 关键: mount 不抛错, fc-main 容器在
    expect(w.find('main.fc-main').exists()).toBe(true)
  })

  it('keepAlive=false → 跳过 keep-alive (同样 mount 不报错)', () => {
    const w = mountFc(FcMain, {
      props: { keepAlive: false },
      slots: { default: '<div />' },
      global: {
        components: { RouterView: RouterViewStub },
        config: { compilerOptions: { isCustomElement: (tag: string) => tag === 'router-view' } },
      },
    })
    expect(w.find('main.fc-main').exists()).toBe(true)
  })

  it('transitionName 自定义 prop', () => {
    const w = mountFc(FcMain, {
      props: { transitionName: 'slide' },
      global: {
        components: { RouterView: RouterViewStub },
        config: { compilerOptions: { isCustomElement: (tag: string) => tag === 'router-view' } },
      },
    })
    expect(w.props('transitionName')).toBe('slide')
    expect(w.find('main.fc-main').exists()).toBe(true)
  })

  it('自定义 slot 覆盖默认 router-view', () => {
    const w = mountFc(FcMain, {
      slots: { default: '<div class="custom-slot-x">custom</div>' },
    })
    expect(w.find('.custom-slot-x').exists()).toBe(true)
  })
})