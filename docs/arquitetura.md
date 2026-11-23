# Arquitetura do encurtador de URLs

Um vínculo associa um código de sete caracteres a um destino HTTP ou HTTPS por dez anos. A origem pública da instalação faz parte do link compartilhado. O Cassandra guarda o vínculo, o Redis acelera consultas e o NGINX serve a interface React/Astryx e encaminha requisições à API em Node.js e TypeScript. A interface e os clientes HTTP usam o mesmo contrato.

## Da criação ao redirecionamento

1. `POST /api/v1/encurtar` recebe `{"url":"…"}`. A API aceita JSON em UTF-8 de até 1 MiB e um destino absoluto com host, sem espaços, barras invertidas ou caracteres de controle ASCII. A validação aceita Unicode bem formado. A aplicação guarda o texto enviado, incluindo escapes, consulta e fragmento.
2. Uma réplica obtém um ID do bloco que reservou e o converte em código. Grava código, destino e instantes de criação e vencimento em uma partição do Cassandra cuja chave é o código. Só responde `201` com `{"short_url":"…"}` depois da confirmação da gravação. Um novo pedido para o mesmo destino gera outro link.
3. `GET /{codigo}` e `POST /api/v1/redirecionar` resolvem o vínculo. O POST recebe `{"short_url":"…"}` e exige a origem pública configurada e o caminho literal de um código. Para um vínculo ativo, ambas as rotas devolvem `302`, `Location` e `Cache-Control: no-store`.
4. Um destino integralmente ASCII passa ao cabeçalho byte a byte. Caracteres internacionais no caminho, consulta e fragmento viram escapes dos bytes UTF-8. Um hostname internacional sem escapes prévios usa a conversão IDNA do Node.js. Se o host combina Unicode e escapes, apenas os caracteres não ASCII são codificados, preservando a grafia dos escapes existentes.

Uma entrada de criação ou corpo de resolução inválido recebe `400`. Um código inexistente ou vencido recebe `404`. Quando a API precisa do Cassandra e a operação não pode ser confirmada, responde `503`. O NGINX mantém as sondas e métricas em `/internal/` fora da entrada pública. [Rotas HTTP](../src/http/server.ts) · [Destino e validade](../src/links/link.ts) · [Regras do NGINX](../deploy/nginx/rotas.conf)

## Códigos e reservas

Cada instalação usa uma permutação FF1-AES sobre sete dígitos Base62. O alfabeto é `0–9 A–Z a–z`, com distinção de caixa e zeros à esquerda. Uma mesma chave, tweak e alfabeto transformam IDs distintos em códigos distintos. A emissão começa no ID `62⁴` (14.776.336) e termina antes de `62⁷` (3.521.614.606.208). É um domínio finito. A expiração de um vínculo não devolve o ID. As URLs curtas são públicas para quem conhece o código.

A linha `principal` da tabela `reservations` contém o próximo ID livre, teto autorizado, geração e impressão digital dos parâmetros FF1. Cada API reserva um bloco de até `ID_BLOCK_SIZE` posições (padrão 1.024). Uma transação condicional do Cassandra (LWT, `LOCAL_SERIAL`) avança o cursor apenas se os quatro valores ainda correspondem à leitura. A geração local de códigos amortiza essa disputa entre as réplicas. A gravação do vínculo é um `INSERT` comum. A perda de confirmação de uma reserva ou o reinício da API podem deixar posições sem uso.

Antes de consumir cada posição, a API consulta a marca externa da instalação. Essa marca registra geração, piso e teto fora dos snapshots do Cassandra. A chave FF1, o tweak, a origem e a identidade da instalação devem durar tanto quanto os links. Se o banco voltar a um snapshot antigo, a última marca durável permite retomar acima de todo o intervalo anteriormente autorizado. Sem essa evidência ou sem espaço acima do teto, a instalação restaurada só pode resolver links existentes. [Permutação](../src/ids/codec.ts) · [Reserva condicional](../src/storage/allocator.ts) · [Emissão, backup e restauração](../deploy/ha/recuperacao.md)

## Vencimento e cache

O vencimento ocorre no mesmo instante UTC dez anos civis depois da criação. Um vínculo criado em 29 de fevereiro vence em 28 de fevereiro quando o ano de destino é comum. A partir de `expires_at`, a API já responde `404`. O TTL físico do Cassandra usa o tempo restante arredondado para cima em segundos, acrescido de um segundo e da tolerância entre relógios. Isso evita remover a linha antes da fronteira pública. Cassandra 5 requer formato de armazenamento compatível com expirações além de 2038. [Escrita com TTL](../src/storage/write.ts) · [Medição dos relógios](../deploy/demo/relogios.md)

O Redis guarda apenas vínculos encontrados, sob a chave `INSTALLATION_ID:codigo`. O prazo de uma entrada é o menor entre o tempo restante do vínculo e o TTL do cache. A API confere tanto o destino quanto a vigência ao ler. Ausência, corrupção, expiração ou falha do Redis encaminham a consulta ao Cassandra. A espera pelo cache ocupa no máximo metade do prazo HTTP restante, limitada também por `CACHE_TIMEOUT_MS`. Após uma leitura persistente confirmada, o preenchimento do Redis roda em segundo plano. Um acerto válido pode servir uma leitura durante uma falha do banco. Uma escrita sempre precisa do banco. [Resolução](../src/links/resolve.ts) · [Métricas privadas](../tests/ops/metricas.md)

## Escala e disponibilidade

Cada consulta de destino conhece a chave de partição. O Cassandra distribui essas partições pelos nós de acordo com os tokens e a replicação do keyspace. Acrescentar nós requer espaço para streaming, compactação e reparo. A capacidade física inclui todas as réplicas, backups, retenção e folga para perda de nó. Aumentar o bloco reduz a frequência de reservas na única linha coordenadora e pode aumentar a quantidade de posições abandonadas. [Carga e projeção de disco](../tests/load/relatorio.md)

A instalação local usa um nó Cassandra com RF 1 e consistência `ONE`. A topologia distribuída de referência usa três nós no mesmo datacenter em domínios de falha distintos, RF 3 e `LOCAL_QUORUM`, além de duas APIs e duas entradas atrás de um endereço público redundante. O operador fornece o balanceamento e o armazenamento coerente e redundante da marca. [Topologia e expansão](../deploy/ha/topologia.md)

Os ensaios locais exercitaram criação, ambas as rotas, reinício com cache frio e restauração de dados. A medição de memória foi feita numa VM Linux de 2 GiB com um serviço vizinho sintético. A margem de uma VPS compartilhada, o comportamento após perda de um host físico e a vazão sustentada por 24 horas dependem de ensaios no ambiente correspondente. [Qualificação local](../deploy/demo/qualificacao.md) · [Ensaio de failover](../tests/ops/failover.md)
