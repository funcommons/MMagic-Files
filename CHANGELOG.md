# Changelog

本项目遵循 [Semantic Versioning](https://semver.org/)。

## [1.0.0] — 2026-10-22

首个正式版。项目由 MMagic-Files 更名 **mmagix-files**（协议命名空间 `ns` 由 `mmagic-files` 同步更名 `mmagix-files`——首版无兼容包袱）。

### 核心：文件管理器（iframe 嵌入式，纯前端）

- **双形态**：workspace（S3 桶浏览：树/多 tab/上传/下载/重命名/删除/新建）+ 单文件模式（source 直链/预签名 URL，可选 save 段写回；v1.2 无源装载）
- **JS SDK**：postMessage 双向协议（cmd/evt/reply 信封、origin 白名单、10s 超时）；双形态构造（iframe / window.open）
- **内存文件通路**：`mem://` 键域 DataSource 分流（凭证不出/字节不落盘场景），全部渲染器零改动
- **凭证红线**：S3 密钥仅宿主持有（setCredentials 热替换 + TTL 自毁线），预签名 URL 直传直取
- **会话治理**：expired 自毁、单实例闩锁、命令面板、全量 i18n（中/英）、明暗主题随宿主（data-theme/data-brand）

### 内置应用（文件类型支持）

- 代码编辑器（Monaco 0.57）：worker 五入口按 label 分发（json/css/html/ts 语言服务真 worker）、格式化双链（worker 原生优先+自研回退）、主题随宿主（8 类核心 token 映射）、全中文右键菜单、viewState 持久化、5MiB 只读降级、4305 只读闩锁
- xlsx/xls 表格：ExcelJS 样式渲染（底色/字色/边框/合并/列宽/行高；2000 行截断护栏）；xls 保留 SheetJS 链
- docx（mammoth）/ PDF（pdfjs + 直链 Range）/ Markdown / Mermaid 流程图 / CSV-TSV / HEIC / 音视频 / 图片
- 上传：队列/失败原因透出/File 失效免疫（选时缓冲）

### 动态插件（v1.0.0 全家桶，SRI 自校验装载）

| 插件 | 能力 |
|---|---|
| univer-office | xlsx/xls/docx 编辑（Univer） |
| pdf-annotator | PDF 标注/签批/签名/压平写回 |
| markdown-editor | 三形态（源码/分屏/预览）编辑 |
| html-editor | 三态（源码 CM6/可视 Tiptap/沙箱预览）+ 单体化（图片 base64 内联）+ 新 tab 代理 |
| artplayer-player | 媒体播放增强（断流重连） |
| filerobot-image-editor | 图片编辑（裁剪/标注/调色） |
| pptx-viewer | PPTX 纯前端预览（pptx-preview，中上保真） |

### 质量基线

- 单元测试 1391 通过（96 文件）；vue-tsc/eslint 零错误
- 多轮 Playwright E2E 回归（test-report/2026-10-19~21）：worker 分发/格式化双链/主题联动/pptx 三页/xlsx 样式/内存文件/一键直达

### 已知边界

- pptx 保真度中上（SmartArt/艺术字/复杂动画有损；高保真路线=LibreOffice 转 PDF，未部署）
- 旧 .doc/.ppt 二进制不支持在线预览（纯前端无成熟解析）
- Safari/Firefox 不支持 File System Access API（本地文件夹模式未含在本版）
