<script setup lang="ts">
/* eslint-disable local/prefer-fc-button */
/**
 * ── scaffold 存量，未接线；勿在此新增功能 ──
 * R2-01 已确证：router/ 与 App.vue 均未挂载本组件（工作台走 Home 单页，不经路由/布局壳）。
 * R2-09：文件内 5 处裸 <button> 的 local/prefer-fc-button 警告按文件级豁免处理，
 * 不做 FcButton 迁移——避免向死代码继续投入；接线（若日后启用）时再整体换 FcButton。
 */
defineOptions({ name: 'AppLayout' })
// AppLayout.vue — host 业务侧. 无顶部 header, 内容去 header 化:
//   • 品牌 → sidebar 的 header slot
//   • 用户菜单/通知/关于 → sidebar 的 footer slot
//   • 侧栏折叠 → 走 FcSidebar 自带按钮
//   • 移动端 drawer 触发 → 主区左上浮动按钮
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { usePreferenceStore } from '@/store/preference'
import { useOemStore } from '@/store/oem'
import { useResponsive, watchViewport, useSidebarNavItems, NAV_DEFAULT_OPENEDS, useKeyboardShortcut, openCommandPalette } from '@/composables'
import i18n from '@/locales'
import Avatar from '@/components/sdk/display/FcAvatar.vue'
import FcSidebar from '@/components/sdk/layout/FcSidebar.vue'
import FcSidebarNav from '@/components/sdk/layout/FcSidebarNav.vue'
import FcMain from '@/components/sdk/layout/FcMain.vue'
import FcDrawer from '@/components/sdk/overlay/FcDrawer.vue'
import FcDialog from '@/components/sdk/overlay/FcDialog.vue'
import FcSwitch from '@/components/sdk/form/FcSwitch.vue'
import { showSuccess } from '@/utils'

const preference = usePreferenceStore()
const oem = useOemStore()
// 显示用应用名: OEM.title 优先 (常见场景), 没填则退到 companyName, 最后兜底 i18n.
const oemCompanyName = computed(() => oem.config.title || oem.config.companyName || t('app.name'))
const oemLogo = computed(() => oem.config.logoUrl || '')
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { isMobile } = useResponsive()

const appVersion = __APP_VERSION__
const formattedBuildTime = computed(() => {
  try {
    return new Date(__BUILD_TIME__).toLocaleString()
  } catch {
    return __BUILD_TIME__
  }
})
const isEnglish = computed<boolean>({
  get: () => preference.locale === 'en-US',
  set: (v: boolean) => {
    const next = v ? 'en-US' : 'zh-CN'
    preference.setLocale(next)
    i18n.global.locale.value = next
  },
})
const aboutVisible = ref(false)

function handleMenuCommand(command: string) {
  switch (command) {
    case 'messages':
      showSuccess(t('common.no-new-messages'))
      break
    case 'docs':
      showSuccess(t('common.docs-coming-soon'))
      break
    case 'about':
      aboutVisible.value = true
      break
  }
}

const navItems = useSidebarNavItems()

// ---- Mobile drawer ----
const mobileDrawerOpen = ref(false)
const sidebarDrawerVisible = computed({
  get: () => isMobile.value && mobileDrawerOpen.value,
  set: (v: boolean) => {
    if (isMobile.value) mobileDrawerOpen.value = v
  },
})

// ---- Sidebar width v-model ----
const sidebarWidth = computed({
  get: () => preference.sidebarWidth,
  set: (v: number) => preference.setSidebarWidth(v),
})
const sidebarCollapsed = computed({
  get: () => preference.sidebarCollapsed,
  set: (v: boolean) => preference.setSidebarCollapsed(v),
})

function onSelectSidebar(path: string) {
  if (route.path === path) return
  router.push(path)
}

onMounted(() => {
  // 基建阶段无用户体系; 业务接入时在此恢复登录态
})

watch(
  () => route.fullPath,
  () => {
    if (isMobile.value) mobileDrawerOpen.value = false
  }
)

watchViewport(() => {
  if (!isMobile.value) mobileDrawerOpen.value = false
})

// 全局快捷键: Cmd/Ctrl+K → 命令面板 (#9)
useKeyboardShortcut('mod+k', () => openCommandPalette())
</script>

<template>
  <div class="app-shell">
    <!-- 关于对话框 -->
    <FcDialog
      v-model:open="aboutVisible"
      :title="t('common.about-title')"
      width="360px"
      append-to-body
      dialog-class="about-dialog"
    >
      <div class="about-body">
        <div class="about-app-name">{{ oemCompanyName }}</div>
        <div class="about-row">
          <span class="about-label">{{ t('common.about-version') }}</span>
          <span class="about-value">{{ appVersion }}</span>
        </div>
        <div class="about-row">
          <span class="about-label">{{ t('common.about-build-time') }}</span>
          <span class="about-value">{{ formattedBuildTime }}</span>
        </div>
        <div v-if="oem.config.footerText" class="about-row">
          <span class="about-label">{{ t('common.about-footer') }}</span>
          <span class="about-value">{{ oem.config.footerText }}</span>
        </div>
      </div>
    </FcDialog>

    <div class="app-body">
      <!-- Desktop sidebar -->
      <FcSidebar
        v-if="!isMobile"
        v-model:collapsed="sidebarCollapsed"
        :width="sidebarWidth"
        @update:width="(v: number) => (sidebarWidth = v)"
        @select="onSelectSidebar"
      >
        <template #header>
          <div
            class="app-logo"
            role="button"
            tabindex="0"
            :aria-label="oemCompanyName"
            @click="router.push('/')"
            @keydown.enter="router.push('/')"
            @keydown.space.prevent="router.push('/')"
          >
            <img v-if="oemLogo" class="app-logo__icon" :src="oemLogo" alt="Logo" />
            <div class="app-logo__text">
              <strong>{{ oemCompanyName }}</strong>
            </div>
          </div>
        </template>

        <FcSidebarNav
          :items="navItems"
          :active-path="route.path"
          :collapse="sidebarCollapsed"
          :default-openeds="sidebarCollapsed ? [] : NAV_DEFAULT_OPENEDS"
          @select="onSelectSidebar"
        />

        <template #footer>
          <div class="sidebar-footer" :class="{ 'is-collapsed': sidebarCollapsed }">
            <button
              v-if="!sidebarCollapsed"
              class="header-btn"
              :title="t('common.menu-messages')"
              @click="handleMenuCommand('messages')"
            >
              <i class="ri-notification-3-line" />
            </button>
            <el-dropdown
              trigger="click"
              placement="top-end"
              popper-class="user-menu-popper"
              @command="handleMenuCommand"
            >
              <button
                type="button"
                class="app-sidebar__user"
                tabindex="0"
                aria-haspopup="menu"
              >
                <Avatar :src="''" :name="oemCompanyName" size="small" />
                <span v-if="!sidebarCollapsed" class="app-sidebar__user-name">
                  {{ oemCompanyName }}
                </span>
              </button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item v-if="sidebarCollapsed" command="messages">
                    <i class="ri-notification-3-line" />
                    <span>{{ t('common.menu-messages') }}</span>
                  </el-dropdown-item>
                  <el-dropdown-item command="docs">
                    <i class="ri-book-open-line" />
                    <span>{{ t('common.menu-docs') }}</span>
                  </el-dropdown-item>
                  <el-dropdown-item class="user-menu__lang-item" @click.stop>
                    <i class="ri-translate-2" />
                    <span>{{ t('common.menu-language') }}</span>
                    <FcSwitch
                      v-model="isEnglish"
                      class="user-menu__lang-switch"
                      inline-prompt
                      :active-text="t('langSwitch.en')"
                      :inactive-text="t('langSwitch.zh')"
                      size="small"
                    />
                  </el-dropdown-item>
                  <el-dropdown-item command="about" divided>
                    <i class="ri-information-line" />
                    <span>{{ t('common.menu-about') }}</span>
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </template>
      </FcSidebar>

      <!-- Mobile drawer -->
      <FcDrawer
        v-else
        v-model:open="sidebarDrawerVisible"
        direction="ltr"
        :with-header="false"
        size="240px"
        drawer-class="fc-sidebar-drawer-modal"
      >
        <FcSidebar
          :force-collapsed="false"
          :collapsed="false"
          :width="sidebarWidth"
          :enable-drag="false"
          @update:collapsed="() => {}"
          @update:width="(v: number) => (sidebarWidth = v)"
          @select="onSelectSidebar"
        >
          <template #header>
            <div class="app-logo" @click="router.push('/')">
              <img v-if="oemLogo" class="app-logo__icon" :src="oemLogo" alt="Logo" />
              <div class="app-logo__text">
                <strong>{{ oemCompanyName }}</strong>
              </div>
            </div>
          </template>
          <FcSidebarNav
            :items="navItems"
            :active-path="route.path"
            :collapse="false"
            :default-openeds="NAV_DEFAULT_OPENEDS"
            @select="onSelectSidebar"
          />
          <template #footer>
            <div class="sidebar-footer">
              <button class="header-btn" :title="t('common.menu-messages')" @click="handleMenuCommand('messages')">
                <i class="ri-notification-3-line" />
              </button>
              <el-dropdown
                trigger="click"
                placement="top-end"
                popper-class="user-menu-popper"
                @command="handleMenuCommand"
              >
                <button type="button" class="app-sidebar__user" tabindex="0" aria-haspopup="menu">
                  <Avatar :src="''" :name="oemCompanyName" size="small" />
                  <span class="app-sidebar__user-name">{{ oemCompanyName }}</span>
                </button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="docs">
                      <i class="ri-book-open-line" />
                      <span>{{ t('common.menu-docs') }}</span>
                    </el-dropdown-item>
                    <el-dropdown-item class="user-menu__lang-item" @click.stop>
                      <i class="ri-translate-2" />
                      <span>{{ t('common.menu-language') }}</span>
                      <FcSwitch
                        v-model="isEnglish"
                        class="user-menu__lang-switch"
                        inline-prompt
                        :active-text="t('langSwitch.en')"
                        :inactive-text="t('langSwitch.zh')"
                        size="small"
                      />
                    </el-dropdown-item>
                    <el-dropdown-item command="about" divided>
                      <i class="ri-information-line" />
                      <span>{{ t('common.menu-about') }}</span>
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </template>
        </FcSidebar>
      </FcDrawer>

      <div class="app-main-wrap">
        <button
          v-if="isMobile"
          class="mobile-menu-trigger"
          :title="t('common.menu') || 'Menu'"
          @click="mobileDrawerOpen = true"
        >
          <i class="ri-menu-line" />
        </button>
        <FcMain />
      </div>
    </div>
  </div>
</template>

<style lang="scss">
@use '@/styles/mixins' as *;

.app-shell {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.app-body {
  display: grid;
  grid-template-columns: auto 1fr;
  flex: 1;
  min-height: 0;
  min-width: 0;
}

.app-body > .fc-sidebar {
  grid-column: 1;
}

.app-body > .app-main-wrap {
  grid-column: 2;
  min-width: 0;
  position: relative;
  display: flex;
}

.app-body > .app-main-wrap > main.fc-main {
  flex: 1;
  min-width: 0;
  width: 100%;
  padding: var(--app-main-padding-y) var(--app-main-padding-x);
}

@media (max-width: 768px) {
  .app-body {
    grid-template-columns: 1fr;
  }
  .app-body > .fc-sidebar {
    display: none;
  }
  .app-body > .app-main-wrap {
    grid-column: 1;
  }
}

/* Brand / Logo (现在在 sidebar header 里) */
.app-logo {
  display: flex;
  align-items: center;
  gap: var(--app-header-gap-logo, 10px);
  cursor: pointer;
  user-select: none;
  padding: 12px;
}

.app-logo__icon {
  width: 32px;
  height: 32px;
  border-radius: var(--app-radius-md, 8px);
  object-fit: contain;
}

.app-logo__text {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
  strong {
    font-size: 16px;
    font-weight: 700;
    color: var(--app-text);
  }
}

/* Sidebar footer (用户/通知区) */
.sidebar-footer {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px;
  border-top: 1px solid var(--app-header-border-color, var(--app-separator, #e5e5e5));

  &.is-collapsed {
    justify-content: center;
    padding: 8px 4px;
  }
}

.header-btn {
  background: none;
  border: none;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--app-radius-sm, 8px);
  color: var(--app-text-secondary);
  cursor: pointer;
  transition: all 0.15s;
  &:hover {
    background: var(--app-sidebar-item-hover-bg);
    color: var(--app-text);
  }
  i {
    font-size: 18px;
  }
}

.app-sidebar__user {
  @include reset-button;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  cursor: pointer;
  border-radius: var(--app-radius-md, 8px);
  transition: background 0.15s;
  flex: 1;
  min-width: 0;
  &:hover {
    background: var(--app-sidebar-item-hover-bg);
  }
}

.app-sidebar__user-name {
  font-size: 13px;
  color: var(--app-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-menu-popper .el-dropdown-menu__item {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 200px;
  padding: 8px 16px;
  i {
    font-size: 16px;
    color: var(--app-text-secondary);
  }
}

.user-menu__lang-item {
  cursor: default;
}

.user-menu__lang-switch {
  margin-left: auto;
}

.about-dialog .about-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px 0 8px;
}

.about-dialog .about-app-name {
  font-size: 18px;
  font-weight: 600;
  color: var(--app-text);
  margin-bottom: 12px;
}

.about-dialog .about-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px solid var(--app-header-border-color);
  font-size: 14px;
}

.about-dialog .about-row:last-child {
  border-bottom: none;
}

.about-dialog .about-label {
  color: var(--app-text-secondary);
}

.about-dialog .about-value {
  color: var(--app-text);
  font-variant-numeric: tabular-nums;
}

/* Mobile menu trigger (顶替原 header 的 hamburger) */
.mobile-menu-trigger {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 10;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: var(--app-radius-sm, 8px);
  background: var(--app-bg-card, #fff);
  color: var(--app-text);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  &:hover {
    background: var(--app-sidebar-item-hover-bg);
  }
  i {
    font-size: 20px;
  }
}

/* Mobile sidebar drawer */
.fc-sidebar-drawer-modal .el-drawer {
  background-color: var(--el-bg-color) !important;
}
.fc-sidebar-drawer-modal .el-drawer__body {
  padding: 0;
}
</style>