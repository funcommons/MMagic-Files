<template>
  <Teleport to="body">
    <div v-if="visible" class="fc-menu-backdrop" @click="emit('close')" @contextmenu.prevent="emit('close')">
      <div ref="menuEl" class="fc-menu" :style="{ left: adj.x + 'px', top: adj.y + 'px' }" @click.stop>
        <button
          v-for="item in items"
          :key="item.value"
          class="fc-menu-item"
          :class="{ danger: item.danger, disabled: item.disabled }"
          :disabled="item.disabled"
          @click="onSelect(item)"
        >
          <i v-if="item.icon" :class="item.icon" />
          <span>{{ item.label }}</span>
        </button>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'

defineOptions({ name: 'FcContextMenu' })

export interface MenuItem {
  /** 唯一值, select 事件回传 */
  value: string
  /** 显示文本 (调用方负责 i18n) */
  label: string
  /** RemixIcon / Element Icon 等 class 名 */
  icon?: string
  /** 危险项 (删除等) 红色高亮 */
  danger?: boolean
  /** 禁用态 */
  disabled?: boolean
}

export interface FcContextMenuProps {
  visible: boolean
  pos: { x: number; y: number }
  items: MenuItem[]
}

const props = defineProps<FcContextMenuProps>()

const emit = defineEmits<{
  /** 选中某项 */
  select: [value: string]
  /** 关闭 (点 backdrop / 选中后自动 / Esc) */
  close: []
}>()

function onSelect(item: MenuItem) {
  if (item.disabled) return
  emit('select', item.value)
  emit('close')
}

/** 视口夹紧：pos 在底部/右侧附近时菜单会溢出视口被裁（iframe 视口同理）——
 * 渲染后量实际尺寸，把落点夹回视口内（8px 边距） */
const menuEl = ref<HTMLElement | null>(null)
const adj = ref({ x: props.pos.x, y: props.pos.y })
watch(
  [() => props.visible, () => props.pos],
  async ([v]) => {
    if (!v) return
    await nextTick()
    const w = menuEl.value?.offsetWidth ?? 160
    const h = menuEl.value?.offsetHeight ?? 200
    adj.value = {
      x: Math.max(8, Math.min(props.pos.x, window.innerWidth - w - 8)),
      y: Math.max(8, Math.min(props.pos.y, window.innerHeight - h - 8)),
    }
  },
  { immediate: true, deep: true },
)
</script>

<style scoped lang="scss">
/* z-index 必须高于 EP 弹层基线（el-drawer/el-dialog=2000+）——否则在抽屉/弹窗内
   右键时菜单被宿主弹层盖住（表现=右键无响应）。3000+ 常驻最顶层。 */
.fc-menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 3000;
}

.fc-menu {
  position: fixed;
  z-index: 3001;
  min-width: 160px;
  padding: 4px;
  background: var(--app-bg-card);
  border: 1px solid var(--app-separator);
  border-radius: var(--radius-md);
  box-shadow: var(--app-shadow-lg, 0 8px 32px rgba(0, 0, 0, 0.15));
  backdrop-filter: blur(8px);
}

.fc-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  border: none;
  background: transparent;
  color: var(--app-text-primary);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: background 0.1s;

  i {
    font-size: 16px;
    color: var(--app-text-tertiary);
  }

  &:hover:not(:disabled) {
    background: var(--app-bg-page);
    i {
      color: var(--app-primary);
    }
  }

  &.disabled,
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  &.danger {
    color: var(--app-color-danger, #ff3b30);
    i {
      color: var(--app-color-danger, #ff3b30);
    }
    &:hover:not(:disabled) {
      background: color-mix(in srgb, var(--app-color-danger, #ff3b30) 8%, transparent);
    }
  }
}
</style>
