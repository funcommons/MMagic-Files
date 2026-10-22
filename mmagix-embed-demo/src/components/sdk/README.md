# Fc SDK 组件库

Vue 3 + Element Plus + 多品牌多主题的统一组件层。

**SDK 用户目标**：用组件拼页面，**不写或少写 CSS**，主题/品牌切换开箱即用。

---

## 5 分钟接入（SDK 用户）

### 第 1 步：引入全局样式

在 `main.ts` 顶部加一行（包含 EP 覆写 + 8 个 brand 样式 + light/dark 主题）：

```ts
import '@/components/sdk/theme/theme.scss'
```

⚠️ **不要**再单独引入 Element Plus 主题覆写 SCSS（已在 `theme.scss` 内置）；EP 原生 CSS 仍需引入：`import 'element-plus/dist/index.css'`。

⚠️ **必须走 `theme.scss` 这一个入口，不要拆开 cherry-pick 子文件**（如只引 `brands` / `element-classes`）。
`theme.scss` 是 SDK 全局样式的唯一注册点 — 后续新增的全局 class 文件（如 `_button-classes.scss`）
只会挂到 `theme.scss`。宿主项目如果绕过它自己拼 import 链，新增样式会静默缺失，页面"样式没生效"但没有任何报错。
真实案例：本仓库 `src/styles/index.scss` 曾直引 `element-classes`，导致 `_button-classes.scss`
只注册到 `theme.scss` 后 app 端完全没加载（2026-07 踩坑记录）。如果宿主确实需要自有样式入口，
每次 SDK 升级后对比一遍 `theme.scss` 的 `@use` 清单，确认没有漏挂新文件。

### 第 2 步：用 FcThemeProvider 包 App

在 `App.vue` 顶层包 `FcThemeProvider`，主题/品牌自动持久化到 localStorage：

```vue
<template>
  <FcThemeProvider>
    <router-view />
  </FcThemeProvider>
</template>

<script setup lang="ts">
import { FcThemeProvider } from '@/components/sdk'
</script>
```

启动后默认 `brand=ldx2` + `theme=light`。用户切换后自动存 localStorage（key `fc-theme-provider`），刷新仍保持。

### 第 3 步：加切换 UI（可选）

用户想自己切主题/品牌，用 `FcThemeSwitcher`：

```vue
<!-- 顶栏放一个按钮，点击弹出 popover -->
<FcThemeSwitcher v-model:brand="brand" v-model:theme="theme" variant="popover" />

<!-- 或在设置抽屉里直接展开 -->
<FcThemeSwitcher v-model:brand="brand" v-model:theme="theme" variant="inline" />

<!-- 或移动端用抽屉 -->
<FcThemeSwitcher v-model:brand="brand" v-model:theme="theme" variant="drawer" />
```

### 第 4 步：用 Fc 组件搭页面

按分类索引找组件，组合拼页面，**几乎不用写 CSS**：

```vue
<template>
  <FcSectionHeader :title="t('page.title')" :back="true" @back="router.back()">
    <template #actions>
      <FcButton variant="primary" :icon="Plus" @click="onCreate">{{ t('common.create') }}</FcButton>
    </template>
  </FcSectionHeader>

  <FcFilterBar>
    <FcFilterButton v-for="t in tabs" :active="active === t.value" @click="active = t.value">
      {{ t.label }}
    </FcFilterButton>
  </FcFilterBar>

  <FcSection>
    <el-table class="fc-table" :data="rows" row-key="id" v-loading="loading">
      <el-table-column prop="name" :label="t('col.name')" />
      <el-table-column :label="t('col.actions')">
        <template #default="{ row }">
          <FcButton variant="text" size="sm" @click="edit(row)">{{ t('common.edit') }}</FcButton>
        </template>
      </el-table-column>
      <template #empty><FcEmpty /></template>
    </el-table>
    <FcPagination v-model:current-page="page" :total="total" />
  </FcSection>
</template>

<script setup lang="ts">
import { FcSectionHeader, FcSection, FcFilterBar, FcFilterButton, FcEmpty, FcButton, FcPagination } from '@/components/sdk'
</script>
```

整个页面**0 行 SCSS**，颜色/圆角/阴影/间距全部由 SDK 主题 token 驱动。

### OEM 集成（可选）

如果走 OEM 白标，把 OEM 配置作为兜底默认传给 Provider：

```vue
<FcThemeProvider
  :initial-brand="oem.config.brand || 'ldx2'"
  :initial-theme="oem.config.theme || 'light'"
  v-model:brand="brand"
  v-model:theme="theme"
>
  <router-view />
</FcThemeProvider>
```

用户首次访问无 localStorage 时，用 OEM 配置；用户切换后 localStorage 优先。

---

## 分类索引

| 分类 | 组件 |
|---|---|
| **section** 区段容器 | FcSection · FcSectionHeader |
| **display** 展示原子 | FcSectionCard · FcEmpty · FcSkeleton · FcTag · FcTagGroup · FcAvatar · FcImage · FcIcon |
| **data** 数据承载 | FcStatusBadge · FcReorderableGrid |
| **layout** 布局骨架 | FcHeader · FcMain · FcSidebar · FcSidebarToggle · FcSidebarNav · FcNavGroup · FcSidePanel |
| **navigation** 导航筛选 | FcFilterBar · FcFilterBarDivider · FcFilterButton · FcSegmented · FcTabsPanel · FcPagination |
| **overlay** 浮层交互 | FcDialog · FcDrawer · FcPopover · FcTooltip · FcConfirm · FcContextMenu · FcCommandPalette · FcPicker · FcPickerGroup · FcImagePicker |
| **form** 表单输入 | FcDropZone · FcButton · FcSelect · FcSwitch · FcRadioGroup · FcRadio · FcRadioButton · FcFormDraftBanner |
| **form global classes** EP 原生外观 | `el-input.fc-input` · `el-form-item.fc-form-item` · `el-slider.fc-slider` · `el-table.fc-table` |
| **feedback** 轻反馈 | FcToast（含 `toast()` 函数） · FcHelpTip |
| **theme** 主题品牌 | FcThemeProvider · FcThemeSwitcher |
| **utils** 工具 / 错误兜底 | FcErrorBoundary · useResponsive / useRecentProvider 等工具函数 |

### 两种引入方式

```ts
// 全量入口 — 一处导入所有组件
import { FcButton, FcEmpty } from '@/components/sdk'

// 按目录入口 — 树摇更友好, 且 copy 单个子目录即自带导出清单
import { FcButton } from '@/components/sdk/form'
import { FcEmpty } from '@/components/sdk/display'
```

子目录 `data` `display` `feedback` `form` `layout` `navigation` `overlay` `section` `theme` `utils` 各有自治 `index.ts`（导出该目录的组件 + Props 类型 + composables），主 `index.ts` 只做聚合。

---

## section — 区段容器

### FcSection

页面分区底座。自带 bg/radius/shadow/border，可选 padding/shadow/hover；内置「去盒」覆写消除嵌套 `.el-card`/`.el-descriptions`/`.el-divider`。

```vue
<FcSection padding="md" shadow="sm">
  <template #header><h2>标题</h2></template>
  内容
</FcSection>
```

| prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `padding` | `'inherit' \| 'none' \| 'sm' \| 'md' \| 'lg'` | `inherit` | 内边距 |
| `shadow` | `'none' \| 'sm' \| 'md' \| 'lg'` | `none` | 阴影 |
| `hover` | `boolean` | `false` | hover 上浮 |
| `noHeaderBorder` | `boolean` | `false` | 关闭 header 下分隔线 |

槽位：`header` / 默认。**禁止**在 FcSection 内嵌套带 border/bg 的盒子（见规范）。

### FcSectionHeader

页面顶部标题行，可选返回按钮 + 操作 + welcome 槽。

```vue
<FcSectionHeader :title="t('page.title')" :subtitle="t('page.sub')" back @back="router.back()">
  <template #actions><FcFilterButton active>全部</FcFilterButton></template>
</FcSectionHeader>
```

| prop | 类型 | 默认 |
|---|---|---|
| `title` | `string` | — |
| `subtitle` | `string` | — |
| `back` | `boolean` | `false` |

槽位：`actions` / `welcome`。emit：`back`。

---

## display — 展示原子

### FcSectionCard

FcSection 的快捷版（默认 `padding=md / shadow=sm`）。用于小型独立卡片。

```vue
<FcSectionCard hover>悬浮卡片</FcSectionCard>
```

| prop | 类型 | 默认 |
|---|---|---|
| `padding` | `'none' \| 'sm' \| 'md' \| 'lg'` | `md` |
| `shadow` | `'none' \| 'sm' \| 'md' \| 'lg'` | `sm` |
| `hover` | `boolean` | `false` |

### FcEmpty

通用空 / 错 / 加载 / 搜索无结果。含内联 SVG + i18n 回退。

```vue
<FcEmpty type="no-data" :title="t('common.no-data')" span-full />
```

| prop | 类型 | 默认 |
|---|---|---|
| `type` | `EmptyType` (`'no-data' \| 'error' \| 'processing' \| 'search' \| 'no-result'`) | `'no-data'` |
| `title` / `description` | `string` | i18n 回退 |
| `spanFull` | `boolean` | `false`（设 true 占满 `grid-column: 1/-1`） |
| `spinning` | `boolean` | `false` |

槽位：`icon` / 默认（title） / `action`。

### FcSkeleton

骨架屏。variant：text/rect/avatar/card，含 shimmer 动画。

```vue
<FcSkeleton variant="text" :rows="3" animated />
<FcSkeleton variant="card" :width="200" :height="120" />
```

| prop | 类型 | 默认 |
|---|---|---|
| `variant` | `'text' \| 'rect' \| 'avatar' \| 'card'` | `'text'` |
| `rows` | `number` | `3`（text 专用） |
| `width` / `height` | `string \| number` | — |
| `size` | `number` | —（avatar 专用） |
| `animated` | `boolean` | `true` |
| `radius` | `string \| number` | — |

### FcTag

**替代 `el-tag`**。6 色 tone + solid/light + closable/selectable/clickable。

```vue
<FcTag color="success">成功</FcTag>
<FcTag color="danger" solid :closable="true" @close="onClose">违规</FcTag>
```

| prop | 类型 | 默认 |
|---|---|---|
| `color` | `'primary' \| 'gray' \| 'success' \| 'warning' \| 'danger' \| 'brand'` | `'primary'` |
| `size` | `'sm' \| 'md' \| 'lg'` | `'sm'` |
| `solid` | `boolean` | `false`（满色 vs 浅底） |
| `closable` | `boolean` | `false` |
| `disabled` / `selected` | `boolean` | `false` |

**el-tag → FcTag 映射**：`type=info→gray` / `type=success→success` / `type=warning→warning` / `type=danger→danger` / `type=primary→primary` / `effect=dark→solid` / `size=small→sm`。

emit：`close` / `click`。

### FcTagGroup

可编辑标签列表容器（Enter 新增、Backspace 删末位）。

```vue
<FcTagGroup v-model:tags="tags" editable color="primary" placeholder="添加标签..." />
```

| prop | 类型 | 默认 |
|---|---|---|
| `tags` | `string[]` | — |
| `editable` | `boolean` | `true` |
| `color` | `'primary' \| 'gray' \| 'success' \| 'warning'` | `'primary'` |
| `placeholder` | `string` | `'Add tag...'` |

emit：`update:tags`。expose：`focus()`。

### FcAvatar

圆形头像，图片缺失自动按 name 哈希出 HSL 渐变首字母。

```vue
<FcAvatar :src="user.avatar" :name="user.name" size="small" />
```

| prop | 类型 | 默认 |
|---|---|---|
| `src` | `string` | — |
| `name` | `string` | — |
| `size` | `'tiny' \| 'small' \| 'medium' \| 'large'` | `'medium'` |
| `urlTransform` | `(src, size) => string` | — |

### FcImage

`<img>` 替代品。含加载 shimmer、失败 fallback、比例锁、圆角统一。

```vue
<FcImage :src="url" :alt="name" ratio="1/1" radius="8" />
<FcImage :src="user.avatar" :name="user.name" shape="circle" />
<FcImage :src="url" :fallback="defaultCover" fit="cover" />
```

| prop | 类型 | 默认 |
|---|---|---|
| `src` | `string \| null` | — |
| `alt` | `string` | — |
| `fallback` | `string` | — |
| `name` | `string` | 失败时取首字母 |
| `fit` | `'cover' \| 'contain' \| 'fill' \| 'none' \| 'scale-down'` | `'cover'` |
| `shape` | `'rect' \| 'circle'` | `'rect'`（circle 强制 1:1） |
| `ratio` | `string` (`'1/1'` `'16/9'`) | — |
| `radius` | `string \| number` | — |
| `width` / `height` | `string \| number` | — |
| `lazy` | `boolean` | `true` |
| `retry` | `boolean` | `false` |

槽位：`fallback`（错误态自定义内容）。emit：`load` / `error`。

---

## data — 数据承载

### FcStatusBadge

语义状态徽章：success/processing/error/pending/neutral，可选脉冲点 + solid。

```vue
<FcStatusBadge tone="processing" dot label="处理中" />
```

| prop | 类型 | 默认 |
|---|---|---|
| `tone` | `'success' \| 'processing' \| 'error' \| 'pending' \| 'neutral'` | `'neutral'` |
| `label` | `string` | — |
| `dot` | `boolean` | `false` |
| `size` | `'sm' \| 'md'` | `'md'` |
| `solid` | `boolean` | `false` |

### FcReorderableGrid

拖拽排序的槽位网格（HTML5 DnD）。自动补空槽、加/删/重排、min/max。

```vue
<FcReorderableGrid
  v-model="slots"
  :columns="4"
  :max="8"
  reorderable
  trailing-empty
>
  <template #default="{ value, index }">
    <img v-if="value" :src="value" />
  </template>
</FcReorderableGrid>
```

| prop | 类型 | 默认 |
|---|---|---|
| `modelValue` | `(string \| null)[]` | — |
| `min` / `max` | `number` | — |
| `layout` | `'grid' \| 'wrap'` | `'grid'` |
| `columns` / `width` / `height` | `number` | — |
| `reorderable` / `showIndex` / `keepNull` / `trailingEmpty` | `boolean` | — |

emit：`update:modelValue` / `change` / `remove` / `reorder`。expose：`slots` / `setSlot` / `remove`。

### el-table + `fc-table` (全局 class, 非组件)

**替代原 FcTable 薄封装** (已删除 — wrapper 的声明式 columns / loading prop 业务零使用,
且 props/emits 同步层是持续的维护负担). 直接用 EP 原生 el-table + `fc-table` class,
视觉 (表头 bg / 行高 48 / 圆角 / hover / 边框色) 由全局样式统一.

```vue
<el-table class="fc-table" :data="rows" row-key="id" stripe highlight-current-row v-loading="loading" @row-click="onRow">
  <el-table-column prop="name" label="姓名" />
  <el-table-column label="操作">
    <template #default="{ row }"><FcButton size="sm" @click="edit(row)">编辑</FcButton></template>
  </el-table-column>
  <template #empty><FcEmpty /></template>
</el-table>
```

约定：
- `class="fc-table"` 必带 (ESLint error 级强制), 否则表格无 SDK 外观.
- `row-key="id"` 按数据主键写; `stripe` / `highlight-current-row` 推荐带上 (原 FcTable 默认行为).
- 空态写 `<template #empty><FcEmpty /></template>` (EP 原生 slot, FcEmpty 可带 type/title).
- loading 用 EP `v-loading` 指令, 不要自己包蒙层.
- `el-table-column` 是 EP 内部子件, ESLint 放行.

---

## layout — 布局骨架 + 侧栏菜单

### FcSidebar (侧栏视觉壳)

5 个 slot: header / default (nav) / footer / toggle / resize-handle + 拖拽改宽。

**三种折叠模式**：

```vue
<!-- 模式 1: 完全受控 (推荐, 业务自己持久化) -->
<FcSidebar v-model:collapsed="x" v-model:width="w" />

<!-- 模式 2: 非受控 + 默认值, SDK 内部自管 (不用写 watch) -->
<FcSidebar :default-collapsed="false" />

<!-- 模式 3: 强制覆写 (如移动端) -->
<FcSidebar :force-collapsed="isMobile" />
```

| prop | 类型 | 默认 |
|---|---|---|
| `collapsed` | `boolean` | - (v-model) |
| `defaultCollapsed` | `boolean` | `false` (非受控模式初值) |
| `width` / `defaultWidth` | `number` | `240` |
| `minWidth` / `maxWidth` | `number` | `200` / `400` |
| `collapsedWidth` | `number` | `64` |
| `forceCollapsed` | `boolean` | - (viewport 强制态) |
| `enableDrag` | `boolean` | `true` |

emit：`select` / `reset-width` / `toggle-sidebar` / `update:collapsed` / `update:width`。

### FcSidebarNav (数据驱动导航)

接 `items: NavItem[]` (业务自己组装, 用 SDK 提供的 `useSidebarNavItems` 默认实现), 选中 emit `select(path)` 给宿主 router.push。

```vue
<FcSidebarNav
  :items="navItems"
  :active-path="route.path"
  :collapse="sidebarCollapsed"
  :default-openeds="['sub-create', 'sub-assets']"
  @select="(path) => router.push(path)"
/>
```

| prop | 类型 | 默认 |
|---|---|---|
| `items` | `NavItem[]` | - |
| `activePath` | `string` | `''` |
| `collapse` | `boolean` | `false` |
| `defaultOpeneds` | `string[]` | `[]` |
| `defaultPopperClass` | `string` | `'fc-sidebar-popper'` |
| `accordion` | `boolean` | `true` |

emit：`select: [path]`。

### FcSidebarToggle (折叠按钮)

独立的折叠/展开按钮。颜色走品牌 token, hover 动画内置, 不再写在 brand scss mixin 里。

```vue
<!-- 桌面 sidebar 底部 (default slot, forceCollapsed 时自动隐藏) -->
<FcSidebar v-model:collapsed="x">
  <FcSidebarToggle slot="toggle" placement="footer" :collapsed="x" @click="x = !x" />
  <FcSidebarNav ... />
</FcSidebar>
```

| prop | 类型 | 默认 |
|---|---|---|
| `collapsed` | `boolean` | - (v-model) |
| `placement` | `'header' \| 'footer' \| 'inline'` | `'header'` |
| `disabled` | `boolean` | `false` |

emit：`click`。

### useSidebarNavItems / useRouteAccess / buildNavItems (nav 工厂)

**最小用法**（一行生成 NavItem[]）：

```ts
import { useSidebarNavItems } from '@/components/sdk'
import { resolveIcon } from '@/utils'
import { isFeatureEnabled } from '@/config/features'
import { Files, MagicStick, Wallet } from '@element-plus/icons-vue'

const navItems = useSidebarNavItems({
  iconResolver: (name) => resolveIcon(name),
  features: isFeatureEnabled,         // meta.feature 校验
  customFilter: r => !r.meta?.hideInMenu,
  topLevels: [
    { routeNames: ['Home', 'Chat'] },  // 顶层单条
  ],
  groups: [
    { id: 'plaza',  labelKey: 'sidebar.plaza',  icon: Files,      routeNames: ['Inspiration', 'TemplatePlaza'] },
    { id: 'create', labelKey: 'sidebar.create', icon: MagicStick, routeNamePrefix: 'Create' },
    { id: 'assets', labelKey: 'sidebar.assets', icon: Wallet,     routeNamePrefix: 'Assets' },
  ],
})
```

**进阶用法**（角色过滤 + 复杂分组）：

```ts
const navItems = useSidebarNavItems({
  iconResolver: (name) => resolveIcon(name),
  features: isFeatureEnabled,

  groups: [
    // 普通 group
    { id: 'plaza', labelKey: 'sidebar.plaza', icon: Files, routeNames: ['Inspiration'] },

    // 按角色显隐
    { id: 'admin', labelKey: 'sidebar.admin', icon: Setting, routeNamePrefix: 'Admin',
      visible: () => userStore.userInfo?.role === 'admin' },

    // 叶子额外过滤 (admin 菜单排除某些路由)
    { id: 'admin', labelKey: 'sidebar.admin', icon: Setting, routeNamePrefix: 'Admin',
      leafFilter: r => r.name !== 'AdminModels' },

    // 顶层单条 + 自定义 dev 入口
    { id: 'ops', labelKey: 'sidebar.ops', icon: Tools, routeNames: ['AdminModels'],
      visible: () => userStore.userInfo?.ops === true },
  ],
})
```

**底层纯函数**（自己写 composable 时复用）：

```ts
import { filterRoutes, buildNavItems } from '@/components/sdk'

// filterRoutes: 同步过滤路由
const accessible = filterRoutes(router.getRoutes(), {
  features: isFeatureEnabled,
  customFilter: r => !r.meta?.hideInMenu,
})

// buildNavItems: 组装 NavItem 树
const items = buildNavItems({
  routes: accessible,
  t,
  iconResolver,
  groups: [...],
})
```

### FcHeader

顶栏视觉壳：brand/search/actions/user 槽 + 移动端汉堡。

```vue
<FcHeader @toggle-sidebar="collapsed = !collapsed">
  <template #brand>...</template>
  <template #actions>...</template>
  <template #user>...</template>
</FcHeader>
```

槽位：`brand` / `search` / `actions` / `user`。emit：`toggle-sidebar`。

### FcMain

主区壳：包 router-view + keep-alive + 过渡，可整体替换。

```vue
<FcMain :keep-alive="true" transition-name="fade" />
```

| prop | 类型 | 默认 |
|---|---|---|
| `keepAlive` | `boolean` | `true` |
| `transitionName` | `string` | `'fade'` |

槽位：默认（替换 router-view）。

### FcSidebar

视觉侧栏壳：折叠 + 鼠标拖拽改宽，header/footer/toggle 槽。

```vue
<FcSidebar v-model:collapsed="collapsed" v-model:width="width" :enable-drag="true">
  <template #header>...</template>
  <template #footer>...</template>
</FcSidebar>
```

| prop | 类型 | 默认 |
|---|---|---|
| `collapsed` | `boolean` | `false` |
| `width` / `defaultWidth` / `minWidth` / `maxWidth` / `collapsedWidth` | `number` | — |
| `forceCollapsed` / `enableDrag` | `boolean` | — |

emit：`update:collapsed` / `update:width` / `reset-width` / `toggle-sidebar`。

### FcSidebarNav

**数据驱动侧栏导航**。接收 `NavItem[]` 树，省去手写 `el-sub-menu`。

```vue
<FcSidebarNav :items="navItems" :active-path="route.path" :collapse="collapsed" />
```

| prop | 类型 | 默认 |
|---|---|---|
| `items` | `NavItem[]` | — |
| `activePath` | `string` | — |
| `collapse` | `boolean` | `false` |
| `defaultOpeneds` | `string[]` | — |
| `accordion` | `boolean` | `false` |

emit：`select`。导出类型：`NavLeaf` / `NavGroup` / `NavItem`。

### FcNavGroup

`el-menu` 薄封装。

```vue
<FcNavGroup :active-path="path" mode="vertical" :collapse="collapsed">
  <el-sub-menu index="1">...</el-sub-menu>
</FcNavGroup>
```

| prop | 类型 | 默认 |
|---|---|---|
| `activePath` | `string` | — |
| `mode` | `'horizontal' \| 'vertical'` | `'vertical'` |
| `collapse` | `boolean` | `false` |
| `openeds` | `string[]` | — |
| `accordion` | `boolean` | `false` |

emit：`select` / `update:openeds`。

### FcSidePanel

响应式侧栏：桌面定宽卡片 / 移动 FAB + 抽屉。

```vue
<FcSidePanel v-model:open="open" :width="320" fab-icon="Filter" drawer-title="筛选" />
```

| prop | 类型 | 默认 |
|---|---|---|
| `open` | `boolean` | `false` |
| `width` | `string \| number` | — |
| `fabIcon` | `string` | — |
| `drawerTitle` | `string` | — |
| `drawerDirection` | `'rtl' \| 'ltr' \| 'ttb' \| 'btt'` | `'rtl'` |

---

## navigation — 导航筛选

### FcFilterBar / FcFilterBarDivider / FcFilterButton

横向筛选条三件套。

```vue
<FcFilterBar>
  <FcFilterButton :active="filter === 'all'" @click="filter = 'all'">全部</FcFilterButton>
  <FcFilterBarDivider />
  <FcFilterButton :active="filter === 'hot'">热门<template #badge>{{ hotCount }}</template></FcFilterButton>
</FcFilterBar>
```

| 组件 | prop | 类型 |
|---|---|---|
| FcFilterBar | `block` | `boolean` |
| FcFilterButton | `active` / `disabled` | `boolean` |
| FcFilterBarDivider | — | — |

FcFilterButton 槽位：默认 / `badge`。emit：`click`。

### FcSegmented

分段单选控件（视图 / 模式切换），含 a11y。

```vue
<FcSegmented v-model="mode" :options="[{label:'图',value:'image'},{label:'视频',value:'video'}]" />
```

| prop | 类型 | 默认 |
|---|---|---|
| `modelValue` | `string \| number` | — |
| `options` | `SegOption[]` (`{ label, value, disabled? }`) | — |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` |
| `block` / `disabled` | `boolean` | `false` |

emit：`update:modelValue` / `change`。

### FcTabsPanel

tab 条 + 内容面板，按 `#tab-{value}` 命名槽。

```vue
<FcTabsPanel v-model="active" :tabs="[{label:'详情',value:'detail'},{label:'评论',value:'comments'}]">
  <template #tab-detail>...</template>
  <template #tab-comments>...</template>
</FcTabsPanel>
```

| prop | 类型 | 默认 |
|---|---|---|
| `tabs` | `TabItem[]` (`{ label, value, disabled? }`) | — |
| `modelValue` | `string` | — |
| `showTabsBar` | `boolean` | `true` |

emit：`update:modelValue` / `tab-click`。

### FcPagination

**替代 `el-pagination`**。统一布局（total + sizes + pager + jumper）、字号、颜色。

```vue
<FcPagination
  v-model:current-page="page"
  v-model:page-size="size"
  :total="total"
  @change="onPage"
/>
```

| prop | 类型 | 默认 |
|---|---|---|
| `currentPage` | `number` | — |
| `pageSize` | `number` | — |
| `total` | `number` | — |
| `pageSizes` | `number[]` | `[10, 20, 50, 100]` |
| `showJumper` / `showTotal` / `showSize` | `boolean` | `true` |
| `background` | `boolean` | `false` |
| `disabled` / `small` | `boolean` | `false` |
| `layout` | `string` | 自动拼接 |

emit：`update:currentPage` / `update:pageSize` / `change`。

---

## overlay — 浮层交互

### FcDialog

**替代 `el-dialog`**。双向 open/active、滚动锁、可拖拽/自定义 resize。

```vue
<FcDialog v-model:open="visible" title="标题" :width="600" draggable resizable>
  内容
  <template #footer>
    <FcButton @click="visible = false">取消</FcButton>
  </template>
</FcDialog>
```

| prop | 类型 | 默认 |
|---|---|---|
| `open` / `active` | `boolean` | — |
| `title` | `string` | — |
| `width` / `height` | `string \| number` | — |
| `alignCenter` / `closeOnClickModal` / `showClose` / `withHeader` / `draggable` / `resizable` / `fullscreen` / `appendToBody` / `destroyOnClose` | `boolean` | — |
| `minWidth` / `minHeight` | `number` | — |
| `dialogClass` / `bodyClass` / `modalClass` | `string` | — |

槽位：`header` / 默认 / `footer`（都 expose `close`）。emit：`update:open` / `toggle` / `before-close` / `close` / `resize`。

### FcDrawer

**替代 `el-drawer`**。4 方向 + 屏边圆角修剪。

```vue
<FcDrawer v-model:open="visible" title="筛选" direction="rtl" :size="400">
  内容
</FcDrawer>
```

| prop | 类型 | 默认 |
|---|---|---|
| `open` / `active` | `boolean` | — |
| `title` | `string` | — |
| `direction` | `'rtl' \| 'ltr' \| 'ttb' \| 'btt'` | `'rtl'` |
| `size` | `string \| number` | `'30%'` |
| `withHeader` / `showClose` / `closeOnClickModal` / `closeOnPressEscape` | `boolean` | `true` |
| `drawerClass` / `bodyClass` | `string` | — |

槽位：`header` / 默认（expose `close`）。emit：`update:open` / `toggle` / `before-close`。

### FcPopover

**替代 `el-popover`**。桌面 el-popover / 移动 el-drawer。

```vue
<FcPopover v-model:open="open" title="详情" placement="bottom" :width="300">
  <template #trigger="{ open }">
    <button @click="open()">详情</button>
  </template>
  内容
</FcPopover>
```

| prop | 类型 | 默认 |
|---|---|---|
| `open` / `active` | `boolean` | — |
| `title` | `string` | — |
| `width` | `string \| number` | — |
| `placement` | EP `Placement` | `'bottom'` |
| `trigger` | `'hover' \| 'click' \| 'focus' \| 'contextmenu'` | `'click'` |
| `showArrow` / `withHeader` | `boolean` | `true` |
| `drawerDirection` / `drawerSize` | — | — |
| `popperClass` / `drawerClass` | `string` | — |

槽位：`trigger`（expose `open` / `toggle`）/ 默认（expose `open` / `close`）。emit：`update:open` / `toggle`。

### FcTooltip

**替代 `el-tooltip`**。统一 delay/placement/字体/颜色，移动端可长按降级。

```vue
<FcTooltip :content="t('help.hint')" placement="top">
  <el-icon><QuestionFilled /></el-icon>
</FcTooltip>
<FcTooltip content="删除后无法恢复" variant="danger">
  <FcButton variant="danger">删除</FcButton>
</FcTooltip>
```

| prop | 类型 | 默认 |
|---|---|---|
| `content` | `string` | — |
| `placement` | EP `Placement` (`'top' \| 'bottom' \| 'left' \| 'right' + '-start/-end'`) | `'top'` |
| `variant` | `'default' \| 'danger'` | `'default'` (danger 红字) |
| `disabled` | `boolean` | `false` |
| `showArrow` | `boolean` | `true` |
| `showDelay` / `hideDelay` | `number` | `100` |
| `light` | `boolean` | `true` (false = 深底) |

槽位：`default`。

### FcConfirm

标准化确认弹窗，默认/危险/主色三态。

```vue
<FcConfirm
  v-model:open="showConfirm"
  title="删除确认"
  content="删除后无法恢复，确认？"
  variant="danger"
  :loading="deleting"
  @confirm="onDelete"
/>
```

| prop | 类型 | 默认 |
|---|---|---|
| `open` | `boolean` | — |
| `title` / `content` | `string` | — |
| `variant` | `'default' \| 'danger' \| 'primary'` | `'default'` |
| `confirmText` / `cancelText` | `string` | i18n 回退 |
| `loading` / `disabled` | `boolean` | `false` |
| `width` | `string \| number` | — |
| `closeOnClickModal` | `boolean` | `false` |

emit：`update:open` / `confirm` / `cancel`。

### FcContextMenu

teleport 右键菜单。

```vue
<FcContextMenu
  v-model:visible="menuVisible"
  :pos="{ x, y }"
  :items="[{ key: 'copy', label: '复制' }, { key: 'del', label: '删除', danger: true }]"
  @select="onSelect"
/>
```

| prop | 类型 |
|---|---|
| `visible` | `boolean` |
| `pos` | `{ x: number, y: number }` |
| `items` | `MenuItem[]` (`{ key, label, danger?, disabled? }`) |

emit：`select` / `close`。

### FcPicker / FcPickerGroup

通用 picker 壳 + 槽位网格版。

```vue
<FcPicker v-model:open="open" title="选择图片" :dialog-width="800" :dialog-height="600">
  <template #trigger="{ open }">
    <button @click="open()">选图</button>
  </template>
  <template #panel>
    <!-- 自定义面板内容 -->
  </template>
</FcPicker>
```

FcPickerGroup 在 FcReorderableGrid 上加 `v-model:slots` 同步：

```vue
<FcPickerGroup v-model="images" :max="6" :columns="3" reorderable>
  <template #default="{ value, index }">
    <img v-if="value" :src="value" />
  </template>
</FcPickerGroup>
```

### FcImagePicker

完整图片选择器：上传 / URL / 最近 tab + 粘贴 / 拖放 / 多选 / 转码缩放 / 服务端配置 / blob 模式。

```vue
<FcImagePicker
  v-model="imageUrl"
  :width="200"
  :height="200"
  :max-size="10"
  :allowed-types="['image/png', 'image/jpeg']"
  :server="{
    uploadUrl: '/api/upload',
    recentUrl: '/api/recent',
    headers: { Authorization: token },
  }"
  @select="onSelect"
/>
```

详见组件内 `FcImagePickerProps` 接口。emit：`update:modelValue` / `select` / `multi` / `uploading` / `error`。

---

## form — 表单输入

### FcButton

**替代 `el-button`**。四态 + 三尺寸 + 图标/loading/block。

```vue
<FcButton variant="primary" @click="save">保存</FcButton>
<FcButton variant="text" size="sm" :icon="Edit">编辑</FcButton>
<FcButton variant="danger" :loading="deleting" @click="del">删除</FcButton>
<FcButton variant="secondary" block>全宽</FcButton>
```

| prop | 类型 | 默认 |
|---|---|---|
| `variant` | `'primary' \| 'secondary' \| 'text' \| 'danger'` | `'primary'` |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` |
| `icon` | EP icon component | — |
| `loading` | `boolean` | `false` |
| `disabled` | `boolean` | `false` |
| `block` | `boolean` | `false` |
| `type` | `'button' \| 'submit' \| 'reset'` | `'button'` |

emit：`click`。

**el-button → FcButton 映射**：`type=primary→variant=primary` / `type=default→variant=secondary` / `type=text→variant=text` / `type=danger→variant=danger` / `size=small→size=sm`。

### 原生 `<button>` + `fc-button-*` class（全局 class，非组件）

FcButton 覆盖大部分场景（loading / EP 集成）。必须用原生 `<button>` 时，带 `fc-button` 系列 class 获得 SDK 统一外观，**不要自己写 `.btn-*` SCSS**（历史教训：`btn-cancel` 曾在 6 个文件里定义出 3 种长相）。

组合方式：`fc-button` 基础 + 变体（必填）+ 尺寸（默认 md 可省）+ 修饰符。

| 变体 | 语义 | 视觉 |
|---|---|---|
| `fc-button-primary` | 主要 | primary 底 + 白字 |
| `fc-button-secondary` | 次要（填充） | muted 灰底 |
| `fc-button-outline` | 次要（描边） | 透明底 + border，hover 变 primary |
| `fc-button-danger` | 危险 | danger 底 + 白字 |
| `fc-button-text` | 文字按钮 | 无底无边框，primary 字色（表格行操作） |
| `fc-button-text-danger` | 危险文字 | 同上，danger 字色（表格行删除） |
| `fc-button-dashed` | 虚线触发 | dashed border（新建卡片/添加入口） |

| 尺寸 | 高度 | 字号 | 用途 |
|---|---|---|---|
| `fc-button-xs` | 24px | 12px | 表格行 / 紧凑操作 |
| `fc-button-sm` | 28px | 12px | 弹窗底部 |
| `fc-button-md` | 32px | 13px | 默认，可省略 |
| `fc-button-lg` | 40px | 14px | 页面主 CTA |

修饰符：`fc-button-icon`（正方形，宽高=尺寸高度）· `fc-button-circle`（全圆角）· `fc-button-block`（占满父宽）。内嵌 svg 自动 `1em` 跟字号缩放。

```html
<button class="fc-button fc-button-primary fc-button-sm">保存</button>
<button class="fc-button fc-button-outline fc-button-sm">取消</button>
<button class="fc-button fc-button-text fc-button-xs">编辑</button>
<button class="fc-button fc-button-text-danger fc-button-xs">删除</button>
<button class="fc-button fc-button-outline fc-button-icon fc-button-xs fc-button-circle"><i class="ri-edit-line" /></button>
<button class="fc-button fc-button-dashed fc-button-block fc-button-lg">+ 新建分组</button>
```

实现要点（改 SDK 时别踩）：

- 样式在 `theme/_button-classes.scss`。注意 **el-button 渲染出来也是原生 `<button>`** 且 FcButton 给它挂 `fc-button` class，所以每条规则都带 `:not(.el-button)` 排除 EP 实例 — 漏掉的话 base 的 height/padding 会以更高特异性压掉 EP 的 size 变体（2026-07 踩坑记录）。
- 已注册进 `theme.scss`；宿主若绕过 `theme.scss` 自有样式入口，需同步补 `@use`（见第 1 步警告）。
- ESLint `prefer-fc-button`（warn 级）：原生 button 不带 `fc-button*` class 即警告，带任意 `fc-button-*` 即放行。

### EP 原生组件 + 全局 fc-* class

`el-input`、`el-form-item`、`el-slider`、`el-table` 保留 Element Plus 原生 API，不增加同名 Vue 薄封装。必须带对应的 SDK 全局 class，以统一主题样式：

| EP 组件 | 必需 class | 统一内容 |
|---|---|---|
| `el-input` | `fc-input` | 宽度、错误态 |
| `el-form-item` | `fc-form-item` | label、校验错误文案 |
| `el-slider` | `fc-slider` | 宽度、禁用态 |
| `el-table` | `fc-table` | 表头、行高 48、圆角、hover、边框色（详见 data 章节） |

```vue
<el-input v-model="name" class="fc-input" maxlength="50" show-word-limit />
<el-form-item class="fc-form-item" label="姓名" prop="name">
  <el-input v-model="name" class="fc-input" />
</el-form-item>
<el-slider v-model="volume" class="fc-slider" :min="0" :max="100" />
```

需要手动错误态时，给输入组件增加 `has-error`，错误文案使用 `fc-input__error`；辅助文案使用 `fc-form-item__hint`：

```vue
<el-input v-model="email" class="fc-input has-error" />
<div class="fc-input__error">邮箱格式错误</div>
```

这些 class 随 `@/components/sdk/theme/theme.scss` 一并加载。业务不得省略 class，也不要重新封装仅转发 EP props/events/slots 的组件。

### FcSelect

`el-select` 薄封装。统一空态文案、loading、远程搜索。

```vue
<FcSelect v-model="v" :options="opts" placeholder="请选择" />
<FcSelect v-model="v" :options="opts" :loading="loading" remote @search="onSearch">
  <template #empty>暂无数据</template>
</FcSelect>
```

| prop | 类型 | 默认 |
|---|---|---|
| `modelValue` | `T \| undefined` | — |
| `options` | `SelectOption<T>[]` (`{ label, value, disabled? }`) | — |
| `placeholder` / `clearable` / `disabled` / `loading` | — | — |
| `remote` | `boolean` | `false` |
| `multiple` | `boolean` | `false` |
| `size` | `'small' \| 'default' \| 'large'` | `'default'` |
| `emptyText` | `string` | `'无数据'` |

槽位：`prefix` / `empty`。emit：`update:modelValue` / `change` / `search` / `clear` / `visible-change`。导出类型：`SelectOption<V>`。

### FcSwitch

**替代 `el-switch`**。on/off 走品牌 token，统一尺寸/文案/loading。

```vue
<FcSwitch v-model="enabled" />
<FcSwitch v-model="opt" active-text="开" inactive-text="关" />
<FcSwitch v-model="sync" loading />
```

| prop | 类型 | 默认 |
|---|---|---|
| `modelValue` | `boolean \| string \| number` | — |
| `activeValue` / `inactiveValue` | `boolean \| string \| number` | `true` / `false` |
| `activeText` / `inactiveText` | `string` | — |
| `disabled` / `loading` | `boolean` | `false` |
| `size` | `'large' \| 'default' \| 'small'` | `'default'` |
| `inlinePrompt` | `boolean` | `false` |

emit：`update:modelValue` / `change`。

### FcDropZone

业务无关的拖放 / 点选文件区。只校验和吐文件，不上传。

```vue
<FcDropZone accept="image/*" :max-size="10" multiple @drop="onFiles" @drop-url="onUrl">
  <template #default="{ isDragOver }">
    {{ isDragOver ? '松开上传' : '点击或拖拽到这里' }}
  </template>
</FcDropZone>
```

| prop | 类型 | 默认 |
|---|---|---|
| `accept` | `string` | — |
| `multiple` | `boolean` | `false` |
| `maxSize` | `number` (MB) | — |
| `disabled` / `clickable` | `boolean` | — |
| `as` | `string` | `'div'` |
| `containerClass` | `string` | — |

emit：`drop` / `drop-url` / `reject` / `click`。

---

## theme - 主题/品牌系统

SDK 自带 8 个 brand + light/dark 主题切换。**SDK 用户不需要 copy 任何 brand CSS 文件**，只 import 一次 SCSS + 用 `FcThemeProvider` 包 App 即可。

### 快速接入（SDK 用户）

**1. 引入 SCSS（main.ts）**：
```ts
import '@/components/sdk/theme/theme.scss'
```

**2. 用 FcThemeProvider 包 App（App.vue）**：
```vue
<FcThemeProvider>
  <App />
</FcThemeProvider>
```

Provider 内置 localStorage 持久化（key `fc-theme-provider`），切 brand/theme 后刷新页面仍保持。

**3. 集成 OEM 配置（可选）**：
```vue
<FcThemeProvider
  :initial-brand="oem.config.brand || 'ldx2'"
  :initial-theme="oem.config.theme || 'light'"
  v-model:brand="brand"
  v-model:theme="theme"
>
  <App />
</FcThemeProvider>
```

`initialBrand` / `initialTheme` 作为兜底默认（localStorage 没存时用）。

**4. 加切换 UI（可选）**：
```vue
<FcThemeSwitcher v-model:brand="brand" v-model:theme="theme" variant="popover" />
```

### FcThemeProvider

| prop | 类型 | 默认 | 说明 |
|---|---|---|---|
| `brand` | `string` | - | v-model:brand |
| `theme` | `'light' \| 'dark'` | - | v-model:theme |
| `initialBrand` | `string` | - | OEM 默认（localStorage 没存时兜底） |
| `initialTheme` | `'light' \| 'dark'` | - | OEM 默认 |
| `persistKey` | `string` | `'fc-theme-provider'` | localStorage key |
| `persist` | `boolean` | `true` | 是否持久化 |
| `defaultBrand` | `string` | `'ldx2'` | 兜底默认 |
| `defaultTheme` | `'light' \| 'dark'` | `'light'` | 兜底默认 |

emit：`update:brand` / `update:theme` / `change`。expose：`applyToRoot` / `reset` / `currentBrand` / `currentTheme`。provide：`fc-theme` 注入给子组件。

### FcThemeSwitcher

UI 控件，三种 variant：

```vue
<!-- inline: 直接展开 (放 settings 面板内) -->
<FcThemeSwitcher v-model:brand="b" v-model:theme="t" variant="inline" />

<!-- popover: 弹出气泡 (默认, 顶栏按钮触发) -->
<FcThemeSwitcher v-model:brand="b" v-model:theme="t" variant="popover" />

<!-- drawer: 弹出抽屉 (移动端) -->
<FcThemeSwitcher v-model:brand="b" v-model:theme="t" variant="drawer" />
```

| prop | 类型 | 默认 |
|---|---|---|
| `brand` | `string` | - (v-model) |
| `theme` | `'light' \| 'dark'` | - (v-model) |
| `variant` | `'inline' \| 'popover' \| 'drawer'` | `'popover'` |
| `triggerText` | `string` | i18n 回退 |
| `triggerIcon` | EP icon | - |
| `showReset` | `boolean` | `false` |
| `title` | `string` | i18n 回退 |
| `t` | `(key, params?) => string` | 内置 en/zh |

emit：`update:brand` / `update:theme` / `reset`。内置 8 个 brand swatch + 2 个 theme swatch。

### 内置 8 个 brand

| id | label | accent | 说明 |
|---|---|---|---|
| `ldx2` | AIGC | `#ff6b00` | Apple-inspired 大圆角 + 橙色主调 |
| `apple` | Apple | `#007aff` | Apple HIG 系统蓝 |
| `google` | Google | `#6750a4` | Material Design 紫 |
| `mchuan` | B-End | `#2563eb` | B 端工程化蓝 |
| `manyun` | Teal | `#2E8B57` | 海洋青绿 + KPI 三档色 |
| `acme` | Acme | `#0070e0` | Acme Blue 工程化基调 |
| `microsoft` | Microsoft | `#0078d4` | Fluent Design 微软蓝 |
| `vonnex` | Vonnex | `#00a86b` | Vonnex 绿 + glass 效果 |

### 新增 brand 步骤

1. 在 `sdk/theme/brands/` 新建 `_<name>.scss`，调用 `@include define-brand(<name>, $tokens)` + 可选 `@include brand-dark-surface`
2. 在 `sdk/theme/brands/_index.scss` 加 `@use '<name>'`
3. 在 `sdk/theme/brands.ts` 的 `BRANDS` 数组追加 `{ id, label, desc, accent }`
4. 完成 - 业务侧无需改代码，FcThemeSwitcher 自动列出新 brand

---

## 常见任务模板（不写 CSS）

照着下面模板拼页面，**整页 0 行 SCSS**。颜色/圆角/阴影/间距全由 SDK 主题 token 驱动。

### 模板 1：列表页（表头 + 筛选 + 表格 + 分页）

```vue
<template>
  <div class="app-page">
    <FcSectionHeader :title="t('page.title')" :back="true" @back="router.back()">
      <template #actions>
        <FcButton variant="primary" :icon="Plus" @click="onCreate">{{ t('common.create') }}</FcButton>
      </template>
    </FcSectionHeader>

    <FcFilterBar>
      <FcFilterButton v-for="t in tabs" :key="t.value" :active="active === t.value" @click="active = t.value">
        {{ t.label }}
      </FcFilterButton>
      <FcFilterBarDivider />
      <el-input v-model="keyword" class="fc-input" :placeholder="t('common.search')" clearable @keyup.enter="onSearch" />
    </FcFilterBar>

    <FcSection>
      <el-table class="fc-table" :data="rows" stripe v-loading="loading">
        <el-table-column prop="name" :label="t('col.name')" min-width="160" />
        <el-table-column :label="t('col.status')" min-width="100">
          <template #default="{ row }">
            <FcTag :color="row.active ? 'success' : 'gray'" size="sm">{{ row.active ? '启用' : '禁用' }}</FcTag>
          </template>
        </el-table-column>
        <el-table-column :label="t('col.actions')" min-width="120" fixed="right">
          <template #default="{ row }">
            <FcButton variant="text" size="sm" @click="edit(row)">{{ t('common.edit') }}</FcButton>
            <FcButton variant="text" size="sm" @click="del(row)">{{ t('common.delete') }}</FcButton>
          </template>
        </el-table-column>
        <template #empty><FcEmpty /></template>
      </el-table>

      <div v-if="total > pageSize" style="margin-top: 12px; display: flex; justify-content: flex-end">
        <FcPagination v-model:current-page="page" v-model:page-size="pageSize" :total="total" />
      </div>
    </FcSection>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Plus } from '@element-plus/icons-vue'
import {
  FcSectionHeader, FcSection, FcFilterBar, FcFilterBarDivider, FcFilterButton,
  FcEmpty, FcTag, FcButton, FcPagination,
} from '@/components/sdk'
</script>
```

### 模板 2：表单弹窗（Dialog + Form）

```vue
<template>
  <FcButton variant="primary" @click="open = true">{{ t('common.create') }}</FcButton>

  <FcDialog v-model:open="open" :title="t('form.title')" width="540px" append-to-body>
    <el-form :model="form" :rules="rules" label-width="80px">
      <el-form-item class="fc-form-item" :label="t('form.name')" prop="name">
        <el-input v-model="form.name" class="fc-input" :placeholder="t('form.name-ph')" maxlength="50" show-word-limit />
      </el-form-item>
      <el-form-item class="fc-form-item" :label="t('form.type')" prop="type">
        <FcSelect v-model="form.type" :placeholder="t('form.type-ph')">
          <el-option v-for="o in typeOptions" :key="o.value" :label="o.label" :value="o.value" />
        </FcSelect>
      </el-form-item>
      <el-form-item class="fc-form-item" :label="t('form.enabled')">
        <FcSwitch v-model="form.enabled" active-text="开" inactive-text="关" />
      </el-form-item>
    </el-form>
    <template #footer>
      <FcButton @click="open = false">{{ t('common.cancel') }}</FcButton>
      <FcButton variant="primary" :loading="saving" @click="save">{{ t('common.save') }}</FcButton>
    </template>
  </FcDialog>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import { FcDialog, FcSelect, FcSwitch, FcButton } from '@/components/sdk'
</script>
```

### 模板 3：详情页（卡片 + Tab + 空态）

```vue
<template>
  <FcSectionHeader :title="data?.name || ''" :back="true" @back="router.back()">
    <template #actions>
      <FcButton variant="danger" :loading="deleting" @click="del">{{ t('common.delete') }}</FcButton>
    </template>
  </FcSectionHeader>

  <FcSection v-if="loading">
    <FcSkeleton variant="card" :rows="5" />
  </FcSection>

  <FcSection v-else-if="data">
    <FcTabsPanel v-model="tab" :tabs="tabs">
      <template #tab-info>
        <div class="info-grid">
          <div class="info-item"><span class="info-label">{{ t('info.id') }}</span><span>{{ data.id }}</span></div>
          <div class="info-item"><span class="info-label">{{ t('info.created') }}</span><span>{{ data.createdAt }}</span></div>
        </div>
      </template>
      <template #tab-history>
        <FcEmpty v-if="!history.length" :title="t('history.empty')" />
        <div v-else>
          <!-- history list -->
        </div>
      </template>
    </FcTabsPanel>
  </FcSection>

  <FcEmpty v-else type="error" :title="t('error.not-found')" />
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { FcSectionHeader, FcSection, FcTabsPanel, FcSkeleton, FcEmpty, FcButton } from '@/components/sdk'
</script>

<style scoped lang="scss">
/* 唯一允许写的少量布局 CSS (非颜色/圆角) */
.info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.info-item { display: flex; gap: 8px; font-size: 13px; }
.info-label { color: var(--app-text-secondary); min-width: 80px; }
</style>
```

> 模板 3 的 4 行 CSS 是布局类（grid/flex/字号），不是颜色或圆角 - **颜色 / 圆角 / 阴影永远走 token**，不要写死 `#xxx` 或 `border-radius: 8px`。

### 模板 4：图片选择（上传 + URL + 最近）

```vue
<FcImagePicker
  v-model="imageUrl"
  :width="200" :height="200"
  :max-size="10"
  :allowed-types="['image/jpeg', 'image/png', 'image/webp']"
  :server="{
    url: '/api/v1/oss/upload/image',
    fieldName: 'file',
    responseUrlPath: 'data.url',
  }"
  multiple
  paste-enabled
  @error="onError"
/>
```

无需自写上传按钮、URL 输入、最近列表 - 全部内置。

### 模板 5：右侧滑出设置面板

```vue
<FcButton @click="panelOpen = true">{{ t('settings.open') }}</FcButton>

<FcSidePanel v-model:open="panelOpen" :width="320" fab-icon="Settings" drawer-title="设置">
  <FcThemeSwitcher v-model:brand="brand" v-model:theme="theme" variant="inline" />
  <!-- 其他设置项 -->
</FcSidePanel>
```

桌面端是固定宽度卡片，移动端自动变 FAB + 抽屉。

---

## 强制规范（业务页 review 必查）

### 1. EP 组件禁用清单

业务页直接使用 EP 组件时，已有 Fc 封装的必须改用 Fc 组件；以下三个全局 class 例外必须显式带 class。

| EP 用法 | 要求 / 替代 |
|---|---|
| `el-card` | `FcSection` / `FcSectionCard` |
| `el-dialog` | `FcDialog` |
| `el-drawer` | `FcDrawer` |
| `el-popover` | `FcPopover` |
| `el-tooltip` | `FcTooltip` |
| `el-empty` | `FcEmpty` |
| `el-skeleton` | `FcSkeleton` |
| `el-tag` | `FcTag` |
| `el-upload`（图片） | `FcImagePicker` / `FcDropZone` |
| `el-button`（业务主操作） | `FcButton` |
| `el-input` | `<el-input class="fc-input">` |
| `el-select` | `FcSelect` |
| `el-form-item` | `<el-form-item class="fc-form-item">` |
| `el-slider` | `<el-slider class="fc-slider">` |
| `el-switch` | `FcSwitch` |
| `el-table` | `<el-table class="fc-table">` |
| `el-tabs`（页内 tab） | `FcTabsPanel` |
| `el-pagination` | `FcPagination` |
| `<img class="cover">` + 自写加载/失败 | `FcImage` |
| 自写 `.xxx-card` / `.xxx-tag` | 对应 Fc 组件 |

> ESLint 以 `error` 级拦截：禁止已有 Fc 封装的裸 `el-*`，并检查 `el-input` / `el-form-item` / `el-slider` 是否带对应 `fc-*` class。绕开 SDK 会让 `npm run lint` / `verify` / CI 失败。

### 2. CSS 写与不写的边界

**✅ 允许写**（布局/间距/字号/动画）：

```scss
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.row { display: flex; align-items: center; gap: 8px; }
.title { font-size: 16px; font-weight: 600; }
.fade-enter-active { transition: opacity 0.2s; }
```

**❌ 禁止写**（颜色/圆角/阴影/边框 - 全走 token）：

```scss
.bad { color: #1677ff; background: #f5f5f5; }              /* ❌ 硬编码色值 */
.bad { border-radius: 8px; }                                /* ❌ 硬编码圆角 */
.bad { box-shadow: 0 2px 8px rgba(0,0,0,0.1); }            /* ❌ 硬编码阴影 */
.bad { border: 1px solid #e5e5e5; }                          /* ❌ 硬编码边框 */
```

**✅ 必须用 token**：

```scss
.good { color: var(--app-text); background: var(--app-bg-card); }
.good { border-radius: var(--app-radius-md); }
.good { box-shadow: var(--app-shadow-sm); }
.good { border: 1px solid var(--app-separator); }
.good { color: color-mix(in srgb, var(--app-primary) 12%, transparent); }  /* 派生色 */
```

### 3. 颜色硬约束

- 所有色值走 `--app-*` 令牌或 `color-mix(in srgb, var(--app-primary) X%, transparent)` 派生
- **禁止**写死 `#1677ff` / `rgb(...)` / `rgba(...)` 之类
- 透明度派生用 `color-mix`，不要 `rgba(var(--app-primary-rgb), 0.1)`（token 不提供 rgb 形式）

### 4. 嵌套约束

**FcSection 内禁止嵌套带 border/bg 的盒子** - 用 `el-divider` 或 `margin` 分隔，不要再用 `.xxx-card` 套 `.yyy-card`。

### 5. EP 浮层覆盖

如必须覆盖 `el-dialog` / `el-drawer` / `el-popover` 内部 EP 样式（极少需要），**必须** `!important` + 双类选择器（与 `_ep-overrides.scss` 一致）：

```scss
:deep(.el-dialog__header) {
  /* 双类: .my-dialog + .el-dialog__header */
}
```

但 99% 场景下用 `FcDialog` 的 `dialogClass` / `bodyClass` / `modalClass` props 即可，不必写 `:deep`。

---

## 新增 SDK 组件流程

1. 在 `sdk/<category>/Fc<Name>.vue` 创建
2. 在 `sdk/<category>/index.ts` 导出
3. 在本 README 速查表更新对应分类
4. 业务页面替换散件实现

### 自定义颜色主题（不写 SCSS）

如果业务想在不切 brand 的情况下临时调整某个色：

```vue
<!-- 临时把 --app-primary 改成红色 (FcImage/其他组件会跟着变) -->
<FcSection :style="{ '--app-primary': '#ff0000' }">
  <FcButton variant="primary">红色按钮</FcButton>
</FcSection>
```

⚠️ 仅限一次性场景。如果要持久化，应该新建 brand（参考 `theme - 新增 brand 步骤`）。

### 不在 SDK 范围（业务自写）

以下场景 SDK 不封装，业务自己写：

- 业务专用复杂表单（多步骤 / 联动校验）- 用 `el-form` + `<el-form-item class="fc-form-item">` 拼
- 业务专用图表（echarts 配置）- 直接用 `v-chart`
- 业务专用富文本编辑器 - 自己接 quill / tiptap
- 复杂拖拽布局（gridster 等）- 自己接

---

## 开发与验证

SDK 改完务必跑 `npm run verify`，三件套一起跑：typecheck + eslint + 测试。

```bash
npm run verify
# 等价于依次执行:
#   1. vue-tsc -b --noEmit      静态类型
#   2. eslint "src/**/*.vue"    ESLint (error 级, 绕开 SDK 即失败)
#   3. vitest run              SDK 组件单元测试
```

### 测试结构

`src/components/sdk/__tests__/` 下有三类测试：

| 路径 | 作用 |
|---|---|
| `setup.ts` | 全局 setup：注册 `vue-i18n` + `Pinia` + `ElementPlus` 全局 plugin + jsdom 缺失 API (matchMedia / ResizeObserver / localStorage) |
| `smoke.test.ts` | 10 个组件挂载烟测，每组件 1-2 条断言 |
| `css-isolation.test.ts` | CSS 隔离守护：所有 `<style>` 块必须 scoped 或顶层选择器 `.fc-` 前缀 (防止业务页样式污染) |

### 组件级 colocated 测试

每个有"行为"或"对外契约"的组件旁都有一个 `<Name>.test.ts`，覆盖：

- **mount 不报错**（无 key/missing prop 错误）
- **props 透传**（`variant` / `size` / `disabled` 等）
- **emit 触发**（`click` / `update:modelValue` / `change` / `select` 等）
- **slot 渲染**（`header` / `actions` / `trigger` / `default`）
- **a11y 属性**（`role` / `aria-checked` / `aria-label`）

写法参考 `FcSwitch.test.ts` / `FcThemeProvider.test.ts` / `FcSidebar.test.ts`。

### 不写 unit test 的 4 个组件

下列组件状态/事件层远超 jsdom 模拟能力，留给 e2e（Playwright）：

- `FcImagePicker`（1374 行，粘贴 / 拖放 / 多选 / 转码）
- `FcDropZone`（HTML5 DnD）
- `FcReorderableGrid`（HTML5 DnD）
- `FcContextMenu`（右键定位 + teleport）

### 添加新组件测试

新增 SDK 组件时，**同时**在组件旁加 `<Name>.test.ts` colocated 文件，遵循现有测试的 helper：

```ts
import { mountFc, emittedOf } from '../__tests__/helpers/mount'
import FcNew from './FcNew.vue'

describe('FcNew', () => {
  it('默认 mount 不报错', () => {
    const w = mountFc(FcNew)
    expect(w.find('.fc-new').exists()).toBe(true)
  })
})
```

不需要手动注册 i18n / Pinia / ElementPlus — `setup.ts` 已经做了。
