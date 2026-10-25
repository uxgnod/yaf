import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [react(), cloudflare()],
  // silk-wasm 用 new URL("silk.wasm", import.meta.url) 加载 wasm，预构建会打断这个路径
  optimizeDeps: { exclude: ["silk-wasm"] },
});
