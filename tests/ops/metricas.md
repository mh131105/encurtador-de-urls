# Métricas da API

Leia `GET /internal/metrics` na porta privada de cada réplica. O campo `processId` identifica a instância da API que mantém os contadores e muda a cada inicialização. Compare duas coletas da mesma réplica quando ambas trouxerem o mesmo identificador. Para obter operações por segundo, divida a diferença de `operations.create.count` e de `operations.resolve.count` pelos segundos decorridos. Cada contador inclui os erros, detalhados em `errors`.

Cada operação tem a soma das latências em milissegundos e contadores por intervalo. `latencyUpperBoundsMs` contém o limite superior inclusivo de cada intervalo. O último contador registra tempos superiores ao maior limite. `cacheHits` conta leituras atendidas pelo Redis. `cqlRead` e `cqlWrite` acompanham consultas e gravações de vínculos, incluindo falhas. `localIds` indica o saldo do bloco já reservado nesta réplica. Consulte a tabela de reservas para o teto persistente e o próximo ID livre.

`memoryBytes.rss` mede a memória residente do processo. Heap, memória externa e buffers são recortes que se sobrepõem. `eventLoopP99Ms` mede o atraso p99 do event loop desde o início da réplica.

No ambiente de integração, `npm test` executa `tests/integration/metricas.test.ts`. O ensaio cria um vínculo, aquece o Redis e torna a tabela de vínculos indisponível em seu keyspace descartável. Confere a leitura em cache, a resposta 503 ao tentar gravar ou ler outro código e os contadores de cada operação.

Na amostra local, uma criação seguida por GET e POST de resolução produziu 1 gravação, 1 leitura no Cassandra e 1 acerto no Redis. Os valores individuais de código, destino e chave ficaram ausentes do JSON.

### Entrada inválida no cache (T049)

O contador `cacheHits` só aumenta se o destino no Redis satisfizer as mesmas regras da criação e o vínculo estiver vigente. Uma entrada de cache com destino inválido aciona uma leitura persistente. A gravação posterior no cache preserva o texto original confirmado pelo banco.

No ensaio de 23/11/2026, criamos um vínculo pela API e gravamos em seu prefixo no Redis 7.4.6 uma entrada com `destination: ""` e `expiresAt` no futuro antes de cada consulta. GET e POST retornaram `302`, `Cache-Control: no-store` e o destino integral, com escapes, consulta e fragmento. Cada rota somou uma consulta CQL e zero acertos de cache. Em seguida tornamos indisponível a tabela de vínculos do **keyspace descartável** no Cassandra 5.0.6. Repetimos a preparação do Redis e ambas as rotas retornaram `503` sem `Location`, com uma tentativa CQL em erro por consulta.

Para repetir o caso contratual sem serviços externos, execute na raiz. Esse teste usa HTTP local, o adaptador Redis da aplicação e respostas controladas do cliente do cache e da leitura CQL.

```sh
mise exec -- npm ci
mise exec -- npx --no-install tsc -p tsconfig.test.json
mise exec -- node --test --test-name-pattern='destino inválido no Redis' .test-dist/tests/contract/resolver.test.js
```


### Prazo de consulta ao cache (T052)

No GET do código e no POST de resolução, a API limita a espera pelo Redis ao menor valor entre `CACHE_TIMEOUT_MS` e metade do prazo HTTP que ainda resta. O tempo gasto para receber e validar o corpo do POST já foi descontado. Com menos de um milissegundo disponível para o cache, a API consulta diretamente o Cassandra. O preenchimento do Redis após uma leitura confirmada usa seu próprio timeout em segundo plano.

O ensaio HTTP local com dados controlados usa 40 ms para HTTP e 100 ms para o Redis. Com o cache pendente, cada rota faz uma consulta persistente. Um vínculo ativo retorna `302` com o destino original e `Cache-Control: no-store`. Uma falha de leitura retorna `503` sem `Location`. Um acerto rápido evita a consulta ao banco. Um segundo ensaio entrega o corpo do POST em partes, espera 180 dos 300 ms disponíveis e confirma que a resposta ainda chega pelo caminho persistente. Após compilar os testes, execute o comando abaixo.

```sh
mise exec -- node --test --test-name-pattern='reserva tempo|corpo do POST consome' .test-dist/tests/contract/resolver.test.js
```
