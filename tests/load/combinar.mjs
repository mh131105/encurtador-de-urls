import { readFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { combine, routes } from './latencias.mjs';

const paths = process.argv.slice(2);
const requireUnique = paths[0] === '--require-unique';
if (requireUnique) paths.shift();
if (paths.length === 0) throw new Error('Uso: node tests/load/combinar.mjs [--require-unique] amostra-a.json amostra-b.json ...');
const samples = await Promise.all(paths.map(async path => JSON.parse(await readFile(path, 'utf8'))));
const operations = Object.fromEntries(routes.map(route => [route, combine(samples.map(s => s.operations[route]))]));
operations.resolve = combine([operations.resolveGet,operations.resolvePost]);

function checkCodes() {
  const index = new DatabaseSync('');
  const missing = [];
  let distinct = 0;
  let repeatedAcrossSamples = 0;
  let repeatedWithinSamples = 0;
  let firstRepeated;
  let publicOrigin;
  try {
    index.exec('PRAGMA cache_size = -8192; CREATE TABLE seen (code TEXT PRIMARY KEY, source INTEGER) WITHOUT ROWID');
    for (const [i, sample] of samples.entries()) {
      repeatedWithinSamples += sample.reusedCodes ?? 0;
      const ledger = sample.codeLedger;
      if (!ledger) {
        missing.push(paths[i]);
        continue;
      }
      if (!ledger.file || basename(ledger.file) !== ledger.file) throw new Error('Nome de índice inválido: ' + paths[i]);
      const file = pathToFileURL(resolve(dirname(paths[i]), ledger.file));
      file.searchParams.set('mode', 'ro');
      index.prepare('ATTACH DATABASE ? AS incoming').run(file.href);
      const metadata = index.prepare('SELECT id, origin, reused FROM incoming.sample').get();
      const { count } = index.prepare('SELECT count(*) AS count FROM incoming.seen').get();
      if (!metadata || metadata.id !== ledger.id || metadata.origin !== ledger.origin ||
          metadata.reused !== sample.reusedCodes || count !== sample.operations.create.confirmed) {
        throw new Error('Índice incompatível com o relatório ' + paths[i]);
      }
      publicOrigin ??= metadata.origin;
      if (metadata.origin !== publicOrigin) throw new Error('Os índices pertencem a origens públicas diferentes');
      const added = index.prepare('INSERT OR IGNORE INTO main.seen SELECT code, ? FROM incoming.seen').run(i).changes;
      distinct += added;
      repeatedAcrossSamples += count - added;
      if (added < count && !firstRepeated) {
        const match = index.prepare('SELECT a.code, b.source FROM incoming.seen a JOIN main.seen b USING (code) WHERE b.source <> ? LIMIT 1').get(i);
        firstRepeated = { code: match.code, samples: [paths[match.source], paths[i]] };
      }
      index.exec('DETACH DATABASE incoming');
    }
  } finally {
    index.close();
  }
  let status = missing.length ? 'unverified' : 'verified';
  if (repeatedAcrossSamples || repeatedWithinSamples) status = 'reused';
  return {status, publicOrigin, distinct: missing.length ? null : distinct, repeatedAcrossSamples, repeatedWithinSamples, firstRepeated, missing};
}

let codeUniqueness;
try {
  codeUniqueness = checkCodes();
} catch (error) {
  codeUniqueness = { status: 'unverified', reason: error.message };
  process.exitCode = 1;
}
if (codeUniqueness.status === 'reused' || (requireUnique && codeUniqueness.status !== 'verified')) process.exitCode = 1;
console.log(JSON.stringify({operations, codeUniqueness}, null, 2));
