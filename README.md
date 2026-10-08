# MMagic-Files

**可嵌入的 web 文件中台（纯前端 · 0 后端）**——iframe / window.open 即插即用，无用户体系、S3 直连（浏览器内 SigV4，字节不过中台）、JSSDK 100% 开放；**交付物=一个静态 dist**。

## 文档导航

| 文档 | 一句话 | 读者 |
| --- | --- | --- |
| [产品顶层设计](documents/产品顶层设计.md) | 一页核心：定位/五支柱/边界/里程碑/竞争位 | 所有人（从这入门） |
| [方案设计](documents/方案设计.md) | 完整方案：需求/选型/架构/关键设计/安全/里程碑/裁决台账 | 架构与研发 |
| [第一期文件类型支持计划](documents/第一期文件类型支持计划.md) | v1 文件类型交付面：支持总表/打开链路/预览策略/扩展路径/验收口径 | 架构与研发 |
| [用户手册](documents/用户手册.md) | 接入四步：scoped 凭证/fragment 配置/CORS/引入 SDK + 单文件与独立窗形态、会话行为与安全义务 | 消费方接入开发者 |
| [JSSDK 接口文档](documents/JSSDK%20接口文档.md) | postMessage 双向协议契约：command/event/错误码/类型定义 | 宿主页面开发者 |
| [动态插件方案](documents/动态插件方案.md) | 插件模型：`activate(sdk)`→`registerApp` 契约/信任两级/安全红线 | 扩展应用开发者 |
| [动态插件样例](documents/动态插件样例.md) | 三个可跑插件样例（新文件类型上「打开方式」菜单） | 扩展应用开发者 |

## 代码

`frontend/`——Vue3 基建就绪：`pnpm dev` / `pnpm test` / `pnpm verify`。
