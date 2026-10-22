import { createApp } from "vue";
import ElementPlus from "element-plus";
import "element-plus/dist/index.css";
import "remixicon/fonts/remixicon.css";
import * as ElementPlusIconsVue from "@element-plus/icons-vue";

import App from "./App.vue";
import router from "./router";
import pinia from "./store";
import i18n from "./locales";

// fc-web-sdk §3：sdk 主题一行接入（token + EP 覆写 + 8 品牌；FcThemeProvider 在 App.vue）
import "@/components/sdk/theme/theme.scss";
import "./styles/index.scss";

const app = createApp(App);

app.use(ElementPlus);
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component);
}
app.use(pinia);
app.use(i18n);
app.use(router);

app.mount("#app");
