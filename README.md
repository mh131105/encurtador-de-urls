# Encurtador de URLs

Um serviço auto-hospedado para criar links curtos no seu domínio. Cole uma URL na página inicial ou envie-a pela API. O serviço confirma a gravação no Cassandra e devolve um código de sete caracteres que continua apontando para o mesmo destino por dez anos civis. Quem cria ou abre um link pode usar o serviço sem cadastro.

A aplicação e a distribuição foram verificadas localmente. A medição na VPS compartilhada, o teste de falha entre hosts e a campanha de carga de 24 horas aguardam infraestrutura.

## Demonstração da API

Com a instalação local em execução, crie um link para um destino que contém um acento, escapes, consulta e fragmento. O POST responde com `201 Created` e um JSON como `{"short_url":"http://localhost:8080/k7Q2aZ9"}`. O comando abaixo guarda o código emitido pela sua instalação.

```sh
BASE=http://localhost:8080
CURTO=$(curl -fsS -H 'Content-Type: application/json' \
  -d '{"url":"https://loja.example/café%2Fpedido?q=mão%2b#índice"}' \
  "$BASE/api/v1/encurtar" | python3 -c 'import json,sys; print(json.load(sys.stdin)["short_url"])')
printf '%s\n' "$CURTO"
curl -si "$CURTO"
curl -si -H 'Content-Type: application/json' \
  -d "{\"short_url\":\"$CURTO\"}" "$BASE/api/v1/redirecionar"
```

As duas consultas devolvem o mesmo redirecionamento. Os escapes `%2F` e `%2b` mantêm a grafia original, e o navegador pode usar o fragmento para abrir a seção certa.

```http
HTTP/1.1 302 Found
Cache-Control: no-store
Location: https://loja.example/caf%C3%A9%2Fpedido?q=m%C3%A3o%2b#%C3%ADndice
```

## Funcionalidades

- **Página de criação.** Depois da confirmação, o formulário exibe o link e permite copiá-lo pelo teclado. Se o navegador bloquear a área de transferência, o campo seleciona o endereço inteiro para cópia manual.
- **Links independentes.** Duas criações para o mesmo destino recebem códigos diferentes. Letras maiúsculas e minúsculas distinguem códigos. Um código vencido nunca é reatribuído.
- **Destinos internacionais.** A API aceita endereços HTTP e HTTPS com ideogramas, acentos e emoji. O Cassandra guarda o texto original e a resolução o representa em um cabeçalho HTTP válido.
- **Leitura com falhas de cache.** Se o Redis falhar, a API consulta o Cassandra. Um vínculo ausente ou vencido recebe `404`. Se a leitura persistente falhar sem um resultado válido no cache, a resposta é `503`.

## Tecnologias e decisões

| Componente | Decisão |
| --- | --- |
| Node.js e TypeScript | A API usa o servidor HTTP nativo e concentra a lógica de resolução das duas rotas. Os testes de contrato exercitam status, cabeçalhos e destino. |
| Apache Cassandra e FF1 | O banco guarda cada vínculo pela chave curta e reserva blocos de identificadores para as réplicas. A permutação FF1 com AES produz códigos Base62 sem expor a sequência. Uma marca externa evita reutilizar faixas após restauração. |
| Redis | Guarda cópias de vínculos ativos. O vencimento também é conferido pela aplicação a cada leitura. |
| React, Astryx, Vite e NGINX | React e Astryx compõem o formulário. O Vite gera os arquivos estáticos e o NGINX serve a página e encaminha a API pela mesma origem. |

As decisões sobre retenção, emissão e operação distribuída têm seus critérios de aceite no repositório. [PRD](PRD.md) · [Especificação](specs/001-encurtador/spec.md) · [Plano técnico](specs/001-encurtador/plan.md)

## Executar localmente

Clone o repositório em uma máquina com Git, Bash, Docker Engine com Compose v2 e OpenSSL.

```sh
git clone https://github.com/mh131105/encurtador-de-urls.git
cd encurtador-de-urls
```

Na raiz do projeto, os comandos abaixo criam uma **instalação nova** em `http://localhost:8080`. O Cassandra e o Redis rodam em contêineres e os dados ficam em volumes do Compose. As etiquetas `0.1.0` identificam as imagens construídas localmente.

```sh
docker build -t "${API_IMAGE:-encurtador-api:0.1.0}" .
docker build -f deploy/nginx/Dockerfile -t "${NGINX_IMAGE:-encurtador-nginx:0.1.0}" .

# Gere a chave uma vez. O shell recusa sobrescrever api.env.
(umask 077; set -C; { printf 'FF1_KEY='; openssl rand -hex 32; printf 'INSTALLATION_ID=encurtador-local\n'; } > api.env)
export COMPOSE_PROFILES=cassandra,redis
export PUBLIC_ORIGIN=http://localhost:8080
export EMISSION_MARKER_DIR="$PWD/state/emission"
mkdir -p "$EMISSION_MARKER_DIR"
docker compose config --quiet
docker compose up -d cassandra redis
until docker compose exec -T cassandra cqlsh -e 'SELECT release_version FROM system.local' >/dev/null 2>&1; do sleep 2; done
docker compose exec -T cassandra cqlsh < deploy/cassandra/demo.cql
docker compose exec -T cassandra cqlsh -k encurtador < deploy/cassandra/schema.cql
docker compose run --rm -T --no-deps --user 0 -v "$EMISSION_MARKER_DIR:/run/emissao-admin:rw" api chown node:node /run/emissao-admin
docker compose run --rm -T --no-deps -v "$EMISSION_MARKER_DIR:/run/emissao-admin:rw" -e EMISSION_MARKER_FILE=/run/emissao-admin/emission.json api node dist/ids/recovery.js init 15776336
docker compose up -d api nginx
```

Abra `http://localhost:8080/` e use **Encurtar**. Para interromper e retomar a mesma instalação, use `docker compose stop` e `docker compose start`, no mesmo diretório e com as mesmas variáveis. Conserve os volumes, `api.env`, o domínio e `state/emission`. [Configuração e operação](docs/guia-local.md#configuração-e-operação) · [Backup e recuperação](deploy/ha/recuperacao.md)

## Verificar

Para conferir o exemplo acima, use `curl` e Python 3. Para repetir a suíte integrada, use Node.js 24.22.3 com npm, Bash, Python 3, OpenSSL e Docker Compose. O script cria um projeto descartável, testa o formulário no navegador e as duas rotas com NGINX, Cassandra e Redis reais. Ao terminar, remove os contêineres e os volumes desse projeto de teste.

```sh
npm --prefix web ci
./web/node_modules/.bin/playwright install --with-deps chromium
bash tests/ops/ci.sh
```

No macOS com o Google Chrome instalado, você também pode usar `PLAYWRIGHT_CHANNEL=chrome bash tests/ops/ci.sh` após instalar as dependências de `web/`. O guia reúne os comandos para testar só o formulário, as rotas ou a recuperação e registra as medições locais. [Guia local](docs/guia-local.md) · [CI do repositório](.github/workflows) · [Testes de contrato](tests/contract)

## Limitações e próximos ensaios

- **VPS compartilhada.** Em uma VM de 2 GiB com um serviço vizinho sintético, a pilha completa atingiu 1.105,68 MiB no reinício e o host manteve pelo menos 548,64 MiB disponíveis. A definição dos limites para a VPS depende da medição com os serviços reais. [Qualificação da demo](deploy/demo/qualificacao.md)
- **Alta disponibilidade e carga.** A amostra local confirmou dez criações e cem resoluções, todas para o destino esperado. Continuam pendentes o ensaio de perda de hosts independentes e a campanha de 24 horas para a meta de 100 milhões de criações e 1 bilhão de resoluções. [Roteiro de failover](tests/ops/failover.md) · [Relatório de carga](tests/load/relatorio.md) · [Aceites pendentes](specs/001-encurtador/tasks.md)

## Autoria, créditos e licenças

O mantenedor [@mh131105](https://github.com/mh131105) definiu as decisões de produto. A implementação, os testes e a documentação tiveram apoio do Codex, seguindo o fluxo de desenvolvimento por especificação do GitHub Spec Kit. A interface usa a biblioteca Astryx, da Meta. [GitHub Spec Kit](https://github.com/github/spec-kit) · [Astryx](https://github.com/meta/astryx)

A aplicação usa Apache-2.0. As skills, os scripts, os modelos e o fluxo integrado provenientes do GitHub Spec Kit usam a licença MIT. [Licença da aplicação](LICENSE) · [Licença do GitHub Spec Kit](docs/licencas/spec-kit-MIT.txt)
