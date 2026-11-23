import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import cassandra from 'cassandra-driver';
import { createClient } from 'redis';
import { loadConfig } from './config.js';
import { database } from '../service.js';

const valid = { PUBLIC_ORIGIN: 'https://s.example:8443', FF1_KEY: 'ab'.repeat(16) };
test('mantém origem, endpoints, consistência e parâmetros FF1 por instalação', () => {
  const env = {
    ...valid, CASSANDRA_CONSISTENCY: 'LOCAL_QUORUM', FF1_TWEAK: 'abcd', ID_BLOCK_SIZE: '41',
    CASSANDRA_CONTACT_POINTS: 'db-a, 2001:db8::1', CASSANDRA_PORT: '9043',
    REDIS_URL: 'rediss://usr:com%40sinal@cache:6380/2', CACHE_TIMEOUT_MS: '210', DB_TIMEOUT_MS: '1350',
  };
  const config = loadConfig(env);
  assert.equal(config.origin, valid.PUBLIC_ORIGIN);
  assert.deepEqual(config.contactPoints, ['db-a', '2001:db8::1']);
  assert.equal(config.cassandraPort, 9043);
  assert.equal(config.redisUrl, env.REDIS_URL);
  assert.equal(config.cacheTimeoutMs, 210);
  assert.equal(config.timeoutMs, 1350);
  assert.equal(config.consistency, cassandra.types.consistencies.localQuorum);
  assert.equal(Buffer.from(config.key).toString('hex'), env.FF1_KEY);
  assert.equal(config.blockSize, 41n);
  assert.deepEqual([...config.tweak], [171,205]);
});
for (const [name, value] of Object.entries({
  PUBLIC_ORIGIN:'https://s.example/caminho', FF1_KEY:'valor-secreto-malformado',
  FF1_TWEAK:'três', PORT:'65536', DB_TIMEOUT_MS:'0', ID_BLOCK_SIZE:'-2',
  REDIS_URL:'https://cache.example', CASSANDRA_CONTACT_POINTS:'host,,outro',
  CASSANDRA_CONSISTENCY:'ANY', CASSANDRA_PASSWORD:'senha-secreta', ISSUE_ENABLED:'talvez'
})) {
  test(`rejeita ${name} antes da escuta e oculta o valor`, () => {
    assert.throws(() => loadConfig({...valid, [name]:value}), (error: Error) => error.message.includes(name) && !error.message.includes(value));
  });
}

test('rejeita a porta zero na origem usada para gerar links públicos', () => {
  assert.throws(() => loadConfig({ ...valid, PUBLIC_ORIGIN: 'https://s.example:0' }), { message: 'Configuração inválida em PUBLIC_ORIGIN' });
});

for (const url of [
  'redis://cache:0', 'redis://user:%gg@cache', 'redis://bad%dd@cache',
  'redis://cache/9007199254740993', 'redis://cache%', 'redis://cache%A',
]) {
  test(`rejeita endpoint Redis inválido: ${url}`, () => {
    assert.throws(() => loadConfig({ ...valid, REDIS_URL: url }), { message: 'Configuração inválida em REDIS_URL' });
  });
}

function startUntilListen(env: NodeJS.ProcessEnv) {
  const server = fileURLToPath(new URL('../server.js', import.meta.url));
  const monitor = "import { Server } from 'node:net'; Server.prototype.listen = () => process.exit(2);";
  const preload = 'data:text/javascript,' + encodeURIComponent(monitor);
  const result = spawnSync(process.execPath, ['--import', preload, server], {
    encoding: 'utf8', env: { ...valid, ...env }, timeout: 5000,
  });
  assert.ifError(result.error);
  return result;
}

test('preserva os contatos Cassandra até o driver e a escuta, inclusive o ponto final do DNS', async () => {
  for (const hosts of [
    ['cassandra.prod.example.'],
    ['cassandra.prod.example.', 'db-b'],
    ['cassandra.prod.example'],
    ['2001:db8::1'],
  ]) {
    const env = { CASSANDRA_CONTACT_POINTS: hosts.join(', ') };
    const client = database(loadConfig({ ...valid, ...env }));
    try {
      assert.deepEqual(Reflect.get(client, 'options').contactPoints, hosts);
      const result = startUntilListen(env);
      assert.equal(result.status, 2, result.stderr);
      assert.equal(result.stderr, '');
    } finally {
      await client.shutdown();
    }
  }
});

test('aplica os limites de rótulo e de nome DNS com ou sem ponto final', () => {
  const longest = [63, 63, 63, 61].map(length => 'a'.repeat(length)).join('.');
  for (const end of ['', '.']) {
    assert.deepEqual(loadConfig({ ...valid, CASSANDRA_CONTACT_POINTS: longest + end }).contactPoints, [longest + end]);
    for (const invalid of [longest + 'x' + end, 'a'.repeat(64) + end, '.db' + end, 'db..db' + end, '.']) {
      assert.throws(() => loadConfig({ ...valid, CASSANDRA_CONTACT_POINTS: invalid }), { message: 'Configuração inválida em CASSANDRA_CONTACT_POINTS' });
    }
  }
});

for (const [description, variable, value] of [
  ['rótulo DNS vazio em um contato Cassandra', 'CASSANDRA_CONTACT_POINTS', 'cassandra..example'],
  ['chave FF1 inválida', 'FF1_KEY', 'chave-de-teste-invalida'],
  ['escape inválido na credencial Redis', 'REDIS_URL', 'redis://user:senha-de-teste%gg@cache'],
  ['escape inválido no host Redis', 'REDIS_URL', 'redis://cache%ZZ:6379/0'],
  ['escape inválido no host Redis TLS', 'REDIS_URL', 'rediss://cache%ZZ:6380/0'],
  ['percentual isolado no host Redis', 'REDIS_URL', 'redis://cache%:6379/0'],
  ['escape incompleto no host Redis', 'REDIS_URL', 'rediss://cache%A:6380/0'],
  ['host inválido com credenciais presentes', 'REDIS_URL', 'rediss://cliente-privado:senha-privada@cache%4Z:6380/0'],
]) {
  test(`rejeita ${description} antes de escutar e registra somente o nome da variável`, () => {
    const result = startUntilListen({ [variable]: value });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, `Configuração inválida em ${variable}\n`);
  });
}

test('preserva escapes completos no host Redis e deixa o driver decodificar as credenciais uma vez', () => {
  const url = 'rediss://cliente%40lab:senha%252Ftexto@cache%2Dlab:6380/0';
  const config = loadConfig({ ...valid, REDIS_URL: url });
  assert.equal(config.redisUrl, url);
  const { username, password } = createClient({ url: config.redisUrl }).options;
  assert.equal(username, 'cliente@lab');
  assert.equal(password, 'senha%2Ftexto');
});

for (const url of ['redis://cache.example:6379/0', 'rediss://[::1]:6380/0']) {
  test(`chega à escuta com ${url}`, () => {
    const result = startUntilListen({ REDIS_URL: url });
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  });
}
