/**
 * useMmagixFilesClient —— mmagix-files 宿主侧接入封装（裸 window.postMessage，零 npm SDK 依赖）
 *
 * 协议正本（只读参照，本文件常量/形状逐字段镜像，改协议须两处同步）：
 *   - frontend/src/sdk/types.ts      Envelope / WorkspaceConfig / SingleFileConfig / 全部 payload
 *   - frontend/src/sdk/constants.ts  NS / PROTOCOL_VERSION / CONFIG_VERSION / DEFAULT_TIMEOUT_MS
 *   - frontend/src/sdk/bus.ts        握手与 reply-by-id、origin 白名单静默丢弃、targetOrigin 禁 '*'
 *   - frontend/src/sdk/config.ts     #config/#file fragment 解析（encodeURIComponent，禁 URLSearchParams）
 *   - documents/JSSDK 接口文档.md    命令/事件/错误码语义（§三/§五/§六/§七）
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ 头号坑（本仓库 e2e 与手册反复强调）：#config 的 security.allowedOrigins
 *    必须包含【宿主自身 origin】（= 本 demo 页面的 window.location.origin，
 *    如 http://localhost:5200）。iframe 侧 bus 收消息按
 *    「event.origin ∈ security.allowedOrigins」白名单校验，不在表内 → 静默丢弃
 *    （等价 5001 ORIGIN_REJECTED：不回包、无报错）。
 *    症状极具迷惑性：宿主能收到 iframe 的 ready（那个方向只看 targetOrigin），
 *    而宿主发出的每一条 cmd 都石沉大海，最终全部 4004 超时。
 *    mount() 已自动把 window.location.origin 追加进白名单——宿主业务侧无需手填，
 *    但请理解这条规则：换域名部署时也无需改代码，自动追加的永远是自己。
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 其他要点：
 *  - 配置只走 URL fragment（#config= / #file= + encodeURIComponent），禁 query：
 *    fragment 不到服务端/代理日志；且解析端用 decodeURIComponent 还原——不可用
 *    URLSearchParams（会把 '+' 解成空格，破坏 JSON 里的字面 '+'）。本文件拼链接时
 *    只用 encodeURIComponent，天然规避该陷阱。
 *  - 发送 targetOrigin 一律取 iframe 的精确 origin，禁 '*'（协议 §一双向强制）。
 *  - 握手：iframe boot 完成即发 evt ready；宿主等 ready（默认 10s 超时）后才能发 cmd。
 */
import { onBeforeUnmount, ref, shallowRef } from "vue";

// ── 协议常量（镜像 frontend/src/sdk/constants.ts）──
export const NS = "mmagix-files" as const;
export const PROTOCOL_VERSION = 1 as const;
export const CONFIG_VERSION = 1 as const;
export const DEFAULT_TIMEOUT_MS = 10_000;

/** iframe（mmagix-files SPA）缺省地址：本仓 frontend/ 以 5199 端口起 dev（同 e2e 口径） */
export const DEFAULT_FILES_BASE = "http://localhost:5199/";

// ── 配置类型（镜像 frontend/src/sdk/types.ts 的宿主关心的子集）──
export interface MmxCredentials {
  accessKeyId: string;
  accessKeySecret: string;
  sessionToken: string;
}

export interface MmxBackendConfig {
  endpoint: string;
  region: string;
  bucket: string;
  /** 会话目录域（文件树从此起）；''=bucket 根 */
  prefix: string;
  credentials: MmxCredentials;
  /** 前端自毁定时器（秒），须 ≤ STS 真实 TTL */
  ttlSeconds?: number;
}

export interface MmxWorkspaceConfig {
  mode: "workspace";
  v: number;
  backend: MmxBackendConfig;
  security: { allowedOrigins: string[] };
  params?: { uploadMaxBytes?: number; uploadConcurrency?: number };
  appearance?: {
    theme?: "light" | "dark" | "auto";
    locale?: "zh-CN" | "en-US";
    brand?: { name?: string; logoUrl?: string; primaryColor?: string };
  };
  /** 功能开关；缺省=全集开启。键集见 README「#config 字段表」 */
  features?: Record<string, boolean>;
  permissions?: { denyExts?: string[] };
  /** 动态插件（JSSDK 契约同 sdk/types PluginEntry）：url + 可选 sha384 SRI + lazy + options（透传 activate 第二参） */
  plugins?: Array<{ url: string; sri?: string; lazy?: boolean; options?: Record<string, unknown> }>;
  ui?: {
    initialPath?: string;
    defaultOpen?: string;
    /** 文件树形态：sidebar=常驻侧栏（默认）/ drawer=左抽屉（预览区左上角图标唤起） */
    treeMode?: "sidebar" | "drawer";
    /** 文件树标题覆写（缺省=前缀末段；根=「根目录」） */
    treeTitle?: string;
  };
}

export interface MmxSingleFileConfig {
  mode: "file";
  v: number;
  source: {
    url: string;
    method?: "GET" | "POST";
    body?: string;
    headers?: Record<string, string>;
  };
  /** 只读=无 save 段；可写=有 save 段（按 method 回写源 URL） */
  save?: { method: "PUT" | "POST"; url: string; headers?: Record<string, string> };
  name?: string;
  appearance?: { theme?: "light" | "dark" | "auto"; locale?: "zh-CN" | "en-US" };
  security?: { allowedOrigins: string[] };
  /** v1.2：单文件模式插件（内存文件独立区的应用命中来源） */
  plugins?: Array<{ url: string; sri?: string; lazy?: boolean; options?: Record<string, unknown> }>;
}

export type MmxAppConfig = MmxWorkspaceConfig | MmxSingleFileConfig;

/** evt ready 载荷（§六） */
export interface MmxReadyPayload {
  sdkVersion: string;
  protocolVersion: number;
  configSummary: Record<string, unknown>;
}

/** 失败形态：reply ok=false 的 code（§七）或本地超时 4004/队列 4303/终态 5000 */
export class MmxError extends Error {
  code: number;
  detail?: unknown;
  constructor(code: number, message: string, detail?: unknown) {
    super(message);
    this.name = "MmxError";
    this.code = code;
    this.detail = detail;
  }
}

// ── fragment 链接构造 ──

/** 规整 base：保证以 / 结尾（SPA 路由基线），缺省 http://localhost:5199/ */
export function normalizeBase(baseUrl: string = DEFAULT_FILES_BASE): string {
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

/** iframe 的精确 origin（发送 targetOrigin / 接收 event.origin 校验都用它） */
export function originOf(baseUrl: string): string {
  return new URL(normalizeBase(baseUrl)).origin;
}

/**
 * 工作台模式链接：`${base}#config=${encodeURIComponent(JSON.stringify(config))}`。
 * 禁 query（?config=…）——fragment 不到服务端/代理日志；解析端 decodeURIComponent 还原。
 */
export function buildConfigUrl(baseUrl: string, config: MmxWorkspaceConfig): string {
  return `${normalizeBase(baseUrl)}#config=${encodeURIComponent(JSON.stringify(config))}`;
}

/** 单文件模式链接：`${base}#file=…`（与 #config 互斥，二选一） */
export function buildFileUrl(baseUrl: string, config: MmxSingleFileConfig): string {
  return `${normalizeBase(baseUrl)}#file=${encodeURIComponent(JSON.stringify(config))}`;
}

/**
 * ⚠️ 自动把宿主自身 origin 追加进 security.allowedOrigins（去重、保序）。
 * 不加的后果见文件头「头号坑」：宿主→iframe 方向全被静默丢弃，命令全部 4004 超时。
 * workspace 模式必填 allowedOrigins；file 模式可选（缺省 iframe 侧从 document.referrer
 * 推导）——但显式写上更稳（某些 referrer 策略下 referrer 可能为空）。
 */
export function withHostOrigin<C extends MmxAppConfig>(config: C): C {
  const host = window.location.origin;
  if (config.mode === "workspace") {
    const list = config.security.allowedOrigins;
    if (!list.includes(host)) config.security.allowedOrigins = [...list, host];
  } else {
    const list = config.security?.allowedOrigins ?? [];
    if (!list.includes(host)) {
      config.security = { allowedOrigins: [...list, host] };
    }
  }
  return config;
}

// ── 信封与工具 ─—

interface Envelope {
  ns: typeof NS;
  v: number;
  kind: "cmd" | "evt" | "reply";
  id: string;
  name: string;
  payload: unknown;
  ok?: boolean;
  code?: number;
}

let seq = 0;
function uuid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  seq += 1;
  return `${Date.now().toString(36)}-${seq}-${Math.random().toString(36).slice(2, 10)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ───────────────────────── 协议层：createMmagixFilesHost ─────────────────────────

export type MmxEventHandler = (payload: unknown) => void;
export type MmxEventName =
  | "ready" | "pathChanged" | "fileOpened" | "tabClosed"
  | "selectionChanged" | "selectionConfirmed"
  | "uploadProgress" | "uploadDone" | "uploadFailed"
  | "downloadDone" | "downloadFailed"
  | "fileChanged" | "expired" | "error"
  | "previewFullscreen";

export interface MmagixFilesHostOptions {
  /** 已存在的 <iframe> 元素（src 由本工厂写入） */
  iframe: HTMLIFrameElement;
  /** SPA 基址（缺省 http://localhost:5199/）；决定 iframe origin 与 targetOrigin */
  baseUrl?: string;
  /** 工作台或单文件配置（会原地注入宿主 origin 到 security.allowedOrigins） */
  config: MmxAppConfig;
  /** 命令超时（缺省 10s，与 iframe 侧 DEFAULT_TIMEOUT_MS 同口径） */
  timeoutMs?: number;
  /** 每条协议事件都会回调（含 ready；用于日志面板） */
  onEvent?: (name: MmxEventName, payload: unknown) => void;
  /** 非致命诊断（origin 不符的入站消息等） */
  onLog?: (text: string, ok: boolean) => void;
}

export interface MmagixFilesHost {
  /** 实际装载的 iframe src（#config/#file fragment 全文） */
  readonly url: string;
  /** iframe 精确 origin（= 收包 event.origin 白名单 + 发包 targetOrigin） */
  readonly iframeOrigin: string;
  /** ready 握手 Promise（10s 超时 reject MmxError(4004)） */
  readonly ready: Promise<MmxReadyPayload>;
  /** 是否已握手（ready 已到） */
  readonly isReady: () => boolean;
  /** 是否已终态（expired 已到 / destroy 完成） */
  readonly isDestroyed: () => boolean;
  /** 发命令并等 reply（按 id 匹配；ok=false reject MmxError(code)） */
  call<T = unknown>(name: string, payload?: unknown, timeoutMs?: number): Promise<T>;
  /** 订阅事件（与 onEvent 日志回调互不影响），返回解绑函数 */
  on(name: MmxEventName, handler: MmxEventHandler): () => void;
  /** 发 destroy 命令并拆除监听（幂等） */
  destroy(): Promise<void>;
}

/**
 * 裸 postMessage 宿主端实现：
 *  1. withHostOrigin 注入宿主 origin → buildConfigUrl/buildFileUrl 拼 fragment → 写 iframe.src
 *  2. window.addEventListener('message')，只认 ns=mmagix-files 且 event.origin===iframe origin
 *  3. 等 evt ready（10s 超时）；reply 按 cmd id 匹配；事件派发给订阅者 + onEvent 总回调
 */
export function createMmagixFilesHost(options: MmagixFilesHostOptions): MmagixFilesHost {
  const { iframe, onEvent, onLog } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const baseUrl = options.baseUrl ?? DEFAULT_FILES_BASE;
  const iframeOrigin = originOf(baseUrl);
  const config = withHostOrigin(options.config);
  const url =
    config.mode === "workspace"
      ? buildConfigUrl(baseUrl, config)
      : buildFileUrl(baseUrl, config);

  const handlers = new Map<MmxEventName, Set<MmxEventHandler>>();
  const pending = new Map<
    string,
    { resolve(v: unknown): void; reject(e: MmxError): void; timer: ReturnType<typeof setTimeout> }
  >();
  let readyResolve: ((p: MmxReadyPayload) => void) | null = null;
  let readyReject: ((e: MmxError) => void) | null = null;
  let readyFlag = false;
  let destroyed = false;

  const ready = new Promise<MmxReadyPayload>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
    setTimeout(() => {
      if (!readyFlag && !destroyed) {
        reject(
          new MmxError(
            4004,
            `等待 ready 超时（${timeoutMs}ms）——若连 ready 都收不到，检查 baseUrl 是否正确、` +
              `iframe 页是否启动；若 ready 收到但命令全超时，才是 allowedOrigins 白名单问题`,
          ),
        );
      }
    }, timeoutMs);
  });

  function dispatch(name: MmxEventName, payload: unknown): void {
    onEvent?.(name, payload);
    const set = handlers.get(name);
    if (!set) return;
    for (const h of [...set]) {
      try {
        h(payload);
      } catch (err) {
        console.error(`[mmx] 事件 ${name} 处理器异常`, err);
      }
    }
  }

  function teardown(): void {
    if (destroyed) return;
    destroyed = true;
    window.removeEventListener("message", onMessage);
    const err = new MmxError(5000, "会话已销毁");
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    pending.clear();
    handlers.clear();
  }

  const onMessage = (e: MessageEvent): void => {
    // 双闸之一：来源必须是 iframe 的精确 origin（协议 §一；targetOrigin 对偶校验在发送侧）
    if (e.origin !== iframeOrigin) {
      onLog?.(`忽略来自 ${e.origin} 的非 iframe 消息`, true);
      return;
    }
    const data = e.data as Partial<Envelope> | null;
    if (typeof data !== "object" || data === null) return;
    if (data.ns !== NS || data.v !== PROTOCOL_VERSION) return; // 非本命名空间一律忽略
    if (data.kind === "reply") {
      const entry = pending.get(data.id as string);
      if (!entry) return; // 迟到/未知 id 的 reply，忽略
      pending.delete(data.id as string);
      clearTimeout(entry.timer);
      if (data.ok) entry.resolve(data.payload);
      else {
        const code = typeof data.code === "number" ? data.code : 5000;
        entry.reject(new MmxError(code, `命令 ${data.name} 失败（code=${code}）`, data.payload));
      }
      return;
    }
    if (data.kind === "evt") {
      const name = data.name as MmxEventName;
      if (name === "ready") {
        readyFlag = true;
      }
      if (name === "expired") {
        // 终态（§三）：ttl 到点或 destroy 完成——之后零消息，拆除监听
        dispatch(name, data.payload);
        teardown();
        return;
      }
      dispatch(name, data.payload);
      if (name === "ready") readyResolve?.(data.payload as MmxReadyPayload);
    }
  };

  // 发送 targetOrigin 一律为 iframe 精确 origin，禁 '*'（协议 §一）
  iframe.src = url;
  window.addEventListener("message", onMessage);

  const host: MmagixFilesHost = {
    url,
    iframeOrigin,
    ready,
    isReady: () => readyFlag,
    isDestroyed: () => destroyed,

    call<T = unknown>(name: string, payload?: unknown, perCallTimeout?: number): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        if (destroyed) {
          reject(new MmxError(5000, "会话已销毁，命令拒绝"));
          return;
        }
        if (!readyFlag) {
          // iframe 侧对 ready 前命令有 50 条队列，但宿主侧直接拒绝更直观（§三 4303 同码）
          reject(new MmxError(4303, "尚未握手（未收到 ready），命令拒绝"));
          return;
        }
        const win = iframe.contentWindow;
        if (!win) {
          reject(new MmxError(4005, "iframe.contentWindow 不可用"));
          return;
        }
        const id = uuid();
        const env: Envelope = {
          ns: NS,
          v: PROTOCOL_VERSION,
          kind: "cmd",
          id,
          name,
          payload: payload ?? {},
        };
        const timer = setTimeout(() => {
          if (pending.delete(id)) {
            reject(
              new MmxError(
                4004,
                `命令 ${name} 超时（${perCallTimeout ?? timeoutMs}ms）——` +
                  `若所有命令都超时，优先检查 #config 的 security.allowedOrigins 是否含宿主 origin`,
              ),
            );
          }
        }, perCallTimeout ?? timeoutMs);
        pending.set(id, {
          resolve: resolve as (v: unknown) => void,
          reject,
          timer,
        });
        win.postMessage(env, iframeOrigin);
      });
    },

    on(name, handler) {
      let set = handlers.get(name);
      if (!set) {
        set = new Set();
        handlers.set(name, set);
      }
      set.add(handler);
      return () => {
        const s = handlers.get(name);
        if (!s) return;
        s.delete(handler);
        if (s.size === 0) handlers.delete(name);
      };
    },

    async destroy(): Promise<void> {
      if (destroyed) return;
      try {
        // §三：先 reply(ack) 后 evt expired——ack 后稍候一拍，让 expired 落进日志再拆
        await host.call("destroy", {}, 3_000);
        await sleep(150);
      } catch {
        // 已终态/超时都视为结束；仍要拆监听
      }
      teardown();
    },
  };

  return host;
}

// ───────────────────────── Vue 层：useMmagixFilesClient ─────────────────────────

export type EmbedStatus = "idle" | "mounting" | "ready" | "error";

export interface LogEntry {
  time: string;
  text: string;
  ok: boolean;
}

/** 日志上限（同 opencut-embed-demo 形态） */
const LOG_LIMIT = 200;
/** uploadProgress 日志节流间隔：每 500ms 至多一条，防刷屏 */
const PROGRESS_LOG_INTERVAL_MS = 500;
/** 日志里 payload 摘要截断长度 */
const PAYLOAD_PREVIEW_LEN = 160;

/**
 * Vue 封装：状态机 idle/mounting/ready/error + 日志面板 + 演示动作。
 * EmbedPlay（工作台）/FilePlay（单文件）共用；组件卸载自动 destroy。
 */
export function useMmagixFilesClient() {
  const iframeRef = ref<HTMLIFrameElement | null>(null);
  const status = ref<EmbedStatus>("idle");
  const errorText = ref("");
  const logs = ref<LogEntry[]>([]);
  const readyInfo = shallowRef<MmxReadyPayload | null>(null);
  let host: MmagixFilesHost | null = null;
  let lastProgressLogAt = 0;

  function log(text: string, ok = true): void {
    logs.value.push({ time: new Date().toLocaleTimeString(), text, ok });
    if (logs.value.length > LOG_LIMIT) {
      logs.value.splice(0, logs.value.length - LOG_LIMIT);
    }
  }

  /** payload 摘要：截断过深对象，保日志可读 */
  function preview(payload: unknown): string {
    let text: string;
    try {
      text = JSON.stringify(payload) ?? "";
    } catch {
      text = String(payload);
    }
    return text.length > PAYLOAD_PREVIEW_LEN ? `${text.slice(0, PAYLOAD_PREVIEW_LEN)}…` : text;
  }

  /** 事件总回调：全部 14 事件到达即记录；uploadProgress 500ms 节流 */
  function handleEvent(name: MmxEventName, payload: unknown): void {
    if (name === "uploadProgress") {
      const now = Date.now();
      if (now - lastProgressLogAt < PROGRESS_LOG_INTERVAL_MS) return;
      lastProgressLogAt = now;
      log(`evt uploadProgress（节流500ms）${preview(payload)}`);
      return;
    }
    log(`evt ${name} ${preview(payload)}`);
  }

  /**
   * 装载 iframe 并等待 ready 握手。
   * @param config 工作台/单文件配置（自动注入宿主 origin 到 allowedOrigins）
   * @param baseUrl SPA 基址（缺省 http://localhost:5199/）
   */
  async function mount(config: MmxAppConfig, baseUrl?: string): Promise<MmxReadyPayload> {
    if (!iframeRef.value) throw new Error("iframe 元素未就绪");
    if (host) {
      await host.destroy(); // 重装前先拆旧会话
      host = null;
      // ⚠️ 重装坑：新旧 src 若逐字节相同（仅 fragment、配置未变），对 iframe 写 src 不触发
      // 导航——旧文档原地不动、永不发新 ready，mount 必 4004 超时。先归位 about:blank 强制
      // 下一次 src 写入成为真实跨文档导航（等一拍让归位导航先提交）。
      iframeRef.value.src = "about:blank";
      await sleep(150);
    }
    status.value = "mounting";
    errorText.value = "";
    log(`mounting iframe → ${originOf(baseUrl ?? DEFAULT_FILES_BASE)} …`);
    try {
      const h = createMmagixFilesHost({
        iframe: iframeRef.value,
        config,
        baseUrl,
        onEvent: handleEvent,
        onLog: (t, ok) => log(t, ok),
      });
      host = h;
      log(`iframe.src = ${h.url.length > 120 ? `${h.url.slice(0, 120)}…` : h.url}`);
      const info = await h.ready;
      readyInfo.value = info;
      status.value = "ready";
      log(`ready ✓ sdk=${info.sdkVersion} protocol=v${info.protocolVersion}`);
      return info;
    } catch (err) {
      status.value = "error";
      errorText.value = err instanceof Error ? err.message : String(err);
      log(`mount failed: ${errorText.value}`, false);
      throw err;
    }
  }

  /** 动作统一包装：结果/失败进日志，失败抛 MmxError 供调用方提示 */
  async function run<T>(name: string, fn: () => Promise<T>): Promise<T> {
    try {
      const result = await fn();
      log(`${name} ✓ ${result === undefined || result === null ? "" : preview(result)}`);
      return result;
    } catch (err) {
      const code = err instanceof MmxError ? `（code=${err.code}）` : "";
      const msg = err instanceof Error ? err.message : String(err);
      log(`${name} ✗${code} ${msg}`, false);
      throw err;
    }
  }

  function requireHost(): MmagixFilesHost {
    if (!host) throw new MmxError(4005, "尚未装载 iframe");
    return host;
  }

  /** 便捷：发命令（未装载/未握手直接失败并记日志） */
  function call<T = unknown>(name: string, payload?: unknown, timeoutMs?: number): Promise<T> {
    return run(name, () => requireHost().call<T>(name, payload, timeoutMs));
  }

  /** 订阅 iframe 事件（与日志并行的业务订阅位） */
  function on(name: MmxEventName, handler: MmxEventHandler): () => void {
    return host?.on(name, handler) ?? (() => {});
  }

  /** 会话销毁：发 destroy 命令、拆监听、状态回 idle */
  async function destroy(): Promise<void> {
    if (!host) return;
    const h = host;
    host = null;
    readyInfo.value = null;
    await h.destroy();
    status.value = "idle";
    log("destroy ✓ 监听已拆除，状态回 idle");
  }

  onBeforeUnmount(() => {
    void host?.destroy();
    host = null;
  });

  return {
    iframeRef,
    status,
    errorText,
    logs,
    readyInfo,
    log,
    mount,
    run,
    call,
    on,
    destroy,
    /** 当前是否可发命令（ready 后可用） */
    isReady: () => host?.isReady() === true,
    /** 当前宿主句柄（高级用法） */
    getHost: () => host,
  };
}
