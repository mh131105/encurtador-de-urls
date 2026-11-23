# Instalação distribuída de referência

Use a mesma imagem da API e a mesma imagem dos estáticos nos dois lados. Registre os digests implantados, parâmetros FF1, keyspace, limites autorizados e origem pública. A chave e o arquivo de marca externa precisam representar a mesma instalação em todas as APIs. Consulte o procedimento de recuperação antes de iniciar um nó restaurado.

| Componente | Posicionamento e configuração |
| --- | --- |
| Entrada | Dois hosts de NGINX em domínios de falha diferentes. Um balanceador redundante do operador ou endereço virtual com failover mantém a mesma origem pública e o TLS. Configure no balanceador uma sonda HTTP de `GET /` em cada entrada e retire entradas sem resposta. |
| Aplicação | Duas réplicas em hosts distintos na rede privada. Os nomes `api-a` e `api-b` no [NGINX](nginx.conf) apontam para esses endereços e devem resolver antes de iniciar as entradas. Na troca de endereço, recarregue o NGINX. Ambas as APIs usam o mesmo digest da demo, `PUBLIC_ORIGIN`, `INSTALLATION_ID`, parâmetros FF1 e dados. |
| Cassandra | Três hosts em três domínios de falha. Todos no mesmo datacenter `datacenter1`, em racks que representem esses domínios. Use `NetworkTopologyStrategy` com RF 3. Nos clientes, liste os três contact points e configure `CASSANDRA_CONSISTENCY=LOCAL_QUORUM`. O alocador usa LWT com consenso `LOCAL_SERIAL`. |
| Redis | Endpoint privado com prefixo por instalação. Cada réplica volta a consultar o Cassandra quando o cache está indisponível. |
| Emissão e cópias | Monte em todas as APIs o mesmo diretório de emissão, servido por armazenamento durável e redundante fora do cluster Cassandra, em domínios de falha distintos. O armazenamento precisa continuar acessível e apresentar a última versão confirmada após a perda de qualquer um dos hosts. Serialize a escrita administrativa, com rename atômico, fsync e visibilidade coerente em todos os leitores. Cada criação relê a marca, inclusive quando ainda há IDs no bloco local. Perder o único servidor do diretório bloqueia imediatamente a criação. Teste a continuidade de acesso à marca e a restauração antes de reabrir emissão. |

Prepare o keyspace com `deploy/cassandra/ha.cql` e o esquema com `deploy/cassandra/schema.cql`. O arquivo de topologia usa `datacenter1`. Confira o nome real em `system.local` e em `nodetool status`. Ative `storage_compatibility_mode: NONE` nos nós Cassandra 5 de uma implantação nova. As réplicas devem estar prontas antes de receber tráfego. Consulte `/internal/live` e `/internal/ready` diretamente pela rede privada das APIs. O NGINX recusa essas rotas na entrada pública.

Use nas duas entradas a imagem NGINX da mesma distribuição escolhida na [instalação](../../docs/instalacao.md). A imagem contém `/`, os bundles de `/assets/` e as regras compartilhadas das duas topologias. Em cada entrada, monte apenas `deploy/ha/nginx.conf` como `/etc/nginx/nginx.conf:ro`. Mantenha `/etc/nginx/encurtador-rotas.conf` da imagem. Valide no host com os nomes das APIs disponíveis e rode o ensaio de rotas da distribuição antes do failover.

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
  "${NGINX_IMAGE:?defina a imagem da distribuição}"
docker exec encurtador-entrada nginx -t
for replica in api-a api-b; do
  docker exec encurtador-entrada wget -Y off -S -O /dev/null "http://$replica:3000/internal/ready" || exit 1
done
```

Exija `200` das duas APIs em cada entrada antes de liberar o tráfego. Na troca de um IP fixado por `--add-host`, recrie a entrada com o novo mapeamento.

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

Abra a entrada depois de conferir o quórum, a configuração efetiva das duas APIs e a resposta `200` de ambas em `/internal/ready`. Verifique a criação por uma réplica e as duas formas de resolução pela outra. Para exercitar o encaminhamento em um host Linux, use uma instalação **descartável** com Cassandra e Redis já iniciados, marca compartilhada e `PUBLIC_ORIGIN=http://127.0.0.1:18072`. A [configuração de laboratório](laboratorio.yaml) mapeia as duas APIs em IPs de loopback e monta a entrada na rede do host. Depois da prontidão das duas réplicas, o cliente HTTP verifica as duas formas de resolução pela entrada.

```sh
export COMPOSE_FILE=compose.yaml:deploy/ha/api-privada.yaml:deploy/ha/laboratorio.yaml
export API_PRIVATE_IP=127.0.0.2 PUBLIC_ORIGIN=http://127.0.0.1:18072
docker compose up -d api api-b entrada-rede
for api in api-a api-b; do
  docker compose exec -T entrada-rede wget -Y off -O /dev/null "http://$api:3000/internal/ready" || exit 1
done
node tests/ops/redirecionamento.mjs "$PUBLIC_ORIGIN"
docker compose stop entrada-rede api-b api
```

O laboratório local cobre o encaminhamento entre processos. A perda de um host físico exige a instalação distribuída.
