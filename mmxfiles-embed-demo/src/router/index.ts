import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";
import i18n from "@/locales";

const routes: RouteRecordRaw[] = [
  {
    path: "/",
    redirect: "/embed/play",
  },
  {
    path: "/",
    component: () => import("@/layout/AppLayout.vue"),
    children: [
      {
        path: "overview",
        name: "Overview",
        component: () => import("@/views/Overview.vue"),
        meta: { title: "demo.nav.overview", icon: "Compass" },
      },
      {
        path: "embed/play",
        name: "EmbedPlay",
        component: () => import("@/views/embed/EmbedPlay.vue"),
        meta: { title: "demo.nav.workspace", icon: "FolderOpened" },
      },
      {
        path: "embed/file",
        name: "FilePlay",
        component: () => import("@/views/embed/FilePlay.vue"),
        meta: { title: "demo.nav.file", icon: "Document" },
      },
    ],
  },
  /** 未匹配路由兜底：跳工作台页，避免未知 URL 渲染成空白页 */
  { path: "/:pathMatch(.*)*", redirect: "/embed/play" },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.afterEach((to) => {
  // fc-web-sdk §2.1：title 走 i18n（meta.title 为词典 key；router 层在 setup 外，用 global scope）
  const meta = to.meta as { title?: string };
  const app = "MMagic-Files";
  document.title = meta.title ? `${i18n.global.t(meta.title)} · ${app}` : app;
});

export default router;
