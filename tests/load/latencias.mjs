// Limite superior inclusivo em microssegundos, com três dígitos significativos.
// O número de intervalos cresce com as ordens de grandeza, não com as requisições.
export function record(buckets, elapsedMs) {
  const us = Math.max(1, Math.ceil(elapsedMs * 1000));
  const step = 10 ** Math.max(0, Math.floor(Math.log10(us)) - 2);
  const upper = Math.ceil(us / step) * step;
  buckets.set(upper, (buckets.get(upper) ?? 0) + 1);
}

export const routes = ['create', 'resolveGet', 'resolvePost'];
export function summarize(buckets, confirmed, failures, mismatchedDestinations) {
  const counts = [...buckets].sort((a,b) => a[0]-b[0]);
  const total = counts.reduce((n, [,count]) => n + count, 0);
  if (!Number.isSafeInteger(total) || total !== confirmed + failures) throw new Error('Contagem de latências inválida');
  function percentile(p) {
    if (total === 0) return null;
    const rank = Math.ceil(total * p / 100);
    let seen = 0;
    for (const [upper, count] of counts) {
      seen += count;
      if (seen >= rank) return upper / 1000;
    }
  }
  return {confirmed, failures, mismatchedDestinations, p95Ms:percentile(95), p99Ms:percentile(99), bucketsUs:counts};
}

export function combine(distributions) {
  const buckets = new Map();
  let confirmed = 0, failures = 0, mismatches = 0;
  for (const d of distributions) {
    if (!Array.isArray(d?.bucketsUs) || ![d.confirmed,d.failures,d.mismatchedDestinations].every(n => Number.isSafeInteger(n) && n >= 0)) {
      throw new Error('Relatório sem distribuição válida por rota');
    }
    let count = 0, previous = 0;
    for (const [upper, frequency] of d.bucketsUs) {
      if (!Number.isSafeInteger(upper) || upper <= previous || !Number.isSafeInteger(frequency) || frequency <= 0) throw new Error('Intervalo inválido');
      previous = upper;
      buckets.set(upper, (buckets.get(upper) ?? 0) + frequency);
      count += frequency;
    }
    if (count !== d.confirmed + d.failures) throw new Error('Distribuição incompleta no arquivo de entrada');
    confirmed += d.confirmed;
    failures += d.failures;
    mismatches += d.mismatchedDestinations;
  }
  return summarize(buckets, confirmed, failures, mismatches);
}
