<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import { ElMessage } from "element-plus";
import type { UploadUserFile } from "element-plus";
import { FcButton, FcSegmented, FcSelect, FcSection } from "@/components/sdk";
import LogPanel from "@/components/LogPanel.vue";
import { OEM_CONFIG } from "@/config/oem";
import {
  buildConfigUrl,
  useMmagixFilesClient,
  CONFIG_VERSION,
  type MmxWorkspaceConfig,
} from "@/composables/useMmagixFilesClient";

const { t } = useI18n();

const {
  iframeRef,
  status,
  logs,
  mount,
  call,
  destroy,
  on,
} = useMmagixFilesClient();

// ── 浏览器内全屏（顶级文档）：iframe 发 previewFullscreen 事件，宿主把舞台容器铺满本页视口 ──
const stageFs = ref(false);
let offPreviewFs: (() => void) | null = null;
function onStageEsc(ev: KeyboardEvent) {
  if (ev.key === "Escape" && stageFs.value) stageFs.value = false;
}
onMounted(() => window.addEventListener("keydown", onStageEsc));
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onStageEsc);
  offPreviewFs?.();
});

// ── 连接表单（演示默认值全部留空；读 .env.local 的 VITE_S3_* 作为缺省） ──
const form = reactive({
  endpoint: OEM_CONFIG.s3.endpoint,
  region: OEM_CONFIG.s3.region,
  bucket: OEM_CONFIG.s3.bucket,
  accessKeyId: OEM_CONFIG.s3.accessKeyId,
  accessKeySecret: OEM_CONFIG.s3.accessKeySecret,
  sessionToken: OEM_CONFIG.s3.sessionToken,
  prefix: OEM_CONFIG.s3.prefix,
  ttl: 3600,
  theme: "light" as "light" | "dark",
  locale: "zh-CN" as "zh-CN" | "en-US",
  initialPath: "",
  /** 文件树形态：sidebar=常驻侧栏（默认）/ drawer=左抽屉（预览区左上角图标唤起） */
  treeMode: "sidebar" as "sidebar" | "drawer",
  /** 文件树标题覆写（ui.treeTitle；空=缺省「根目录」/前缀末段） */
  treeTitle: "",
  /** 勾选=关闭该功能（features[key]=false）；不勾=缺省全开 */
  disabledFeatures: [] as string[],
  /** Univer 文档插件（xlsx/xls/docx 编辑）：注入 plugins 配置，启动即载 */
  univerPlugin: true,
  /** PDF 标注签批插件（覆盖层标注/签批/签名，压平写回） */
  pdfAnnotator: true,
  /** Markdown 编辑插件（md/markdown 编辑 × mermaid × 三形态）；空串=不传该参数走缺省链 */
  mdPlugin: true,
  /** Artplayer 媒体播放器插件（视频/音频打开方式增强） */
  artplayerPlugin: true,
  /** Filerobot 图片编辑器插件（png/jpg/webp 等编辑增强） */
  filerobotPlugin: true,
  /** HTML 编辑器插件（html/htm 三态：源码/可视/预览，单体化+新 tab 代理） */
  htmlPlugin: true,
  /** PPTX 预览插件（pptx-preview 纯前端渲染，办公三件套补位） */
  pptxPlugin: true,
  mdInitialMode: "" as "" | "source" | "split" | "preview",
  mdDefaultMode: "" as "" | "source" | "split" | "preview",
});

const FEATURE_KEYS = [
  "upload",
  "mkdir",
  "rename",
  "delete",
  "download",
  "multiTab",
  "openWithMenu",
  "plugins",
] as const;

const statusLabel = computed(
  () =>
    ({
      idle: t("demo.status.idle"),
      mounting: t("demo.status.mounting"),
      ready: t("demo.status.ready"),
      error: t("demo.status.error"),
    })[status.value],
);

/** iframe（被嵌 SPA）的精确 origin */
const iframeOrigin = new URL(OEM_CONFIG.filesBase).origin;

/** 嵌入区最大化（不限高宽）：左侧控制面板可收起；协议日志默认收起（短视口下不再挤压 iframe） */
const panelOpen = ref(true);
const logOpen = ref(false);

/** 当前表单生成的 #config（凭证打码预览用） */
const configPreview = computed(() => {
  const cfg = buildWorkspaceConfig();
  const masked = {
    ...cfg,
    backend: {
      ...cfg.backend,
      credentials: {
        accessKeyId: cfg.backend.credentials.accessKeyId ? "***" : "",
        accessKeySecret: cfg.backend.credentials.accessKeySecret ? "***" : "",
        sessionToken: cfg.backend.credentials.sessionToken ? "***" : "",
      },
    },
  };
  return JSON.stringify(masked, null, 2);
});

const configUrlPreview = computed(() => buildConfigUrl(OEM_CONFIG.filesBase, buildWorkspaceConfig()));

function buildWorkspaceConfig(): MmxWorkspaceConfig {
  const cfg: MmxWorkspaceConfig = {
    mode: "workspace",
    v: CONFIG_VERSION,
    backend: {
      endpoint: form.endpoint.trim(),
      region: form.region.trim() || "us-east-1",
      bucket: form.bucket.trim(),
      prefix: form.prefix,
      credentials: {
        accessKeyId: form.accessKeyId.trim(),
        accessKeySecret: form.accessKeySecret.trim(),
        sessionToken: form.sessionToken.trim(),
      },
      ttlSeconds: form.ttl > 0 ? form.ttl : undefined,
    },
    // security.allowedOrigins 留空数组即可：mount() 内 withHostOrigin 会自动把
    // window.location.origin（本页= http://localhost:5200）追加进去——这是协议
    // 硬要求（缺=宿主方向消息被 iframe 白名单静默丢弃，命令全 4004）。
    security: { allowedOrigins: [] },
    appearance: { theme: form.theme, locale: form.locale },
  };
  if (form.disabledFeatures.length > 0) {
    const features: Record<string, boolean> = {};
    for (const key of FEATURE_KEYS) features[key] = !form.disabledFeatures.includes(key);
    cfg.features = features;
  }
  if (form.univerPlugin || form.pdfAnnotator || form.mdPlugin || form.htmlPlugin || form.pptxPlugin || form.artplayerPlugin || form.filerobotPlugin) {
    // lazy 必须 false：md/xlsx/docx/pdf/媒体都有内置默认应用，lazy 插件在打开链「未命中才触发」永远轮不到
    const base = new URL(OEM_CONFIG.filesBase).origin;
    // markdown-editor 参数（PluginEntry.options → activate(sdk, options)，v1.1）；空串=不传走缺省链
    const mdOptions: Record<string, unknown> = {
      ...(form.mdInitialMode ? { initialMode: form.mdInitialMode } : {}),
      ...(form.mdDefaultMode ? { defaultMode: form.mdDefaultMode } : {}),
    };
    cfg.plugins = [
      ...(form.univerPlugin ? [{ url: `${base}/plugins/univer-office.js`, lazy: false as const }] : []),
      ...(form.pdfAnnotator ? [{ url: `${base}/plugins/pdf-annotator.js`, lazy: false as const }] : []),
      ...(form.mdPlugin
        ? [{ url: `${base}/plugins/markdown-editor.js`, lazy: false as const, ...(Object.keys(mdOptions).length ? { options: mdOptions } : {}) }]
        : []),
      ...(form.artplayerPlugin ? [{ url: `${base}/plugins/artplayer-player.js`, lazy: false as const }] : []),
      ...(form.htmlPlugin ? [{ url: `${base}/plugins/html-editor.js`, lazy: false as const }] : []),
      ...(form.pptxPlugin ? [{ url: `${base}/plugins/pptx-viewer.js`, lazy: false as const }] : []),
      ...(form.filerobotPlugin ? [{ url: `${base}/plugins/filerobot-image-editor.js`, lazy: false as const }] : []),
    ];
  }
  if (form.initialPath.trim() || form.treeMode !== "sidebar" || form.treeTitle.trim()) {
    cfg.ui = {
      treeMode: form.treeMode,
      ...(form.initialPath.trim() ? { initialPath: form.initialPath.trim() } : {}),
      ...(form.treeTitle.trim() ? { treeTitle: form.treeTitle.trim() } : {}),
    };
  }
  return cfg;
}

async function onMount() {
  if (!form.endpoint.trim() || !form.bucket.trim()) {
    ElMessage.warning(t("demo.embed.msg.needEndpoint"));
    return;
  }
  try {
    await mount(buildWorkspaceConfig(), OEM_CONFIG.filesBase);
    // mount 后 host 实例就绪：接 iframe 的全屏事件（重复挂载先解旧绑）
    offPreviewFs?.();
    offPreviewFs = on("previewFullscreen", (payload) => {
      stageFs.value = Boolean((payload as { on?: boolean })?.on);
    });
    // 会话到期（前端自毁线到点）：提示并自动整页刷新重建会话（此前无 handler=僵尸 UI 的直接原因）
    on("expired", () => {
      ElMessage.warning(t("demo.embed.msg.expired"));
      setTimeout(() => window.location.reload(), 1500);
    });
  } catch {
    /* 日志区已记录 */
  }
}

/** setCredentials 续期（v1.1）：以当前表单凭证热替换 + 重置自毁线——宿主重签通道演示 */
async function onRenew() {
  try {
    await call("setCredentials", {
      credentials: {
        accessKeyId: form.accessKeyId,
        accessKeySecret: form.accessKeySecret,
        sessionToken: form.sessionToken,
      },
      ttlSeconds: form.ttl,
    });
    ElMessage.success(t("demo.embed.msg.renewed"));
  } catch (err) {
    ElMessage.error(t("demo.embed.msg.actFail", { name: "setCredentials", code: (err as { code?: number }).code ?? "?" }));
  }
}

// ── 动作输入 ──
const action = reactive({
  path: "/",
  folderName: "reports",
  renameFrom: "old.txt",
  renameTo: "new.txt",
  removePaths: "tmp/a.txt, tmp/b.txt",
  downloadPaths: "reports/summary.md",
});

const fileList = ref<UploadUserFile[]>([]);

async function act(name: string, payload?: unknown, label?: string) {
  // name=真实命令名（发 iframe）；label=展示名（仅日志/Toast）——两者必须分离：
  // 带参数的展示名（如 uploadFiles(files×1)）当命令名发会 4005 无处理器（F 修复）
  const show = label ?? name;
  try {
    await call(name, payload);
    ElMessage.success(t("demo.embed.msg.actOk", { name: show }));
  } catch (err) {
    const code = (err as { code?: number }).code;
    ElMessage.error(t("demo.embed.msg.actFail", { name: show, code: code ?? "?" }));
  }
}

function parsePaths(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * uploadFiles：payload.files = File[]。File 是 structured-cloneable，
 * 可直接经 postMessage 传给 iframe（与 types.ts UploadFilesReply 契约一致）；
 * 不带 files 调用则由 iframe 拉起它自己的文件选择器。
 * memoryTarget：target='memory' → 文件入 iframe 内存 store（不落 S3），上传后自动开预览。
 */
const memoryTarget = ref(false);
function onUploadFiles() {
  // UploadRawFile(带 uid) → 裸 File：postMessage structured clone 只需要 File 本体
  const files = fileList.value.map((f) => f.raw).filter(Boolean) as File[];
  const target = memoryTarget.value ? "memory" : "bucket";
  if (files.length === 0) {
    void act("uploadFiles", { target }, `uploadFiles(target=${target})`); // 缺省拉起 iframe 内选择器
    return;
  }
  void act(
    "uploadFiles",
    memoryTarget.value ? { files, target: "memory" } : { files },
    `uploadFiles(files×${files.length}, ${target})`,
  );
}

async function onDestroy() {
  try {
    await destroy();
    ElMessage.success(t("demo.embed.msg.destroyOk"));
  } catch {
    /* 日志区已记录 */
  }
}

const localeOptions = [
  { label: "zh-CN", value: "zh-CN" },
  { label: "en-US", value: "en-US" },
];
const themeOptions = [
  { label: "light", value: "light" },
  { label: "dark", value: "dark" },
];
/** 文件树形态（config.ui.treeMode）：侧栏 / 左抽屉（computed 包裹——随语言即时切换） */
const treeModeOptions = computed(() => [
  { label: t("demo.embed.treeMode.sidebar"), value: "sidebar" },
  { label: t("demo.embed.treeMode.drawer"), value: "drawer" },
]);
/** markdown-editor 形态参数选项（空串=不传，走插件缺省链） */
/** 插件多选行（单文件页 FilePlay 同款交互）：key 收窄到 form 的布尔字段，label 短文案 */
const PLUGIN_SWITCHES: { key: "univerPlugin" | "pdfAnnotator" | "mdPlugin" | "htmlPlugin" | "pptxPlugin" | "artplayerPlugin" | "filerobotPlugin"; label: string }[] = [
  { key: "univerPlugin", label: "Univer 文档" },
  { key: "pdfAnnotator", label: "PDF 签批" },
  { key: "mdPlugin", label: "Markdown 编辑" },
  { key: "htmlPlugin", label: "HTML 编辑" },
  { key: "pptxPlugin", label: "PPTX 预览" },
  { key: "artplayerPlugin", label: "媒体播放" },
  { key: "filerobotPlugin", label: "图片编辑" },
];
const mdModeOptions = computed(() => [
  { label: t("demo.embed.mdMode.auto"), value: "" },
  { label: t("demo.embed.mdMode.source"), value: "source" },
  { label: t("demo.embed.mdMode.split"), value: "split" },
  { label: t("demo.embed.mdMode.preview"), value: "preview" },
]);
</script>

<template>
  <div class="play">
    <div class="play-main">
      <button
        type="button"
        class="panel-rail"
        :title="t('demo.embed.panelToggle')"
        @click="panelOpen = !panelOpen"
      >
        <i :class="panelOpen ? 'ri-arrow-left-s-line' : 'ri-arrow-right-s-line'"></i>
      </button>
      <aside v-show="panelOpen" class="panel">
        <FcSection padding="md" shadow="sm">
          <template #header>
            <h3 class="section-title">{{ t("demo.embed.connTitle") }}</h3>
          </template>

          <el-alert type="warning" :closable="false" class="cred-hint">
            <p>{{ t("demo.embed.hint.line0") }}</p>
            <p>{{ t("demo.embed.hint.line1") }}</p>
            <p>{{ t("demo.embed.hint.line2") }}</p>
            <p>{{ t("demo.embed.hint.line3") }}</p>
          </el-alert>

          <el-form label-position="top" size="small" class="conn-form">
            <el-form-item class="fc-form-item" label="endpoint">
              <el-input v-model="form.endpoint" class="fc-input" placeholder="http://localhost:9000" />
            </el-form-item>
            <div class="row2">
              <el-form-item class="fc-form-item" label="region">
                <el-input v-model="form.region" class="fc-input" placeholder="us-east-1" />
              </el-form-item>
              <el-form-item class="fc-form-item" label="bucket">
                <el-input v-model="form.bucket" class="fc-input" placeholder="mmagic-demo" />
              </el-form-item>
            </div>
            <el-form-item class="fc-form-item" :label="t('demo.embed.label.prefix')">
              <el-input v-model="form.prefix" class="fc-input" placeholder="sessions/demo/" />
            </el-form-item>
            <el-form-item class="fc-form-item" label="accessKeyId">
              <el-input v-model="form.accessKeyId" class="fc-input" :placeholder="t('demo.embed.placeholder.ak')" autocomplete="off" />
            </el-form-item>
            <el-form-item class="fc-form-item" label="accessKeySecret">
              <el-input v-model="form.accessKeySecret" class="fc-input" :placeholder="t('demo.embed.placeholder.sk')" show-password autocomplete="new-password" />
            </el-form-item>
            <el-form-item class="fc-form-item" label="sessionToken">
              <el-input v-model="form.sessionToken" class="fc-input" :placeholder="t('demo.embed.placeholder.token')" show-password autocomplete="new-password" />
            </el-form-item>
            <div class="row2">
              <el-form-item class="fc-form-item" :label="t('demo.embed.label.ttl')">
                <el-input-number v-model="form.ttl" :min="60" :max="86400" :step="600" style="width: 100%" />
              </el-form-item>
              <el-form-item class="fc-form-item" :label="t('demo.embed.label.appearance')">
                <div class="pair">
                  <FcSegmented v-model="form.theme" :options="themeOptions" size="sm" />
                  <FcSelect v-model="form.locale" :options="localeOptions" size="small" style="width: 96px" />
                </div>
              </el-form-item>
            </div>
            <el-form-item class="fc-form-item" :label="t('demo.embed.label.initialPath')">
              <el-input v-model="form.initialPath" class="fc-input" placeholder="/" />
            </el-form-item>
            <el-form-item class="fc-form-item" :label="t('demo.embed.label.treeMode')">
              <FcSegmented v-model="form.treeMode" :options="treeModeOptions" size="sm" />
            </el-form-item>
            <el-form-item class="fc-form-item" :label="t('demo.embed.label.treeTitle')">
              <el-input v-model="form.treeTitle" class="fc-input" :placeholder="t('demo.embed.placeholder.treeTitle')" />
            </el-form-item>
            <el-form-item class="fc-form-item" :label="t('demo.embed.label.features')">
              <el-checkbox-group v-model="form.disabledFeatures" size="small">
                <el-checkbox v-for="k in FEATURE_KEYS" :key="k" :value="k">{{ k }}</el-checkbox>
              </el-checkbox-group>
            </el-form-item>
            <el-form-item class="fc-form-item" :label="t('demo.embed.label.pluginsLabel')">
              <div style="display: flex; flex-wrap: wrap; gap: 4px 16px">
                <el-checkbox
                  v-for="p in PLUGIN_SWITCHES"
                  :key="p.key"
                  v-model="form[p.key]"
                  size="small"
                  :title="form[p.key] ? t('demo.embed.label.pluginChecked') : t('demo.embed.label.pluginUnchecked')"
                >
                  {{ p.label }}
                </el-checkbox>
              </div>
            </el-form-item>
            <template v-if="form.mdPlugin">
              <el-form-item class="fc-form-item" :label="t('demo.embed.label.mdInitialMode')">
                <FcSelect v-model="form.mdInitialMode" :options="mdModeOptions" size="small" style="width: 100%" />
              </el-form-item>
              <el-form-item class="fc-form-item" :label="t('demo.embed.label.mdDefaultMode')">
                <FcSelect v-model="form.mdDefaultMode" :options="mdModeOptions" size="small" style="width: 100%" />
              </el-form-item>
            </template>
          </el-form>

          <el-collapse class="preview">
            <el-collapse-item :title="t('demo.embed.previewTitle')">
              <pre class="code">{{ configPreview }}</pre>
              <pre class="code">{{ configUrlPreview }}</pre>
            </el-collapse-item>
          </el-collapse>

          <div class="actions">
            <FcButton variant="primary" :disabled="status === 'mounting'" @click="onMount">
              {{ t("demo.embed.mount") }}
            </FcButton>
            <FcButton variant="secondary" :disabled="status !== 'ready'" @click="onDestroy">destroy</FcButton>
            <FcButton variant="primary" :disabled="status !== 'ready'" @click="onRenew">
              {{ t("demo.embed.renew") }}
            </FcButton>
          </div>
        </FcSection>

        <FcSection padding="md" shadow="sm">
          <template #header>
            <h3 class="section-title">{{ t("demo.embed.actionsTitle") }}</h3>
          </template>
          <div class="actions">
            <FcButton variant="secondary" size="sm" :disabled="status !== 'ready'" @click="act('getInfo', {})">getInfo</FcButton>
            <FcButton variant="secondary" size="sm" :disabled="status !== 'ready'" @click="act('getTabs', {})">getTabs</FcButton>
            <FcButton variant="secondary" size="sm" :disabled="status !== 'ready'" @click="act('navigate', { path: action.path })">
              navigate
            </FcButton>
            <FcButton
              variant="secondary"
              size="sm"
              :disabled="status !== 'ready'"
              @click="act('createFolder', { path: `${action.folderName.replace(/\/+$/, '')}/` })"
            >
              createFolder
            </FcButton>
            <FcButton
              variant="secondary"
              size="sm"
              :disabled="status !== 'ready'"
              @click="act('rename', { from: action.renameFrom, to: action.renameTo })"
            >
              rename
            </FcButton>
            <FcButton
              variant="secondary"
              size="sm"
              :disabled="status !== 'ready'"
              @click="act('remove', { paths: parsePaths(action.removePaths) })"
            >
              remove
            </FcButton>
            <FcButton
              variant="secondary"
              size="sm"
              :disabled="status !== 'ready'"
              @click="act('download', { paths: parsePaths(action.downloadPaths) })"
            >
              download
            </FcButton>
          </div>
          <div class="action-params">
            <el-input v-model="action.path" class="fc-input" size="small" placeholder="navigate path">
              <template #prepend>path</template>
            </el-input>
            <el-input v-model="action.folderName" class="fc-input" size="small" :placeholder="t('demo.embed.placeholder.folder')">
              <template #prepend>dir</template>
            </el-input>
            <div class="row2">
              <el-input v-model="action.renameFrom" class="fc-input" size="small" placeholder="rename from">
                <template #prepend>from</template>
              </el-input>
              <el-input v-model="action.renameTo" class="fc-input" size="small" placeholder="rename to">
                <template #prepend>to</template>
              </el-input>
            </div>
            <el-input v-model="action.removePaths" class="fc-input" size="small" :placeholder="t('demo.embed.placeholder.paths')">
              <template #prepend>rm</template>
            </el-input>
            <el-input v-model="action.downloadPaths" class="fc-input" size="small" :placeholder="t('demo.embed.placeholder.paths')">
              <template #prepend>dl</template>
            </el-input>
          </div>
        </FcSection>

        <FcSection padding="md" shadow="sm">
          <template #header>
            <h3 class="section-title">{{ t("demo.embed.uploadTitle") }}</h3>
          </template>
          <el-upload
            v-model:file-list="fileList"
            :auto-upload="false"
            multiple
            drag
            class="uploader"
          >
            <i class="ri-upload-2-line"></i>
            <div class="el-upload__text">{{ t("demo.embed.uploadHint") }}</div>
          </el-upload>
          <div class="actions">
            <FcButton variant="secondary" size="sm" :disabled="status !== 'ready'" @click="onUploadFiles">
              {{ fileList.length ? t("demo.embed.uploadWithFiles", { n: fileList.length }) : t("demo.embed.uploadEmpty") }}
            </FcButton>
            <FcButton variant="secondary" size="sm" @click="fileList = []">{{ t("demo.embed.clearList") }}</FcButton>
            <el-switch
              v-model="memoryTarget"
              :disabled="status !== 'ready'"
              size="small"
            />
            <span class="note" style="margin: 0">内存处理（target=memory，不落 S3）</span>
          </div>
          <p class="note">
            {{ t("demo.embed.uploadNote0") }}<code>uploadFiles { files?: File[] }</code>{{ t("demo.embed.uploadNote1") }}<code>uploadProgress / uploadDone / uploadFailed</code>{{ t("demo.embed.uploadNote2") }}
          </p>
        </FcSection>
      </aside>

      <section class="stage" :class="{ 'stage-fs': stageFs }">
        <div class="stage-head">
          <span class="status-dot" :data-status="status"></span>
          <span>{{ statusLabel }}</span>
          <span class="src">
            iframe origin: <code>{{ iframeOrigin }}</code>
            {{ t("demo.embed.autoOrigin") }}
          </span>
        </div>
        <iframe
          ref="iframeRef"
          class="stage-body"
          :title="t('demo.embed.iframeTitle')"
          allow="clipboard-read; clipboard-write; fullscreen"
        ></iframe>
      </section>
    </div>

    <footer class="play-log">
      <button type="button" class="log-toggle" @click="logOpen = !logOpen">
        <i :class="logOpen ? 'ri-arrow-down-s-line' : 'ri-arrow-up-s-line'"></i>
        {{ t("demo.embed.logToggle") }}（{{ logs.length }}）
      </button>
      <FcSection v-show="logOpen" padding="md" shadow="sm">
        <LogPanel :logs="logs" />
      </FcSection>
    </footer>
  </div>
</template>

<style scoped lang="scss">
.play {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
}

.play-main {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 12px;
}

.panel {
  width: 380px;
  flex: none;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;

  .section-title {
    font-size: 13px;
    margin: 0;
  }
  .cred-hint {
    p {
      margin: 2px 0;
      font-size: 12px;
      line-height: 1.5;
    }
    code {
      background: var(--app-bg-muted);
      padding: 0 3px;
      border-radius: 3px;
    }
  }
  .note {
    color: var(--app-text-tertiary);
    font-size: 12px;
    margin: 0;
    line-height: 1.6;
    code {
      background: var(--app-bg-muted);
      padding: 0 3px;
      border-radius: 3px;
    }
  }
}

.conn-form {
  margin-top: 10px;

  .el-form-item {
    margin-bottom: 10px;
  }
  :deep(.el-form-item__label) {
    font-size: 12px;
    padding-bottom: 2px;
    color: var(--app-text-secondary);
  }
}

.row2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.pair {
  display: flex;
  gap: 8px;
  align-items: center;
}

.preview {
  border: 1px solid var(--app-separator);
  border-radius: var(--app-radius-button);

  .code {
    margin: 0;
    padding: 8px;
    background: var(--app-bg-muted);
    border-radius: 6px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
    line-height: 1.5;
    word-break: break-all;
    white-space: pre-wrap;
    max-height: 160px;
    overflow: auto;
  }
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}

.action-params {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
}

.uploader {
  width: 100%;
  .el-upload-dragger {
    padding: 12px;
    i {
      font-size: 24px;
      color: var(--app-text-tertiary);
    }
  }
}

.stage {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--app-separator);
  border-radius: var(--app-radius-card);
  overflow: hidden;
  background: var(--app-bg-card);

  /* 浏览器内全屏（顶级文档）：fixed 铺满本页视口，盖过左右面板；
     stage-head（已就绪/iframe origin 状态条）是宿主机件——全屏观感只留编辑器本体 */
  &.stage-fs {
    position: fixed;
    inset: 0;
    z-index: 2000;
    width: 100%;
    height: 100%;
    border: none;
    border-radius: 0;

    .stage-head {
      display: none;
    }
  }

  .stage-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--app-separator);
    font-size: 13px;
    color: var(--app-text-secondary);

    .src {
      margin-left: auto;
      font-size: 12px;
      code {
        background: var(--app-bg-muted);
        padding: 2px 6px;
        border-radius: 4px;
      }
    }
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--app-text-tertiary);
    &[data-status="ready"] {
      background: var(--el-color-success);
    }
    &[data-status="error"] {
      background: var(--el-color-danger);
    }
    &[data-status="mounting"] {
      background: var(--el-color-warning);
    }
  }

  .stage-body {
    flex: 1;
    min-height: 0;
    border: 0;
    width: 100%;
    background: var(--app-bg-card);
  }
}

.panel-rail {
  flex: none;
  width: 18px;
  align-self: stretch;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  font-size: 14px;
  color: var(--app-text-secondary);
  background: var(--app-bg-card);
  border: 1px solid var(--app-separator);
  border-radius: var(--app-radius-button);
  cursor: pointer;

  &:hover {
    background: var(--app-bg-muted);
    color: var(--app-text-primary);
  }
}

.play-log {
  flex: none;
  display: flex;
  flex-direction: column;
}

.log-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  font-size: 12px;
  color: var(--app-text-secondary);
  background: var(--app-bg-card);
  border: 1px solid var(--app-separator);
  border-radius: var(--app-radius-button);
  cursor: pointer;

  &:hover {
    background: var(--app-bg-muted);
    color: var(--app-text-primary);
  }
}
</style>
