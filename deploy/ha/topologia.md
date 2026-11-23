# Instalação distribuída de referência

Use a mesma imagem da API e a mesma imagem dos estáticos nos dois lados. Registre os digests implantados, parâmetros FF1, keyspace, limites autorizados e origem pública. A chave e o arquivo de marca externa precisam representar a mesma instalação em todas as APIs. Consulte o procedimento de recuperação antes de iniciar um nó restaurado.

| Componente | Posicionamento e configuração |
| --- | --- |
| Entrada | Dois hosts de NGINX em domínios de falha diferentes. Um balanceador redundante do operador ou endereço virtual com failover mantém a mesma origem pública e o TLS. Configure no balanceador uma sonda HTTP de `GET /` em cada entrada e retire entradas sem resposta. |
| Aplicação | Duas réplicas em hosts distintos na rede privada. Os nomes `api-a` e `api-b` no [NGINX](nginx.conf) apontam para esses endereços e devem resolver antes de iniciar as entradas. Na troca de endereço, recarregue o NGINX. Ambas as APIs usam o mesmo digest da demo, `PUBLIC_ORIGIN`, `INSTALLATION_ID`, parâmetros FF1 e dados. |
| Cassandra | Três hosts em três domínios de falha. Todos no mesmo datacenter `datacenter1`, em racks que representem esses domínios. Use `NetworkTopologyStrategy` com RF 3. Nos clientes, liste os três contact points e configure `CASSANDRA_CONSISTENCY=LOCAL_QUORUM`. O alocador usa LWT com consenso `LOCAL_SERIAL`. |
| Redis | Endpoint privado com prefixo por instalação. Cada réplica volta a consultar o Cassandra quando o cache está indisponível. |
| Emissão e cópias | Monte em todas as APIs o mesmo diretório de emissão, servido por armazenamento durável e redundante fora do cluster Cassandra, em domínios de falha distintos. O armazenamento precisa continuar acessível e apresentar a última versão confirmada após a perda de qualquer um dos hosts. Serialize a escrita administrativa, com rename atômico, fsync e visibilidade coerente em todos os leitores. Cada criação relê a marca, inclusive quando ainda há IDs no bloco local. Perder o único servidor do diretório bloqueia imediatamente a criação. Teste a continuidade de acesso à marca e a restauração antes de reabrir emissão. |

Prepare o keyspace com `deploy/cassandra/ha.cql` e o esquema com `deploy/cassandra/schema.cql`. O arquivo de topologia usa `datacenter1`; confira o nome real em `system.local` e em `nodetool status`. Ative `storage_compatibility_mode: NONE` nos nós Cassandra 5 de uma implantação nova. As réplicas devem estar prontas antes de receber tráfego. Consulte `/internal/live` e `/internal/ready` diretamente pela rede privada das APIs. O NGINX recusa essas rotas na entrada pública.

Na máquina de build, gere `encurtador-nginx:0.1.0` com `docker build -f deploy/nginx/Dockerfile -t encurtador-nginx:0.1.0 .`. A imagem contém `/`, os bundles de `/assets/` e as regras compartilhadas das duas topologias. Em cada entrada, monte apenas `deploy/ha/nginx.conf` como `/etc/nginx/nginx.conf:ro`. Mantenha `/etc/nginx/encurtador-rotas.conf` da imagem. Valide no host com os nomes das APIs disponíveis e rode o ensaio de rotas da distribuição antes do failover.

Para verificar o quórum, a capacidade de continuar após perda de um host e o tempo de recuperação, siga o [ensaio de failover](../../tests/ops/failover.md) em infraestrutura dedicada.

## Ligar as entradas às APIs pela rede privada

Cada host de API publica a porta 3000 no IPv4 da sua interface privada. Escolha endereços alcançáveis a partir dos dois hosts de entrada e permita TCP/3000 deles nas regras da rede privada. No exemplo, os hosts das APIs têm os endereços `10.40.0.11` e `10.40.0.12`. Aplique o complemento [api-privada.yaml](api-privada.yaml) junto com o Compose da raiz. Conserve a seleção de arquivos e o IP no ambiente que opera a réplica, inclusive ao recriá-la no procedimento de consistência.

```sh
# A partir da raiz da distribuição, no primeiro host de API.
# No segundo host, use API_PRIVATE_IP=10.40.0.12.
export COMPOSE_FILE=compose.yaml:deploy/ha/api-privada.yaml
export API_PRIVATE_IP=10.40.0.11
docker compose config --quiet
docker compose up -d --no-deps api
docker compose port api 3000
```

Confira `10.40.0.11:3000` no primeiro host e `10.40.0.12:3000` no segundo. Em cada entrada, configure o DNS privado do contêiner para resolver `api-a` e `api-b` nesses IPs ou fixe os dois endereços com `--add-host`, como no exemplo. A porta 80 da entrada fica acessível ao balanceador TLS pelo IPv4 privado do próprio host de entrada.

```sh
# Em cada host de entrada, ajuste o IP local e os dois IPs das APIs.
export ENTRADA_IP=10.40.0.21
docker run -d --name encurtador-entrada --restart unless-stopped \
  --add-host api-a:10.40.0.11 --add-host api-b:10.40.0.12 \
  -p "${ENTRADA_IP}:80:80" \
  -v "$PWD/deploy/ha/nginx.conf:/etc/nginx/nginx.conf:ro" \
  "${NGINX_IMAGE:-encurtador-nginx:0.1.0}"
docker exec encurtador-entrada nginx -t
for replica in api-a api-b; do
  docker exec encurtador-entrada wget -Y off -S -O /dev/null "http://$replica:3000/internal/ready" || exit 1
done
```

Exija `200` das duas APIs em cada entrada antes de liberar o tráfego. Na troca de um IP fixado por `--add-host`, recrie a entrada com o novo mapeamento.

### Laboratório de rede em um host Linux (T072)

Use Docker Engine local em Linux e uma instalação **descartável**, preparada pelo [guia da demo](../../docs/guia-local.md#subir-a-página-e-conservar-os-links), com o Cassandra RF 1, o Redis, a marca de emissão e as imagens já disponíveis. Reserve `127.0.0.2:3000`, `127.0.0.3:3000` e `127.0.0.1:18072`. Na mesma raiz e com o mesmo projeto e ambiente da demo de teste, execute os comandos em Bash. As duas APIs compartilham a bridge padrão do projeto, o banco e a marca. A [entrada do laboratório](laboratorio.yaml) usa a rede do host e resolve os dois nomes pelos IPs onde o Docker publicou as portas. Seu NGINX usa o arquivo de HA com o listener em `127.0.0.1:18072`.

```sh
set -eu
export COMPOSE_FILE=compose.yaml:deploy/ha/api-privada.yaml:deploy/ha/laboratorio.yaml
export API_PRIVATE_IP=127.0.0.2 PUBLIC_ORIGIN=http://127.0.0.1:18072
docker compose config --quiet
docker compose up -d api api-b entrada-rede
for replica in api-a api-b; do
  sonda="http://$replica:3000/internal/ready"
  for ((tentativa=1; tentativa<=30; tentativa++)); do
    if docker compose exec -T entrada-rede wget -Y off -T 2 -q -O /dev/null "$sonda"; then break; fi
    sleep 1
  done
  docker compose exec -T entrada-rede wget -Y off -T 2 -S -O /dev/null "$sonda"
done
node tests/ops/redirecionamento.mjs "$PUBLIC_ORIGIN"
for rota in live ready metrics; do
  status=$(curl --noproxy '*' --max-time 10 -sS -o /dev/null -w '%{http_code}' "$PUBLIC_ORIGIN/internal/$rota")
  test "$status" = 404
done
docker compose stop entrada-rede api-b api
```

O cliente de ensaio exige três criações com `201` pela entrada. No GET do código e no POST de resolução, lê a resposta sem seguir o redirecionamento e exige `302`, `Cache-Control: no-store` e o `Location` completo com escapes, consulta e fragmento. A última conferência exige `404` para as três rotas internas na mesma origem pública.

**Resultado em um host Linux.** Em 23/11/2026, o roteiro acima rodou no Docker Engine 29.5.2 com Compose 2.40.3 e os dois processos de API separados. A entrada em rede do host obteve `200` nas duas sondas privadas. As três rotas internas devolveram `404` pela origem pública. Uma consulta CQL ao keyspace descartável antes e depois de executar o cliente confirmou três vínculos adicionais (6 → 9). Os três tamanhos de `Location` estão na [descrição do ensaio](#provas-locais-de-configuração).

**Resultado entre dois hosts Linux.** No mesmo computador físico, duas VMs Alpine usaram kernels e daemons Docker distintos, ligados por um switch virtual privado. Em uma VM, duas APIs em projetos separados compartilharam Cassandra 5.0.6 RF 1, Redis 7.4.6 e a marca de emissão. Na outra, duas entradas NGINX resolveram os IPs privados das APIs usando o arquivo de HA. As imagens foram `sha256:66d75cb5e38cdcffe490ca94aec9e238c3e2f8d71845116989deb3fc88228694` (API) e `sha256:40f11fee7813a8425918a767fc8f662b9bb013bbed19ffea9eb72623089c1f8d` (NGINX), também usadas no ensaio de um host.

Antes de publicar as portas, as APIs estavam prontas dentro de seus contêineres. Os nomes resolviam nas entradas, mas as quatro tentativas de conexão a `api-a:3000` e `api-b:3000` foram recusadas. Com o complemento de produção, o Docker publicou `172.27.72.11:3000` e `172.27.72.12:3000` na interface privada. As quatro sondas passaram. A leitura de métricas a partir das entradas confirmou dois processos distintos. A porta 3000 na outra interface da VM das APIs continuou inacessível.

As duas entradas publicaram a porta 80 nos seus IPs privados, `172.27.72.21` e `172.27.72.22`. Um cliente no outro host usou a mesma origem `http://curto.test` nas duas. O POST de criação pela primeira devolveu `201`. Cada entrada devolveu `302` nas duas rotas, com `Cache-Control: no-store` e `Location: https://loja.example/pedido%2F72?cor=azul%20claro&x=%2b#privado`. As consultas públicas a `/internal/live`, `/internal/ready` e `/internal/metrics` devolveram seis `404` com `no-store` e sem `Location`. A perda de um host continua sujeita ao ensaio T025 em infraestrutura independente.


## Expandir o keyspace existente de RF 1 para RF 3

Faça a migração numa janela de manutenção. Calcule espaço para três cópias, bootstrap e repair. Parta de um backup verificável dos vínculos e da reserva e mantenha a marca externa atual. Registre pelo menos um link confirmado, seu `Location` literal e a linha `principal` de `reservations`. Preserve a origem pública, o keyspace, o segredo, o tweak e o identificador da instalação. O procedimento amplia o banco em funcionamento e conserva o estado do alocador. [Backup e restauração](recuperacao.md)

1. Retire todas as APIs de criação da entrada e aguarde o encerramento das requisições. Mantenha a entrada em manutenção durante a mudança de RF e o repair. Com o anel ainda em RF 1, confira `nodetool status encurtador` no nó atual e confirme que seu estado é `UN`.
2. Adicione um nó por vez com a mesma versão e formato do Cassandra, o `cluster_name` e o `datacenter1` existentes. Configure endereços privados distintos, o nó existente como seed, `GossipingPropertyFileSnitch` e um rack diferente para cada domínio de falha. Inicie cada nó novo com diretórios de dados vazios e o bootstrap habilitado. Antes de iniciar o próximo, confira pelo nó existente que todos os membros esperados aparecem `UN` em `nodetool status encurtador`. Quando os três membros estiverem normais, confira o acordo de schema com `nodetool describecluster`.
3. Aplique o `ALTER KEYSPACE` abaixo ao keyspace **existente**. O arquivo `ha.cql` com `CREATE KEYSPACE IF NOT EXISTS` destina-se a uma instalação nova. O `ALTER` atualiza a estratégia, e o repair completo distribui os dados já gravados segundo o novo RF. Execute o repair das faixas primárias em cada nó, aguardando o sucesso anterior. Os exemplos usam `C1`, `C2` e `C3` como nomes dos contêineres definidos pelo operador do laboratório. Em hosts separados, execute os mesmos comandos de CQL e `nodetool` localmente em cada host. Ajuste os nomes do keyspace e datacenter à instalação. [Alteração de RF no Cassandra](https://cassandra.apache.org/doc/stable/cassandra/overview/faq/index.html) · [Repair completo e faixas primárias](https://cassandra.apache.org/doc/stable/cassandra/managing/operating/repair.html)

   ```sh
   set -eu
   docker exec "$C1" cqlsh -e "ALTER KEYSPACE encurtador WITH replication = {'class':'NetworkTopologyStrategy','datacenter1':3}"
   for no in "$C1" "$C2" "$C3"; do
     docker exec "$no" cqlsh -e "SELECT replication FROM system_schema.keyspaces WHERE keyspace_name='encurtador'"
   done
   # Confira NetworkTopologyStrategy e datacenter1=3 nos três resultados.
   for no in "$C1" "$C2" "$C3"; do
     docker exec "$no" nodetool repair -full -pr encurtador
   done
   docker exec "$C1" nodetool status encurtador
   docker exec "$C1" nodetool getendpoints encurtador links "$CODIGO_ANTERIOR"
   ```

4. Exija a conclusão com sucesso de cada repair, os três membros `UN` e os três endpoints para a chave anterior. Confira a linha de reserva e o destino conhecido com todas as réplicas disponíveis. Se houver divergência ou uma sessão de repair falhar, mantenha a manutenção e corrija a replicação antes de reabrir a entrada.

   ```sh
   docker exec "$C1" cqlsh -k encurtador -e "CONSISTENCY ALL; SELECT destination, created_at, expires_at, writetime(destination) FROM links WHERE code='$CODIGO_ANTERIOR'"
   docker exec "$C1" cqlsh -k encurtador -e "CONSISTENCY ALL; SELECT next_free, authorized_until, fingerprint, epoch FROM reservations WHERE installation='principal'"
   ```

5. Aplique e confira os três endereços e `LOCAL_QUORUM` em **cada** API pelo [procedimento de configuração das réplicas](#aplicar-a-consistência-em-cada-réplica). Use as mesmas imagens e a marca externa da demo. Depois que ambas as sondas privadas de prontidão responderem `200`, aponte a entrada da mesma origem para essas APIs. Remova do Redis apenas a chave do código de teste antes de cada consulta (`DEL <INSTALLATION_ID>:<codigo>`). Pelo GET e pelo POST público, confira o `302`, o `Location` original e `Cache-Control: no-store`. Crie outro link, confira o `201` e repita a leitura pela outra API com cache frio. Guarde os resultados junto da listagem do anel, dos repairs e da versão das imagens.

**Ensaio T047 em 23/11/2026.** Um único Docker Desktop executou o Cassandra 5.0.6 em três contêineres, cada qual em um rack lógico e volume próprios. Quatro destinos com escapes, consulta e fragmento foram criados e confirmados antes da expansão; o alocador já havia reservado dois blocos. O `ALTER` mudou o keyspace populado de RF 1 para RF 3. Cada repair completo terminou com sucesso. Os três nós informaram RF 3, `UN` e uma réplica para o código consultado. Uma leitura a `ALL` conferiu os quatro vínculos, `created_at`, `expires_at`, `writetime` e a reserva contra os valores anteriores. O arquivo externo também conservou seu SHA-256.

Na mesma origem pública, os quatro links antigos e os dois criados pelas APIs pós-expansão passaram pelo GET e pelo POST sem seguir o redirecionamento, esvaziando a chave testada antes de cada leitura. As duas APIs, com o mesmo digest e `LOCAL_QUORUM`, devolveram o destino correto aos clientes da outra réplica. O primeiro código novo correspondeu a 14.776.342, o `next_free` anterior à migração. A perda de um host e a vazão de 24 h continuam reservadas aos ensaios em infraestrutura independente.

## Aplicar a consistência em cada réplica

Mantenha a entrada em manutenção até concluir a verificação nos dois hosts. No Compose do repositório, os contact points são interpolados em `environment` e a consistência é lida do arquivo indicado por `API_ENV_FILE` (padrão `api.env`). Se exportar apenas `CASSANDRA_CONSISTENCY` no shell, uma API cujo arquivo omite a variável usará o padrão `ONE`.

Em **cada host da API**, use o mesmo projeto, arquivos Compose e opções com que aquela réplica foi instalada. Aponte `API_ENV_FILE` para o arquivo protegido da instalação. Adicione ou atualize a linha `CASSANDRA_CONSISTENCY=LOCAL_QUORUM` uma única vez, mantendo os parâmetros FF1, o identificador, as credenciais e demais valores existentes. O controle da demo RF 1 usa `CASSANDRA_CONSISTENCY=ONE` em seu próprio arquivo. Depois do repair da expansão, recrie apenas a API para ela receber o ambiente atualizado. O exemplo abaixo usa nomes privados ilustrativos e roda a partir da raiz.

```sh
export API_ENV_FILE=/etc/encurtador/api.env
export CASSANDRA_CONTACT_POINTS=db-a,db-b,db-c
test -r "$API_ENV_FILE" && docker compose up -d --no-deps --force-recreate api
```

Confira a configuração já interpretada pelo mesmo módulo usado pelo servidor. Execute o bloco a seguir em cada host. Ele exibe apenas os endereços e a consistência e encerra com código 1 se os valores divergirem. Ajuste os valores esperados para os três endereços definidos no plano da instalação.

```sh
conferir_cassandra() {
  docker compose exec -T api node --input-type=module - "$1" "$2" <<'JS'
import { loadConfig } from './dist/config/config.js';
import driver from 'cassandra-driver';
const [esperados, nivelEsperado] = process.argv.slice(2);
const config = loadConfig();
const nivel = driver.types.consistencyToString[config.consistency];
const enderecos = config.contactPoints.join(',');
console.log('CASSANDRA_CONTACT_POINTS=' + enderecos);
console.log('CASSANDRA_CONSISTENCY=' + nivel);
process.exitCode = enderecos === esperados && nivel === nivelEsperado ? 0 : 1;
JS
}
conferir_cassandra db-a,db-b,db-c LOCAL_QUORUM
```

No controle da demo local, execute `conferir_cassandra cassandra ONE`. Se qualquer réplica informar `ONE` no perfil RF 3 ou endereços diferentes dos três aprovados, mantenha a entrada fechada. Confira o caminho de `API_ENV_FILE` e o valor de `CASSANDRA_CONTACT_POINTS` desse projeto, corrija a linha no arquivo de ambiente e repita a recriação e a conferência. Só reabra a entrada depois de obter sucesso nos dois hosts, concluir a verificação do anel e receber `200` em `/internal/ready` de cada API.

**Ensaio T069 em 23/11/2026.** Duas APIs iniciadas separadamente pelo Compose usaram o digest de imagem `sha256:ae04a922e924b18591854b2149445edf20e3b376731632fee08f1c28f726f80e`. Exportar as duas variáveis no shell com a consistência ausente do arquivo produziu `db-a,db-b,db-c` e `ONE` nas duas. A conferência de `LOCAL_QUORUM` encerrou com código 1 em ambas. Com a linha no arquivo e as duas APIs recriadas, o mesmo comando informou os três contact points e `LOCAL_QUORUM` e encerrou com código zero em cada uma. O controle da demo devolveu `cassandra` e `ONE`. Este ensaio verificou a configuração efetiva das imagens. A distribuição de dados e as leituras e gravações em RF 3 foram exercitadas no ensaio T047 descrito acima.

## Provas locais de configuração

Em 23/11/2026, a configuração desta entrada passou em `nginx -t` com duas APIs reais em contêineres distintos no mesmo host. `/internal/live` e `/internal/ready` devolveram `200` nas duas APIs. Uma criação e duas resoluções passaram pela entrada com o destino original `https://ha.example/a%2Fb?q=%2f#ancora`. Os contadores privados mostraram uma criação e uma leitura na primeira API e uma leitura na segunda. O banco do ensaio funcional tinha um único nó. O CQL de HA aplicado num keyspace isolado produziu `NetworkTopologyStrategy`, `datacenter1=3`; o banco avisou que havia somente um nó.

Em 23/11/2026, o teste de perda da confirmação enviou um POST público válido em cada configuração de entrada. A API de teste leu o corpo inteiro e encerrou a conexão antes de responder. Tanto na demo quanto em HA, as APIs somadas receberam o POST uma vez e o cliente recebeu `503`, `Cache-Control: no-store` e nenhum `Location`. A prova usa NGINX real e falha controlada da API. O [ensaio entre hosts](../../tests/ops/failover.md) continua pendente.

Execute a partir da raiz, com as imagens construídas pelo [procedimento de instalação](../../README.md#executar-localmente). O primeiro comando inicia as duas entradas e os servidores de teste em um projeto Docker temporário, confere os registros das réplicas e encerra o projeto. Para o segundo, use a origem pública de uma instalação de teste já em execução.

```sh
node tests/ops/proxy-post.mjs
node tests/ops/redirecionamento.mjs "$PUBLIC_ORIGIN"
```

Cada execução de `redirecionamento.mjs` exige **três criações confirmadas** com `201`. A primeira usa um destino ASCII de 12 KiB. As outras duas usam corpos JSON de exatamente 1 MiB, um com destino ASCII e outro com acentos. Para cada código, o GET e o POST devem devolver `302`, `Cache-Control: no-store` e o `Location` completo. No terceiro vínculo, o cliente verifica nas duas rotas a expansão de cada `é` para `%C3%A9`, com os escapes, a consulta e o fragmento preservados. O ensaio HA com as imagens de T072 mediu cabeçalhos de 12.288, 1.048.566 e 3.145.570 bytes, respectivamente, no GET e no POST. Essas três criações também compõem as cinco do [ciclo completo da demo](../demo/qualificacao.md#reproduzir-o-ensaio-leve).

Na verificação dos estáticos em ambas as entradas, o asset apontado pelo HTML respondeu `200` com e sem consulta. O mesmo nome precedido por barra duplicada, segmento de ponto ou escape no prefixo respondeu `404`, com `Cache-Control: no-store` e sem `Location`.

Em 23/11/2026, a CI criou dois vínculos no Cassandra e os confirmou pela API publicada. Com prazo HTTP de 90 s e atraso de leitura controlado no servidor HTTP da API, o mesmo POST recebeu `302` aos 65 s no acesso direto e nas entradas da demo e de HA. O destino com escapes, consulta e fragmento foi idêntico nos três cabeçalhos `Location`. Para a resposta que ultrapassava o prazo, os três acessos receberam `503` aos 90 s sem `Location`. Todas as respostas incluíram `Cache-Control: no-store`. Na configuração anterior, a API direta retornava `302` aos 65 s e as entradas já haviam respondido `503` aos 60 s. Para repetir nos serviços de teste, execute o [roteiro da CI](../../tests/ops/ci.sh).
