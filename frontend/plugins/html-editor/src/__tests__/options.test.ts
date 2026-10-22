/** options.ts 单测：参数归一化/形态解析优先级（initialMode > stored > 缺省 source；无分屏态） */
import { describe, expect, it } from 'vitest'
import { isHtmlMode, normalizeOptions, resolveInitialMode } from '../options'

describe('options', () => {
  it('isHtmlMode：仅三态（无 split——v2 裁定）', () => {
    expect(isHtmlMode('source')).toBe(true)
    expect(isHtmlMode('wysiwyg')).toBe(true)
    expect(isHtmlMode('preview')).toBe(true)
    expect(isHtmlMode('split')).toBe(false)
    expect(isHtmlMode('edit')).toBe(false)
  })
  it('normalizeOptions：非法/非对象丢弃，合法 initialMode 保留', () => {
    expect(normalizeOptions(null)).toEqual({})
    expect(normalizeOptions('x')).toEqual({})
    expect(normalizeOptions({ initialMode: 'wysiwyg', junk: 1 })).toEqual({ initialMode: 'wysiwyg' })
    expect(normalizeOptions({ initialMode: 'split' })).toEqual({})
  })
  it('resolveInitialMode：initialMode > stored > source', () => {
    expect(resolveInitialMode({ initialMode: 'preview' }, 'wysiwyg')).toBe('preview')
    expect(resolveInitialMode({}, 'wysiwyg')).toBe('wysiwyg')
    expect(resolveInitialMode({}, null)).toBe('source')
  })
})
