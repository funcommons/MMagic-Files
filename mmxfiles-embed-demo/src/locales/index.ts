// i18n 入口（fc-web-sdk §2.1：中英双语，即时切换 + LocalStorage 持久化）。
// default 导出与 frontend/src/locales 同构——sdk 内置组件（FcToast）`import i18n from '@/locales'`。
import { createI18n } from "vue-i18n";
import zhCN from "./zh-CN";
import enUS from "./en-US";

const i18n = createI18n({
  legacy: false,
  locale: localStorage.getItem("fc-demo-locale") || "zh-CN",
  fallbackLocale: "zh-CN",
  messages: { "zh-CN": zhCN, "en-US": enUS },
});

export default i18n;
