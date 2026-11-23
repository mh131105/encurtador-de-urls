# Criação e resolução 10:1

## Amostra local de T026

Em 23/11/2026, a API Node 24.22.3 recebeu os pedidos diretamente por HTTP no loopback. A aplicação acessou Cassandra 5.0.6 e Redis 7.4.6 em contêineres dedicados na mesma máquina. Cada destino tinha 100 bytes ASCII e identificava uma criação. O gerador fez cinco GETs e cinco POSTs de resolução por link, com redirecionamento automático desativado.

| Operação | Confirmadas | Falhas | p95 | p99 |
| --- | ---: | ---: | ---: | ---: |
| Criação | 10 | 0 | 9,503 ms | 9,503 ms |
| Resolução | 100 | 0 | 4,187 ms | 7,235 ms |

Dois fluxos concorrentes concluíram a amostra em 0,0882 s, entre 05:22:49,397 e 05:22:49,485 UTC. Os 100 cabeçalhos `Location` corresponderam aos destinos originais e todas as resoluções incluíram `302` e `Cache-Control: no-store`. A API contou 90 acertos de cache, 10 consultas CQL e 10 gravações, com zero erros CQL. O diretório do keyspace `encurtador` ocupava 120 KiB antes e depois. O sistema de arquivos do volume tinha 34.296.136 KiB em uso e 415.643.344 KiB disponíveis nas duas observações. As escritas podem ficar em memtables até o flush. Essas duas amostras de disco não medem o custo por link.

Em uma verificação adicional com HTTP controlado, o gerador recebeu um `503` de criação e um `302` com destino trocado. O resultado foi 2 de 3 criações confirmadas, 19 de 20 resoluções corretas, 1 destino divergente, 10 resoluções sem link para consultar e código de saída 1.

No ensaio T051, o gerador recebeu dois `201` em amostras independentes, com a mesma origem pública. Com o caminho literal `/sub/../0000001`, registrou uma criação falha, dez resoluções omitidas e zero chamadas de resolução. A saída foi 1. Com `/0000001`, confirmou uma criação, cinco GETs e cinco POSTs e saiu com código 0. O POST de resolução recebeu exatamente o texto devolvido pela criação. Para reproduzir com respostas HTTP e disco controlados, execute `node --test --test-name-pattern='caminho literal' tests/load/latencias.test.mjs`.

### Origens do gerador e do link público

`API_ORIGIN` define onde o gerador envia a criação e as dez consultas. `PUBLIC_ORIGIN` define a origem que a API usa para emitir o link curto. `https://S.Example:443` e `https://s.example/` representam a mesma origem pública, registrada como `https://s.example` no índice de códigos. Uma porta diferente da padrão faz parte da origem.

No ensaio T080, o `201` devolveu `https://s.example/Abc1234`. A amostra com a entrada pública e a amostra com a entrada privada `http://PRIVADA.test:8080/` confirmaram, cada uma, uma criação, cinco GETs e cinco POSTs para o destino de 100 bytes, com zero divergências. Cada controle com outro host, outra porta ou um caminho literal inválido registrou uma criação falha e dez consultas omitidas, com saída 1. A regra de comparação do código preserva o caminho literal devolvido no `201`.

Para repetir na raiz, use `node --test --test-name-pattern='usa a origem canônica' tests/load/latencias.test.mjs`. O ensaio executa o gerador com respostas HTTP e medições de disco controladas. Em uma segunda execução, o gerador usou TCP de loopback com `API_ORIGIN=http://LOCALHOST:<porta>/` e a mesma origem pública em HTTPS. O servidor de respostas controladas recebeu um POST de criação, cinco GETs e cinco POSTs de resolução, contagens que coincidiram com o relatório. As métricas e as leituras de disco dessa execução também foram controladas.

### Reproduzir

Use uma instalação dedicada com faixa para emitir novos IDs. `API_ORIGIN` é a entrada HTTP e `PUBLIC_ORIGIN` é a origem esperada no link devolvido. Se forem iguais, basta informar a primeira. `METRICS_ORIGINS` aceita as origens privadas das réplicas, separadas por vírgulas. `CASSANDRA_CONTAINERS` aceita nomes de contêiner separados por vírgulas, inclusive `contexto-docker/container` para nós diferentes. Use o keyspace do ensaio e acesso ao Docker para as leituras de disco.

```sh
API_ORIGIN=http://127.0.0.1:8080 \
METRICS_ORIGINS=http://127.0.0.1:3000 \
CASSANDRA_CONTAINERS=encurtador-cassandra-1 \
CASSANDRA_KEYSPACE=encurtador CREATIONS=10 CONCURRENCY=2 \
mise exec -- node tests/load/amostra.mjs
```

O gerador mostra o relatório em JSON. `CREATIONS` determina o número de tentativas, `CONCURRENCY` limita o total de fluxos em andamento e `TIMEOUT_MS` limita cada operação HTTP. `CREATIONS_PER_SECOND` distribui o início das criações ao longo do tempo. A capacidade dos clientes e do serviço pode reduzir a taxa efetiva. Cada fluxo guarda somente o vínculo em uso. Os percentis são histogramas com três algarismos significativos e resolução de microssegundos, com contadores e memória limitados mesmo em ensaios longos. O tempo mede cada requisição até consumir a resposta. Falhas de rede, conteúdo inesperado e destinos divergentes contam como falhas. Erros de coleta ou no contrato encerram o comando com status diferente de zero.

### Conferir a reutilização de códigos (T067)

O campo `reusedCodes` conta respostas de criação que repetiram um código da mesma execução. `firstRepeatedCode` identifica o primeiro. Cada repetição entra em `operations.create.failures`, omite dez resoluções e leva à saída 1. Os fluxos compartilham um índice SQLite que compara os sete caracteres com distinção entre maiúsculas e minúsculas. Cada criação aceita continua gerando cinco GETs e cinco POSTs.

Em um controle sequencial com dois destinos, o segundo `201` repetiu o primeiro código e as duas rotas passaram a resolver o novo destino. O relatório registrou uma criação confirmada, uma reutilização, cinco GETs e cinco POSTs corretos e saiu com código 1. No controle positivo, os dois códigos distintos produziram duas criações confirmadas, dez GETs e dez POSTs corretos e saída 0. Para reproduzir os controles do processo e a conferência entre arquivos, execute o teste na raiz.

```sh
mise exec -- node --test --test-name-pattern='reutilização de código|confere códigos de geradores' tests/load/latencias.test.mjs
```

**Campanha com vários clientes ou janelas.** Exporte a mesma `PUBLIC_ORIGIN` canônica em todos os geradores. Cada um pode usar uma `API_ORIGIN` diferente. Para cada processo e período, escolha um nome novo em `CODES_FILE` e grave o JSON no mesmo diretório. O gerador recusa um índice já existente. Após a saída completa de cada processo, transfira os pares SQLite/JSON preservando os nomes. Este exemplo considera já configuradas as variáveis de API, métricas e disco descritas acima.

```sh
# Primeiro gerador ou janela
CODES_FILE=cliente-a-janela-1.sqlite node tests/load/amostra.mjs > cliente-a-janela-1.json
# Segundo gerador ou janela
CODES_FILE=cliente-b-janela-1.sqlite node tests/load/amostra.mjs > cliente-b-janela-1.json
# Na máquina de análise, com um relatório por processo e período
node tests/load/combinar.mjs --require-unique cliente-a-janela-1.json cliente-b-janela-1.json
```

`operations` combina as contagens e histogramas observados pelos clientes. `codeUniqueness.distinct` conta os códigos distintos no conjunto. Para aceitar a janela, confira a saída zero de cada gerador, a saída zero do combinador e `codeUniqueness.status=verified`. O combinador confere o identificador da execução, a origem pública, a contagem de linhas e as reutilizações locais de cada índice. `repeatedWithinSamples` contabiliza repetições internas e `repeatedAcrossSamples` ocorrências já encontradas em outro arquivo. Uma colisão produz `status=reused` e saída 1. Para a primeira colisão entre arquivos, o resultado inclui o código e os dois relatórios envolvidos. Índices ausentes, trocados ou de origens públicas diferentes impedem o aceite. Para combinar somente histogramas históricos, omita `--require-unique`. Relatórios sem índice mantêm seus totais HTTP e aparecem com unicidade conjunta `unverified` e `distinct=null`.

Sem `CODES_FILE`, o índice local é temporário e desaparece no encerramento. Com o arquivo, a amostra conserva os códigos, o identificador da execução, a origem pública e a contagem de reutilizações. A inserção no índice acontece fora do cronômetro HTTP. Configure disco no cliente e no agregador. O cache de páginas do índice principal tem alvo de 8 MiB. Na agregação, cada arquivo de origem é aberto para leitura, incorporado ao índice temporário e fechado antes do seguinte. Cem milhões de códigos de sete bytes representam 700 MB decimais só de caracteres. Numa conferência local isolada do agregador, dois arquivos com 50.000 códigos sintéticos cada ocuparam 696.320 bytes por arquivo e o resultado foi de 100.000 códigos distintos. Na calibração de carga, meça também a ocupação das páginas e do diário SQLite, a folga de disco e a taxa efetiva dos clientes.

No laboratório com NGINX, Cassandra e Redis reais, um gerador confirmou duas criações, dez GETs e dez POSTs com zero reutilizações e zero destinos trocados. A consulta ao Cassandra confirmou dois códigos e dois destinos distintos de 100 bytes. Em duas execuções adicionais, cada cliente preservou seu índice, confirmou um vínculo e dez resoluções. O combinador registrou dois códigos distintos, zero repetições internas e entre arquivos e saída 0. A qualificação de 24 horas continua em T027.

### Conferir os contadores por processo (T043)

Em `metrics`, cada origem privada tem suas próprias coletas inicial e final. Para calcular as diferenças de acertos do Redis, leituras, gravações e erros CQL, o gerador exige o mesmo `processId` nas duas coletas da origem, uptime válido e contadores crescentes ou iguais. Se a API reiniciar no mesmo endereço, uma versão antiga omitir o identificador ou algum contador retroceder, a linha traz `inconclusive: true` e o motivo em `reason`. Os totais HTTP em `operations` e as diferenças válidas das outras réplicas continuam disponíveis no JSON. O gerador sai com código 1. Para obter os totais de armazenamento da instalação, repita a janela com coletas comparáveis em todas as réplicas.

Na raiz do repositório, execute `node --test tests/load/latencias.test.mjs` com Node 24. O ensaio usa respostas HTTP e disco controlados. A réplica estável registrou 16 acertos de cache, 4 leituras, 2 gravações e um erro em cada operação CQL. Na origem reiniciada, o uptime passou de 10 para 70 segundos e todos os contadores cresceram. O gerador marcou essa origem e a origem sem identificador como inconclusivas e preservou as 2 criações e 20 resoluções confirmadas pelo cliente.

Com serviços locais reais, uma janela estável de 4 criações e 40 resoluções registrou 4 gravações, 4 leituras e 36 acertos de cache. Em nova amostra no mesmo endereço, o processo foi reiniciado entre as duas coletas. O uptime final e todos os contadores de sucesso superavam os iniciais. A troca de `processId` tornou a janela privada inconclusiva, o cliente conservou as 4 criações e 40 resoluções confirmadas e o gerador encerrou com código 1.

### Origens privadas do mesmo processo (T059)

Para obter os totais privados da amostra, some os campos de diferença presentes em `metrics`. A primeira origem de `METRICS_ORIGINS` com duas coletas válidas do mesmo `processId` fornece as diferenças daquele processo. Se outro endereço observar o mesmo processo, `sharedMetricProcesses` lista ambos em `origins` e identifica em `countedAt` a origem usada no cálculo. As demais linhas válidas desse processo guardam as observações em `before` e `after` e apontam para a origem contabilizada. Repetir a mesma URL, inclusive com uma barra final, produz uma única coleta por fase.

Uma identidade observada em apenas uma das extremidades também aparece no agrupamento se outro endereço a informar. Se nenhuma origem tiver uma janela válida para aquele processo, `countedAt` fica `null`. Uma coleta final perdida ou uma troca de processo gera saída 1, com os totais HTTP, os erros de coleta, as leituras de disco disponíveis e as diferenças dos processos com janelas válidas.

Para reproduzir, execute `node --test --test-name-pattern='contabiliza o mesmo processo' tests/load/latencias.test.mjs`. Com respostas controladas, dois endereços do mesmo processo informaram 10 leituras, 1 gravação e zero acertos. O relatório contabilizou esses valores uma vez e preservou a criação, os cinco GETs e os cinco POSTs. No controle com processos distintos, as diferenças foram 6 leituras e 1 gravação na primeira réplica e 4 leituras e zero gravações na segunda. O teste também cobre uma origem com falha HTTP final, uma troca de identidade e a ausência de identificador.

Em 23/11/2026, com Cassandra 5.0.6 real e Redis indisponível, o gerador confirmou uma criação, cinco GETs e cinco POSTs, sem falhas ou destinos trocados. Os endereços `127.0.0.1` e `localhost` na mesma porta devolveram o mesmo `processId`. O gerador antigo contava duas gravações e vinte leituras. O atual contou uma gravação, dez leituras e zero acertos de cache. Ao repetir pela entrada HA e informar as duas APIs privadas, a criação ficou na primeira e houve cinco leituras em cada réplica real. Para reproduzir, use o comando de amostra acima com `CREATIONS=1 CONCURRENCY=1`, primeiro com os dois endereços da mesma API em `METRICS_ORIGINS`, depois com um endereço por API.

### Coletas parciais de telemetria (T054)

Antes do primeiro POST, o gerador consulta as origens de métricas e executa `du` e `df` nos contêineres configurados. Se uma origem estiver inacessível, a resposta for ilegível ou faltar uma leitura de disco, o comando identifica a coleta inicial em stderr e sai com código 1. Corrija a origem ou o acesso ao contêiner e repita o comando.

Após o tráfego, cada entrada de `metrics` identifica a réplica e traz as observações `before` e `after`, com o horário UTC de cada tentativa em `atUtc`. Uma falha final de rede, HTTP ou leitura do JSON deixa a diferença daquela réplica inconclusiva. A observação inicial e as diferenças das demais réplicas continuam no relatório. Os registros de `diskBefore` e `diskAfter` guardam o contêiner, o horário e os valores disponíveis em KiB. Se o último `du` ou `df` falhar, `reason` identifica o comando e `inconclusive` indica a coleta parcial. O processo escreve o JSON com as operações públicas e seus histogramas e encerra com código 1. Repita a janela se precisar de todos os indicadores privados para o aceite.

Execute `node --test tests/load/latencias.test.mjs` na raiz para reproduzir com respostas controladas. Com uma réplica retornando `503` na coleta final, o JSON preservou uma criação, cinco GETs e cinco POSTs, com latências programadas de 2, 4 e 8 ms. A outra réplica registrou mais 7 acertos no Redis, 3 leituras CQL e 1 gravação. Em uma segunda amostra, a leitura final de `df` falhou em um contêiner. O gerador conservou o resultado do `du` desse contêiner e as duas leituras do outro. Ambos os processos saíram com código 1. Nos cenários de falha da coleta inicial, o ensaio verificou zero POSTs de criação.

Duas verificações adicionais usaram HTTP em loopback e Docker real com um contêiner descartável para a coleta de disco. Na primeira, a segunda réplica respondeu `503` somente ao final. Na segunda, o contêiner encerrou depois da décima resolução e antes da coleta final de disco. Em ambas, o JSON conservou 1 criação, 5 GETs, 5 POSTs e a diferença de 10 leituras da réplica acessível. A saída foi 1, com o motivo da coleta perdida.

### Combinar as latências por rota (T037)

Na mesma fase do ensaio, salve o JSON de cada gerador uma vez. Na raiz do repositório, combine os arquivos dessa fase com Node 24.

```sh
# Em cada gerador, com as variáveis de ambiente do exemplo acima:
node tests/load/amostra.mjs > gerador-a.json   # use gerador-b.json no segundo
# Na máquina de análise, para combinar somente os histogramas:
node tests/load/combinar.mjs gerador-a.json gerador-b.json
```

Em `operations`, `create` mede o POST de criação, `resolveGet` mede o GET do código e `resolvePost` mede o POST de resolução. `resolve` já inclui GET e POST. Cada par de `bucketsUs` contém o limite superior inclusivo em microssegundos e o número de tentativas naquele intervalo, incluindo as que falharam. O combinador soma as frequências por limite e rota. Para p95 e p99, escolhe o primeiro limite cuja contagem acumulada alcança, respectivamente, 95% e 99% das tentativas. O resultado sai em milissegundos. Uma rota sem tentativas tem percentis `null`.

Execute `node --test tests/load/latencias.test.mjs` na raiz para reproduzir o cálculo com relógio, respostas HTTP e coleta de disco controlados. Um processo criou 19 links, o outro criou 1 e cada um fez cinco GETs e cinco POSTs por link. Os tempos abaixo são os valores programados no ensaio.

| Rota | Tentativas combinadas | p95 | p99 |
| --- | ---: | ---: | ---: |
| POST de criação | 20 | 2 ms | 20 ms |
| GET do código | 100 | 4 ms | 40 ms |
| POST de resolução | 100 | 8 ms | 80 ms |

### Medir blocos e posições abandonadas (T038)

1. Use um keyspace de ensaio e identifique cada processo de API pelo host e pela instância do processo ou contêiner. Nas duas extremidades da janela, pause as criações e aguarde o término das requisições em andamento. Registre a hora, o `epoch` e o `next_free` do alocador e recolha `localIds` e `operations.cqlWrite.count` diretamente de cada réplica. No datacenter da instalação, faça uma leitura `LOCAL_SERIAL` da partição do alocador para verificar o cursor após uma reserva de resultado incerto. O exemplo usa o keyspace da demo. [Consistência de leitura no cqlsh](https://cassandra.apache.org/doc/latest/cassandra/managing/tools/cqlsh.html)
2. Se uma réplica for reiniciada, colete suas métricas após a drenagem e antes de pará-la. O novo processo começa com contadores zerados. Some as diferenças de `cqlWrite.count` **por processo** durante a janela. Cada tentativa de gravar um vínculo já consumiu um ID, inclusive quando a gravação terminou em erro. Um pedido rejeitado antes da emissão não consome posição.
3. Calcule **posições abandonadas = soma dos saldos iniciais + avanço de `next_free` − tentativas de gravação − soma dos saldos finais**. Use os saldos das réplicas vivas em cada extremidade e a mesma geração (`epoch`) do alocador. Se faltar a última leitura de um processo que caiu em atividade, ou houver mudança de geração, registre a medição como inconclusiva.
4. Para contar os **blocos** afetados, registre cada evento isoladamente. Uma réplica encerrada com saldo positivo abandona um bloco parcial. Para a falha de confirmação, isole uma única reserva sem concorrência e registre o avanço de `next_free` e os saldos antes e depois. Se o cursor avançou e o emissor não recebeu o bloco, conte um bloco inteiro com o tamanho efetivamente reservado, inclusive junto ao teto. Um timeout por si só não comprova a aplicação da reserva. Confira a soma das perdas de cada evento com a fórmula da janela.

```sh
docker compose exec -T cassandra cqlsh -k encurtador \
  -e "CONSISTENCY LOCAL_SERIAL; SELECT epoch, next_free FROM reservations WHERE installation='principal';"
# Repita para cada origem privada, nas fronteiras e antes de um reinício.
curl -fsS "$API_PRIVADA/internal/metrics" | jq '{processId, localIds, gravacoes: .operations.cqlWrite.count, erros: .operations.cqlWrite.errors}'
```

Para reproduzir a medição local, execute na raiz com as dependências da API instaladas.

```sh
npm exec -- tsc -p tsconfig.test.json
node --test .test-dist/tests/load/blocos.test.js
```

O ensaio envia o POST de criação e consulta as métricas privadas pelos parsers HTTP da aplicação em memória. O emissor e a reserva de blocos executam o código do serviço, com respostas CQL controladas e Redis indisponível. As duas réplicas começaram a janela com 3 posições cada. O cursor avançou 8 e houve 3 tentativas de gravação, uma delas sem confirmação. Ao final, a nova réplica A tinha saldo 3 e B tinha saldo 2. A perda foi **6 + 8 − 3 − 5 = 6 posições em dois blocos**. O reinício de A descartou 2 posições e a reserva aplicada sem resposta descartou 4. Depois da janela, B usou suas duas posições sem avançar o cursor.

### Verificação adicional com Cassandra e Redis reais

Duas amostras locais criaram quatro links cada e fizeram 20 GETs e 20 POSTs de resolução por amostra. Um proxy de teste introduziu esperas diferentes entre fases e rotas para conferir a combinação das distribuições. Os números abaixo incluem essas esperas.

| Amostra | Criação p95 / p99 (ms) | GET p95 / p99 (ms) | POST de resolução p95 / p99 (ms) |
| --- | --- | --- | --- |
| Primeira | 19,2 / 19,2 | 10,4 / 10,7 | 25,5 / 25,5 |
| Segunda | 6,25 / 6,25 | 16,1 / 16,3 | 54,9 / 55,1 |
| Histogramas combinados | 19,2 / 19,2 | 15,0 / 16,3 | 52,2 / 55,1 |

Cada fase teve zero falhas, 36 acertos no Redis e quatro leituras de vínculos no Cassandra. Na prova dos blocos com duas APIs em processos separados, os saldos iniciais eram três e quatro IDs. Depois de encerrar a primeira API, perder uma confirmação de reserva e emitir dois IDs, o alocador tinha avançado dez posições e as duas réplicas ativas conservavam sete. A diferença de oito posições correspondeu às três do processo encerrado e às cinco da reserva cuja confirmação se perdeu.

## Projeção de disco em dez anos (T044)

Para 365,3 bilhões de vínculos ativos com destinos de 100 bytes em média, os destinos ocupam **36,53 TB** em uma cópia e **109,59 TB** com fator de replicação (RF) 3. Todas as capacidades abaixo são decimais (1 TB = 10¹² bytes) e representam espaço utilizável pelo sistema de arquivos.

O exemplo orça **160 bytes por vínculo e por réplica**. São 100 bytes de destino, 7 do código Base62, 16 para os valores de `created_at` e `expires_at` e uma estimativa de 37 para TTL, estrutura da partição, células e índices das SSTables. A conta supõe compressão líquida de 1:1. O esquema define os campos. O custo físico médio por vínculo precisa ser medido com dados representativos. [Esquema CQL](../../deploy/cassandra/schema.cql)

| Parcela | Cálculo | Capacidade |
| --- | --- | ---: |
| Vínculos nas três réplicas | 365,3 bilhões × 160 B × 3 | 175,344 TB |
| Espaço temporário de compactação | 50% dos dados replicados | 87,672 TB |
| Dados e compactação após a perda de um nó | 175,344 + 87,672 | 263,016 TB |
| Disco por nó, com sete nós iguais e seis sobreviventes | 263,016 ÷ 6 | 43,836 TB |
| Discos dos sete nós da instalação | 7 × 43,836 | 306,852 TB |
| Backup externo de uma geração completa de SSTables de todos os nós | 1 × 175,344 | 175,344 TB |
| **Total de disco para dados e backup externo** | **306,852 + 175,344** | **482,196 TB** |

Os sete nós são uma hipótese de cálculo. A margem de 43,836 TB corresponde à capacidade de um nó. Com seis nós e as três réplicas recompostas e equilibradas entre eles, cada sobrevivente comportaria 29,224 TB de dados e 14,612 TB para compactação. O backup supõe uma cópia física externa de cada SSTable das três réplicas, sem deduplicação entre nós. Ajuste o número de gerações à retenção de backups do operador. [Procedimento de cópia](../../deploy/ha/recuperacao.md#capturar-uma-cópia-consistente)

Reproduza a conta em qualquer máquina com Node.js. Altere as entradas para o cenário observado.

```sh
node --input-type=module <<'JS'
const links = 365_300_000_000, bytesPerReplica = 100 + 7 + 16 + 37;
const replicas = 3, nodes = 7, compactionFraction = 0.5, backupGenerations = 1;
const data = links * bytesPerReplica * replicas;
const perNode = Math.ceil(data * (1 + compactionFraction) / (nodes - 1));
const cluster = nodes * perNode;
const backup = backupGenerations * data;
for (const [parcela, bytes] of Object.entries({ data, perNode, cluster, backup, total: cluster + backup })) {
  console.log(parcela, bytes / 1e12, 'TB');
}
JS
```

Para calibrar, registre os bytes das SSTables de `links` em todos os nós após flush e estabilização da compactação, nas duas extremidades de uma amostra de criações. Divida o aumento pelo número de vínculos confirmados e pelo RF para obter os bytes físicos por vínculo e réplica. Meça também o pico temporário durante compactação, retenção de snapshots locais e reconstrução, a ocupação do nó mais cheio e o tamanho arquivado por geração. Ajuste as folgas a esses picos e acrescente os consumos fixos medidos, como commit log, tabelas de sistema e alocador, ao orçamento dos respectivos volumes.

## Qualificação de T027

**Pendente de infraestrutura dimensionada e autorização para executar o ensaio externo de 24 horas.** O resultado local acima comprova o gerador e o percurso funcional da amostra.

1. Registrar data, digest da imagem, versões e posição de cada API, entrada, Redis e Cassandra por host. Registrar CPU, RAM, topologia de rede, disco livre por nó, RF, consistências, tamanho dos blocos e intervalo de IDs autorizado. Reservar capacidade de dados e de emissão para o dia completo e para os demais testes acordados.
2. Preparar geradores em hosts separados do serviço. Medir a folga de CPU, memória, rede e descritores dos clientes. Fazer uma calibração curta no ambiente dedicado, preservando a proporção de dez resoluções por criação e a média de 100 bytes por destino. Ajustar concorrência e taxa para superar 100 milhões de criações e 1 bilhão de resoluções corretas em um dia.
3. Registrar instantes UTC de início e término da janela de 24 h e da janela interna sem Redis. Coletar contadores de cada réplica, histogramas de latência, erros, uso e espaço livre de disco, RSS, atraso do event loop, I/O, OOM e eventos de compactação em intervalos regulares. Identificar reinícios de processos e usar intervalos de contadores correspondentes à mesma instância. Com vários geradores ou períodos, reunir os pares JSON/SQLite da mesma origem pública e verificar o conjunto com `combinar.mjs --require-unique` antes de somar os sucessos dos clientes. Calcular diferenças dos contadores compartilhados uma única vez. Registrar p95/p99 por operação e por fase. Agregar histogramas para obter percentis globais quando houver vários clientes.
4. Com todos os nós de dados em funcionamento, desativar o Redis da instalação de ensaio na janela previamente aprovada e anotar a duração real. Verificar os destinos, as respostas `503`, os acertos de cache e as consultas ao Cassandra em cada fase. Retomar o cache, verificar a continuidade da criação e da resolução e capturar as métricas ao final.
5. Publicar criações e resoluções confirmadas e falhas separadamente, duração real, destinos divergentes e leituras omitidas por falha de criação. Para a janela sem Redis exigir, durante o mesmo intervalo, pelo menos 100.000.000/86.400 criações por segundo e 1.000.000.000/86.400 resoluções corretas por segundo, com consultas persistentes compatíveis e zero acertos de cache. Para o dia completo usar os totais efetivamente confirmados em 24 h. Preservar os relatórios por período, o uso de disco consolidado por host e a descrição de qualquer limite atingido. Os alvos de p95/p99 permanecem como decisão do mantenedor.
