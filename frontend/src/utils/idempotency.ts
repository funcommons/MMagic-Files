import { ref, type Ref } from 'vue'
import { ApiError, ApiErrorCode } from '@/api/errorCodes'

/**
 * 幂等提交守卫 (按钮级 #5 重复提交防护).
 *
 * 用法:
 *   const submit = useIdempotentSubmit(async (payload) => {
 *     return await createBenefitItem(payload)
 *   })
 *
 *   <el-button :loading="submit.loading" :disabled="submit.loading" @click="submit(form)">
 *
 * 行为:
 *   1. submit() 第一次调用立即执行 fn, 同时 lock = true
 *   2. lock 期间再次调用 submit() 直接 reject 一个 DUPLICATE_SUBMISSION ApiError
 *   3. fn 完成后 (success/error) 自动 unlock
 *   4. 调用方可订阅 submit.loading 控制按钮 loading 锁
 */

export interface IdempotentSubmitResult<TArgs extends unknown[], TResult> {
  (...args: TArgs): Promise<TResult>
  readonly loading: Ref<boolean>
  /** 手动 reset, 比如 fn 抛非业务错且希望恢复可点 */
  reset(): void
}

export function useIdempotentSubmit<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
): IdempotentSubmitResult<TArgs, TResult> {
  const loading = ref(false)
  let locked = false

  const submit = async (...args: TArgs): Promise<TResult> => {
    if (locked) {
      throw new ApiError(
        ApiErrorCode.DUPLICATE_SUBMISSION,
        '请勿重复提交',
        { silent: false },
      )
    }
    locked = true
    loading.value = true
    try {
      return await fn(...args)
    } finally {
      locked = false
      loading.value = false
    }
  }

  const reset = () => {
    locked = false
    loading.value = false
  }

  Object.defineProperty(submit, 'loading', { get: () => loading })
  submit.reset = reset
  return submit as IdempotentSubmitResult<TArgs, TResult>
}