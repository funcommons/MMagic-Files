/**
 * E2E 公共工具：console 捕获、截图、宿主 harness 交互、种子数据。
 * 证据目录：REPO/test-report/2026-10-09-01/screenshots（报告以 ./screenshots/x.png 相对引用）。
 */
import fs from 'node:fs'
import type { FrameLocator, Page } from '@playwright/test'
import { expect } from '@playwright/test'

export const REPORT_DIR = '/Users/justin/codes/funcommons/MMagic-Files/test-report/2026-10-09-01'
export const SHOT_DIR = `${REPORT_DIR}/screenshots`

fs.mkdirSync(SHOT_DIR, { recursive: true })
fs.mkdirSync(`${REPORT_DIR}/artifacts`, { recursive: true })

// ───────────────────────── console / pageerror 捕获 ─────────────────────────

export interface ConsoleCapture {
  errors: string[]
  warnings: string[]
  pageErrors: string[]
  all: string[]
}

export function attachConsole(page: Page): ConsoleCapture {
  const cap: ConsoleCapture = { errors: [], warnings: [], pageErrors: [], all: [] }
  page.on('console', (m) => {
    const line = `[console.${m.type()}] ${m.text()}`
    cap.all.push(line)
    if (m.type() === 'error') cap.errors.push(line)
    else if (m.type() === 'warning') cap.warnings.push(line)
  })
  page.on('pageerror', (err) => {
    const line = `[pageerror] ${err.message}`
    cap.pageErrors.push(line)
    cap.all.push(line)
  })
  return cap
}

/** 报告用 console 证据文本（无错误时给明确说明） */
export function consoleEvidence(cap: ConsoleCapture): string {
  const parts: string[] = []
  if (cap.errors.length > 0) parts.push(...cap.errors)
  if (cap.pageErrors.length > 0) parts.push(...cap.pageErrors)
  if (parts.length === 0) return '（无 console.error / pageerror）'
  return parts.join('\n')
}

// ───────────────────────── 截图 ─────────────────────────

/** 全页截图到证据目录，返回相对报告的引用路径 */
export async function shot(page: Page, name: string, fullPage = true): Promise<string> {
  const file = `${SHOT_DIR}/${name}`
  await page.screenshot({ path: file, fullPage })
  return `./screenshots/${name}`
}

// ───────────────────────── 宿主 harness 交互 ─────────────────────────

export interface MmfEvent {
  kind: 'evt'
  name: string
  payload: unknown
}

export interface MmfReply {
  ok: boolean
  code?: number
  name: string
  payload: unknown
  timeout?: boolean
}

export async function getEvents(page: Page): Promise<MmfEvent[]> {
  return page.evaluate(() => (window as unknown as { __mmfEvents: MmfEvent[] }).__mmfEvents)
}

export async function findEvent(page: Page, name: string, timeoutMs = 15000): Promise<MmfEvent> {
  await page.waitForFunction(
    ({ n }) => (window as unknown as { __mmfEvents: { kind: string; name: string }[] }).__mmfEvents.some((e) => e.kind === 'evt' && e.name === n),
    { n: name },
    { timeout: timeoutMs },
  )
  const events = await getEvents(page)
  return events.filter((e) => e.kind === 'evt' && e.name === name).at(-1)!
}

export async function sendCommand(page: Page, name: string, payload?: unknown, timeoutMs = 12000): Promise<MmfReply> {
  return page.evaluate(
    ({ n, p, t }) =>
      (window as unknown as { __mmfSend: (n: string, p: unknown, t?: number) => Promise<MmfReply> }).__mmfSend(n, p, t),
    { n: name, p: payload, t: timeoutMs },
  ) as Promise<MmfReply>
}

// ───────────────────────── 工作台通用操作 ─────────────────────────

/** 等待文件树完成首轮加载（行渲染或空态出现） */
export async function waitTreeLoaded(page: Page): Promise<void> {
  await expect(page.locator('.ws')).toBeVisible()
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const rows = document.querySelectorAll('[data-testid="row"]').length
          const empty = document.querySelectorAll('.fc-empty, [class*="empty"]').length
          const skeleton = document.querySelectorAll('[class*="skeleton" i]').length
          return rows > 0 || (empty > 0 && skeleton === 0) ? 'ready' : 'loading'
        }),
      { timeout: 20000 },
    )
    .toBe('ready')
}

/** 点击行（按文件/目录名）——Lane F5 交互模型：单击=仅选中 */
export async function clickRow(page: Page, name: string): Promise<void> {
  await page.locator(`[data-testid="row"]`, { hasText: name }).first().click()
}

/** 双击行打开预览（Lane F5 交互模型：双击/回车=打开；单击不再自动开预览） */
export async function openRow(page: Page, name: string): Promise<void> {
  await page.locator(`[data-testid="row"]`, { hasText: name }).first().dblclick()
}

/** 进入目录（点目录名按钮，触发 loadDir） */
export async function enterDir(page: Page, name: string): Promise<void> {
  await page.locator(`[data-testid="dir-name"]`, { hasText: name }).first().click()
}

/** ElMessageBox prompt/confirm 的确认按钮（对话框挂在应用文档树内——顶层页或 iframe 二选一） */
export async function confirmMessageBox(root: Page | FrameLocator, inputValue?: string): Promise<void> {
  const box = root.locator('.el-message-box')
  await expect(box).toBeVisible()
  if (inputValue !== undefined) {
    await box.locator('.el-message-box__input input').fill(inputValue)
  }
  await box.locator('.el-message-box__btns button.el-button--primary').click()
  await expect(box).toBeHidden()
}

/** 工具栏按钮（按文案；root 可为 Page 或 FrameLocator） */
export function toolbarButton(root: Page | FrameLocator, text: string) {
  return root.locator('.ws-toolbar button', { hasText: text }).first()
}
