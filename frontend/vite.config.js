import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

function precompressAssetsPlugin() {
  const compressibleRe = /\.(js|css|html|svg|json)$/i;
  return {
    name: 'digirest-precompress-assets',
    apply: 'build',
    closeBundle() {
      const outDir = fileURLToPath(new URL('./dist', import.meta.url));
      if (!fs.existsSync(outDir)) return;
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(fullPath);
          } else if (entry.isFile() && compressibleRe.test(entry.name)) {
            const raw = fs.readFileSync(fullPath);
            if (raw.length < 1024) continue;
            const gz = zlib.gzipSync(raw, { level: 9 });
            const br = zlib.brotliCompressSync(raw, {
              params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 },
            });
            if (gz.length < raw.length) fs.writeFileSync(`${fullPath}.gz`, gz);
            if (br.length < raw.length) fs.writeFileSync(`${fullPath}.br`, br);
          }
        }
      };
      walk(outDir);
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), precompressAssetsPlugin()],
  build: {
    target: 'es2020',
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('socket.io-client') || id.includes('engine.io-client')) {
              return 'vendor-socket';
            }
            if (id.includes('vue') || id.includes('pinia')) {
              return 'vendor-vue';
            }
          }
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Reuse the original vanilla-JS modules (services, utils, views, features)
      // without duplicating code. Only core/state.js is overridden in src/legacy.
      '@legacy': fileURLToPath(new URL('./src/legacy', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
      },
    },
  },
});
