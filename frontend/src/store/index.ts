import { createPinia } from 'pinia'

const pinia = createPinia()

export default pinia

// 导出所有 store
export * from './oem'
export * from './app'
export * from './preference'
