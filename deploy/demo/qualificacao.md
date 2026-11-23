# Qualificar uma instalação compartilhada

A medição considera a memória de toda a máquina e a saúde de quem já a utiliza. Em um host Linux com Docker Engine, cgroup v2, Bash, Python 3 e curl, faça primeiro o [levantamento de memória, portas e serviços](preflight.md). Escolha quais serviços serão novos e meça o orçamento disponível. Execute o ciclo em um projeto de teste com uma origem e dados próprios. O script inicializa a emissão e remove seus contêineres e volumes ao terminar.

## Reproduzir o ensaio leve

Na raiz do clone completo, deixe disponíveis no daemon as imagens da API e do NGINX da [instalação](../../docs/instalacao.md) e as imagens de dados fixadas no Compose. Exporte `API_IMAGE` e `NGINX_IMAGE` no shell com as referências escolhidas. O coletor usa o socket local do Docker e os cgroups do próprio host. No Docker Desktop essas medições pertencem à VM Linux.

```sh
docker image inspect "$API_IMAGE" "$NGINX_IMAGE" >/dev/null
docker compose --profile cassandra --profile redis pull cassandra redis

export STACK_BUDGET_MIB="${ORCAMENTO_MEDIDO:?informe o orçamento em MiB}"
export MIN_MARGIN_MIB="${MARGEM_MEDIDA:?informe a margem em MiB}"
export NEIGHBOR_HEALTH_URL="${SAUDE_VIZINHO:?informe uma sonda do vizinho}"
bash tests/ops/demo.sh
```

O orçamento e a margem devem ser positivos e finitos. A sonda é opcional para exercitar o script. Para avaliar convivência com outro serviço, use um endereço dele que represente sua disponibilidade. Os limites padrão de Cassandra, API, NGINX e Redis somam 1.256 MiB (1.024 + 160 + 24 + 48). Os heaps padrão são 384 MiB para Cassandra, 64 MiB de geração antiga para V8 e 16 MiB de `maxmemory` para Redis. O restante do limite atende alocações nativas, processos auxiliares e cache de páginas. Confira a soma dos limites da colocação escolhida antes da partida.

O ciclo mede partida, repouso, uso, resposta com cabeçalhos grandes, reinício e, quando o Cassandra é local, compactação. São cinco criações confirmadas. Os controles incluem destinos ASCII e Unicode em corpos de até 1 MiB, ambas as rotas com `302`, `Location` completo e `Cache-Control: no-store`, e a leitura de um vínculo criado antes do reinício.

### Reproduzir com o Cassandra em outro host

Prepare um Cassandra 5 de laboratório acessível pela rede dos contêineres, com `storage_compatibility_mode: NONE` e datacenter conhecido. Use um keyspace novo, um domínio de teste sem emissões anteriores e uma conta restrita a `SELECT` e `MODIFY` nesse keyspace. O administrador aplica o esquema antes da medição. Exemplo para um nó em `datacenter1`, com acesso administrativo já configurado em cqlsh e um nome exclusivo de keyspace.

```sh
KS=encurtador_demo_qualificacao
cqlsh "$DB_HOST" "$DB_PORT" -e "CREATE KEYSPACE $KS WITH replication={'class':'NetworkTopologyStrategy','datacenter1':1}" &&
  cqlsh "$DB_HOST" "$DB_PORT" -k "$KS" -f deploy/cassandra/schema.cql
```

Na máquina sob medição, defina `KS` com o nome criado na estação administrativa e exporte as variáveis abaixo. Mantenha o orçamento e a margem calculados para os serviços locais. O arquivo protegido indicado por `CASSANDRA_AUTH_ENV_FILE` contém `CASSANDRA_USERNAME` e `CASSANDRA_PASSWORD`. O Cassandra externo continua em operação durante o reinício da aplicação. A conta administrativa controla a remoção posterior do keyspace e das permissões de teste.

```sh
export DEMO_CASSANDRA=externo DEMO_DATABASE_HOST=laboratorio-dados
export CASSANDRA_CONTACT_POINTS="$ENDPOINT_PRIVADO" CASSANDRA_PORT="$PORTA_CQL"
export CASSANDRA_DATACENTER=datacenter1 CASSANDRA_KEYSPACE="$KS"
export CASSANDRA_AUTH_ENV_FILE="$ARQUIVO_PROTEGIDO"
bash tests/ops/demo.sh
```

### Redis e NGINX compartilhados

A colocação de Redis é independente da de Cassandra. Para testar com um Redis preexistente, exporte `DEMO_REDIS_MODE=externo` e `REDIS_URL` com o endereço acessível aos contêineres. Use credenciais de laboratório que permitam `SCAN` e acesso ao prefixo exclusivo do ensaio e à sua chave sentinela. O script limpa as chaves próprias e confirma o valor da sentinela em outro prefixo antes de removê-la. Uma chave independente da sua aplicação também pode ser conferida antes e depois.

Para reutilizar uma entrada NGINX, reserve um virtual host no laboratório. Disponibilize os estáticos da mesma imagem em `/srv/encurtador/`, o arquivo de [rotas da distribuição](../nginx/rotas.conf) em `/etc/nginx/encurtador-rotas.conf` e o upstream no loopback do host da API. O exemplo usa um NGINX com acesso à rede desse host. Valide com `nginx -t` antes da recarga. Um proxy em outro namespace precisa de encaminhamento privado até o upstream.

```nginx
upstream encurtador { server 127.0.0.1:18083; }
server {
    listen 127.0.0.1:18081;
    include /etc/nginx/encurtador-rotas.conf;
}
```

```sh
export DEMO_NGINX_MODE=existente PUBLIC_ORIGIN=http://127.0.0.1:18081 DEMO_API_PORT=18083
bash tests/ops/demo.sh
```

O host e o contêiner cliente precisam alcançar `PUBLIC_ORIGIN`. Para HTTPS com CA de laboratório, exporte `SSL_CERT_FILE` com o caminho absoluto do PEM. NGINX e Redis preexistentes continuam atendendo durante o reinício do projeto. O uso total do host inclui seus processos. A soma dos cgroups da pilha inclui apenas os serviços criados pelo ensaio.

## Interpretar o relatório

O script imprime o diretório dos resultados. `colocacao.json` identifica a topologia. Em `resultado.json`, cada fase deve ter leitura simultânea de todos os serviços locais, pico compatível com as leituras parciais, soma dos limites dentro do orçamento e memória disponível do host acima ou igual à margem. Uma observação que cruza uma troca de fase continua valendo para verificar limites, OOM e a sonda. Atribuir o pico a uma fase exige uma observação estável. Pico `null`, OOM, sonda com falha ou violação dos limites exige consultar `failures` antes de usar o resultado.

Depois do reinício, o script esfria somente a chave do vínculo testado antes de cada GET e POST. `cache.txt` e as três coletas `metricas-frio-*.json` devem mostrar a mesma réplica, uma leitura CQL bem-sucedida e zero acertos de cache para cada rota. `redirecionamento.txt` registra os tamanhos conferidos nos testes de cabeçalho. Para reprocessar uma medição ou executar os controles do coletor, execute os comandos abaixo.

```sh
python3 deploy/demo/resumir.py "$DIRETORIO_RELATORIO" "$STACK_BUDGET_MIB" "$MIN_MARGIN_MIB"
python3 tests/ops/test_resumir.py -v
```

| Ensaio local em VM ARM64 de 2 GiB, 2 vCPUs e sem swap | Orçamento da pilha | Maior soma simultânea | Mínimo disponível no host |
| --- | ---: | ---: | ---: |
| API, NGINX, Redis e Cassandra na VM | 1.345 MiB | 1.105,68 MiB no reinício | 548,64 MiB |
| API, NGINX e Redis na VM, Cassandra externo | 232 MiB | 92,82 MiB nos cabeçalhos | 1.354,33 MiB |

Nos dois perfis, o vizinho sintético mantinha 160 MiB alocados e acrescentava 64 MiB em parte de cada ciclo. A margem exigida era de 192 MiB. Todas as sondas responderam e o contador de OOM permaneceu estável. A janela curta de laboratório mede esses perfis. A margem em uma VPS compartilhada depende dos vizinhos e da carga reais.

## Conferir um vínculo pela entrada

O verificador Python compara o status, a origem e a grafia integral do `Location`, inclusive escapes e fragmento, sem seguir o redirecionamento. Com um link como terceiro argumento, ele consulta um vínculo existente.

```sh
DESTINO='https://loja.example/café%2Fpedido?q=mão%2b#índice'
LINK=$(python3 deploy/demo/verificar.py "$PUBLIC_ORIGIN" "$DESTINO")
python3 deploy/demo/verificar.py "$PUBLIC_ORIGIN" "$DESTINO" "$LINK" GET
python3 deploy/demo/verificar.py "$PUBLIC_ORIGIN" "$DESTINO" "$LINK" POST
```

Para um destino longo, passe `-` no lugar de `"$DESTINO"` e redirecione um arquivo UTF-8 com o texto literal, sem quebra de linha final. A origem pública aceita grafias canônicas equivalentes, inclusive portas padrão. Para um hostname internacional sem escapes, disponibilize Node.js ou informe em `VERIFICAR_HOST_ASCII` o valor de `new URL(destino).hostname` obtido no navegador. Para um host internacional na própria origem, a variável correspondente é `VERIFICAR_ORIGEM_HOST_ASCII`.

## Reverter a publicação e retomar a mesma demo

1. Antes de trocar a entrada compartilhada, guarde, em diretório protegido, a saída de `nginx -T`, os arquivos ativos que mudarão e uma resposta identificável da rota atual. Registre a saúde do vizinho, a identidade do projeto e dos volumes, o checksum da marca de emissão e o par destino/link de controle quando publicado. Em um contêiner, monte o diretório pai da configuração para que a troca de arquivo por rename fique visível. Preserve também a configuração da demo.
2. Se a margem cair, confira se o arquivo ativo ainda corresponde à versão publicada. Reconcilie alterações de outros operadores antes da troca. Reponha atomicamente o virtual host anterior, valide `nginx -t` e só então faça `nginx -s reload`. Se a validação falhar, recoloque a última configuração válida. Aguarde os novos workers servirem a resposta anterior e confirme a saúde do vizinho.
3. Com as opções Compose do projeto correto, execute `docker compose stop api` para drenar a API. Pare só os serviços de dados que pertencem ao projeto. Conserve os volumes, a chave, o tweak, a marca e a origem. Confira os volumes e a marca contra o inventário anterior.
4. Antes de retomar, repita o pré-voo. Inicie os serviços de dados próprios com os mesmos volumes, confira CQL e `PING` do Redis, inicie a API e consulte sua prontidão privada. Reaplique e valide a rota da demo, remova apenas a chave Redis do vínculo de controle antes de cada método e repita o GET e POST acima. Se o volume ou a marca mudou, siga o [procedimento de restauração](../ha/recuperacao.md) antes de autorizar criações.
