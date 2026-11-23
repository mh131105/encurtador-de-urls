// Executado na imagem da API com o Cassandra descartável da CI.
import { setTimeout as delay } from 'node:timers/promises';
import { loadConfig } from './dist/config/config.js';
import { createAppServer } from './dist/http/server.js';
import { isActive } from './dist/links/link.js';
import { database } from './dist/service.js';
import { readLink } from './dist/storage/read.js';

const config = loadConfig(process.env);
const client = database(config);
await client.connect();
createAppServer({
  ...config,
  create: async () => { throw new Error('A criação usa a API normal da instalação de teste'); },
  resolve: async code => {
    const link = await readLink(client, config.consistency, code);
    if (!link) return null;
    await delay(link.destination.endsWith('#apos-prazo') ? 95000 : 65000);
    return isActive(link, new Date()) ? link.destination : null;
  },
}).listen(config.port);
