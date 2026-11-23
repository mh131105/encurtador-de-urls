# Emissão, backup e restauração

A recuperação exige os vínculos, a linha de reserva `principal`, os parâmetros FF1 e a marca externa mais recente. A marca contém a instalação, a geração, a impressão digital dos parâmetros e o intervalo autorizado. Ela deve sobreviver à perda do banco. Preserve também a origem pública e uma cópia protegida da chave e do tweak durante toda a vida dos links.

## Iniciar uma instalação nova

O [iniciador da instalação](../../docs/instalacao.md) prepara o schema e a emissão da demo. As instruções manuais desta seção são para operadores que administram o Cassandra e a marca diretamente. Use `demo.cql` para um nó novo com RF 1 ou `ha.cql` para três nós em domínios independentes com `LOCAL_QUORUM`. Confira o datacenter antes de aplicar o esquema. Para um keyspace já existente, siga a [expansão para RF 3](topologia.md#expandir-o-keyspace-existente-de-rf-1-para-rf-3).

```sh
docker compose exec -T cassandra cqlsh < deploy/cassandra/demo.cql
docker compose exec -T cassandra cqlsh -k encurtador < deploy/cassandra/schema.cql
```

Para um banco externo, use cqlsh na estação administrativa. A retenção longa exige Cassandra 5 com `storage_compatibility_mode: NONE`. Após upgrade, conclua a migração do formato dos SSTables e confira uma gravação com TTL além de 2038. [Teste com o armazenamento](../../tests/integration/write.test.ts)

Monte o diretório **pai** da marca fora do volume e dos snapshots do Cassandra. O sistema de arquivos precisa oferecer criação exclusiva para a trava, rename atômico, fsync do arquivo e do diretório e visibilidade coerente para todas as APIs. Mantenha um único escritor administrativo e as réplicas com montagem de leitura.

Execute `init` uma única vez e somente com evidência externa de que **o domínio e o keyspace jamais emitiram links**. Tabelas vazias também podem resultar de restauração ou expiração. Sem histórico confiável, mantenha a emissão suspensa. Para uma instalação manual com as mesmas variáveis da API, os comandos administrativos usam `node dist/ids/recovery.js AÇÃO [TETO]`. Em uma instalação Compose com o diretório padrão existente e gravável pelo usuário administrativo da imagem, a função abaixo executa a CLI no contexto do próprio projeto:

```sh
emissao() {
  docker compose run --rm -T --no-deps \
    -v "$PWD/state/emission:/run/emissao-admin:rw" \
    -e EMISSION_MARKER_FILE=/run/emissao-admin/emission.json \
    api node dist/ids/recovery.js "$@"
}
```

Ajuste a montagem se a marca estiver em outro diretório. O primeiro ID é 14.776.336 e o maior teto exclusivo é 3.521.614.606.208. Por exemplo, `emissao init 15776336` autoriza um milhão de posições em uma instalação virgem. Avalie quantas posições podem ser abandonadas em uma recuperação ao escolher o tamanho da janela.

Na **origem íntegra**, `emissao extend 16776336` amplia esse teto em outro milhão. A CLI persiste a autorização externa antes de alterar a linha do banco com LWT. As APIs avisam no log ao reservar o último bloco ou encontrar a faixa esgotada. Um processo com saldo ainda pode usá-lo. Quando já não há blocos, novas reservas devolvem `503`. As leituras dos vínculos vigentes continuam disponíveis.

## Capturar uma cópia consistente

Faça snapshots dos nós Cassandra, arquive o esquema e copie os backups para armazenamento independente. Identifique o instante e os nós da cópia e ensaie o procedimento de restauração apropriado à versão. Um backup dos vínculos preserva os valores originais de `created_at` e `expires_at`. Em uma reimportação lógica, descarte vínculos vencidos e derive o TTL dos demais pelo tempo restante. A marca externa deve permanecer atual e durável a cada autorização, inclusive depois de qualquer snapshot de dados.

**Backup planejado da origem.** Retire o tráfego de criação, impeça o reinício automático das réplicas, drene as requisições em curso e pare todas as APIs escritoras. Suspenda também os jobs que alteram os dados e as ações administrativas de emissão. Mantenha a marca externa habilitada, com o mesmo conteúdo e geração durante a cópia. Guarde seu checksum, os identificadores dos volumes e nós e a linha `principal` (`fingerprint`, `epoch`, `next_free` e `authorized_until`) em um registro de operação. As cópias destinam-se a armazenamento independente.

**Reabertura da origem íntegra.** Antes de recolocar as mesmas APIs no tráfego, confira a continuidade do anel, dos volumes, da linha `principal` e da marca durável registrada. Confirme que os processos apontam para o banco original, sem restauração ou troca de volumes, e que não há outro emissor usando o domínio. Religando as APIs com as mesmas configurações, a próxima reserva usa o `next_free` persistido. Saldos dos antigos processos já reservados em memória são abandonados. Esta reabertura funciona com o teto em `62^7` enquanto houver posições livres a partir de `next_free`. Durante um backup planejado, os comandos `freeze`, `resume` e `extend` ficam fora da sequência. Se a continuidade da origem for incerta, mantenha as escritas isoladas e siga a restauração de cópia defasada.

## Copiar os SSTables da demo para fora do volume

Este procedimento cobre uma instalação de **um nó Cassandra 5.0.6 com RF 1**. A distribuição com vários nós segue o [procedimento de RF 3](#copiar-e-restaurar-um-keyspace-com-rf-3). [Snapshots do Cassandra](https://cassandra.apache.org/doc/stable/cassandra/managing/operating/backups.html) · [Importação de SSTables](https://cassandra.apache.org/doc/stable/cassandra/managing/operating/bulk_loading.html)

Os exemplos de backup usam um host Linux, Bash, ferramentas GNU e o projeto Compose de origem. Defina `BACKUP_ROOT` com o caminho absoluto em mídia independente. Suspenda todas as escritoras para obter um ponto comum das tabelas.

```sh
set -eu
BANCO=$(docker compose ps -q cassandra)
KS=${CASSANDRA_KEYSPACE:-encurtador}
TAG="encurtador-$(date -u +%Y%m%dT%H%M%SZ)"
COPIA="${BACKUP_ROOT:?Defina o diretório externo de backups}/$TAG"
mkdir -m 700 "$COPIA"
docker compose stop api
docker exec "$BANCO" cqlsh -e "DESCRIBE KEYSPACE $KS" > "$COPIA/esquema.cql"
docker exec "$BANCO" nodetool snapshot --tag "$TAG" "$KS"
for tabela in links reservations; do
  pasta=$(docker exec "$BANCO" sh -ec '
    set -- /var/lib/cassandra/data/"$1"/"$2"-*/snapshots/"$3"
    test "$#" = 1 && test -d "$1" || exit 1
    printf "%s" "$1"
  ' sh "$KS" "$tabela" "$TAG")
  mkdir "$COPIA/$tabela"
  docker cp "$BANCO:$pasta/." "$COPIA/$tabela/"
  test -s "$COPIA/$tabela/schema.cql" && test -s "$COPIA/$tabela/manifest.json" || exit 1
done
(cd "$COPIA" && find . -type f -print0 | sort -z | xargs -0 sha256sum) > "$COPIA.sha256"
(cd "$COPIA" && sha256sum -c "$COPIA.sha256")
```

Com as escritas ainda suspensas, registre um código de controle, destino, `created_at`, `expires_at`, `writetime(destination)` e o horário da consulta a `ttl(destination)`. Confira os componentes de SSTable listados no manifesto e os checksums na mídia. Após verificar a continuidade da origem, reinicie a API original com `docker compose start api`. Valide a cópia antes de liberar o espaço do snapshot local. Preserve separadamente o domínio, os parâmetros FF1, o segredo e a **última** marca externa, inclusive autorizações posteriores ao backup.

## Importar em armazenamento novo

Antes de restaurar, isole as réplicas antigas, mantenha as APIs de destino fora de serviço e congele a marca externa atual conforme o procedimento de retomada abaixo. Se faltar a marca comprovada, mantenha o destino em leitura. Selecione o projeto de **destino** com Cassandra 5 e formato `storage_compatibility_mode: NONE`. Prepare um volume novo na instalação recuperada. Também se pode ensaiar com outro keyspace vazio no mesmo nó. O exemplo cria um keyspace novo no datacenter `datacenter1`. Use um nome CQL simples com letras minúsculas, números e sublinhado. Execute `CREATE KEYSPACE` sem `IF NOT EXISTS` para que um destino ocupado interrompa a operação. Confira que as definições das duas tabelas correspondem ao esquema arquivado. Guarde as duas cópias até a verificação.

```sh
set -eu
(cd "${COPIA:?informe o caminho absoluto do backup}" && sha256sum -c "$COPIA.sha256")
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

Mantenha a hierarquia `diretório-temporário/keyspace/tabela/arquivos`. Nesta versão do Cassandra, um diretório fora da hierarquia pode resultar em uma importação vazia com saída zero. Consulte a tabela restaurada antes de permitir escritas. Defina `CODIGO_ANTERIOR` com o código Base62 anotado no backup.

```sh
docker exec "$BANCO_DESTINO" cqlsh -k "$DESTINO" -e "SELECT destination, created_at, expires_at, writetime(destination), ttl(destination) FROM links WHERE code='${CODIGO_ANTERIOR:?informe o código do backup}'"
docker exec "$BANCO_DESTINO" cqlsh -k "$DESTINO" -e "SELECT next_free, authorized_until, fingerprint, epoch FROM reservations WHERE installation='principal'"
```

Confira o destino, os instantes e o `writetime` originais e desconte do TTL anotado os segundos transcorridos. Confira a linha de reserva contra a cópia da mesma data. Aponte `CASSANDRA_KEYSPACE` da aplicação para o destino, abra a leitura com o cache frio e siga a retomada usando a marca externa atual. Com a verificação concluída, remova o diretório temporário criado para a importação.

## Copiar e restaurar um keyspace com RF 3

O exemplo usa Cassandra 5.0.6, um datacenter `datacenter1`, três nós em racks distintos, `NetworkTopologyStrategy` com RF 3 e `LOCAL_QUORUM` na API. Para reproduzir em hosts independentes, coloque cada nó em um domínio de falha distinto. Na estação administrativa, configure SSH, CQL, JMX e o streaming entre nós protegido de acordo com o cluster. A máquina de importação precisa alcançar os endereços anunciados por todos os nós de destino. O operador mantém o arquivo de marca em armazenamento durável externo ao anel e guarda os parâmetros FF1 em seu cofre.

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
4. Com a marca congelada e confirmada, selecione um novo teto superior ao teto externo anterior. Exemplo para uma instalação com teto anterior de 16.776.336, cujo domínio ainda possui espaço livre.

   ```sh
   node dist/ids/recovery.js resume 17776336
   ```

   O comando registra a nova geração e o teto fora do cluster. No Cassandra, o primeiro ID disponível passa a ser o teto externo anterior. Uma atualização condicional protege a troca da geração. Se o registro do alocador desapareceu na cópia, a retomada pode criá-lo nessa faixa nova, com a marca externa a fundamentar o piso. Uma falha no meio da operação pode deixar a nova geração bloqueada por divergência entre banco e marca. Confira ambos. Para repetir uma retomada cuja confirmação seja incerta, congele e avance acima do último teto durável. Isso abandona toda a faixa duvidosa.
5. Reinicie as réplicas de criação com `ISSUE_ENABLED=true`, teste uma criação e abra o link por outra réplica. Confira um vínculo anterior ao snapshot e que um código posterior ausente no backup permanece sem destino. Respostas `201` devem corresponder ao destino gravado. Durante o bloqueio ou após esgotamento, confirme `503` sem `Location` e `302` nos vínculos vigentes.

Mantenha um único administrador atuando sobre o diretório. Uma trava `.lock` sobrevivente de interrupção exige confirmar que o processo administrador encerrou, conferir a marca e o banco, e só então remover a trava. A validade da marca depende do armazenamento externo e da ordem operacional. A restauração silenciosa de um snapshot com processos antigos ainda ativos quebra essas premissas.
