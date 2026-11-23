#!/usr/bin/env bash
# Executar na cópia de build da distribuição, com Node 24 e Docker Compose.
set -euo pipefail
cd "$(dirname "$0")/../.."

project="enc-ci-$(date +%s)-$$"
work=$(mktemp -d)
export API_ENV_FILE="$work/api.env" EMISSION_MARKER_DIR="$work/emission"
export API_IMAGE="$project-api" NGINX_IMAGE="$project-nginx"
# Todos os clientes deste ensaio usam os dados descartáveis do projeto recém-criado.
export CASSANDRA_CONTACT_POINTS=cassandra CASSANDRA_PORT=9042 CASSANDRA_DATACENTER=datacenter1
export CASSANDRA_KEYSPACE=encurtador REDIS_URL=redis://redis:6379
export REQUEST_TIMEOUT_MS=15000 DB_TIMEOUT_MS=5000
unset CASSANDRA_USERNAME CASSANDRA_PASSWORD
export HTTP_BIND=127.0.0.1
export HTTP_PORT=${HTTP_PORT:-$(node --input-type=module -e 'import net from "node:net"; const s=net.createServer().listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')}
export PUBLIC_ORIGIN="http://127.0.0.1:$HTTP_PORT"

cat > "$work/ports.yaml" <<'YAML'
services:
  api:
    ports: ["127.0.0.1::3000"]
    networks:
      default:
        aliases: [api-a, api-b]
  entrada-ha:
    image: ${NGINX_IMAGE}
    depends_on: [api]
    ports: ["127.0.0.1::80"]
    volumes:
      - ./deploy/ha/nginx.conf:/etc/nginx/nginx.conf:ro
  api-prazo:
    image: ${API_IMAGE}
    env_file: ["${API_ENV_FILE}"]
    environment:
      PUBLIC_ORIGIN: ${PUBLIC_ORIGIN}
      REQUEST_TIMEOUT_MS: 90000
      CASSANDRA_CONTACT_POINTS: cassandra
    command: [node, /app/api-prazo.mjs]
    volumes:
      - ./tests/ops/fixtures/api-prazo.mjs:/app/api-prazo.mjs:ro
    ports: ["127.0.0.1::3000"]
    networks:
      default: {}
      prazo: {aliases: [api, api-a, api-b]}
    healthcheck:
      test: [CMD, node, -e, "fetch('http://localhost:3000/internal/live').then(r => process.exit(r.ok ? 0 : 1))"]
      interval: 1s
      timeout: 2s
      retries: 30
  demo-prazo:
    image: ${NGINX_IMAGE}
    depends_on: {api-prazo: {condition: service_healthy}}
    networks: [prazo]
    ports: ["127.0.0.1::80"]
  ha-prazo:
    image: ${NGINX_IMAGE}
    depends_on: {api-prazo: {condition: service_healthy}}
    networks: [prazo]
    ports: ["127.0.0.1::80"]
    volumes:
      - ./deploy/ha/nginx.conf:/etc/nginx/nginx.conf:ro
  cassandra:
    ports: ["127.0.0.1::9042"]
  redis:
    ports: ["127.0.0.1::6379"]
networks:
  prazo: {}
YAML
compose() { docker compose -p "$project" -f compose.yaml -f "$work/ports.yaml" --profile cassandra --profile redis "$@"; }
cleanup() {
  compose down -v >/dev/null || true
  docker image rm "$API_IMAGE" "$NGINX_IMAGE" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

mkdir -m 0777 "$EMISSION_MARKER_DIR"
# Parâmetros de teste do vetor FF1. A posição de 0000000 fica fora da faixa desta CI.
(umask 077; printf '%s\n' 'FF1_KEY=2b7e151628aed2a6abf7158809cf4f3c' 'FF1_TWEAK=39383736353433323130' > "$API_ENV_FILE")
compose config --quiet
python3 tests/ops/test_resumir.py
python3 tests/ops/test_verificar.py
npm ci
npm run build
npm --prefix web ci
npm --prefix web run build
docker build -t "$API_IMAGE" .
docker build -f deploy/nginx/Dockerfile -t "$NGINX_IMAGE" .
compose up -d cassandra redis
for ((i=0; i<90; i++)); do
  if compose exec -T cassandra cqlsh -e 'SELECT release_version FROM system.local' >/dev/null 2>&1; then break; fi
  sleep 2
done
compose exec -T cassandra cqlsh < deploy/cassandra/demo.cql
compose exec -T cassandra cqlsh -k encurtador < deploy/cassandra/schema.cql
compose run --rm -T --no-deps -v "$EMISSION_MARKER_DIR:/run/emissao-admin:rw" -e EMISSION_MARKER_FILE=/run/emissao-admin/emission.json api node dist/ids/recovery.js init 15776336
compose up -d api nginx entrada-ha
for ((i=0; i<45; i++)); do
  if compose exec -T api node -e 'fetch("http://localhost:3000/internal/ready").then(r => process.exit(r.ok?0:1))' >/dev/null 2>&1; then break; fi
  sleep 1
done
cql_port=$(compose port cassandra 9042)
redis_port=$(compose port redis 6379)
# Mantém o ambiente da suíte no processo npm. O Compose usa os endereços da rede interna.
CASSANDRA_CONTACT_POINTS=127.0.0.1 CASSANDRA_PORT="${cql_port##*:}" REDIS_URL="redis://$redis_port" TEST_REDIS_URL="redis://$redis_port" npm test
node tests/ops/proxy-post.mjs
node tests/ops/redirecionamento.mjs "$PUBLIC_ORIGIN"
python3 deploy/demo/verificar.py "$PUBLIC_ORIGIN" 'https://loja.example/café%2Fpedido?q=mão%2b#índice'
# Mesmos dados com o arquivo de rotas de produção. O failover entre hosts tem ensaio próprio.
ha_port=$(compose port entrada-ha 80)
node tests/ops/redirecionamento.mjs "http://$ha_port"
npm --prefix web run test:browser -- "$PUBLIC_ORIGIN"
# O Chrome resolve o domínio reservado na própria máquina. A criação desta amostra é controlada.
npm --prefix web run test:browser -- "http://encurtador.test:${HTTP_PORT}"
# Somente o keyspace descartável desta CI recebe o controle positivo.
export BROWSER_ZERO_DESTINATION='https://loja.example/ativo%2Fzero?cor=azul%20claro#detalhes'
compose exec -T -e BROWSER_ZERO_DESTINATION api node --input-type=module - <<'JS'
import assert from 'node:assert/strict';
import { loadConfig } from './dist/config/config.js';
import { expiresAt } from './dist/links/link.js';
import { database } from './dist/service.js';
import { readLink } from './dist/storage/read.js';
import { writeLink } from './dist/storage/write.js';

const config = loadConfig(), client = database(config);
try {
  const createdAt = new Date();
  const destination = process.env.BROWSER_ZERO_DESTINATION;
  assert.equal(await readLink(client, config.consistency, '0000000'), null, 'A CI exige um keyspace novo');
  await writeLink(client, config.consistency, {
    code: '0000000', destination, createdAt, expiresAt: expiresAt(createdAt),
  });
  assert.equal((await readLink(client, config.consistency, '0000000'))?.destination, destination);
} finally {
  await client.shutdown();
}
JS
BROWSER_ABSENT_CODE=$(compose exec -T api node --input-type=module - < tests/ops/fixtures/codigo-ausente.mjs)
export BROWSER_ABSENT_CODE
BROWSER_ADDITIONAL_ENTRY="http://$ha_port" npm --prefix web run test:browser -- "$PUBLIC_ORIGIN" --real

compose up -d --wait api-prazo demo-prazo ha-prazo
node tests/ops/prazo-proxy.mjs "$PUBLIC_ORIGIN" "http://$(compose port api-prazo 3000)" \
  "http://$(compose port demo-prazo 80)" "http://$(compose port ha-prazo 80)"

direct=$(compose port api 3000)
node tests/ops/parada.mjs "$PUBLIC_ORIGIN" "http://$direct" docker compose -p "$project" -f compose.yaml -f "$work/ports.yaml" stop api
exit_code=$(docker inspect -f '{{.State.ExitCode}}' "$(compose ps -aq api)")
test "$exit_code" = 0
