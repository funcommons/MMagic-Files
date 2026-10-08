import vue from 'eslint-plugin-vue'
import vueUtilsImport from 'eslint-plugin-vue/dist/utils/index.js'
import vueParser from 'vue-eslint-parser'
import tseslint from 'typescript-eslint'

// vue plugin 是 CJS, ESM 引入后是 { default: { default: <real module> } }
// 双重 default 包装, 取出真正的 utils 对象.
const vueUtils = vueUtilsImport.default?.default ?? vueUtilsImport.default ?? vueUtilsImport

/**
 * ESLint flat config.
 *
 * 目标 (P0-2): 业务代码默认用 SDK 封装的 Fc* 组件.
 * - SDK 已封装的 el-* 组件: 业务必须改用 Fc* 组件 (error).
 * - el-input / el-form-item / el-slider / el-table: SDK 选择保留 EP 原生,
 *   但必须带对应的 fc-* 全局 class, 否则报错 (error).
 * - el-icon / el-option / el-table-column / el-tab-pane 等纯 EP 内部子件
 *   放行, 不强制 SDK 接管.
 * - 原生 <button>: warn 级, 鼓励改用 FcButton. icon-only / 表单 submit /
 *   slot 容器按钮都可用 FcButton 表达 (FcButton 已统一 variant/size/
 *   loading/i18n). 逃生通道: 带 `fc-button` 或 `fc-button-*` (如
 *   fc-button-primary / fc-button-ghost / fc-button-text) class 时放行,
 *   表示已采用 SDK 视觉但保留原生 button 标签.
 *
 * 运行: npm run lint
 */
const SDK_WRAPPED = {
  'el-button': '业务代码禁用 <el-button>, 请用 FcButton 替代.',
  'el-card': '业务代码禁用 <el-card>, 请用 FcSection / FcSectionCard 替代.',
  'el-dialog': '业务代码禁用 <el-dialog>, 请用 FcDialog 替代.',
  'el-drawer': '业务代码禁用 <el-drawer>, 请用 FcDrawer 替代.',
  'el-empty': '业务代码禁用 <el-empty>, 请用 FcEmpty 替代.',
  'el-pagination': '业务代码禁用 <el-pagination>, 请用 FcPagination 替代.',
  'el-popover': '业务代码禁用 <el-popover>, 请用 FcPopover 替代.',
  'el-skeleton': '业务代码禁用 <el-skeleton>, 请用 FcSkeleton 替代.',
  'el-switch': '业务代码禁用 <el-switch>, 请用 FcSwitch 替代.',
  'el-tabs': '业务代码禁用 <el-tabs>, 请用 FcTabsPanel 替代.',
  'el-tag': '业务代码禁用 <el-tag>, 请用 FcTag 替代.',
  'el-tooltip': '业务代码禁用 <el-tooltip>, 请用 FcTooltip 替代.',
  'el-select': '业务代码禁用 <el-select>, 请用 FcSelect 替代.',
}

const GLOBAL_CLASS_RULES = {
  'el-input': 'fc-input',
  'el-form-item': 'fc-form-item',
  'el-slider': 'fc-slider',
  'el-table': 'fc-table',
}

const restrictedSelectors = Object.keys(SDK_WRAPPED).map(
  (tag) => `VElement[rawName='${tag}']`,
)

const wrappedMessage = (tag) => SDK_WRAPPED[tag]
const requiredClassMessage = (tag, cls) =>
  `业务使用 <${tag}> 时必须带 class="${cls}" 以加载 SDK 统一外观. 不要重新封装 ${cls} 的同名 Fc 薄封装组件.`

/**
 * 自定义规则: 校验 el-input / el-form-item / el-slider 是否带对应 fc-* class.
 * esquery 无法稳定地表达 "任意 attribute 名等于 class 且值包含 token" + "attribute 数量不固定",
 * 因此走 AST 节点遍历. 业务大多 class 不会走 v-bind 表达式, 这层用静态 class 检测即可.
 *
 * 关键: 必须用 vue 的 defineTemplateBodyVisitor 把选择器作用到 template AST,
 * 否则 ESLint 默认只走 Program.body (script), 完全看不到 template 里的 VElement.
 */
const requireFcClassRule = {
  meta: { type: 'problem', schema: false, messages: {} },
  create(context) {
    const sourceCode = context.getSourceCode()
    return vueUtils.defineTemplateBodyVisitor(context, {
      "VElement[rawName='el-input'], VElement[rawName='el-form-item'], VElement[rawName='el-slider'], VElement[rawName='el-table']"(node) {
        const requiredClass = GLOBAL_CLASS_RULES[node.rawName]
        const attributes = node.startTag?.attributes ?? []
        const hasStaticClass = attributes.some((attr) => {
          if (attr.key?.name !== 'class' || attr.value?.value === undefined) {
            return false
          }
          return new RegExp(`\\b${requiredClass}\\b`).test(attr.value.value)
        })
        if (hasStaticClass) return
        context.report({
          node,
          message: requiredClassMessage(node.rawName, requiredClass),
        })
      },
    })
  },
}

/**
 * 自定义规则 (warn 级): 推荐 <button> 带 fc-button / fc-button-* class.
 *
 * 鼓励用 FcButton 组件, 但允许逃生: 原生 <button> 带上 fc-button 或
 * fc-button-* (fc-button-primary / fc-button-ghost / fc-button-text 等)
 * 表示采用了 SDK 视觉, 跳过警告. 业务已存在大量存量按钮, 先以 warn 兜住,
 * 等存量迁移到 FcButton (或 fc-button-* class) 之后再考虑升级 error.
 *
 * 同上, 必须用 defineTemplateBodyVisitor 才能看到 template 里的 VElement.
 */
const FC_BUTTON_CLASS_RE = /\bfc-button(?:-\w+)?\b/
const preferFcButtonRule = {
  meta: { type: 'suggestion', schema: false, messages: {
    noFcButton: '业务代码 <button> 推荐带 fc-button / fc-button-* class (如 fc-button-primary, fc-button-ghost), 或者直接用 FcButton 组件.',
  } },
  create(context) {
    return vueUtils.defineTemplateBodyVisitor(context, {
      "VElement[rawName='button']"(node) {
        const attributes = node.startTag?.attributes ?? []
        const hasFcButtonClass = attributes.some((attr) => {
          if (attr.key?.name !== 'class' || attr.value?.value === undefined) {
            return false
          }
          return FC_BUTTON_CLASS_RE.test(attr.value.value)
        })
        if (hasFcButtonClass) return
        context.report({ node, messageId: 'noFcButton' })
      },
    })
  },
}

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'src/components/sdk/**',
      '**/*.d.ts',
    ],
  },
  {
    files: ['src/**/*.vue'],
    // 关键: 让 ESLint 进入 <template> AST, 否则 VElement 事件不会触发,
    // 业务侧 SDK 规则全部静默失效 (require-fc-class / vue/no-restricted-syntax / prefer-fc-button).
    processor: 'vue/vue',
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        ecmaVersion: 'latest',
        sourceType: 'module',
        extraFileExtensions: ['.vue'],
      },
    },
    plugins: { vue, local: { rules: { 'require-fc-class': requireFcClassRule, 'prefer-fc-button': preferFcButtonRule } } },
    rules: {
      // eslint-disable-next-line no-unused-vars
      'vue/no-restricted-syntax': ['error', ...restrictedSelectors.map((s, i) => ({
        selector: s,
        message: Object.values(SDK_WRAPPED)[i],
      }))],
      'local/require-fc-class': 'error',
      'local/prefer-fc-button': 'warn',
    },
  },
]

// 提示: 自定义规则的 messages 字典在 create() 中通过 message 字符串提供,
// 不需要 plugin meta.messages.
