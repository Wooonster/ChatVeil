import { defineConfig } from 'vite';

const userscriptHeader = `// ==UserScript==
// @name         ChatVeil
// @namespace    https://github.com/local/chatveil
// @version      0.1.0
// @description  Mask non-current chatbot conversation titles with hover reveal and per-title unlocks.
// @author       ChatVeil contributors
// @match        https://chatgpt.com/*
// @match        https://*.chatgpt.com/*
// @match        https://claude.ai/*
// @match        https://*.claude.ai/*
// @match        https://qwen.ai/*
// @match        https://*.qwen.ai/*
// @match        https://chat.qwen.ai/*
// @match        https://minimax.io/*
// @match        https://*.minimax.io/*
// @match        https://agent.minimax.com/*
// @match        https://agent.minimaxi.com/*
// @match        https://hailuo.ai/*
// @match        https://*.hailuo.ai/*
// @match        https://hailuoai.video/*
// @match        https://*.hailuoai.video/*
// @match        https://chat.deepseek.com/*
// @match        https://kimi.moonshot.cn/*
// @match        https://doubao.com/*
// @match        https://*.doubao.com/*
// @match        https://yuanbao.tencent.com/*
// @match        https://tongyi.com/*
// @match        https://*.tongyi.com/*
// @match        https://tongyi.aliyun.com/*
// @match        https://yiyan.baidu.com/*
// @match        https://gemini.google.com/*
// @match        https://copilot.microsoft.com/*
// @match        https://perplexity.ai/*
// @match        https://*.perplexity.ai/*
// @match        https://poe.com/*
// @match        https://*.poe.com/*
// @match        https://chat.mistral.ai/*
// @match        https://grok.com/*
// @match        https://*.grok.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==
`;

export default defineConfig({
  build: {
    outDir: 'dist/userscript',
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    lib: {
      entry: 'src/userscript/main.ts',
      name: 'ChatVeilUserscript',
      formats: ['iife'],
      fileName: () => 'chatveil.user.js',
    },
    rollupOptions: {
      output: {
        banner: userscriptHeader,
        inlineDynamicImports: true,
      },
    },
  },
});
