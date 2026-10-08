import { ImageSize } from '@/utils'

declare module 'vue' {
  interface ComponentCustomProperties {
    /**
     * 图片URL转换函数
     * @param url - 图片地址
     * @param size - 尺寸：tiny | small | medium | large | xlarge
     */
    $img: (url: string | null | undefined, size?: ImageSize) => string
  }
}

export {}