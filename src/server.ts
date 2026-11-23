export { createAppServer, type Routes } from './http/server.js';

if (import.meta.main) {
  try {
    const { loadConfig } = await import('./config/config.js');
    const config = loadConfig();
    const { startService } = await import('./service.js');
    await startService(config);
  } catch (error) {
    const validation = error instanceof Error && /^Configuração inválida em [A-Z0-9_ /]+$/.test(error.message);
    console.error(validation ? (error as Error).message : 'Falha ao iniciar a API');
    process.exitCode = 1;
  }
}
