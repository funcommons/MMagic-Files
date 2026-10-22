# MMX Demo · 单文件模式渲染样例

这是一个由 **mmxfiles-embed-demo** 自带的 Markdown 样例，经 `#file=` fragment
装载进 MMagic-Files 单文件模式（只读预览）。

## 能看到什么

- 标题/列表/**行内强调**等基础 Markdown 渲染
- 表格与代码块：

| 字段 | 值 |
| --- | --- |
| 模式 | `file`（只读，无 save 段） |
| 装载方式 | `iframe.src = …#file=<encodeURIComponent(JSON)>` |
| 可用命令 | `setTheme` / `setLocale` / `getInfo` / `destroy` |

```ts
// 工作台命令在单文件模式会被拒：4305 UNSUPPORTED_MODE
await client.call('navigate', { path: '/' }) // → reject
```

## 下一步

回到宿主页的「单文件嵌入」标签，把 source URL 换成你自己的
（任意支持 CORS GET 的 URL 即可，不依赖对象存储）。
