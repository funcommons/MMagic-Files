<script setup lang="ts">
// 应用根：FcThemeProvider 管 brand/theme（fc-web-sdk §1.4 禁自写主题切换——
// 原 store/brand + styles/brands(bend/aigc) + _aliases 桥已整体退役）
import { FcThemeProvider } from "@/components/sdk";
</script>

<template>
  <FcThemeProvider initial-brand="mchuan" initial-theme="light">
    <router-view />
  </FcThemeProvider>
</template>
