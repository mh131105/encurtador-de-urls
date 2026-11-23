#!/usr/bin/env bash
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."

falhar() { printf 'Instalação interrompida. %s\n' "$*" >&2; exit 1; }
uso() { echo 'Uso: bash scripts/iniciar.sh [--build]'; }
case "${1:-}" in
  --help|-h) uso; exit 0 ;;
  ''|--build) ;;
  *) uso >&2; exit 2 ;;
esac
[[ $# -le 1 ]] || { uso >&2; exit 2; }
modo=${1:-hub}
docker compose version >/dev/null
docker info >/dev/null

if [[ ! -f state/instalacao ]]; then
  for caminho in .env api.env state; do
    [[ ! -e $caminho && ! -L $caminho ]] || falhar "Já existe $caminho sem identificação do iniciador. Consulte o guia de recuperação antes de prosseguir."
  done
  HTTP_PORT=${HTTP_PORT:-8080}
  HTTP_BIND=${HTTP_BIND:-127.0.0.1}
  PUBLIC_ORIGIN=${PUBLIC_ORIGIN:-http://localhost:$HTTP_PORT}
  PUBLIC_ORIGIN=${PUBLIC_ORIGIN%/}
  origem='^https?://([a-zA-Z0-9.-]+|\[[a-fA-F0-9:]+\])(:[0-9]+)?$'
  bind='^([0-9.]+|\[[a-fA-F0-9:]+\])$'
  [[ $PUBLIC_ORIGIN =~ $origem ]] || falhar 'PUBLIC_ORIGIN deve ser uma origem HTTP(S), sem caminho, consulta ou fragmento.'
  [[ $HTTP_BIND =~ $bind ]] || falhar 'HTTP_BIND deve ser um endereço IPv4 ou IPv6 entre colchetes.'
  [[ $HTTP_PORT =~ ^[1-9][0-9]{0,4}$ ]] && (( HTTP_PORT <= 65535 )) || falhar 'HTTP_PORT deve ser uma porta entre 1 e 65535.'
  projeto=${COMPOSE_PROJECT_NAME:-$(docker compose -f compose.yaml config --format yaml | sed -n 's/^name: //p')}
  [[ $projeto =~ ^[a-z0-9][a-z0-9_-]{0,79}$ ]] || falhar 'Defina um COMPOSE_PROJECT_NAME com letras minúsculas, números, hífen ou sublinhado.'
  volumes=$(docker volume ls -q --filter "label=com.docker.compose.project=$projeto")
  containers=$(docker ps -aq --filter "label=com.docker.compose.project=$projeto")
  [[ -z $volumes && -z $containers ]] || falhar "Já existe uma instalação Docker com o projeto $projeto."
  for volume in cassandra-data redis-data; do
    if docker volume inspect "${projeto}_$volume" >/dev/null 2>&1; then falhar "O volume ${projeto}_$volume já existe."; fi
  done

  api=mh131105/encurtador-de-urls:0.1.0
  web=mh131105/encurtador-de-urls-web:0.1.0
  if [[ $modo == --build ]]; then
    [[ -f Dockerfile && -f deploy/nginx/Dockerfile ]] || falhar 'A opção --build requer o clone completo do repositório.'
    api="$projeto-api:0.1.0"
    web="$projeto-web:0.1.0"
  fi
  chave=$(od -An -N32 -tx1 /dev/urandom | tr -d '[:space:]')
  [[ ${#chave} == 64 ]] || falhar 'Não foi possível gerar a chave de emissão.'
  mkdir state
  mkdir -m 755 state/emission
  (set -C; printf 'FF1_KEY=%s\nINSTALLATION_ID=%s\nCASSANDRA_CONSISTENCY=ONE\n' "$chave" "$projeto" > api.env)
  unset chave
  (set -C; printf '%s\n' "COMPOSE_PROJECT_NAME=$projeto" 'COMPOSE_PROFILES=cassandra,redis' "API_IMAGE=$api" "NGINX_IMAGE=$web" "HTTP_BIND=$HTTP_BIND" "HTTP_PORT=$HTTP_PORT" "PUBLIC_ORIGIN=$PUBLIC_ORIGIN" > .env)
  printf '%s\n%s\n' "$projeto" "$modo" > state/instalacao
fi

[[ -s .env && -s api.env && -d state/emission ]] || falhar 'Faltam arquivos da instalação. Preserve os dados e consulte a recuperação.'
projeto=$(sed -n '1p' state/instalacao)
[[ $modo == "$(sed -n '2p' state/instalacao)" ]] || falhar 'Repita o mesmo modo da primeira instalação (com ou sem --build).'
for nome in COMPOSE_PROJECT_NAME API_IMAGE NGINX_IMAGE HTTP_BIND HTTP_PORT PUBLIC_ORIGIN; do
  valor=$(sed -n "s/^${nome}=//p" .env)
  [[ -n $valor && $valor != *$'\n'* ]] || falhar "Confira $nome no .env da instalação."
  [[ -z ${!nome:-} || ${!nome} == "$valor" ]] || falhar "$nome no terminal difere do valor salvo em .env."
  export "$nome=$valor"
done
[[ $COMPOSE_PROJECT_NAME == "$projeto" ]] || falhar 'O projeto salvo diverge da identificação da instalação.'
# Esta instalação usa os serviços da própria pilha, inclusive no comando administrativo.
export COMPOSE_PROFILES=cassandra,redis API_ENV_FILE=./api.env EMISSION_MARKER_DIR=./state/emission
export CASSANDRA_CONTACT_POINTS=cassandra CASSANDRA_KEYSPACE=encurtador CASSANDRA_PORT=9042 CASSANDRA_DATACENTER=datacenter1 REDIS_URL=redis://redis:6379
compose() { docker compose --env-file .env -f compose.yaml -p "$projeto" "$@"; }
mkdir state/.iniciando || falhar 'Outro iniciador está ativo ou deixou state/.iniciando. Consulte o guia.'
trap 'rmdir state/.iniciando' EXIT
compose config --quiet
marca=state/emission/emission.json
if [[ -e state/pronta || -f $marca ]]; then
  [[ -f $marca ]] || falhar 'Marca de emissão ausente em instalação conhecida. Restaure os dados antes de iniciar.'
  for volume in cassandra-data redis-data; do
    if ! dono=$(docker volume inspect --format '{{index .Labels "com.docker.compose.project"}}' "${projeto}_$volume" 2>/dev/null); then
      [[ $volume == redis-data ]] && continue
      falhar "Volume $volume ausente. Consulte a recuperação."
    fi
    [[ $dono == "$projeto" ]] || falhar "O volume $volume pertence a outro projeto."
  done
fi

if [[ $modo == --build ]]; then
  docker build -t "$API_IMAGE" .
  docker build -f deploy/nginx/Dockerfile -t "$NGINX_IMAGE" .
fi
compose up -d cassandra redis
echo 'Aguardando o Cassandra aceitar consultas...'
for ((i=0; i<90; i++)); do
  if compose exec -T cassandra cqlsh -e 'SELECT release_version FROM system.local' >/dev/null 2>&1; then break; fi
  sleep 2
done
(( i < 90 )) || falhar 'Cassandra ainda indisponível. Veja docker compose logs cassandra e repita o iniciador.'
if [[ ! -f $marca ]]; then
  compose exec -T cassandra cqlsh < deploy/cassandra/demo.cql
  compose exec -T cassandra cqlsh -k encurtador < deploy/cassandra/schema.cql
  admin=(run --rm -T --no-deps -v "$PWD/state/emission:/run/emissao-admin:rw")
  compose "${admin[@]}" --user 0 api chown node:node /run/emissao-admin
  compose "${admin[@]}" -e EMISSION_MARKER_FILE=/run/emissao-admin/emission.json api node dist/ids/recovery.js init 15776336
fi

# Uma marca pode ter sido salva antes de o Cassandra confirmar a inicialização.
# Confira a autorização por leitura antes de subir o servidor ou dar a instalação por pronta.
compose run --rm -T --no-deps api node --input-type=module - <<'JS'
import cassandra from 'cassandra-driver';
import { loadConfig } from './dist/config/config.js';
import { parameterFingerprint } from './dist/ids/codec.js';
import { readMarker, ROW } from './dist/ids/recovery.js';
const config = loadConfig();
const marker = await readMarker(config.markerFile, config.installation, parameterFingerprint(config.key, config.tweak));
const db = new cassandra.Client({ contactPoints: config.contactPoints, localDataCenter: config.datacenter, keyspace: config.keyspace });
try {
  const row = (await db.execute('SELECT * FROM reservations WHERE installation=?', [ROW], { prepare: true })).first();
  if (!marker.enabled || !row || row.epoch.toString() !== marker.epoch || row.fingerprint !== marker.fingerprint ||
      row.authorized_until.toString() !== marker.limit || BigInt(row.next_free.toString()) < BigInt(marker.floor) ||
      BigInt(row.next_free.toString()) > BigInt(marker.limit)) {
    throw new Error('Marca e autorização divergentes ou congeladas. Consulte a recuperação antes de iniciar.');
  }
} finally { await db.shutdown(); }
JS
[[ -f state/pronta ]] || : > state/pronta
compose up -d api nginx
for ((i=0; i<30; i++)); do
  if compose exec -T api node -e "fetch('http://127.0.0.1:3000/internal/ready').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" >/dev/null 2>&1 &&
     compose exec -T nginx wget -qO /dev/null http://127.0.0.1/; then
    printf 'Instalação pronta. Abra %s/\n' "$PUBLIC_ORIGIN"
    exit 0
  fi
  sleep 1
done
falhar 'A página ou a API ainda não estão prontas. Veja docker compose logs api nginx.'
