#!/usr/bin/env bash
# Ensaio destrutivo apenas nos volumes de um projeto temporário criado por este script.
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${STACK_BUDGET_MIB:?Informe o orçamento medido para todos os novos serviços em MiB}"
: "${MIN_MARGIN_MIB:?Informe a margem mínima para o host em MiB}"
[[ $(uname -s) == Linux && -f /sys/fs/cgroup/cgroup.controllers ]] || { echo "Execute no host Linux do Docker, com cgroup v2." >&2; exit 1; }
endpoint=${DOCKER_HOST:-$(docker context inspect "$(docker context show)" --format '{{.Endpoints.docker.Host}}')}
[[ $endpoint == unix://* ]] || { echo "O ensaio requer um socket local do Docker." >&2; exit 1; }
placement=${DEMO_CASSANDRA:-local}
redis_mode=${DEMO_REDIS_MODE:-local}
nginx_mode=${DEMO_NGINX_MODE:-local}
data_services=()
web_services=(api)
compose_args=(--env-file /dev/null -f "$PWD/compose.yaml")
case "$redis_mode" in
  local) export REDIS_URL=redis://redis:6379; data_services+=(redis); compose_args+=(--profile redis) ;;
  externo) : "${REDIS_URL:?Informe o endpoint do Redis compartilhado acessível pela API}"; export REDIS_URL ;;
  *) echo "DEMO_REDIS_MODE deve ser local ou externo" >&2; exit 1 ;;
esac
case "$nginx_mode" in
  local) web_services+=(nginx) ;;
  existente)
    : "${PUBLIC_ORIGIN:?Informe a origem da entrada NGINX de laboratório existente}"
    : "${DEMO_API_PORT:?Informe a porta do upstream da entrada existente no loopback deste host}"
    [[ $DEMO_API_PORT =~ ^[1-9][0-9]{0,4}$ ]] && (( DEMO_API_PORT <= 65535 )) || { echo "Porta de upstream inválida" >&2; exit 1; }
    export PUBLIC_ORIGIN=${PUBLIC_ORIGIN%/}
    ;;
  *) echo "DEMO_NGINX_MODE deve ser local ou existente" >&2; exit 1 ;;
esac
case "$placement" in
  local)
    compose_args+=(--profile cassandra)
    data_services+=(cassandra)
    export CASSANDRA_CONTACT_POINTS=cassandra CASSANDRA_PORT=9042 CASSANDRA_DATACENTER=datacenter1
    export CASSANDRA_KEYSPACE=encurtador
    database_host=$(hostname)
    ;;
  externo)
    : "${CASSANDRA_CONTACT_POINTS:?Informe o endpoint do Cassandra de laboratório}"
    : "${CASSANDRA_KEYSPACE:?Informe o keyspace exclusivo já preparado para este ensaio}"
    export CASSANDRA_CONTACT_POINTS CASSANDRA_KEYSPACE
    export CASSANDRA_PORT=${CASSANDRA_PORT:-9042} CASSANDRA_DATACENTER=${CASSANDRA_DATACENTER:-datacenter1}
    database_host=${DEMO_DATABASE_HOST:-$CASSANDRA_CONTACT_POINTS}
    if [[ -n ${CASSANDRA_AUTH_ENV_FILE:-} && ! -r $CASSANDRA_AUTH_ENV_FILE ]]; then
      echo "Arquivo de credenciais do Cassandra ilegível" >&2; exit 1
    fi
    ;;
  *) echo "DEMO_CASSANDRA deve ser local ou externo" >&2; exit 1 ;;
esac
work=$(mktemp -d)
project="encdemo-$(python3 -c 'import uuid; print(uuid.uuid4().hex)')"
out=$(mktemp -d "${REPORT_PARENT:-/tmp}/$project.XXXXXX")
printf 'Relatório: %s\n' "$out"
export API_ENV_FILE="$work/api.env" EMISSION_MARKER_DIR="$work/emissao"
export INSTALLATION_ID="$project"
if [[ $nginx_mode == local ]]; then
  export HTTP_BIND=127.0.0.1
  export HTTP_PORT=${HTTP_PORT:-$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')}
  export PUBLIC_ORIGIN="http://127.0.0.1:$HTTP_PORT"
else
  printf '{"services":{"api":{"ports":["127.0.0.1:%s:3000"]}}}\n' "$DEMO_API_PORT" > "$work/upstream.json"
  compose_args+=(-f "$work/upstream.json")
fi
local_services=("${web_services[@]}")
if (( ${#data_services[@]} )); then local_services+=("${data_services[@]}"); fi
mkdir -m 0777 "$EMISSION_MARKER_DIR" # O diretório pai temporário tem modo 0700.
umask 077
if [[ $placement == externo && -n ${CASSANDRA_AUTH_ENV_FILE:-} ]]; then
  cat "$CASSANDRA_AUTH_ENV_FILE" > "$API_ENV_FILE"
  printf '\n' >> "$API_ENV_FILE"
fi
python3 - <<'PY' >> "$API_ENV_FILE"
import os, secrets
print("FF1_KEY=" + secrets.token_hex(32))
print("FF1_TWEAK=" + secrets.token_hex(8))
print("INSTALLATION_ID=" + os.environ["INSTALLATION_ID"])
PY
compose() { COMPOSE_PROFILES= docker compose "${compose_args[@]}" -p "$project" "$@"; }
cache() {
  docker run --rm -i --pull never --network "${project}_default" -e REDIS_URL -e INSTALLATION_ID \
    "${API_IMAGE:-encurtador-api:0.1.0}" node --input-type=module - "$@" < deploy/demo/cache-ensaio.mjs
}
phase() { echo "$1" > "$out/fase.tmp"; mv "$out/fase.tmp" "$out/fase"; }
monitor=
shared_cache_started=false
cleanup() {
  local result=$?
  if [[ -n $monitor ]]; then kill "$monitor" 2>/dev/null || true; wait "$monitor" || true; fi
  if [[ $shared_cache_started == true ]]; then
    compose stop api >> "$out/limpeza.log" 2>&1 || result=1
    cache limpar >> "$out/cache.txt" || result=1
  fi
  compose down -v >> "$out/limpeza.log" 2>&1 || result=1
  rm -rf "$work"
  return "$result"
}
trap 'cleanup || exit $?' EXIT
python3 - "$placement" "$database_host" "$redis_mode" "$nginx_mode" "${local_services[@]}" > "$out/colocacao.json" <<'PY'
import json, os, socket, sys
print(json.dumps({"cassandra_mode": sys.argv[1], "api_host": socket.gethostname(),
                  "redis_mode": sys.argv[3], "nginx_mode": sys.argv[4], "local_services": sys.argv[5:],
                  "public_origin": os.environ["PUBLIC_ORIGIN"], "installation": os.environ["INSTALLATION_ID"],
                  "database_host": sys.argv[2], "contact_points": os.environ["CASSANDRA_CONTACT_POINTS"],
                  "port": os.environ["CASSANDRA_PORT"], "datacenter": os.environ["CASSANDRA_DATACENTER"],
                  "keyspace": os.environ["CASSANDRA_KEYSPACE"]}, ensure_ascii=False))
PY
phase partida
python3 deploy/demo/medir.py "$project" "$out" &
monitor=$!
await_cql() {
  for ((i=0;i<100;i++)); do
    if compose exec -T cassandra cqlsh -e 'SELECT release_version FROM system.local' >/dev/null 2>&1; then return; fi
    sleep 2
  done
  echo "Cassandra não respondeu ao CQL no prazo" >&2; return 1
}
ready() {
  local address
  address=$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$(compose ps -q api)")
  for ((i=0;i<60;i++)); do
    if curl --silent --fail --max-time 2 "http://$address:3000/internal/ready" >/dev/null; then return; fi
    sleep 1
  done
  echo "API sem prontidão" >&2; return 1
}
metrics() {
  local address
  address=$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$(compose ps -q api)")
  curl --silent --show-error --fail --max-time 3 "http://$address:3000/internal/metrics" > "$out/metricas-$1.json"
}
compose config --format json | python3 deploy/demo/orcamento.py "$STACK_BUDGET_MIB" "$MIN_MARGIN_MIB" "${local_services[@]}"
if (( ${#data_services[@]} )); then compose up --pull never --no-build -d "${data_services[@]}"; fi
if [[ $placement == local ]]; then
  await_cql
  compose exec -T cassandra cqlsh < deploy/cassandra/demo.cql
  compose exec -T cassandra cqlsh -k encurtador < deploy/cassandra/schema.cql
fi
compose run --rm -T --no-deps -v "$EMISSION_MARKER_DIR:/run/emissao-admin:rw" -e EMISSION_MARKER_FILE=/run/emissao-admin/emission.json api node dist/ids/recovery.js init 15776336
compose up --pull never --no-build -d "${web_services[@]}"
ready
if [[ $redis_mode == externo ]]; then
  cache iniciar > "$out/cache.txt"
  shared_cache_started=true
fi
metrics partida
phase repouso
sleep 5
metrics repouso
first='https://loja.example/a%2Fb?cor=azul%20claro#detalhes'
second='https://loja.example/c%2Fd?x=2#outro'
phase uso
short=$(python3 deploy/demo/verificar.py "$PUBLIC_ORIGIN" "$first")
sleep 1
metrics uso
phase cabecalhos
nginx_group=
if [[ $nginx_mode == local ]]; then
  nginx_pid=$(docker inspect -f '{{.State.Pid}}' "$(compose ps -q nginx)")
  nginx_group=/sys/fs/cgroup$(awk -F: '$1=="0"{print $3}' "/proc/$nginx_pid/cgroup")
  if [[ -r $nginx_group/memory.peak ]]; then cat "$nginx_group/memory.peak" > "$out/nginx-pico-antes.bytes"; fi
fi
client_args=(--network host)
if [[ -n ${SSL_CERT_FILE:-} ]]; then
  client_args+=(-v "$SSL_CERT_FILE:/tmp/encurtador-ca.pem:ro" -e NODE_EXTRA_CA_CERTS=/tmp/encurtador-ca.pem)
fi
docker run --rm --pull never "${client_args[@]}" \
  -v "$PWD/tests/ops/redirecionamento.mjs:/tmp/redirecionamento.mjs:ro" \
  "${API_IMAGE:-encurtador-api:0.1.0}" node /tmp/redirecionamento.mjs "$PUBLIC_ORIGIN" | tee "$out/redirecionamento.txt"
if [[ -n $nginx_group && -r $nginx_group/memory.peak ]]; then cat "$nginx_group/memory.peak" > "$out/nginx-pico-depois.bytes"; fi
sleep 1
metrics cabecalhos
phase reinicio
if [[ $placement == local ]]; then
  # Grave o primeiro vínculo em uma SSTable distinta antes da segunda criação.
  compose exec -T cassandra nodetool flush encurtador links
fi
compose stop "${local_services[@]}"
if (( ${#data_services[@]} )); then compose start "${data_services[@]}"; fi
if [[ $placement == local ]]; then await_cql; fi
compose start "${web_services[@]}"
ready
metrics frio-antes
for method in GET POST; do
  code=${short##*/}
  if [[ $redis_mode == local ]]; then
    compose exec -T redis redis-cli DEL "$INSTALLATION_ID:$code" >/dev/null
    [[ $(compose exec -T redis redis-cli EXISTS "$INSTALLATION_ID:$code") == 0 ]]
    printf 'Chave ausente antes de %s %s\n' "$method" "$code" >> "$out/cache.txt"
  else
    cache frio "$code" "$method" >> "$out/cache.txt"
  fi
  python3 deploy/demo/verificar.py "$PUBLIC_ORIGIN" "$first" "$short" "$method"
  metrics "frio-$method"
done
python3 - "$out" <<'PY' | tee -a "$out/cache.txt"
import json, sys
from pathlib import Path
directory = Path(sys.argv[1])
before = json.loads((directory / "metricas-frio-antes.json").read_text())
for method in ("GET", "POST"):
    after = json.loads((directory / f"metricas-frio-{method}.json").read_text())
    old, new = (m["operations"]["cqlRead"] for m in (before, after))
    if (before["processId"] != after["processId"] or new["count"] - old["count"] != 1
            or new["errors"] != old["errors"] or after["cacheHits"] != before["cacheHits"]):
        sys.exit(f"{method}: leitura com cache frio não confirmada na réplica do ensaio")
    print(f"{method} com cache frio: 1 leitura confirmada no Cassandra, 0 acertos no Redis")
    before = after
PY
next=$(python3 deploy/demo/verificar.py "$PUBLIC_ORIGIN" "$second")
[[ $short != "$next" ]]
python3 deploy/demo/verificar.py "$PUBLIC_ORIGIN" "$first" "$short"
metrics reinicio
if [[ $placement == local ]]; then
  phase compactacao
  compose exec -T cassandra nodetool flush encurtador links
  compose exec -T cassandra nodetool compact encurtador links
  compose exec -T cassandra nodetool compactionhistory > "$out/compactacao.txt"
  grep -Eq '[[:space:]]encurtador[[:space:]]+links[[:space:]]' "$out/compactacao.txt"
  python3 deploy/demo/verificar.py "$PUBLIC_ORIGIN" "$second" "$next"
  metrics compactacao
  sleep 1
fi
kill "$monitor"
wait "$monitor"
monitor=
compose images > "$out/imagens.txt"
python3 deploy/demo/resumir.py "$out" "$STACK_BUDGET_MIB" "$MIN_MARGIN_MIB"
