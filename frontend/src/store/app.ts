import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useAppStore = defineStore('app', () => {
  // sidebarCollapsed 由 preference.ts 持有 (持久化 + AppLayout 直接读写),
  // 不在本 store 重复维护.
  const sidebarDrawerVisible = ref(false)
  const loading = ref(false)
  const globalLoading = ref(false)

  function toggleSidebar() {
    sidebarDrawerVisible.value = !sidebarDrawerVisible.value
  }

  function openDrawer() {
    sidebarDrawerVisible.value = true
  }

  function closeDrawer() {
    sidebarDrawerVisible.value = false
  }

  function setLoading(value: boolean) {
    loading.value = value
  }

  function setGlobalLoading(value: boolean) {
    globalLoading.value = value
  }

  return {
    sidebarDrawerVisible,
    loading,
    globalLoading,
    toggleSidebar,
    openDrawer,
    closeDrawer,
    setLoading,
    setGlobalLoading
  }
})
