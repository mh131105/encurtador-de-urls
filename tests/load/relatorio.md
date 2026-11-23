# Carga, identidade dos links e capacidade de disco

O gerador envia um destino de 100 bytes por criação. Para cada vínculo confirmado, verifica dez resoluções, cinco por GET e cinco por POST. Cada consulta exige `302`, destino integral em `Location` e `Cache-Control: no-store`. O cliente registra falhas de criação, leituras omitidas, divergências de destino e códigos repetidos separadamente.

## Executar uma amostra

Use Node.js 24 em um cliente com acesso à entrada pública, às métricas privadas de cada API e aos volumes de uma instalação dedicada. Reserve IDs e disco para todos os geradores e janelas. Exemplo a partir da raiz, com endereços ilustrativos.

```sh
export API_ORIGIN=http://127.0.0.1:8080
export PUBLIC_ORIGIN=https://s.example
export METRICS_ORIGINS=http://api-a:3000,http://api-b:3000
export CASSANDRA_CONTAINERS=contexto-a/db-a,contexto-b/db-b,contexto-c/db-c
export CASSANDRA_KEYSPACE=encurtador CREATIONS=10 CONCURRENCY=2
CODES_FILE=cliente-a.sqlite node tests/load/amostra.mjs > cliente-a.json
```

Ajuste `PUBLIC_ORIGIN` à origem que o serviço realmente emite. Quando o gerador usa essa própria origem, basta definir `API_ORIGIN` e omitir `PUBLIC_ORIGIN`. Use hostnames Docker acessíveis pela máquina do cliente ou os endereços privados correspondentes. Na demo de nó único, `CASSANDRA_CONTAINERS` aceita apenas o nome local do contêiner. O gerador lê `du` do keyspace e `df` do volume em cada nó antes e depois da janela.

`CREATIONS` limita as tentativas e `CONCURRENCY` limita os fluxos simultâneos. `TIMEOUT_MS` define o prazo de cada operação e `CREATIONS_PER_SECOND` regula o início das criações. Registre a taxa efetivamente concluída. Uma falha de medição inicial impede a partida. No fechamento, o relatório preserva as contagens HTTP e as leituras válidas mesmo quando um erro de telemetria leva à saída 1.

## Combinar clientes e janelas

Use um `CODES_FILE` novo por processo. O SQLite compara os sete caracteres com distinção de caixa, mantendo em disco o índice dos códigos. Sem o parâmetro, o índice temporário é descartado na saída. Uma repetição na mesma execução produz falha de criação, omite as dez consultas daquela tentativa e faz o comando sair com código 1.

Exporte a mesma origem pública em todos os geradores, ainda que usem endereços de entrada diferentes. Leve cada par JSON/SQLite completo para o diretório de análise e preserve os nomes originais.

```sh
# No segundo cliente, com as variáveis da própria instalação.
CODES_FILE=cliente-b.sqlite node tests/load/amostra.mjs > cliente-b.json
# No diretório com os resultados dos dois processos.
node tests/load/combinar.mjs --require-unique cliente-a.json cliente-b.json
```

Para aprovar a janela, exija saída zero de cada gerador e do combinador e `codeUniqueness.status=verified`. `distinct` é o total de códigos distintos na origem pública. O combinador confere identidade da execução, origem, contagem de linhas e repetições dentro e entre arquivos. Índices ausentes, trocados ou colisões impedem a confirmação. Dimensione o disco tanto dos clientes quanto do agregador. Só os sete caracteres de 100 milhões de códigos ocupam 700 MB decimais, antes de páginas e diários do banco.

Em `operations`, `create`, `resolveGet` e `resolvePost` têm distribuições separadas. `resolve` já reúne as duas consultas. Cada par de `bucketsUs` contém um limite superior inclusivo em microssegundos e a frequência de requisições, com êxitos e falhas. O combinador soma frequências para obter p95 e p99 da fase. Não some nem tire a média dos percentis já publicados. Sem `--require-unique`, relatórios históricos podem ser combinados para latência. Se faltarem índices, os totais HTTP são preservados com unicidade `unverified` e `distinct=null`.

As diferenças de `cacheHits`, leituras, gravações e erros no Cassandra exigem coletas do mesmo `processId` em cada ponta da janela. Reinício, coleta incompleta ou contador regressivo torna a série privada inconclusiva. O gerador conta apenas uma vez os endereços alternativos de um mesmo processo. Com clientes simultâneos, use apenas uma diferença para o mesmo processo e intervalo. [Campos das métricas](../ops/metricas.md)

Uma amostra local com NGINX, Cassandra e Redis reais confirmou duas criações, dez GETs e dez POSTs, sem reutilização nem destinos trocados. Dois processos com índices separados também confirmaram a união de dois códigos distintos. Os controles do gerador e do combinador podem ser repetidos com `node --test tests/load/latencias.test.mjs`.

## Medir posições abandonadas

Pause as criações nas duas extremidades da janela e drene requisições. Registre `epoch` e `next_free` na reserva e `processId`, `localIds` e `operations.cqlWrite.count` em **cada** API. Para uma reserva de resultado incerto, leia o cursor com `LOCAL_SERIAL` no datacenter da instalação.

```sh
docker compose exec -T cassandra cqlsh -k encurtador \
  -e "CONSISTENCY LOCAL_SERIAL; SELECT epoch, next_free FROM reservations WHERE installation='principal';"
curl -fsS "$API_PRIVADA/internal/metrics" | jq '{processId, localIds, gravacoes: .operations.cqlWrite.count}'
```

**Posições abandonadas = saldos iniciais + avanço do cursor − tentativas de gravação − saldos finais.** Some os saldos das APIs vivas em cada ponta. Cada tentativa de gravação, mesmo em erro, consumiu um ID. Em reinício planejado, colete as últimas métricas após a drenagem e conte as tentativas de gravação por processo. Sem a última leitura de um processo perdido em atividade ou com mudança de geração, o resultado é inconclusivo.

Para contar blocos, observe cada evento isoladamente. Encerrar uma API com saldo positivo abandona a parte restante de um bloco. Uma reserva aplicada cuja resposta se perdeu abandona todas as posições daquele bloco. Para comprovar a segunda perda, isole a reserva, compare o avanço de `next_free` e confira que nenhum emissor recebeu as posições. Um timeout sozinho deixa a aplicação da reserva incerta. [Teste com reinício e confirmação perdida](blocos.test.ts)

## Projeção de disco em dez anos

Para estimar, multiplique os vínculos ativos pelos bytes físicos por vínculo e pelo RF. Num cenário hipotético de 365,3 bilhões de vínculos ativos e 100 bytes de destino, uma réplica usa em média 160 bytes por vínculo. Esse total inclui 100 bytes de destino, 7 de código, 16 de timestamps e 37 estimados para TTL, células, partições e índices. A hipótese de compressão é 1:1.

| Parcela do cenário | Cálculo | Disco utilizável |
| --- | --- | ---: |
| Dados com RF 3 | 365,3 bilhões × 160 bytes × 3 | 175,344 TB |
| Dados e folga de compactação de 50% | 175,344 × 1,5 | 263,016 TB |
| Por host, com sete nós e redistribuição entre seis sobreviventes | 263,016 ÷ 6 | 43,836 TB |
| Discos dos sete hosts | 43,836 × 7 | 306,852 TB |
| Uma geração de backup externo de todas as réplicas | 175,344 × 1 | 175,344 TB |
| **Dados, folga e backup** | 306,852 + 175,344 | **482,196 TB** |

Os valores são terabytes decimais. Calibre os bytes por réplica dividindo o crescimento total de SSTables de `links`, após flush e estabilização da compactação, pelos vínculos confirmados e pelo RF. Meça o nó mais cheio, a compactação, a reconstrução, os snapshots locais e o tamanho arquivado. Some commit log, tabelas de sistema e demais consumos fixos por volume. Ajuste a retenção de backups e a folga por perda de nó ao ambiente. [Esquema CQL](../../deploy/cassandra/schema.cql) · [Cópias dos dados](../../deploy/ha/recuperacao.md#capturar-uma-cópia-consistente)

## Ensaio sustentado de 24 horas

A meta de qualificação é confirmar 100 milhões de criações e 1 bilhão de resoluções corretas em 24 horas. A execução requer infraestrutura dimensionada e uma janela dedicada. A amostra local comprova o percurso funcional do gerador.

1. Inventarie hardware, rede, digests, RF, consistências, blocos, teto autorizado e espaço por nó. Dimensione os clientes em hosts separados. Calibre concorrência e taxa com destinos representativos e registre CPU, I/O, rede e descritores também nos geradores.
2. Registre início e fim em UTC. Separe as fases com Redis disponível, indisponível e recuperado. Durante a janela sem Redis, mantenha o Cassandra saudável e meça a duração, o aumento de consultas CQL, os erros e a ausência de acertos do cache.
3. Em cada fase, registre contagens corretas e falhas, p95/p99 por rota, memória, atraso do event loop, OOM, disco, compactação e posições abandonadas. Confira a unicidade global antes de aprovar os totais. Na janela sem Redis, compare as taxas **confirmadas** com 100.000.000 ÷ 86.400 criações/s e 1.000.000.000 ÷ 86.400 resoluções/s.
4. Publique a topologia observada, duração e totais do dia completo, dados por fase, medições indisponíveis e limites encontrados. Resultados de uma janela curta não medem essas metas.
