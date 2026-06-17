import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@openim/protocol/lib/pb/sdkws/sdkws': fileURLToPath(new URL('./src/shims/openim-sdkws.js', import.meta.url))
    }
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:18000',
      '/openim-api': 'http://127.0.0.1:10002',
      '/openim-ws': {
        target: 'ws://127.0.0.1:10001',
        ws: true,
        changeOrigin: true
      }
    }
  }
});
