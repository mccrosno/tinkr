import { defineConfig, type Plugin } from "vite";
import vue from "@vitejs/plugin-vue";
// @ts-expect-error type error without @types/node package
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
// Dev-only endpoint: the in-page theming benchmark (src/bench.ts) POSTs its results here,
// and they're printed to the terminal and saved to bench-result.json.
const benchSink: Plugin = {
  name: 'tinkr-bench-sink',
  configureServer(server) {
    server.middlewares.use('/__bench', (req, res) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', async () => {
        console.log('[bench] ' + body)
        const { writeFile } = await import('node:fs/promises')
        await writeFile('bench-result.json', body)
        res.end('ok')
      })
    })
  },
}

export default defineConfig(() => ({
  plugins: [vue(), benchSink],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
