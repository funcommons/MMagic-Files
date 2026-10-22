import { ElMessage, ElMessageBox, ElNotification, type MessageOptions } from 'element-plus'
import i18n from '@/locales'

/**
 * FcToast — 业务侧统一 toast 入口 (#21 长任务进度 + #22 复制反馈).
 *
 * 用法:
 *   toast.success('保存成功')
 *   toast.error('保存失败')
 *   toast.warning('请注意...')
 *   toast.info('提示')
 *   await toast.promise(
 *     fetchData(),
 *     { loading: '加载中', success: '加载成功', error: '加载失败' },
 *   )
 *   await toast.confirm({ title, message, type: 'warning' })
 */

const t = (k: string) => i18n.global.t(k)

export const toast = {
  success(message: string, options?: MessageOptions) {
    ElMessage.success({ message, ...options })
  },
  error(message: string, options?: MessageOptions) {
    ElMessage.error({ message, ...options })
  },
  warning(message: string, options?: MessageOptions) {
    ElMessage.warning({ message, ...options })
  },
  info(message: string, options?: MessageOptions) {
    ElMessage.info({ message, ...options })
  },

  /**
   * Promise 包装: 自动显示 loading → success/error, 出错时返回原 promise reject.
   *
   * @example
   *   await toast.promise(
   *     saveItem(),
   *     { loading: t('ux.toast.saving'), success: t('ux.toast.saved'), error: t('ux.toast.save-failed') },
   *   )
   */
  async promise<T>(
    promise: Promise<T>,
    messages: { loading: string; success: string; error: string | ((e: unknown) => string) },
  ): Promise<T> {
    const loadingMsg = ElMessage({
      message: messages.loading,
      type: 'info',
      duration: 0,
      showClose: false,
    })
    try {
      const r = await promise
      loadingMsg.close()
      ElMessage.success(messages.success)
      return r
    } catch (e) {
      loadingMsg.close()
      const msg = typeof messages.error === 'function' ? messages.error(e) : messages.error
      ElMessage.error(msg)
      throw e
    }
  },

  /** 二次确认, 默认 type=warning. cancel 抛 reject. */
  async confirm(opts: {
    title?: string
    message: string
    type?: 'warning' | 'info' | 'success' | 'error'
    confirmText?: string
    cancelText?: string
  }): Promise<void> {
    await ElMessageBox.confirm(opts.message, opts.title ?? t('common.confirm'), {
      type: opts.type ?? 'warning',
      confirmButtonText: opts.confirmText ?? t('common.confirm'),
      cancelButtonText: opts.cancelText ?? t('common.cancel'),
    })
  },

  /** 右上角长通知 (10s, 重要业务事件). */
  notify(opts: { title: string; message: string; type?: 'success' | 'error' | 'warning' | 'info' }) {
    ElNotification({
      title: opts.title,
      message: opts.message,
      type: opts.type ?? 'info',
      position: 'top-right',
      duration: 10000,
      offset: 16,
    })
  },
}

export default toast