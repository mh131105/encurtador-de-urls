# Saúde e métricas da API

As sondas ficam na porta privada de cada réplica. O NGINX da distribuição responde `404` a acessos públicos em `/internal/`.

| GET | Uso |
| --- | --- |
| `/internal/live` | Verifica se o processo HTTP responde. |
| `/internal/ready` | Consulta `system.local` no Cassandra. Falha da consulta ou expiração do prazo produz `503`. O Redis é opcional para a prontidão. |
| `/internal/metrics` | Retorna contadores e histogramas desde a partida do processo. |

```sh
curl -fsS "${API_PRIVADA:?informe a origem privada da réplica}/internal/metrics"
```

- `processId` muda em toda inicialização. Calcule diferenças somente entre coletas da mesma réplica com a mesma identidade e contadores crescentes ou iguais. Dois endereços do mesmo processo representam uma só série.
- Em `operations`, `create` e `resolve` contam operações da aplicação. `cqlRead` e `cqlWrite` contam leituras e gravações de vínculos. Cada série expõe `count`, `errors`, `totalMs` e `buckets`. Os limites em `latencyUpperBoundsMs` são inclusivos. O último intervalo contém os tempos acima do maior limite.
- `cacheHits` aumenta em uma leitura vigente e válida no Redis. Para comprovar uma leitura fria em uma API isolada, remova somente a chave do código de teste, consulte-o e confira que `cqlRead.count` subiu uma unidade e `cacheHits` e `cqlRead.errors` continuaram iguais.
- `localIds` é o saldo do bloco já reservado por **esta réplica**. A tabela `reservations` contém o cursor do conjunto e o teto autorizado. [Medição de posições abandonadas](../load/relatorio.md#medir-posições-abandonadas)
- `memoryBytes.rss` mede a memória residente do processo. Heap, memória externa e buffers podem se sobrepor. `eventLoopP99Ms` informa o p99 do atraso do event loop desde a partida. A memória total do host e a dos cgroups exigem [medição própria](../../deploy/demo/qualificacao.md).

Os contadores de resolução agrupam GET e POST. O [gerador de carga](../load/relatorio.md) mede separadamente as latências de cada rota pelo cliente. [Implementação das métricas](../../src/http/metrics.ts) · [Sonda de prontidão](../../src/http/health.ts)
