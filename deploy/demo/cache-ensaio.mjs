// Executado em /app com as dependências da própria imagem da API.
import assert from 'node:assert/strict';
import { createClient } from 'redis';

const [action, code, method] = process.argv.slice(2);
const prefix = process.env.INSTALLATION_ID;
assert.match(prefix, /^encdemo-[a-f0-9]{32}$/);
const control = 'controle-' + prefix + ':vizinho';
let client;
try {
  client = createClient({
    url: process.env.REDIS_URL,
    socket: { connectTimeout: 5000, reconnectStrategy: false },
    commandOptions: { timeout: 5000 },
  });
} catch {
  console.error('Configuração inválida em REDIS_URL');
  process.exit(1);
}
client.on('error', () => {});
try {
  await client.connect();
  if (action === 'iniciar') {
    assert.equal(await client.set(control, prefix, { NX: true, EX: 86400 }), 'OK', 'Chave de controle já existe');
    console.log('Criada chave de controle em outro prefixo:', control);
  } else if (action === 'frio') {
    assert.match(code, /^[A-Za-z0-9]{7}$/);
    const key = prefix + ':' + code;
    await client.del(key);
    assert.equal(await client.exists(key), 0);
    console.log('Chave ausente antes de', method, code);
  } else if (action === 'limpar') {
    let removed = 0;
    for await (const keys of client.scanIterator({ MATCH: prefix + ':*', COUNT: 128 })) {
      if (keys.length) removed += await client.del(keys);
    }
    assert.ok(await client.get(control) === prefix, 'O controle de outro prefixo mudou durante o ensaio');
    console.log('Controle de outro prefixo preservado:', control, '| Chaves do ensaio removidas:', removed);
    await client.del(control);
  } else {
    throw new Error('Operação de cache desconhecida');
  }
} finally {
  if (client.isOpen) client.destroy();
}
