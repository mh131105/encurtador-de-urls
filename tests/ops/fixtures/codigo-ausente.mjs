// Na raiz da imagem da API: node --input-type=module - < codigo-ausente.mjs
import { loadConfig } from './dist/config/config.js';
import { createCodec, FIRST_ID } from './dist/ids/codec.js';
import { database } from './dist/service.js';
import { readLink } from './dist/storage/read.js';

const config = loadConfig();
const client = database(config);

async function findAbsentCode() {
  const codec = createCodec(config.key, config.tweak);
  for (let id = 0n; id < FIRST_ID; id++) {
    const code = codec.encode(id);
    if (!(await readLink(client, config.consistency, code))) return code;
  }
  throw new Error('Nenhum controle ausente entre as posições anteriores ao início da emissão.');
}

try {
  console.log(await findAbsentCode());
} finally {
  await client.shutdown();
}
