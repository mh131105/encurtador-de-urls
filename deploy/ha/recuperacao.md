# Emissão, backup e restauração

Um keyspace mantém os vínculos e uma linha de reserva chamada `principal`. A chave FF1, o tweak, o alfabeto, a origem e o identificador da instalação acompanham os links durante toda a sua vida. A marca externa guarda a geração, a identificação dos parâmetros e o teto exclusivo de todos os blocos já autorizados. Ela precisa sobreviver à perda do cluster. Guarde a chave separadamente em um repositório de segredos com backup.

## Iniciar uma instalação nova

Os exemplos CQL usam `encurtador` e `datacenter1`. Ajuste esses nomes ao cluster e à configuração da API. Para um volume novo da demo, use RF 1. Para três nós em domínios independentes, use `ha.cql` e `CASSANDRA_CONSISTENCY=LOCAL_QUORUM`. O schema é o mesmo. Para expandir um keyspace que já contém links, siga o procedimento de alteração da replicação e repair. [Expansão de RF 1 para RF 3](topologia.md#expandir-o-keyspace-existente-de-rf-1-para-rf-3)

```sh
docker compose exec -T cassandra cqlsh < deploy/cassandra/demo.cql
docker compose exec -T cassandra cqlsh -k encurtador < deploy/cassandra/schema.cql
```

Em cluster externo, rode `cqlsh` na máquina administrativa e aplique os mesmos arquivos. Use o formato Cassandra 5 com `storage_compatibility_mode: NONE` nos nós preparados para TTL longo. Em volumes que passaram por upgrade, confirme o formato dos SSTables e conclua o procedimento de upgrade da versão antes de qualificar o TTL. A verificação de escrita e leitura está em `tests/integration/write.test.ts`.

Em um host administrativo, monte um diretório fora do volume e dos snapshots do Cassandra. Ele precisa garantir escrita atômica por rename, bloqueio por criação exclusiva e persistência de arquivo e diretório após fsync. Em HA, todas as APIs devem ler a mesma versão atual desse diretório, com visibilidade coerente das trocas de nome. Monte o diretório pai inteiro no contêiner. Dê escrita somente ao processo administrativo, com permissão de leitura às réplicas. Defina `EMISSION_MARKER_FILE`, por exemplo `/run/encurtador/emission.json`, e as variáveis de conexão, origem e FF1 descritas no guia principal.

Os comandos abaixo usam a imagem compilada ou um checkout com `npm run build`, as mesmas credenciais locais de configuração e o diretório administrativo montado para escrita. Execute `init` uma única vez, depois de comprovar que tanto o domínio quanto o keyspace jamais emitiram códigos. Exija evidência externa de que é uma instalação virgem mesmo quando as duas tabelas estiverem vazias: um snapshot defasado ou a expiração dos vínculos pode ter eliminado toda a evidência local. Registre a origem do domínio e da instalação no inventário operacional. Na ausência dessa comprovação, mantenha a emissão bloqueada. O exemplo autoriza um milhão de IDs a partir de 14.776.336. Escolha o tamanho da janela considerando o volume de emissão e quantos IDs podem ser abandonados numa recuperação.

```sh
node dist/ids/recovery.js init 15776336
```

A API abre a emissão somente com parâmetros, geração e limites compatíveis. A leitura continua disponível se faltar a marca. Os avisos de capacidade saem no log de erro da API. Ao confirmar a última reserva, a réplica informa `Último bloco reservado`. Se o Cassandra aplicar a reserva e a resposta se perder, aquela criação devolve `503`. A leitura seguinte que encontrar `next_free >= authorized_until` informa `Faixa autorizada de IDs esgotada para novas reservas`. A posição incerta fica abandonada. Cada réplica em execução avisa uma vez pela mesma geração e teto. Uma nova autorização permite outro aviso. Elevar o teto preserva os blocos já confirmados. A CLI confirma a nova marca em armazenamento externo antes de aplicar o teto ao banco via LWT.

```sh
node dist/ids/recovery.js extend 16776336
```

O maior teto exclusivo é 3.521.614.606.208. Uma réplica que ainda tem saldo local pode concluir as emissões desse bloco. Quando precisa de outro bloco e o teto está esgotado, a criação devolve `503` sem `Location`. GET e POST continuam resolvendo os vínculos ativos. Na instalação original íntegra, avalie ampliar o teto se ainda houver espaço no domínio.

**Reprodução do alerta (T075).** A partir da raiz, `mise exec -- bash tests/ops/ci.sh` executa o teste de integração em Cassandra descartável. Para rodá-lo isoladamente, com as dependências instaladas e o CQL de um Cassandra de teste acessível nas variáveis `CASSANDRA_CONTACT_POINTS` e `CASSANDRA_PORT`, use os comandos abaixo. O teste cria e remove seu próprio keyspace.

```sh
mise exec -- npx --no-install tsc -p tsconfig.test.json
mise exec -- node --test --test-name-pattern='a última reserva sem resposta' .test-dist/tests/integration/allocator.test.js
```

Em 23/11/2026, o teste manteve um vínculo ativo com uma posição livre e descartou apenas a resposta de uma LWT realmente aplicada no Cassandra 5.0.6. O banco confirmou `next_free=authorized_until` e apenas o vínculo anterior persistido. A tentativa seguinte gerou o aviso e `503` sem `Location`. Novas tentativas mantiveram o status sem repetir o aviso. GET e POST devolveram o mesmo `302`, destino com escapes, consulta e fragmento, e `Cache-Control: no-store`. Após ampliar o teto em uma posição, a reserva confirmada normalmente produziu `201` com um código novo e o aviso de último bloco da nova faixa.

## Capturar uma cópia consistente

Faça snapshots dos nós Cassandra, arquive o esquema e copie os backups para armazenamento independente. Identifique o instante e os nós da cópia e ensaie o procedimento de restauração apropriado à versão. Um backup dos vínculos preserva os valores originais de `created_at` e `expires_at`. Em uma reimportação lógica, descarte vínculos vencidos e derive o TTL dos demais pelo tempo restante. A marca externa deve permanecer atual e durável a cada autorização, inclusive depois de qualquer snapshot de dados.

**Backup planejado da origem.** Retire o tráfego de criação, impeça o reinício automático das réplicas, drene as requisições em curso e pare todas as APIs escritoras. Suspenda também os jobs que alteram os dados e as ações administrativas de emissão. Mantenha a marca externa habilitada, com o mesmo conteúdo e geração durante a cópia. Guarde seu checksum, os identificadores dos volumes e nós e a linha `principal` (`fingerprint`, `epoch`, `next_free` e `authorized_until`) em um registro de operação. As cópias destinam-se a armazenamento independente.

**Reabertura da origem íntegra.** Antes de recolocar as mesmas APIs no tráfego, confira a continuidade do anel, dos volumes, da linha `principal` e da marca durável registrada. Confirme que os processos apontam para o banco original, sem restauração ou troca de volumes, e que não há outro emissor usando o domínio. Religando as APIs com as mesmas configurações, a próxima reserva usa o `next_free` persistido. Saldos dos antigos processos já reservados em memória são abandonados. Esta reabertura funciona com o teto em `62^7` enquanto houver posições livres a partir de `next_free`. Durante um backup planejado, os comandos `freeze`, `resume` e `extend` ficam fora da sequência. Se a continuidade da origem for incerta, mantenha as escritas isoladas e siga a restauração de cópia defasada.

## Copiar os SSTables da demo para fora do volume

Este procedimento cobre uma instalação de **um nó Cassandra 5.0.6 com RF 1**. A distribuição com vários nós segue o [procedimento de RF 3](#copiar-e-restaurar-um-keyspace-com-rf-3). [Snapshots do Cassandra](https://cassandra.apache.org/doc/stable/cassandra/managing/operating/backups.html) · [Importação de SSTables](https://cassandra.apache.org/doc/stable/cassandra/managing/operating/bulk_loading.html)

Durante a cópia da demo, siga a suspensão de escritas acima e pare a única API para obter um ponto comum das duas tabelas. Reserve um diretório de backup protegido, com espaço suficiente, em armazenamento independente do volume de dados. Na raiz da distribuição, com o projeto de origem selecionado, execute em um shell com `set -eu`.

```sh
set -eu
BANCO=$(docker compose ps -q cassandra)
KS=${CASSANDRA_KEYSPACE:-encurtador}
TAG="encurtador-$(date -u +%Y%m%dT%H%M%SZ)"
COPIA="${BACKUP_ROOT:?Defina o diretório externo de backups}/$TAG"
mkdir -m 700 "$COPIA"
docker compose stop api
docker exec "$BANCO" nodetool snapshot --tag "$TAG" "$KS"
for tabela in links reservations; do
  pasta=$(docker exec "$BANCO" sh -ec '
    set -- /var/lib/cassandra/data/"$1"/"$2"-*/snapshots/"$3"
    test "$#" = 1 && test -d "$1" || exit 1
    printf "%s" "$1"
  ' sh "$KS" "$tabela" "$TAG")
  mkdir "$COPIA/$tabela"
  docker cp "$BANCO:$pasta/." "$COPIA/$tabela/"
done
# Selecionado o projeto original, confira os volumes, a reserva e a marca antes de religar.
docker compose start api
```

A cópia inclui os componentes de cada SSTable e os arquivos `schema.cql` e `manifest.json`. Registre um código conhecido, destino, `created_at`, `expires_at`, `writetime(destination)` e o horário da consulta a `ttl(destination)`. Valide a cópia antes de liberar o espaço do snapshot local. Preserve separadamente a versão do esquema, o domínio, os parâmetros FF1, o segredo e a **última** marca externa. O teto externo pode avançar depois desse backup.

## Importar em armazenamento novo

Antes de restaurar, isole as réplicas antigas, mantenha as APIs de destino fora de serviço e congele a marca externa atual conforme o procedimento de retomada abaixo. Se faltar a marca comprovada, mantenha o destino em leitura. Selecione o projeto de **destino** com Cassandra 5 e formato `storage_compatibility_mode: NONE`. Prepare um volume novo na instalação recuperada. Também se pode ensaiar com outro keyspace vazio no mesmo nó. O exemplo cria um keyspace novo no datacenter `datacenter1`. Use um nome CQL simples com letras minúsculas, números e sublinhado. Execute `CREATE KEYSPACE` sem `IF NOT EXISTS` para que um destino ocupado interrompa a operação. Guarde as duas cópias até a verificação.

```sh
set -eu
BANCO_DESTINO=$(docker compose ps -q cassandra)
DESTINO=${CASSANDRA_KEYSPACE:-encurtador}
docker exec "$BANCO_DESTINO" cqlsh -e "CREATE KEYSPACE $DESTINO WITH replication={'class':'NetworkTopologyStrategy','datacenter1':1}"
docker exec -i "$BANCO_DESTINO" cqlsh -k "$DESTINO" < deploy/cassandra/schema.cql
TEMP=$(docker exec -u cassandra "$BANCO_DESTINO" mktemp -d /tmp/enc-restauro.XXXXXXXX)
docker exec -u cassandra "$BANCO_DESTINO" mkdir "$TEMP/$DESTINO"
for tabela in links reservations; do
  docker cp "$COPIA/$tabela" "$BANCO_DESTINO:$TEMP/$DESTINO/"
  docker exec -u 0 "$BANCO_DESTINO" chown -R cassandra:cassandra "$TEMP/$DESTINO/$tabela"
  docker exec "$BANCO_DESTINO" nodetool import --copy-data --extended-verify \
    "$DESTINO" "$tabela" "$TEMP/$DESTINO/$tabela"
done
```

Mantenha a hierarquia `diretório-temporário/keyspace/tabela/arquivos`. Nesta versão do Cassandra, um diretório fora da hierarquia pode resultar em uma importação vazia com saída zero. Consulte a tabela restaurada antes de permitir escritas. Troque `k7Q2aZ9` pelo código anotado no backup.

```sh
docker exec "$BANCO_DESTINO" cqlsh -k "$DESTINO" -e "SELECT destination, created_at, expires_at, writetime(destination), ttl(destination) FROM links WHERE code='k7Q2aZ9'"
docker exec "$BANCO_DESTINO" cqlsh -k "$DESTINO" -e "SELECT next_free, authorized_until, fingerprint, epoch FROM reservations WHERE installation='principal'"
```

Confira o destino, os instantes e o `writetime` originais e desconte do TTL anotado os segundos transcorridos. Confira a linha de reserva contra a cópia da mesma data. Aponte `CASSANDRA_KEYSPACE` da aplicação para o destino, abra a leitura com o cache frio e siga a retomada usando a marca externa atual. Com a verificação concluída, remova o diretório temporário criado para a importação.

## Copiar e restaurar um keyspace com RF 3

O exemplo usa Cassandra 5.0.6, um datacenter `datacenter1`, três nós em racks distintos, `NetworkTopologyStrategy` com RF 3 e `LOCAL_QUORUM` na API. Para reproduzir em hosts independentes, coloque cada nó em um domínio de falha distinto. Na estação administrativa, configure SSH, CQL, JMX e o streaming internó protegido de acordo com o cluster. A máquina de importação precisa alcançar os endereços anunciados por todos os nós de destino. O operador mantém o arquivo de marca em armazenamento durável externo ao anel e guarda os parâmetros FF1 em seu cofre.

**Cópia com as escritas suspensas.** Siga o procedimento de backup planejado acima e confira a parada de todas as escritoras antes do primeiro repair. Preserve o anel original e sua marca habilitada. Mantenha todas as escritas suspensas até terminar as cópias dos três nós e as verificações. Registre a versão, o particionador, o esquema, datacenter/racks, os tokens e host IDs. Confirme todos os nós previstos em `UN` com `nodetool status encurtador` e o acordo de esquema com `nodetool describecluster`. Registre um código de controle, seu destino integral e a linha `principal`, inclusive a geração e os limites. Para a linha do código, guarde `created_at`, `expires_at`, `writetime(destination)`, `ttl(destination)` e o instante da consulta. Use `CONSISTENCY ALL` nesses controles.

No exemplo, cada nó usa um único diretório de dados `/var/lib/cassandra/data`. A estação conserva a cópia em outra mídia já montada em `BACKUP_ROOT`. Use o mesmo nome simples de keyspace e a mesma tag nos três nós. Execute com Bash e mantenha o registro de êxito de cada comando.

```bash
set -euo pipefail
umask 077
KS=encurtador
TAG="encurtador-$(date -u +%Y%m%dT%H%M%SZ)"
COPIA="${BACKUP_ROOT:?defina a mídia externa}/$TAG"
ORIGEM=(db-a db-b db-c)
mkdir "$COPIA"
reserva_origem() {
  cqlsh "${ORIGEM[0]}" -k "$KS" -e "CONSISTENCY ALL; SELECT next_free, authorized_until, epoch, fingerprint FROM reservations WHERE installation='principal'"
}
reserva_origem > "$COPIA/reserva-origem.txt"
sha256sum "${EMISSION_MARKER_FILE:?informe o caminho absoluto da marca atual}" > "$COPIA/marca-origem.sha256"
cqlsh "${ORIGEM[0]}" -e "DESCRIBE KEYSPACE $KS" > "$COPIA/esquema.cql"
for tabela in links reservations; do
  cqlsh "${ORIGEM[0]}" -e "DESCRIBE TABLE $KS.$tabela" > "$COPIA/$tabela.cql"
done
for host in "${ORIGEM[@]}"; do
  ssh "$host" nodetool status "$KS" > "$COPIA/$host-status.txt"
  cqlsh "$host" -e "SELECT host_id, data_center, rack, tokens FROM system.local" > "$COPIA/$host-tokens.txt"
  ssh "$host" nodetool repair -full -pr "$KS"
done
for host in "${ORIGEM[@]}"; do
  ssh "$host" nodetool snapshot -t "$TAG" "$KS"
  for tabela in links reservations; do
    destino="$COPIA/$host/dados1/$KS/$tabela"
    mkdir -p "$destino"
    ssh "$host" bash -s -- "$KS" "$tabela" "$TAG" <<'REMOTO' | tar -x -C "$destino"
set -eu
set -- /var/lib/cassandra/data/"$1"/"$2"-*/snapshots/"$3"
test "$#" = 1 && test -d "$1" || exit 1
tar -C "$1" -cf - .
REMOTO
    test -s "$destino/schema.cql"
    test -s "$destino/manifest.json"
  done
done
(cd "$COPIA" && find . -type f -print0 | sort -z | xargs -0 sha256sum) > "$COPIA.sha256"
(cd "$COPIA" && sha256sum -c "$COPIA.sha256")
```

Para reabrir a própria origem, confira os volumes e o anel registrados e, ainda com os escritores parados, repita a consulta no mesmo shell. Exija uma linha `principal`, com a geração e o fingerprint da marca ativa. Para emitir um novo bloco, `next_free` precisa estar entre o piso da marca e o teto persistido, com `floor <= next_free < authorized_until <= limit`.

```bash
sha256sum -c "$COPIA/marca-origem.sha256"
reserva_origem | cmp "$COPIA/reserva-origem.txt" -
```

Se houver mais de um `data_file_directories`, copie as pastas de snapshot existentes em **cada** diretório de cada nó, preservando o identificador do disco como `dados1`, `dados2` etc. Confira cada SSTable listado nos manifestos e os checksums em armazenamento independente. Se um arquivo listado faltar, interrompa a restauração e localize outra cópia íntegra. Guarde a identidade do nó e os diretórios inventariados, inclusive quando um deles não contiver SSTables. Separar os conjuntos evita colisões de nomes entre nós. Após validar a cópia e comprovar a continuidade da origem, reinicie as escritoras na própria origem com a mesma marca habilitada e o mesmo teto. Recoloque a criação no tráfego após confirmar um novo `201` e a resolução do vínculo anterior e do novo. Uma restauração posterior requer a marca mais recente, inclusive os avanços ocorridos depois do backup. [Snapshots no Cassandra 5](https://cassandra.apache.org/doc/stable/cassandra/managing/operating/backups.html)

**Importação por faixa de tokens.** Isole a origem antiga e todas as escritoras do domínio. Antes de atender tráfego no destino, congele por `freeze` a última marca externa comprovada e confirme `enabled=false`. Para ensaiar em uma instalação isolada, entregue ao destino um diretório administrativo próprio com uma cópia verificada dessa marca atual. Preserve o diretório original e seus segredos fora dos snapshots de dados. A promoção exige uma única instalação com autoridade para emitir no domínio. Mantenha o cache de destino vazio e suas APIs paradas ou com `ISSUE_ENABLED=false`. Se a marca faltar, a criação continua suspensa. Prepare um cluster de destino vazio e isolado dos clientes, com Cassandra compatível, o mesmo particionador, `storage_compatibility_mode: NONE` nos três nós e espaço para streaming e compactação. Confirme `UN`, os racks esperados e o acordo de esquema. Crie o keyspace novo com falha caso já exista, aplique as tabelas do esquema arquivado e confira a replicação em **cada** nó. O exemplo usa o mesmo nome no cluster novo. Use as opções de TLS e autenticação do ambiente em `cqlsh`, `nodetool` e `sstableloader`.

```bash
DESTINO=(novo-a novo-b novo-c)
SEEDS=$(IFS=,; echo "${DESTINO[*]}")
cqlsh "${DESTINO[0]}" -e "CREATE KEYSPACE $KS WITH replication={'class':'NetworkTopologyStrategy','datacenter1':3} AND durable_writes=true"
for tabela in links reservations; do
  cqlsh "${DESTINO[0]}" -k "$KS" -f "$COPIA/$tabela.cql"
done
for host in "${DESTINO[@]}"; do
  cqlsh "$host" -e "SELECT replication FROM system_schema.keyspaces WHERE keyspace_name='$KS'"
done
(cd "$COPIA" && sha256sum -c "$COPIA.sha256")
TRABALHO=$(mktemp -d "${STAGING_ROOT:?defina disco gravável}/encurtador.XXXXXXXX")
cp -R "$COPIA/." "$TRABALHO/"
chmod -R u+rwX "$TRABALHO"
(cd "$TRABALHO" && sha256sum -c "$COPIA.sha256")
for host in "${ORIGEM[@]}"; do
  for disco in "$TRABALHO/$host"/*; do
    for tabela in links reservations; do
      pasta="$disco/$KS/$tabela"
      test -d "$pasta" || continue
      if find "$pasta" -name '*-Data.db' -print -quit | grep -q .; then
        sstableloader -d "$SEEDS" "$pasta"
      fi
    done
  done
done
for host in "${DESTINO[@]}"; do
  ssh "$host" nodetool repair -full -pr "$KS"
done
```

A área de trabalho precisa ser gravável e independente do arquivo de backup, com espaço para uma cópia integral. O Cassandra 5.0.6 pode atualizar `Statistics.db` durante o streaming. Preserve a mídia original e seu arquivo de checksums. O `sstableloader` descobre os tokens e replica os SSTables segundo o anel de destino. Cada conjunto retém as escritas e expirações originais. Confira transferências nos logs de cada conjunto com dados. Use cada cópia inteiramente verificada, preservando as datas de escrita repetidas nas réplicas. [Streaming com sstableloader](https://cassandra.apache.org/doc/stable/cassandra/managing/operating/bulk_loading.html)

**Verificação antes da emissão.** Para o código de controle e para a reserva `principal`, `nodetool getendpoints "$KS" links "$CODIGO"` e `nodetool getendpoints "$KS" reservations principal` devem listar três proprietários distintos. Em cada proprietário indicado, rode `nodetool flush "$KS"` e `nodetool getsstables "$KS" links "$CODIGO"` ou `nodetool getsstables "$KS" reservations principal` e confirme os arquivos locais. Com `CONSISTENCY ALL`, compare os campos, `writetime` e a reserva com a cópia registrada. Para um mesmo vínculo, a diferença do TTL deve acompanhar o tempo transcorrido, dentro da resolução em segundos dos relógios. Confirme também que o limite de retenção continua sendo o instante original de `expires_at`.

Use o cache dedicado vazio e as APIs em leitura. GET e POST de resolução devem devolver `302`, o destino integral e `Cache-Control: no-store` para o código ativo do backup. Se um vínculo registrado depois da cópia se perdeu, verifique `404` nas duas rotas e `503` ao criar enquanto congelado. Com todos os processos antigos isolados, siga a retomada abaixo usando o teto externo atual e um teto maior. Compare a primeira posição emitida com o piso novo, volte a resolver o vínculo antigo e confira que o código perdido permanece sem destino. Preserve o conjunto original até concluir estas verificações.

## Retomar com uma cópia defasada

1. Retire da entrada todas as APIs que criam links. Com acesso de escrita ao diretório administrativo, execute `node dist/ids/recovery.js freeze`. Isso persiste o modo congelado, que também é verificado antes de consumir o próximo ID de um bloco em memória. Isole e encerre os processos antigos e aguarde as requisições em curso. Desabilite os reinícios automáticos dessas réplicas enquanto o cluster está em restauração.
2. Restaure os vínculos, o estado do alocador e o segredo da instalação. Para consultar links durante a intervenção, inicie réplicas com `ISSUE_ENABLED=false`, com o cache da instalação vazio. Use uma nova instância Redis dedicada ou remova apenas as chaves do prefixo desta instalação. Confira um vínculo conhecido e compare o `Location` completo nas duas rotas.
3. Obtenha a última marca externa comprovadamente durável, inclusive autorizações posteriores ao snapshot. Um arquivo anterior, uma marca de outro cluster ou apenas o `next_free` restaurado são insuficientes. Se o teto externo já era `62^7`, não existe faixa superior no domínio. O destino restaurado permanece em leitura, mesmo quando o snapshot mostra posições livres. Nunca reative manualmente o arquivo da marca para contornar o bloqueio. Sem a última marca, mantenha as réplicas em leitura. Preserve também o domínio, a chave, o tweak e o identificador da instalação. Nunca execute `init` para retomar um domínio que já emitiu links.
4. Com a marca congelada e confirmada, selecione um novo teto superior ao teto externo anterior. Exemplo para uma instalação com teto anterior de 16.776.336, cujo domínio ainda possui espaço livre:

   ```sh
   node dist/ids/recovery.js resume 17776336
   ```

   O comando registra a nova geração e o teto fora do cluster. No Cassandra, o primeiro ID disponível passa a ser o teto externo anterior. Uma atualização condicional protege a troca da geração. Se o registro do alocador desapareceu na cópia, a retomada pode criá-lo nessa faixa nova, com a marca externa a fundamentar o piso. Uma falha no meio da operação pode deixar a nova geração bloqueada por divergência entre banco e marca. Confira ambos. Para repetir uma retomada cuja confirmação seja incerta, congele e avance acima do último teto durável. Isso abandona toda a faixa duvidosa.
5. Reinicie as réplicas de criação com `ISSUE_ENABLED=true`, teste uma criação e abra o link por outra réplica. Confira um vínculo anterior ao snapshot e que um código posterior ausente no backup permanece sem destino. Respostas `201` devem corresponder ao destino gravado. Durante o bloqueio ou após esgotamento, confirme `503` sem `Location` e `302` nos vínculos vigentes.

Mantenha um único administrador atuando sobre o diretório. Uma trava `.lock` sobrevivente de interrupção exige confirmar que o processo administrador encerrou, conferir a marca e o banco, e só então remover a trava. A validade da marca depende do armazenamento externo e da ordem operacional. A restauração silenciosa de um snapshot com processos antigos ainda ativos quebra essas premissas.

O ensaio `tests/integration/recovery.test.ts` restaura um snapshot lógico defasado em um keyspace descartável, consulta as rotas HTTP com o banco real, impede emissão quando a marca desaparece e consome as duas últimas posições do domínio. Ele mantém o cache frio.

## Verificação local da distribuição em 23/11/2026

Uma cópia limpa dos fontes gerou as imagens da API e do NGINX. Após `docker save` e `docker load`, o perfil da demo criou vínculos pela origem configurada. Em Cassandra 5.0.6 de nó único, as duas tabelas de um keyspace exclusivo foram copiadas para fora do contêiner e importadas em outro keyspace vazio. O destino com escapes, os dois timestamps, o `writetime` e a linha de reserva conferiram. Na comparação simultânea, as duas cópias indicaram 315.619.082 segundos de TTL restante. Com a marca congelada e o cache frio, o link do backup respondeu `302`, o link posterior ao snapshot respondeu `404` e criar respondeu `503`. Depois de `resume`, o primeiro ID veio da posição 16.776.336, o teto externo autorizado depois do snapshot.

A expansão local para duas APIs com `LOCAL_QUORUM` e o NGINX distribuído manteve os digests das imagens carregadas e voltou a criar e redirecionar. A API usou `sha256:3e85b5ccb9daea1e7938a98d61266e7c0dbcd550c2cec5f255cb8748a2181faa` e o NGINX `sha256:f53ed544e5b09c4c853de0cc46a1ae79986656adefe9036f4b57e59043a908f7` nesta cópia. Ambas as APIs compartilharam o mesmo host e o nó Cassandra RF 1. A qualificação da VPS compartilhada, do failover entre hosts e da vazão de 24 h depende dos ensaios operacionais correspondentes.

## Ensaio de restauração RF 3 em 23/11/2026

O laboratório criou dois anéis Cassandra 5.0.6 sucessivos no Docker Desktop Linux ARM64, com 4 vCPUs e 3,58 GiB de RAM. Cada anel tinha três nós em contêineres, um volume exclusivo e oito tokens por nó, um datacenter e três racks. Os três host IDs e os 24 tokens do destino diferiram dos da origem. O fator foi 3 em ambos e a API leu e gravou em `LOCAL_QUORUM`. Cada instalação usou seu Redis dedicado. A marca externa, o segredo FF1 e o domínio ficaram fora dos seis volumes Cassandra. A API do destino usou a imagem `sha256:0e75a38ed88777bdfa23035ed064d77998a699acf063c408ff44ddd8c22ea4b8`. Os nós compartilharam uma máquina física. A repetição entre domínios de falha independentes permanece pendente.

Neste ensaio de recuperação, o operador provocou uma troca de geração na origem e verificou o bloqueio por `freeze` e `503`. O teste de backup planejado, com a origem íntegra no teto máximo, está registrado a seguir. O processo foi parado. A cópia reuniu seis diretórios de snapshots dos três nós, com 60 arquivos conferidos por SHA-256. Voltar a emitir na origem com `resume 16776336` criou o código posterior `tDrelJA` na posição 15.776.336. O operador congelou a marca mais recente e desligou a origem.

Em um cluster novo, o `sstableloader` inicialmente falhou ao tentar atualizar `Statistics.db` na mídia somente leitura. As duas tabelas de destino continuavam vazias. Na área gravável, os seis carregamentos concluíram. O checksum da cópia original voltou a passar. O repair das faixas primárias terminou nos três nós de cada anel. No destino, tanto o código de controle quanto a reserva tinham três endpoints e SSTables locais nos três proprietários.

A leitura CQL com `ALL` confirmou o destino `https://origem.example/antes%2F?q=%2b#secao`, os dois timestamps, o `writetime(destination)` e a linha de reserva originais. O TTL caiu de 315.619.197 para 315.618.976 segundos nos 221 segundos transcorridos. Em ambas as consultas o instante calculado de expiração física foi o mesmo. O vencimento público preservado do código `0x9SwJX` foi **23/11/2036 às 06:26:44.689 UTC**.

| Condição no destino | GET por código | POST de resolução |
| --- | --- | --- |
| Código do backup ativo, marca congelada | 302 | 302 |
| Mesmo código, 1 ms antes do vencimento original | 302 | 302 |
| Mesmo código, no vencimento original | 404 | 404 |
| Código posterior ausente, antes e depois da retomada | 404 | 404 |
| Código do backup e novo código, após retomada em horário corrente | 302 | 302 |

Cada consulta começou com a chave correspondente ausente no Redis. Ambos os métodos retornaram `Cache-Control: no-store`. Os `302` preservaram o destino byte a byte e os `404` vieram sem `Location`. O POST de criação devolveu `503` enquanto a marca estava congelada. Após `resume 17776336`, o primeiro `201` entregou `XIEy7vw`. Decodificar esse código com os mesmos parâmetros FF1 confirmou a posição **16.776.336**, o teto durável posterior à cópia. O código perdido permaneceu sem vínculo.

Para reproduzir a borda temporal, use duas instâncias sequenciais da API de laboratório com `ISSUE_ENABLED=false`. Monte o arquivo abaixo como `/tmp/relogio.mjs` e inicie o processo com `node --import /tmp/relogio.mjs dist/server.js`. Defina `LAB_MS` primeiro como o vencimento salvo em milissegundos Unix menos um e depois como o próprio vencimento. A alteração do relógio se aplica apenas ao processo Node. Em cada instância, remova a chave deste código do Redis de teste antes de cada método, faça GET e POST sem seguir redirects e compare com a tabela acima.

```js
import { mock } from 'node:test';
mock.timers.enable({ apis: ['Date'], now: Number(process.env.LAB_MS) });
```

## Backup planejado no teto máximo · T056

Em 23/11/2026, dois anéis Cassandra 5.0.6 RF 3 rodaram em sequência no mesmo Docker Desktop. Cada anel tinha três nós, três racks, oito tokens por nó e volumes próprios. A API usou `LOCAL_QUORUM` e `ID_BLOCK_SIZE=1`. Para reproduzir o estado inicial **em um domínio e keyspace de teste virgens**, execute a sequência administrativa abaixo antes de abrir a primeira API. Ela reserva para o ensaio as quatro últimas posições. O backup começa depois da primeira criação.

```sh
node dist/ids/recovery.js init 3521614606204
node dist/ids/recovery.js freeze
node dist/ids/recovery.js resume 3521614606208
```

Para repetir as verificações, inicie as APIs com a marca preparada e uma `PUBLIC_ORIGIN` HTTP que a estação de teste consiga acessar. Exporte no shell o mesmo `PUBLIC_ORIGIN`, `INSTALLATION_ID` e o `REDIS_URL` do Redis de laboratório. Na raiz do repositório, crie o primeiro vínculo. O verificador exige o status `201`.

```bash
set -euo pipefail
antes='https://origem.example/antes%2F?q=%2b#secao'
primeiro=$(python3 deploy/demo/verificar.py "$PUBLIC_ORIGIN" "$antes")
```

Execute a cópia planejada com os escritores parados. Após as conferências da origem, inicie as APIs com o mesmo banco e a mesma marca. No mesmo shell, crie outro vínculo. Para conferir cada rota com cache frio, o exemplo usa `redis-cli` no Redis do laboratório e curl 7.84 ou superior, que permite ler um cabeçalho com `%header`.

```bash
depois='https://origem.example/posterior%2F?q=%2b#secao'
segundo=$(python3 deploy/demo/verificar.py "$PUBLIC_ORIGIN" "$depois")
test "$primeiro" != "$segundo"
verificar_frio() {
  local curto=$1 destino=$2 chave="${INSTALLATION_ID:?}:${1##*/}" resultado metodo
  local formato=$'%{response_code}\n%header{location}\n%header{cache-control}'
  for metodo in GET POST; do
    redis-cli -u "$REDIS_URL" DEL "$chave" > /dev/null
    test "$(redis-cli -u "$REDIS_URL" EXISTS "$chave")" = 0
    if [[ $metodo == GET ]]; then
      resultado=$(curl -q -sS --max-time 30 -o /dev/null -w "$formato" "$curto")
    else
      resultado=$(curl -q -sS --max-time 30 -o /dev/null -w "$formato" --json "{\"short_url\":\"$curto\"}" "$PUBLIC_ORIGIN/api/v1/redirecionar")
    fi
    test "$resultado" = "$(printf '302\n%s\nno-store' "$destino")"
  done
}
verificar_frio "$primeiro" "$antes"
verificar_frio "$segundo" "$depois"
```

A origem respondeu `201` com `LxCQ2R2` na posição 3.521.614.606.204. Com todas as escritoras paradas, o repair e os snapshots dos três nós produziram seis conjuntos de SSTables e 60 arquivos verificados por SHA-256. O teto exclusivo era 3.521.614.606.208 e `next_free` permaneceu em 3.521.614.606.205 durante a cópia. O operador conferiu os volumes, as identidades e os instantes de partida dos três nós, a linha `principal` e o checksum da marca habilitada. Os processos do banco continuaram ativos.

Ao religar a API na própria origem, o POST retornou `201` com `S0RenFF`. A decodificação FF1 confirmou a posição 3.521.614.606.205. O teto e a geração permaneceram iguais. Com a chave removida do Redis antes de cada rota, os GET e POST de `LxCQ2R2` devolveram `302` com `Location: https://origem.example/antes%2F?q=%2b#secao`. Para `S0RenFF`, devolveram `302` com `Location: https://origem.example/posterior%2F?q=%2b#secao`. As quatro respostas incluíram `Cache-Control: no-store`.

Para testar o desastre, a origem foi isolada e o segundo anel recebeu os snapshots. O destino usou um diretório administrativo próprio com a cópia verificada da última marca externa. O operador executou `freeze` nesse diretório antes de importar e confirmou `enabled=false`. A marca original permaneceu habilitada e com o mesmo checksum. O clone tinha `next_free=3521614606205`, posição já usada depois do backup na origem. Com o cache frio, o código do snapshot entregou `302` nas duas rotas e o código posterior retornou `404` nas duas. A criação devolveu `503` sem `Location`. A CLI recusou tanto a retomada no teto existente quanto um limite superior ao domínio. Uma nova tentativa de criação manteve o `503` e a reserva continuou idêntica à do snapshot.
