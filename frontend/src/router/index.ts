import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import i18n from '@/locales'
import { useEmbedParams } from '@/composables/useEmbedParams'
import { ElMessageBox } from 'element-plus'

const t = i18n.global.t

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'Home',
    component: () => import('@/views/Home.vue'),
    meta: { title: 'router.home' }
  },
  // 子路径挂载兜底（宿主 vendoring 形）: dist 以 --base=./ 构建挂宿主子路径（如 /mmfiles/）时,
  // 入口路径非 '/' —— 无此兜底路由不匹配 = 整页空白。catch-all 渲染 Home 且不重定向
  //（redirect 会改写地址栏到 /, 破坏相对资源解析）; hash 配置（#config/#file）与路径无关, 不受扰。
  { path: '/:pathMatch(.*)*', name: 'EmbedFallback', component: () => import('@/views/Home.vue') }
]

const router = createRouter({
  // 铁律: 项目统一使用 history 模式, 禁止 hash 模式
  history: createWebHistory(),
  routes
})

// 路由守卫
router.beforeEach((to) => {
  const title = to.meta.title as string
  if (title) {
    document.title = `${t(title)} - ${t('app.name')}`
  }

  // 嵌入模式: 解析外观参数 (brand/mode/language), 即时生效不持久化
  const embed = useEmbedParams()
  embed.applyFromRoute(to)

  return true
})

// 全局兜底: 任意路由变化都过一遍 dirty form registry (#2 表单未保存提示 — 路由级兜底)
router.beforeEach(async () => {
  const dirty = dirtyFormRegistry.findDirty()
  if (dirty) {
    try {
      await ElMessageBox.confirm(
        i18n.global.t('ux.dirty-form.message'),
        i18n.global.t('ux.dirty-form.title'),
        {
          confirmButtonText: i18n.global.t('ux.dirty-form.discard'),
          cancelButtonText: i18n.global.t('ux.dirty-form.cancel'),
          type: 'warning',
        },
      )
      dirty.discard()
      return true
    } catch {
      return false
    }
  }
  return true
})

/**
 * 脏表单全局注册表 (#2 表单未保存提示 — 路由级兜底).
 * useDirtyForm 自动 register/unregister, 此处提供 findDirty 给 router guard 用.
 */
export const dirtyFormRegistry = {
  _forms: new Set<{ isDirty: () => boolean; discard: () => void }>(),

  register(form: { isDirty: () => boolean; discard: () => void }) {
    this._forms.add(form)
  },

  unregister(form: { isDirty: () => boolean; discard: () => void }) {
    this._forms.delete(form)
  },

  findDirty() {
    for (const f of this._forms) {
      if (f.isDirty()) return f
    }
    return null
  },
}

export default router
