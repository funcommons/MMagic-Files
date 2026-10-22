/**
 * media-type.ts 单测（插件纯逻辑：扩展名 → 媒体形态映射）
 * 被测：plugins/artplayer-player/src/media-type.ts（VIDEO_EXTS / AUDIO_EXTS / extOf / mediaKindOf）
 * 契约：白名单对齐内置 video-player/audio-player 两张 matcher 表（builtins.ts），不扩口——
 *   video: mp4/webm/mov；audio: mp3/wav/ogg/flac/m4a；白名单外 → null（matcher 已挡, 此处防御纵深）。
 *   extOf：lastIndexOf('.') 取最后一段、toLowerCase、无点 → ''；实现口径：'.md'（点在 0 位）→ 'md'
 *   （按 lastIndexOf 实际行为断言, 不做「隐藏文件无扩展名」的宽松化）。
 */
import { describe, expect, it } from 'vitest'
import { AUDIO_EXTS, VIDEO_EXTS, extOf, mediaKindOf } from '../media-type'

// ───────────────────────── 白名单常量 ─────────────────────────

describe('白名单常量', () => {
  it('VIDEO_EXTS = mp4/webm/mov（小写、无点）', () => {
    expect(VIDEO_EXTS).toEqual(['mp4', 'webm', 'mov'])
  })

  it('AUDIO_EXTS = mp3/wav/ogg/flac/m4a（小写、无点）', () => {
    expect(AUDIO_EXTS).toEqual(['mp3', 'wav', 'ogg', 'flac', 'm4a'])
  })
})

// ───────────────────────── extOf · 扩展名提取 ─────────────────────────

describe('extOf', () => {
  it('普通文件名 → 小写、无点的扩展名', () => {
    expect(extOf('a.mp4')).toBe('mp4')
    expect(extOf('demo.webm')).toBe('webm')
    expect(extOf('song.FLAC')).toBe('flac')
  })

  it('大小写归一：A.MP4 → mp4', () => {
    expect(extOf('A.MP4')).toBe('mp4')
    expect(extOf('Movie.MOV')).toBe('mov')
  })

  it('多个点取最后一段', () => {
    expect(extOf('a.b.txt')).toBe('txt')
    expect(extOf('my.movie.2024.MP4')).toBe('mp4')
  })

  it('无点 → 空串', () => {
    expect(extOf('noext')).toBe('')
    expect(extOf('')).toBe('')
  })

  it('边界口径（lastIndexOf 实现）：点在 0 位 → 首段；结尾点 → 空串', () => {
    expect(extOf('.md')).toBe('md') // slice(1), 非「隐藏文件无扩展名」
    expect(extOf('file.')).toBe('') // 点后无字符
  })
})

// ───────────────────────── mediaKindOf · 八扩展映射 ─────────────────────────

describe('mediaKindOf · 白名单映射', () => {
  it('视频扩展：mp4/webm/mov → video', () => {
    expect(mediaKindOf('video.mp4')).toBe('video')
    expect(mediaKindOf('video.webm')).toBe('video')
    expect(mediaKindOf('video.mov')).toBe('video')
  })

  it('音频扩展：mp3/wav/ogg/flac/m4a → audio', () => {
    expect(mediaKindOf('audio.mp3')).toBe('audio')
    expect(mediaKindOf('audio.wav')).toBe('audio')
    expect(mediaKindOf('audio.ogg')).toBe('audio')
    expect(mediaKindOf('audio.flac')).toBe('audio')
    expect(mediaKindOf('audio.m4a')).toBe('audio')
  })

  it('大小写不敏感：A.MP4 → video, SONG.MP3 → audio', () => {
    expect(mediaKindOf('A.MP4')).toBe('video')
    expect(mediaKindOf('SONG.MP3')).toBe('audio')
    expect(mediaKindOf('Clip.WebM')).toBe('video')
  })
})

// ───────────────────────── mediaKindOf · 白名单外 → null ─────────────────────────

describe('mediaKindOf · 非媒体扩展 → null（防御纵深）', () => {
  it('白名单外扩展（txt/png）→ null', () => {
    expect(mediaKindOf('readme.txt')).toBeNull()
    expect(mediaKindOf('photo.png')).toBeNull()
  })

  it('无扩展名 / 隐藏文件形态 / 空串 → null', () => {
    expect(mediaKindOf('noext')).toBeNull()
    expect(mediaKindOf('.md')).toBeNull() // extOf='md' 不在白名单
    expect(mediaKindOf('file.')).toBeNull()
    expect(mediaKindOf('')).toBeNull()
  })
})
