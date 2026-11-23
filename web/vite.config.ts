import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'API_');
  const target = env.API_ORIGIN || 'http://127.0.0.1:3000';

  return {
    plugins: [react()],
    appType: 'mpa',
    server: {
      host: '127.0.0.1',
      proxy: {
        '^/(?:[A-Za-z0-9]{7}(?:\\?.*)?|api/v1/redirecionar)$': {
          target,
          changeOrigin: true,
          // O http-proxy-3 do Vite 8 usa ssl como opções mutáveis de http(s).request.
          // Cada resolução recebe suas próprias opções, com espaço para o Location UTF-8.
          get ssl() { return { maxHeaderSize: 3 * 1024 * 1024 + 4096 }; },
        },
        '/api/': target,
      },
    },
  };
});
