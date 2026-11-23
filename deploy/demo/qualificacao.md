# Qualificação da instalação compartilhada

A [medição prévia](preflight.md) define o orçamento e a margem. O perfil local de prova usa imagens prontas, volume exclusivo de dados e marca externa separada da base.

## Distribuição da vigésima rodada

Em 23/11/2026, a VM ARM64 de 2 GiB, com duas CPUs e sem swap, executou o [ensaio leve](#reproduzir-o-ensaio-leve) com a API `sha256:3e2a1cc2c6b8b139c04487b39633f8c1e558c61c0751831aa3db53faa78f0579` e o NGINX `sha256:40f11fee7813a8425918a767fc8f662b9bb013bbed19ffea9eb72623089c1f8d`. O vizinho sintético ocupava 160 MiB continuamente e mais 64 MiB em intervalos de cinco segundos. Cada perfil teve 35 segundos de pré-voo e margem mínima exigida de 192 MiB.

| Serviços na VM | Janela de coleta (UTC) | Orçamento (MiB) | Maior soma simultânea e fase (MiB) | Pico na fase dos cabeçalhos (MiB) | `memory.peak` do NGINX antes e depois dos cabeçalhos (MiB) | Mínimo disponível na VM (MiB) |
| --- | --- | ---: | --- | ---: | --- | ---: |
| API, NGINX, Redis e Cassandra | 12:09:59–12:11:32 | 1.345 | 1.105,68 no reinício | 1.038,89 | 5,49 a 15,80 | 548,64 |
| API, NGINX e Redis, com [Cassandra em outro host](#reproduzir-com-o-cassandra-em-outro-host) | 12:12:26–12:12:38 | 232 | 92,82 nos cabeçalhos | 92,82 | 5,84 a 13,48 | 1.354,33 |

As 175 sondas do vizinho na pilha completa e as 24 com banco externo responderam. O consolidador encontrou amostras simultâneas em todas as fases de cada perfil, zero OOM e nenhum intervalo inconclusivo. GET e POST entregaram `302`, `no-store` e o mesmo `Location` nos três tamanhos de 12.288, 1.048.566 e 3.145.570 bytes. Depois do reinício, cada rota fria fez uma leitura de Cassandra com zero acertos de Redis. A conta restrita do Cassandra 5.0.6 externo confirmou que o keyspace passou de zero a cinco vínculos. O nó manteve o `host_id` `df2986fa-6619-4022-b9b6-37beb45862b2`, o mesmo contêiner e o horário de partida. A margem disponível na VPS ainda depende da medição com os vizinhos reais.

## Distribuição da décima oitava rodada

A VM ARM64 de 2 GiB usou a API `sha256:c0c47bd4f094584d21c592e8e94456c4667d53d4cde764d2350413c3cc6d759d` e o NGINX `sha256:40f11fee7813a8425918a767fc8f662b9bb013bbed19ffea9eb72623089c1f8d`. A margem mínima exigida foi de 192 MiB.

| Execução com cobertura completa das fases | Orçamento (MiB) | Maior soma observada com todos os serviços (MiB) | Pico na fase de cabeçalhos (MiB) | `memory.peak` do NGINX antes e depois dos cabeçalhos (MiB) | Mín. disponível no host (MiB) |
| --- | ---: | --- | ---: | --- | ---: |
| Pilha completa, segunda execução | 1.315 | 949,64 na compactação | 892,71 | 6,09 a 13,43 | 556,37 |
| Cassandra em outra VM | 232 | 91,72 nos cabeçalhos | 91,72 | 5,85 a 13,64 | 1.359,29 |

Na primeira execução da pilha completa, a linha 115 registrou **1.108,01 MiB** durante a partida, somando Cassandra, Redis e a CLI de inicialização do emissor. Os eventos do Docker confirmaram que o NGINX ainda seria criado. A maior soma com os quatro serviços nessa fase foi de 1.048,10 MiB. O consolidador saiu com código 1 e registrou o pico da partida como inconclusivo. O orçamento dessa execução foi de 1.324 MiB, e o host conservou pelo menos 584,36 MiB disponíveis. A repetição usou volume novo e outro pré-voo. Nela, a CLI rodou entre duas coletas. Ao dimensionar a partida, considere também os 1.108,01 MiB efetivamente observados na primeira execução.

As 175 sondas da primeira execução, as 174 da segunda e as 24 com banco externo responderam. Todos os ciclos tiveram marcadores estáveis e houve zero OOM. Nos dois perfis da tabela, GET e POST entregaram o `Location` de 3.145.570 bytes. Depois do reinício, cada rota recuperou o vínculo com uma leitura de Cassandra e zero acertos do Redis. No banco externo, o papel de teste confirmou cinco vínculos no keyspace inicialmente vazio e o nó conservou o mesmo instante de partida.

## Distribuição da décima sexta rodada

A VM ARM64 de 2 GiB mediu a API `sha256:66d75cb5e38cdcffe490ca94aec9e238c3e2f8d71845116989deb3fc88228694` e o NGINX `sha256:40f11fee7813a8425918a767fc8f662b9bb013bbed19ffea9eb72623089c1f8d`. Nos dois perfis aceitos, o proxy entregou nas duas rotas o `Location` de **3.145.570 bytes** gerado pelo destino com acentos.

| Perfil aceito | Orçamento (MiB) | Pico da pilha e fase (MiB) | Pico na fase de cabeçalhos (MiB) | `memory.peak` do NGINX antes e depois dos cabeçalhos (MiB) | Mín. disponível no host (MiB) |
| --- | ---: | --- | ---: | --- | ---: |
| Pilha completa | 1.326 | 949,59 no reinício | 881,47 | 4,73 a 12,79 | 546,38 |
| Cassandra em outra VM | 232 | 83,34 nos cabeçalhos | 83,34 | 5,59 a 13,27 | 1.298,80 |

A primeira execução local saiu com código 1 por cobertura insuficiente na partida. A linha 115 de `memoria.jsonl` registrou API, Redis e Cassandra somando **1.107,32 MiB**, acima da maior soma completa dessa fase, de 1.048,81 MiB. O pico da partida ficou inconclusivo. Nas observações dessa execução, o host conservou ao menos 627,36 MiB disponíveis segundo `MemAvailable`, o orçamento foi de 1.286 MiB e houve zero OOM. Na fase de cabeçalhos, que teve cobertura completa, a pilha chegou a 1.088,80 MiB e o `memory.peak` do NGINX passou de 6,08 a 15,37 MiB.

A repetição local usou um volume novo e novo pré-voo, com os mesmos limites por serviço, margem de 192 MiB e regras de cobertura. Seus 173 ciclos e os 24 ciclos do perfil externo tiveram marcadores estáveis. Todas as sondas do vizinho responderam, ambos os relatórios saíram com código zero e houve zero OOM. Após o reinício, cada rota recuperou o primeiro vínculo com uma leitura confirmada de Cassandra e zero acertos do cache. Consultas diretas pelo papel de teste confirmaram que o keyspace externo passou de zero a **cinco vínculos** no mesmo nó. A VPS compartilhada ainda depende de medição própria.

## Distribuição da décima quinta rodada

Na VM ARM64 de 2 GiB, `docker image inspect` confirmou o NGINX da T070 em `sha256:9806383041063e4f716d39bc60c8b166fc99335e6e61f7f0f612d053af93581e` e a API em `sha256:ae04a922e924b18591854b2149445edf20e3b376731632fee08f1c28f726f80e`. Os dois perfis passaram com o vizinho ativo e margem mínima exigida de 192 MiB.

| Pico simultâneo por fase (MiB) | Pilha completa | Cassandra em outra VM |
| --- | ---: | ---: |
| Partida | 1.058,49 | 55,59 |
| Repouso | 1.074,54 | 55,84 |
| Criação e leitura | 1.075,24 | 56,31 |
| Destinos longos | 1.082,17 | **69,48** |
| Reinício e cache frio | **1.141,06** | 61,39 |
| Compactação do banco local | 934,01 | — |

O pré-voo da pilha completa mediu no mínimo 1.551.040 KiB disponíveis. Com orçamento de **1.322 MiB** e limites efetivos somando 1.256 MiB, o host manteve ao menos **600,77 MiB disponíveis**. As 174 sondas responderam. Com Cassandra externo, os três serviços locais tinham orçamento e limites de **232 MiB** e a VM manteve ao menos **1.355,57 MiB disponíveis**. Todas as 23 sondas responderam. A linha 5 desse perfil cruzou de partida para repouso e participou apenas das verificações do ciclo. Houve zero OOM em ambos.

O maior RSS da API foi 109,62 MiB na pilha completa e 102,74 MiB com Cassandra externo. Os maiores valores de heap em uso foram 31,39 e 31,29 MiB, os de memória externa foram 9,38 e 7,35 MiB e o p99 máximo do atraso do event loop foi 30,02 e 30,06 ms. Cada rota recuperou o destino original depois do reinício, com uma leitura confirmada do Cassandra e zero acertos do Redis. No banco externo, uma consulta direta confirmou quatro vínculos no keyspace inicialmente vazio e o contêiner manteve o instante de partida. A qualificação da VPS continua dependente de medições no próprio host.

## Reproduzir o ensaio leve

Em uma máquina de build da arquitetura do host de destino, execute na raiz do repositório.

```sh
docker build -t encurtador-api:0.1.0 .
docker build -f deploy/nginx/Dockerfile -t encurtador-nginx:0.1.0 .
docker save -o encurtador.tar encurtador-api:0.1.0 encurtador-nginx:0.1.0
```

No laboratório Linux dedicado, disponibilize a mesma versão de `compose.yaml`, `deploy/`, `tests/ops/demo.sh` e `tests/ops/redirecionamento.mjs`, Python 3, Bash, curl e Docker Compose. Carregue as imagens e disponibilize as versões de dados fixadas no Compose antes de medir. O cliente HTTP dos casos de cabeçalho roda em um contêiner temporário com a própria imagem da API. Seu consumo aparece no uso do host. O script cria um projeto com nome exclusivo, volume vazio, chave temporária e porta de loopback. Remove os recursos desse projeto na saída e conserva as medições no diretório de relatório anunciado. O script encontra o cgroup v2 de cada serviço a partir do PID informado pelo daemon local. Execute no próprio host do daemon.

```sh
docker load -i encurtador.tar
docker compose -p encurtador-preparo --profile cassandra --profile redis pull cassandra redis
```

Esta linha reproduz os limites ensaiados na VM. Para outro host, substitua os orçamentos pelos valores do preflight. A sonda opcional `NEIGHBOR_HEALTH_URL` verifica o serviço vizinho durante o ciclo e registra latência por amostra.

```sh
STACK_BUDGET_MIB=1315 MIN_MARGIN_MIB=192 \
CASSANDRA_MEMORY_LIMIT=1024m CASSANDRA_HEAP=384M CASSANDRA_YOUNG_HEAP=64M \
API_MEMORY_LIMIT=160m V8_HEAP_MIB=64 NGINX_MEMORY_LIMIT=24m \
REDIS_MEMORY_LIMIT=48m REDIS_MAXMEMORY=16mb \
NEIGHBOR_HEALTH_URL=http://127.0.0.1:18080 bash tests/ops/demo.sh
```

Os limites somam 1.256 MiB. No Cassandra, os 640 MiB além do heap atendem memória nativa, page cache e processos de operação. No Node, a geração antiga do V8 tem teto de 64 MiB dentro do limite de 160 MiB do contêiner. No Redis, `maxmemory` de 16 MiB deixa folga no limite de 48 MiB.

Informe `STACK_BUDGET_MIB` e `MIN_MARGIN_MIB` em MiB, com valores finitos e maiores que zero. O pré-voo identifica um parâmetro inválido antes da partida dos serviços. A mesma validação se aplica ao recalcular `resultado.json` com `deploy/demo/resumir.py`. Se um parâmetro for inválido, o comando sai com erro e preserva o relatório anterior.

Na raiz, estes testes usam uma configuração Compose controlada com limite de 160 MiB para a API e amostras com orçamento de 200 MiB e margem de 192 MiB. O relatório reprova 32 MiB disponíveis no host e aprova o controle com 500 MiB e as demais condições atendidas.

```sh
python3 tests/ops/test_resumir.py -v CoverageTest.test_compose_budget_before_startup CoverageTest.test_budget_and_margin_must_be_positive_and_finite CoverageTest.test_demo_rejects_invalid_limits_before_starting_services
```

Na fase de cabeçalhos, `tests/ops/redirecionamento.mjs` exige três criações em sequência, cada uma confirmada com `201`. Consulte `redirecionamento.txt` no diretório do relatório para conferir os tamanhos dos destinos e dos cabeçalhos recebidos. A primeira criação usa um destino ASCII de 12 KiB. As duas seguintes usam corpos JSON de exatamente 1 MiB, cada qual com um destino de 1.048.566 bytes, um em ASCII e outro com acentos literais.

Para cada vínculo, o roteiro envia um GET por código e um POST em `/api/v1/redirecionar` e verifica `302`, `Cache-Control: no-store` e o `Location` integral. No terceiro caso, os acentos viram escapes UTF-8 e o cabeçalho chega a 3.145.570 bytes. No caso ASCII máximo, um POST adicional de resolução verifica o limite do corpo com o mesmo vínculo.

O ciclo completo de `tests/ops/demo.sh` confirma **cinco criações** no total, incluindo a criação de uso antes do reinício e a segunda criação da jornada depois do reinício.

Em kernels com `memory.peak`, registra separadamente o pico acumulado do cgroup de NGINX antes e depois dessas requisições. Após o reinício, o script remove a chave do primeiro vínculo e comprova sua ausência antes de cada método de resolução. Durante a compactação, confere o histórico de SSTables da tabela de vínculos. O host usa `MemTotal − MemAvailable`. Nas métricas Node, `external` já inclui os `arrayBuffers` e o RSS inclui memória gerenciada pelo V8.

A VPS compartilhada permanece sem medição. O ensaio na VPS exige janela acordada, métricas dos serviços reais e as etapas apropriadas aos volumes existentes. Quando o banco precisar ficar em outro host, omita o perfil `cassandra`, aplique o esquema nesse host, registre o endpoint privado e repita as fases com as novas colocações.

### Conferir o destino com acentos

O verificador envia o destino original na criação e exige nas duas rotas o mesmo `302`, `Cache-Control: no-store` e `Location` completo. Para `https://loja.example/café%2Fpedido?q=mão%2b#índice`, o cabeçalho esperado é `https://loja.example/caf%C3%A9%2Fpedido?q=m%C3%A3o%2b#%C3%ADndice`. Esta conferência requer apenas Python 3 no host da demo. Na raiz do projeto, estes comandos usam a origem da instalação de teste definida em `PUBLIC_ORIGIN`.

```sh
DESTINO='https://loja.example/café%2Fpedido?q=mão%2b#índice'
LINK=$(python3 deploy/demo/verificar.py "$PUBLIC_ORIGIN" "$DESTINO")
python3 deploy/demo/verificar.py "$PUBLIC_ORIGIN" "$DESTINO" "$LINK" GET
python3 deploy/demo/verificar.py "$PUBLIC_ORIGIN" "$DESTINO" "$LINK" POST
```

Quando o próprio host combina caracteres internacionais e escapes percentuais, o verificador mantém os escapes existentes e compara a representação UTF-8 dos caracteres literais. Para um domínio internacional sem escapes, o verificador usa a conversão WHATWG do Node.js se o executável estiver no `PATH`. Em um host só com Python, obtenha o hostname ASCII no console do navegador, por exemplo `new URL('https://faß.example/').hostname`, e informe o resultado no comando da prova. Se faltar a conversão, o verificador encerra antes de enviar a criação. A expectativa só substitui o hostname. Porta, escapes e fragmento continuam sendo conferidos integralmente. Se faltar a conversão do hostname, o verificador encerra antes de criar o vínculo.

```sh
VERIFICAR_HOST_ASCII=xn--fa-hia.example python3 deploy/demo/verificar.py "$PUBLIC_ORIGIN" 'https://faß.example/café#índice'
```

Para repetir com respostas HTTP controladas em loopback e Node.js no `PATH`, execute `python3 tests/ops/test_verificar.py -v`. Os controles aprovam o exemplo com acentos e a grafia original de um destino ASCII. Cada rota rejeita um fragmento trocado, e a mudança de `%2b` para `%2B` também reprova a comparação ASCII. O ensaio do domínio `faß.example` aprova `xn--fa-hia.example` e reprova `fass.example`.

### Revalidar um link longo na origem configurada

O verificador aceita `https://S.Example:443` com ou sem a barra final e espera que o `201` devolva um link como `https://s.example/Abc1234`. Uma porta diferente da padrão faz parte da origem. Para uma origem internacional, use Node.js no `PATH` ou informe em `VERIFICAR_ORIGEM_HOST_ASCII` o hostname canônico obtido no navegador. Essa variável se refere ao domínio público da instalação. Se a resposta trouxer outro host, outra porta ou um caminho como `/sub/../Abc1234`, a conferência encerra antes de consultar o código.

Para conferir um vínculo já criado, passe o link confirmado como terceiro argumento. Para um destino longo, use `-` no lugar do segundo argumento e forneça um arquivo UTF-8 com o destino exato, inclusive o fragmento, sem quebra de linha final. O comando consulta GET e POST e compara o `Location` inteiro. Sem o terceiro argumento, ele também cria o vínculo, enviando JSON compacto em UTF-8. A leitura da entrada padrão é limitada a 1 MiB. A linha de status e todos os cabeçalhos da resposta compartilham um orçamento de 3 MiB + 4 KiB.

```sh
python3 deploy/demo/verificar.py "$PUBLIC_ORIGIN" - "$LINK" < destino.txt
```

Na raiz, execute os controles abaixo com Python 3, Node.js e OpenSSL. Em HTTP de loopback, eles conferem os cabeçalhos de 60.025 e 66.025 bytes e o `Location` de 3.145.570 bytes gerado por um corpo JSON de 1 MiB. Mudar só o último byte do fragmento reprova GET e POST. Em HTTPS, o ensaio verifica o certificado, confere as duas rotas depois do `201` com DNS, IDN e IPv6 e recusa um host fora do certificado. Os servidores devolvem respostas controladas.

```sh
python3 tests/ops/test_verificar.py -v \
  Verificador.test_localizacao_de_60025_e_66025_bytes \
  Verificador.test_stdin_json_de_um_mib_e_cabecalho_de_tres_mib \
  Verificador.test_https_com_origem_canonica_e_porta_padrao
```

## Distribuição da API da décima quarta rodada

A VM ARM64 de 2 GiB repetiu o roteiro com a API da T068. O comando `docker image inspect` no convidado confirmou a API `sha256:ae04a922e924b18591854b2149445edf20e3b376731632fee08f1c28f726f80e` e o NGINX `sha256:925e9e78c58bd68dfec9dad3fe1bb9ecd21efc33c99843e93a0ff42a8b8397c0`. O Compose usou os digests de Redis 7.4.6 e Cassandra 5.0.6. A VM tinha 2.013.712 KiB de RAM e zero swap. O vizinho sintético permaneceu ativo nos dois perfis.

No pré-voo da pilha completa, 69 sondas em 35 segundos mediram no mínimo 1.534.528 KiB disponíveis no host. Reservar a margem de 192 MiB deixou um orçamento de **1.306 MiB**. Os limites rígidos por serviço somaram 1.256 MiB. Com Cassandra externo, o segundo pré-voo teve 70 sondas, mínimo de 1.534.440 KiB disponíveis e orçamento de **232 MiB** para API, NGINX e Redis.

| Fase | Pilha completa, pico em MiB | Cassandra externo, pico local em MiB |
| --- | ---: | ---: |
| Partida | 1.051,46 | 55,20 |
| Repouso | 1.072,07 | 55,19 |
| Criação e leitura | 1.072,48 | 55,64 |
| Destinos longos | 1.089,97 | 69,29 |
| Reinício e cache frio | 1.126,29 | 63,16 |
| Compactação do banco local | 889,43 | — |

Nos 174 ciclos da pilha completa, o pico simultâneo foi **1.126,29 MiB** no reinício. O uso do host atingiu 1.325,23 MiB, com mínimo de **641,29 MiB disponíveis**. Nos 23 ciclos com Cassandra externo, o pico local foi **69,29 MiB** ao transmitir destinos longos. O uso do host da aplicação atingiu 561,32 MiB e o mínimo disponível foi **1.405,20 MiB**. Todas as fases tiveram ao menos uma amostra simultânea dos serviços locais. Os 197 ciclos mantiveram os dois marcadores estáveis e todas as sondas responderam, com máximos de 9,97 e 11,13 ms nos dois perfis. Os ensaios passaram sem OOM.

Entre as leituras privadas por fase, o maior RSS da API foi 108,53 MiB na pilha completa e 102,60 MiB com Cassandra externo. O heap em uso atingiu 31,19 e 30,64 MiB. A memória externa atingiu 9,39 e 6,45 MiB, incluindo até 1,53 MiB em `arrayBuffers`. O maior p99 observado de atraso do event loop foi de 29,59 e 30,08 ms, respectivamente.

A página e seus assets foram servidos pela imagem indicada. Em ambos os perfis, GET e POST devolveram o destino de até 1.048.566 bytes. Após o reinício da aplicação, cada rota recuperou o primeiro vínculo com cache frio e uma leitura confirmada de Cassandra, sem acertos de Redis. O keyspace externo passou de zero para quatro vínculos, com o mesmo identificador do nó e o mesmo horário de partida do contêiner. O encerramento removeu os contêineres, redes, volumes e credenciais dos ensaios e desligou a VM. O aceite da VPS compartilhada segue condicionado à medição em seu próprio host.

## Distribuição final da décima segunda rodada

A VM ARM64 de 2 GiB repetiu os dois perfis com o formulário da T064. Após carregar as imagens, `docker image inspect` no convidado confirmou o NGINX `sha256:925e9e78c58bd68dfec9dad3fe1bb9ecd21efc33c99843e93a0ff42a8b8397c0` e a API `sha256:0e75a38ed88777bdfa23035ed064d77998a699acf063c408ff44ddd8c22ea4b8`. O Compose selecionou Redis 7.4.6 e Cassandra 5.0.6 pelos digests registrados. O kernel informou 2.013.712 KiB de RAM e zero swap.

O vizinho respondeu durante os pré-voos de 35 segundos. No primeiro, 70 amostras registraram pelo menos 1.544.840 KiB disponíveis. Descontar a margem de 192 MiB e arredondar para baixo deu o orçamento de **1.316 MiB** para a pilha completa. No segundo pré-voo, 69 amostras registraram pelo menos 1.526.660 KiB disponíveis. Com Cassandra em outra VM, o orçamento escolhido para os três serviços locais foi **232 MiB**.

| Fase | Pilha completa, pico em MiB | Cassandra externo, pico local em MiB |
| --- | ---: | ---: |
| Partida | 839,93 | 56,66 |
| Repouso | 844,36 | 57,41 |
| Criação e leitura | 838,00 | 57,62 |
| Destinos longos | 855,11 | 70,81 |
| Reinício e cache frio | 878,65 | 64,48 |
| Compactação do banco local | 943,74 | — |

O pico na pilha completa foi **943,74 MiB** na compactação. Os limites dos quatro serviços somaram 1.256 MiB. O host consumiu até 1.389,17 MiB e conservou pelo menos **577,34 MiB** disponíveis. As 174 sondas do vizinho responderam, com máximo de 10,42 ms. Cada ciclo permaneceu dentro da mesma fase.

No perfil com Cassandra externo, os limites dos três serviços locais somaram 232 MiB. O host da aplicação consumiu até 618,54 MiB e manteve pelo menos **1.347,97 MiB** disponíveis. As 23 sondas responderam, com máximo de 9,38 ms. Na linha 5 de `memoria.jsonl`, o marcador passou de partida a repouso durante uma soma observada de 57,41 MiB. Essa linha entrou nas verificações de segurança. Os cálculos de pico e de cobertura por fase usaram os outros 22 ciclos. O maior pico local foi **70,81 MiB** em destinos longos.

Nas leituras privadas por fase, o maior RSS da API foi de 102,43 MiB na pilha completa e 103,12 MiB com Cassandra externo. Os maiores valores de heap em uso foram 31,78 e 31,17 MiB. A memória externa chegou a 7,35 MiB nos dois perfis, incluindo até 1,53 MiB de `arrayBuffers`. O maior p99 amostrado de atraso do event loop foi de 28,10 e 30,11 ms, respectivamente. São indicadores separados da memória já contabilizada nos cgroups.

Os dois ensaios terminaram com saída zero e sem OOM. A entrada serviu a página e seus assets, as duas rotas preservaram destinos de até 1.048.566 bytes e cada rota confirmou uma leitura no Cassandra ao resolver o vínculo com cache frio depois do reinício. A consulta CQL direta ao banco externo confirmou que o keyspace passou de zero para quatro vínculos e que o nó e o contêiner mantiveram seus identificadores e seu horário de partida. O encerramento removeu os contêineres, as redes, os volumes e as credenciais dos ensaios. A qualificação da VPS depende das condições do seu host e dos seus serviços vizinhos.

## Conferir a cobertura das medições por fase

O coletor grava `phase` antes de consultar o host e `phase_end` depois de ler o último cgroup. Se o roteiro substituir o arquivo do marcador nesse intervalo, `phase_changed` registra a troca mesmo que os nomes inicial e final coincidam. No relatório, `phase_transitions` identifica as fases e as linhas correspondentes de `memoria.jsonl`, numeradas a partir de 1. Nessas linhas continuam valendo as verificações de consumo, limites rígidos, margem, sonda do vizinho e OOM. Para obter o pico de cada fase, o relatório usa os ciclos em que o marcador permaneceu estável.

Para reproduzir T061, rode `python3 tests/ops/test_resumir.py -v` na raiz. Com a API em 30 MiB em repouso, a sonda controlada mudou a fase para uso antes da leitura de 120 MiB. O pico de repouso ficou em 30 MiB. O pico de uso chegou a 120 MiB na coleta seguinte. Ao retirar essa última coleta, o relatório indicou falta de cobertura em uso e saiu com código 1. Com orçamento de 110 MiB e margem mínima de 192 MiB, o mesmo teste registrou a violação na transição, incluindo a queda da memória disponível a 100 MiB e um OOM.

Na décima primeira rodada, a VM ARM64 de 2 GiB repetiu os quatro perfis, um por vez, com as imagens da oitava rodada e o vizinho sintético ativo. Cada pré-voo durou 35 segundos. Para a pilha completa, as 70 observações do pré-voo registraram no mínimo 1.593.496 KiB disponíveis. Após reservar 192 MiB de margem, o teto ficou em 1.364 MiB. A tabela traz as novas medições com os dois marcadores por ciclo.

| Colocação | Ciclos estáveis | Orçamento (MiB) | Pico da pilha (MiB) | Mín. disponível no host (MiB) | Maior tempo da sonda (ms) |
| --- | ---: | ---: | ---: | ---: | ---: |
| API, NGINX, Redis e Cassandra no projeto | 176 | 1.364 | 1.136,70 | 644,22 | 10,74 |
| Redis compartilhado, NGINX do projeto | 180 | 1.308 | 939,17 | 579,63 | 28,13 |
| Redis compartilhado, NGINX existente | 177 | 1.269 | 854,68 | 618,95 | 11,13 |
| Cassandra em outra VM, Redis e NGINX do projeto | 23 | 232 | 81,44 | 1.360,19 | 11,87 |

O recálculo dos quatro arquivos `memoria.jsonl` confirmou os picos usando apenas as observações da respectiva fase. Cada ciclo desses arquivos apareceu uma única vez no relatório. Os 556 ciclos tiveram os dois marcadores estáveis, todas as fases tiveram cobertura completa em pelo menos um ciclo e todas as sondas do vizinho responderam. Os quatro ensaios terminaram sem OOM e com saída zero. GET e POST confirmaram o primeiro vínculo depois do reinício e de esfriar o cache. Nos dois perfis com Redis compartilhado, os contêineres vizinhos conservaram suas identidades e horários de partida. Ao término restava somente a chave de controle independente no Redis. No perfil com Cassandra em outra VM, uma consulta direta confirmou que o keyspace passou de zero para quatro vínculos. O banco preservou o identificador do nó e o horário de partida do contêiner durante o ensaio.

Em `resultado.json`, `samples` conta os ciclos da fase e `complete_samples` conta os que leram o `memory.current` de cada serviço local no mesmo ciclo. O coletor espera cerca de meio segundo entre ciclos. `stack_peak_lower_bound_mib` informa o maior somatório observado, inclusive quando faltou algum cgroup. Em cada fase, inclusive partida e reinício, `stack_peak_mib` registra a maior soma completa se ela atingir ou superar esse limite inferior. Quando falta cobertura completa ou uma soma parcial já supera todas as completas, o pico fica `null`, `failures` identifica a fase e o consolidador sai com código 1. Na partida e no reinício, serviços podem entrar ou sair entre ciclos. Quando falta uma leitura simultânea, o diagnóstico também informa quais serviços de `local_services` ficaram ausentes de toda a fase. Ver cada nome em um ciclo diferente permite estabelecer apenas um limite inferior para o pico. O orçamento, a margem do host e OOM também são verificados nas amostras parciais.

Na raiz, rode `python3 tests/ops/test_resumir.py -v` para reproduzir os controles locais e externos. Uma amostra de uso com somente 72 MiB de NGINX excedeu os maiores somatórios completos de 51 MiB no perfil local e 21 MiB no externo. Ambos os relatórios indicaram limite inferior de 72 MiB, pico inconclusivo em uso e saída 1. Com leitura parcial de 8 MiB, ambos conservaram os respectivos picos completos e saíram com código zero. Os controles também cobrem fases sem nenhuma amostra completa e as transições de partida e reinício. As verificações dos limites inferiores continuam valendo para os ciclos de fase confirmada.

O consolidador verifica o `memory.max` de cada contêiner observado em cada ciclo e compara a soma dos limites desse ciclo com o orçamento. Em cada fase, `observed_limit_sum_peak_mib` mostra a maior soma observada no mesmo ciclo. Uma amostra parcial inclui só os cgroups lidos. Se algum cgroup observado tiver limite ausente ou ilimitado, o pico da fase fica `null`. Essa condição e qualquer soma superior ao orçamento geram saída 1 e uma mensagem em `failures` com a fase e a violação. O campo `cgroup_limits_mib` mostra o último limite observado por serviço.

O mesmo comando reproduz T058 com Cassandra externo simulado, três serviços locais e orçamento de 250 MiB. Com 60 MiB por serviço, o relatório indicou pico de limites de 180 MiB e saiu com código zero. Em repouso, uma leitura sem o campo de limite ou com `memory.max=max` na API produziu pico inconclusivo na fase. Em outro controle, o limite de 220 MiB da API elevou a soma da amostra a 340 MiB. Os controles saíram com código 1 mesmo após a volta a 60 MiB. Ao elevar os limites da API e do NGINX para 130 MiB em ciclos distintos, a maior soma foi exatamente 250 MiB e a saída foi zero.

Para recalcular um ensaio preservado, execute `python3 deploy/demo/resumir.py DIRETORIO ORCAMENTO_MiB MARGEM_MiB` na raiz. O comando lê `memoria.jsonl` e `colocacao.json` e atualiza `resultado.json`. O campo `legacy_phase_samples` conta as leituras antigas que guardavam somente a fase inicial. Elas aparecem em `phase_transitions` com `fim desconhecido` e continuam participando das verificações do ciclo. Se forem as únicas leituras de uma fase, a reanálise indica falta de cobertura e sai com código 1. Para comprovar o pico dessa fase, repita o ensaio com o coletor atual.

Na consolidação anterior a T061, a maior soma de limites em cada fase foi **1.256 MiB** nas seis fases com Cassandra local (174 ciclos, orçamento de 1.284 MiB) e **232 MiB** nas cinco fases com Cassandra externo (23 ciclos, orçamento de 232 MiB). Com margem mínima de 192 MiB, os dois relatórios históricos saíram com código zero.

### Cobertura da partida e do reinício (T066)

Execute `python3 tests/ops/test_resumir.py -v CoverageTest.test_local_service_coverage_at_startup_and_restart` na raiz. Com apenas 2 MiB do NGINX na partida ou no reinício, o relatório preservou esse limite inferior, registrou pico `null`, identificou API, Cassandra e Redis como ausentes e saiu com código 1. No controle, as leituras parciais antes e depois da amostra simultânea de 2 + 15 + 4 + 930 MiB preservaram o pico de **951 MiB**, com saída zero. Se os quatro serviços só aparecerem individualmente, os 930 MiB do Cassandra ficam como limite inferior. Uma leitura parcial de 960 MiB também deixa o pico inconclusivo quando a maior soma completa é 951 MiB.

Na décima terceira rodada, o consolidador reprocessou cópias das seis séries de `colocacao.json` e `memoria.jsonl` com seus orçamentos originais e margem de 192 MiB. Os seis relatórios saíram com código zero. Em cada célula, o valor entre parênteses é o número de coletas estáveis que mediram todos os serviços próprios simultaneamente naquela fase.

| Série de laboratório | Pico na partida, MiB (coletas completas) | Pico no reinício, MiB (coletas completas) |
| --- | ---: | ---: |
| 11ª rodada, pilha completa | 1.058,82 (2) | 1.136,70 (6) |
| 11ª rodada, Redis compartilhado e NGINX próprio | 826,61 (3) | 929,16 (6) |
| 11ª rodada, Redis compartilhado e NGINX existente | 817,73 (2) | 849,46 (7) |
| 11ª rodada, Cassandra externo | 69,19 (3) | 61,72 (3) |
| 12ª rodada, distribuição final, pilha completa | 839,93 (2) | 878,65 (5) |
| 12ª rodada, distribuição final, Cassandra externo | 56,66 (2) | 64,48 (3) |

## Reproduzir com o Cassandra em outro host

Escolha um Cassandra 5 de laboratório com `storage_compatibility_mode: NONE`, um datacenter conhecido e conectividade a partir dos contêineres da VM. O procedimento abaixo prepara um keyspace novo e uma conta de teste que pode ler e modificar seus dados. Use um domínio de teste sem links anteriores. Execute estes comandos na estação administrativa com `cqlsh` e acesso autorizado a esse banco. O exemplo assume o datacenter `datacenter1`.

```sh
umask 077
segredos=$(mktemp -d)
export CASSANDRA_KEYSPACE=encdemo_$(python3 -c 'import uuid; print(uuid.uuid4().hex)')
# Defina CQLSH_ADMIN_CREDENTIALS, DB_HOST e DB_PORT na estação administrativa.
cql() { cqlsh --credentials "$CQLSH_ADMIN_CREDENTIALS" "$DB_HOST" "$DB_PORT" "$@"; }
cql -e "CREATE KEYSPACE $CASSANDRA_KEYSPACE WITH replication={'class':'NetworkTopologyStrategy','datacenter1':1} AND durable_writes=true" &&
cql -k "$CASSANDRA_KEYSPACE" -f deploy/cassandra/schema.cql || exit 1
python3 - "$CASSANDRA_KEYSPACE" "$segredos" <<'PY'
from pathlib import Path
import secrets, sys
name, directory = sys.argv[1], Path(sys.argv[2])
pwd = secrets.token_hex(32)
(directory / "role.cql").write_text(
    f"CREATE ROLE {name} WITH PASSWORD='{pwd}' AND LOGIN=true AND SUPERUSER=false;\n"
    f"GRANT SELECT ON KEYSPACE {name} TO {name};\n"
    f"GRANT MODIFY ON KEYSPACE {name} TO {name};\n")
(directory / "cred.env").write_text(f"CASSANDRA_USERNAME={name}\nCASSANDRA_PASSWORD={pwd}\n")
PY
cql -f "$segredos/role.cql"
cql -e 'SELECT host_id,data_center,release_version FROM system.local'
```

Transfira `cred.env` por canal privado e informe à VM o nome de keyspace gerado. Na VM dedicada, use o mesmo código e imagens da instalação local. Ajuste a origem do banco para o endereço acessível pelos contêineres da API. `DEMO_DATABASE_HOST` identifica o host físico ou virtual do banco no relatório, mesmo quando o endpoint passa por um gateway. As variáveis abaixo exemplificam um orçamento de 232 MiB, correspondente à soma dos limites de API, Redis e NGINX. O pré-voo da máquina determina quanto pode ser destinado a esses serviços.

```sh
export DEMO_CASSANDRA=externo DEMO_DATABASE_HOST=laboratorio-dados
export CASSANDRA_CONTACT_POINTS="$ENDPOINT_PRIVADO" CASSANDRA_PORT="$PORTA_CQL"
export CASSANDRA_DATACENTER=datacenter1 CASSANDRA_KEYSPACE="$KEYSPACE_DO_ENSAIO"
export CASSANDRA_AUTH_ENV_FILE="$CAMINHO_CRED_ENV"
STACK_BUDGET_MIB=232 MIN_MARGIN_MIB=192 \
  NEIGHBOR_HEALTH_URL=http://127.0.0.1:18080 bash tests/ops/demo.sh
```

O script usa um projeto Compose novo com API, NGINX e Redis. Após o reinício dos três serviços, confere o primeiro vínculo com cache frio antes de cada rota, cria um novo vínculo e volta a conferir o anterior. `resultado.json` identifica a colocação e consolida os três cgroups da VM. `imagens.txt` enumera os serviços que rodaram. O ciclo de compactação pelo `nodetool` pertence ao perfil com Cassandra local. No perfil externo, o banco permanece em operação durante o ciclo. A conta administrativa do host de dados conserva o controle sobre a limpeza do keyspace e da conta descartáveis. Para repetir a prova, prepare outro keyspace vazio e credenciais próprias.

## Escolher Redis compartilhado e entrada NGINX existente · T060

As escolhas de Redis, NGINX e Cassandra são independentes. Sem variáveis de colocação, o ensaio sobe os quatro serviços no mesmo projeto. Para usar Redis externo, informe `DEMO_REDIS_MODE=externo` e uma `REDIS_URL` acessível a partir dos contêineres. Para usar uma entrada existente, informe `DEMO_NGINX_MODE=existente`, a `PUBLIC_ORIGIN` reservada para o laboratório e a porta livre `DEMO_API_PORT`. A API publica seu upstream exclusivamente em `127.0.0.1:DEMO_API_PORT` no host do Docker. O modo `DEMO_CASSANDRA` continua aceitando `local` ou `externo` conforme o procedimento acima.

Este exemplo sobe API, Cassandra e NGINX novos usando o Redis compartilhado do laboratório. Escolha o orçamento e a margem com o pré-voo do host.

```sh
export DEMO_CASSANDRA=local DEMO_REDIS_MODE=externo DEMO_NGINX_MODE=local
export REDIS_URL="$ENDPOINT_REDIS_DO_LABORATORIO"
export STACK_BUDGET_MIB="$ORCAMENTO_MEDIDO" MIN_MARGIN_MIB="$MARGEM_MEDIDA"
bash tests/ops/demo.sh
```

Para reutilizar também o NGINX, prepare um servidor virtual na entrada do laboratório com os estáticos da distribuição, as regras de rotas e o upstream privado apontado para a porta escolhida. Um NGINX que roda no host, ou que compartilha sua rede, pode acessar `127.0.0.1:18083`. Se o proxy estiver em outro namespace, providencie o encaminhamento privado até esse loopback. A origem precisa estar acessível tanto pelo host Linux quanto pelo cliente de teste, que usa a rede desse host. Para HTTPS com uma CA de laboratório, aponte `SSL_CERT_FILE` para um arquivo PEM absoluto de confiança legível pelos dois clientes. A entrada existente permanece ativa durante o reinício da API.

Por exemplo, em um NGINX no host com a porta 18081 livre, disponibilize o conteúdo de `web/dist/` em `/srv/encurtador/` e copie `deploy/nginx/rotas.conf` para `/etc/nginx/encurtador-rotas.conf`. Inclua a configuração abaixo no contexto `http` e valide com `nginx -t` antes de recarregar o NGINX do laboratório.

```nginx
upstream encurtador {
    server 127.0.0.1:18083;
}
server {
    listen 127.0.0.1:18081;
    include /etc/nginx/encurtador-rotas.conf;
}
```

```sh
export DEMO_NGINX_MODE=existente PUBLIC_ORIGIN=http://127.0.0.1:18081 DEMO_API_PORT=18083
bash tests/ops/demo.sh
```

`colocacao.json` identifica a origem HTTP, os três modos, o prefixo exclusivo da instalação e os nomes em `local_services` antes da primeira medição. Com Cassandra local e Redis compartilhado, a lista contém API, Cassandra e o NGINX quando novo. Se o NGINX já existe, a lista contém apenas API e Cassandra. Com os dois serviços de dados externos e uma entrada existente, somente a API pertence ao projeto. Os limites rígidos e os totais por fase usam essa lista. A medição do host continua abrangendo seus vizinhos, inclusive qualquer serviço compartilhado que rode nele. `nginx-pico-*.bytes` pertence ao NGINX criado pelo ensaio.

O prefixo `encdemo-<UUID>` é gerado a cada execução e usado como `INSTALLATION_ID`. Em Redis compartilhado, o teste cria também uma chave `controle-encdemo-<UUID>:vizinho` com valor conhecido e expiração. Use uma conta de laboratório que possa operar as chaves do ensaio e da sentinela e percorrer o banco com `SCAN`. Antes de cada GET e POST do primeiro vínculo no reinício, o cliente apaga a chave exata e exige `EXISTS=0`. As métricas privadas da mesma réplica devem registrar exatamente uma leitura CQL bem-sucedida e zero acertos no Redis por método. Na saída, a API é parada, o teste remove as chaves com seu prefixo, confere o valor da sentinela e apaga a própria sentinela. `cache.txt` registra a ausência antes de cada método e a preservação do controle. Uma segunda chave de controle criada pelo operador em outro prefixo pode ser consultada antes e depois do ciclo.

Para conferir de onde veio o destino após o reinício, compare `metricas-frio-antes.json`, `metricas-frio-GET.json` e `metricas-frio-POST.json`. O ensaio exige o mesmo `processId` nas três coletas. Entre cada par, o contador de leituras no Cassandra deve subir uma unidade e os contadores de erros de leitura e de acertos no Redis devem manter seus valores. Essa comparação exige tráfego exclusivo na réplica do ensaio. Cada rota também precisa devolver `302`, o `Location` integral e `Cache-Control: no-store`.

Na raiz do repositório, `python3 tests/ops/test_resumir.py -v` reproduz as oito combinações de colocação com amostras controladas. Com Redis externo, API de 15 MiB e Cassandra de 30 MiB, o pico de uso foi de **47 MiB** ao incluir o NGINX de 2 MiB e de **45 MiB** ao reutilizar a entrada. Ambos retornaram código zero. Ao retirar o cgroup da API durante toda a fase de uso, o pico ficou `null` e o comando de consolidação retornou código 1.

### Resultado com Redis compartilhado

Na décima rodada, em 23/11/2026, a VM Linux `encurtador-lab` de 2 GiB executou o ciclo com Cassandra local, Redis compartilhado e um vizinho sintético. A tabela registra a série histórica, coletada com um único marcador de fase. Cada linha corresponde a um preflight e uma execução de `bash tests/ops/demo.sh`. Os valores estão em MiB.

| Entrada | Serviços medidos na pilha nova | Orçamento | Pico simultâneo da pilha | Pico do host | Mínimo disponível no host |
| --- | --- | ---: | ---: | ---: | ---: |
| NGINX do projeto | API, Cassandra, NGINX | 1.273 | 884,48 | 1.340,22 | 626,29 |
| NGINX existente | API, Cassandra | 1.307 | 915,04 | 1.381,68 | 584,84 |

Nas duas execuções, o link criado pela entrada escolhida sobreviveu ao reinício. GET e POST devolveram o destino com escapes, consulta e fragmento, com uma leitura confirmada no Cassandra e zero acertos no Redis por método. O segundo vínculo recebeu outro código. A chave independente `vizinho:controle` conservou o valor e o TTL permanente no banco lógico 9. O Redis e a entrada preexistente mantiveram os mesmos identificadores e horários de partida durante o ciclo. Cada série teve 175 sondas bem-sucedidas do vizinho, zero OOM e margem disponível superior aos 192 MiB definidos. O consolidador usado na décima rodada reproduziu os dois resultados. Ao reprocessar hoje cada arquivo histórico, `legacy_phase_samples` identifica as 175 leituras de marcador único, e o comando sai com código 1 por falta de cobertura confirmada das fases.

## Resultado da VM de 2 GiB em 23/11/2026

A série histórica desta seção foi coletada com um marcador de fase por ciclo. A API, o NGINX, o Redis e o Cassandra rodaram na VM do [pré-voo](preflight.md), junto do vizinho sintético. A máquina de build entregou imagens Linux ARM64 por `docker save/load`. Na oitava rodada, `docker image inspect` no convidado confirmou o ID da imagem da API `sha256:0e75a38ed88777bdfa23035ed064d77998a699acf063c408ff44ddd8c22ea4b8` e o NGINX `sha256:922bf403b3590be281cce08a961c632d7bf9f70af39caf0e10779e276bae5a90`. Redis 7.4.6 e Cassandra 5.0.6 usaram os digests do Compose.

| Fase | Amostras completas / totais | Pico da pilha (MiB) | Pico de uso do host (MiB) | Mín. disponível no host (MiB) | Maior tempo da sonda vizinha (ms) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Partida a frio | 2 / 118 | 1.058,14 | 1.301,18 | 665,33 | 11,63 |
| Repouso | 10 / 10 | 1.073,75 | 1.311,58 | 654,94 | 1,88 |
| Criação e leitura | 2 / 2 | 1.070,46 | 1.301,76 | 664,76 | 1,72 |
| Destinos longos | 2 / 2 | 1.077,48 | 1.304,84 | 661,68 | 1,99 |
| Reinício e cache frio | 5 / 37 | 1.108,22 | 1.396,84 | 569,68 | 2,09 |
| Compactação | 5 / 5 | 898,40 | 1.342,97 | 623,54 | 1,59 |

Os cgroups confirmaram `memory.max` de 1.024 MiB no Cassandra, 160 MiB na API, 48 MiB no Redis e 24 MiB no NGINX. A maior soma simultânea amostrada foi **1.108,22 MiB** para o orçamento de **1.284 MiB**. Em cada fase, o limite inferior observado coincidiu com o pico da tabela. O menor `MemAvailable` foi **569,68 MiB**, com margem estipulada de 192 MiB. As 174 sondas do vizinho tiveram sucesso. Houve zero OOM nos cgroups amostrados e zero variação de `oom_kill` no host. A VM permaneceu sem swap. O kernel da VM não expôs `/proc/pressure/memory`.

A fase de destinos longos criou, um por vez, um vínculo de 12.288 bytes e outro de 1.048.566 bytes (JSON de criação com exatamente 1.048.576 bytes). Os dois POSTs de criação retornaram `201`. Nas quatro resoluções, GET e POST retornaram `302`, `Cache-Control: no-store` e o destino byte a byte. Os POSTs de criação e resolução aceitaram JSON de 1 MiB. Um byte adicional produziu `400`, `Cache-Control: no-store` e ausência de `Location` em ambos. O `memory.peak` acumulado do cgroup de NGINX passou de **6,09 MiB** antes desses casos para **10,60 MiB** depois deles. A raiz retornou HTML com `200`. O caminho literal `//` retornou `404`, sem `Location`, com `Cache-Control: no-store`.

Após reiniciar os quatro serviços com os volumes preservados e esvaziar o Redis, o primeiro link continuou entregando o destino original nas duas rotas. A criação seguinte produziu outro código. O script conferiu os dois vínculos, confirmou a compactação de `encurtador.links` no histórico do Cassandra e terminou com código zero. Os contêineres e volumes do ensaio foram removidos.

| Fase | RSS (MiB) | Heap V8 total/usado (MiB) | Externa (MiB) | ArrayBuffers (MiB) | Atraso p99 do event loop (ms) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Partida a frio | 94,86 | 34,30 / 30,88 | 5,28 | 1,46 | 29,52 |
| Repouso | 94,86 | 34,30 / 30,95 | 5,28 | 1,46 | 29,33 |
| Criação e leitura | 95,11 | 34,05 / 31,18 | 5,34 | 1,53 | 29,52 |
| Destinos longos | 105,27 | 23,31 / 19,32 | 6,35 | 1,53 | 29,52 |
| Reinício e cache frio | 98,76 | 37,30 / 32,73 | 5,34 | 1,53 | 28,08 |
| Compactação | 98,76 | 37,55 / 32,50 | 5,34 | 1,53 | 28,08 |

As métricas de processo foram lidas no fim de cada fase. O p99 agrega o período desde o início da réplica. O reinício abre um novo período de coleta. O aceite SC-005 continua aberto na VPS compartilhada.

## Resultado com Cassandra em outro host

Na oitava rodada, a série histórica do perfil externo registrou um marcador de fase por ciclo. O ensaio usou a mesma VM da aplicação após a remoção dos contêineres e volumes da execução local. O convidado confirmou os mesmos IDs ARM64 do perfil local. A API usou `sha256:0e75a38ed88777bdfa23035ed064d77998a699acf063c408ff44ddd8c22ea4b8` e o NGINX usou `sha256:922bf403b3590be281cce08a961c632d7bf9f70af39caf0e10779e276bae5a90`. O host da aplicação, `encurtador-lab`, executou apenas API, NGINX e Redis. O Cassandra 5.0.6 usou uma segunda VM com kernel `6.10.14-linuxkit` no Docker Desktop, 4 vCPUs e 3,58 GiB de RAM. Ambas as VMs estavam no mesmo computador físico. A [medição antes da partida](preflight.md) registrou o mínimo disponível na VM da aplicação durante os ciclos de carga do vizinho. O gateway privado do laboratório encaminhou o CQL para o contêiner dedicado do banco.

Na VM da API, uma consulta CQL autenticada nas credenciais do keyspace `prova_externa_8e6e392494` confirmou `datacenter1`, versão 5.0.6 e `host_id=98e9c511-1e7e-4ec3-a01e-959ed072fc63`, o mesmo ID consultado diretamente no host do banco. O papel de teste tinha SELECT e MODIFY no keyspace. Antes do ensaio, a tabela de vínculos estava vazia. A API criou os vínculos, resolveu os dois destinos longos pelas duas rotas e voltou a resolver o primeiro vínculo com cache frio após reiniciar somente os serviços locais. Uma consulta posterior no banco encontrou quatro linhas. O contêiner do Cassandra permaneceu com o mesmo ID e instante de partida.

| Fase | Amostras completas / totais | Pico dos três serviços locais (MiB) | Mín. disponível no host da API (MiB) | Maior tempo da sonda vizinha (ms) |
| --- | ---: | ---: | ---: | ---: |
| Partida | 3 / 5 | 62,30 | 1.413,92 | 10,14 |
| Repouso | 9 / 9 | 62,30 | 1.383,92 | 2,01 |
| Criação e leitura | 2 / 2 | 62,52 | 1.372,00 | 2,35 |
| Destinos longos | 3 / 3 | 78,68 | 1.335,00 | 2,71 |
| Reinício e cache frio | 3 / 4 | 56,52 | 1.389,59 | 1,83 |

O orçamento local escolhido para esta colocação foi **232 MiB**, com limites efetivos de 160 MiB para API, 24 MiB para NGINX e 48 MiB para Redis. O pico simultâneo amostrado chegou a **78,68 MiB** e o mínimo disponível foi **1.335,00 MiB**. Em cada fase, o limite inferior coincidiu com o pico dos três serviços da tabela. As 23 sondas do vizinho tiveram sucesso. O host da aplicação e seus cgroups registraram zero OOM. O consumo do Cassandra pertence ao host dos dados. A qualificação da VPS com seus vizinhos reais continua pendente.

## Reverter a publicação e retomar a mesma demo

**Antes da publicação.** No NGINX compartilhado, identifique o arquivo que define a rota atual do domínio e todos os arquivos que a mudança vai substituir. Guarde a configuração efetiva, uma cópia íntegra desses arquivos e uma resposta característica da rota. Registre a saúde do vizinho por um endereço independente. Use o diretório administrativo protegido para esses registros. O exemplo altera um arquivo de servidor virtual regular e mantém os arquivos das duas versões disponíveis. Se a instalação usa symlinks, `realpath` aponta para o arquivo efetivamente carregado. Em NGINX containerizado, monte o diretório pai do arquivo para que a troca por `rename` fique visível.

```bash
set -euo pipefail
umask 077
REGISTRO=$(mktemp -d "${REGISTROS_DA_JANELA:?informe um diretório protegido}/rota.XXXXXXXX")
VHOST=$(realpath "${ARQUIVO_DA_ROTA:?informe o servidor virtual ativo}")
# No caso de NGINX nativo, use ng() { nginx "$@"; }.
ng() { docker exec "${NGINX_EXISTENTE:?}" nginx "$@"; }
# Ajuste -p, --env-file, -f e os perfis para o projeto que foi instalado.
demo() { docker compose -p "${PROJETO_DEMO:?}" --profile cassandra --profile redis "$@"; }
resposta() {
  curl -sS --max-time 15 -D "$REGISTRO/$1.headers" -o "$REGISTRO/$1.body" \
    -w '%{http_code} %{content_type}\n' "$URL_ROTA_ANTERIOR" > "$REGISTRO/$1.status"
}
ng -T > "$REGISTRO/nginx-anterior.txt" 2>&1
cp -p -- "$VHOST" "$REGISTRO/anterior.conf"
ng -t
resposta anterior
curl -fsS -o "$REGISTRO/vizinho.body" "$URL_SAUDE_VIZINHO"
```

Prepare o arquivo `$REGISTRO/demo.conf` conforme a seção de entrada existente. No mesmo contexto de administração, esta função substitui somente a rota alterada. O arquivo temporário fica fora do padrão `*.conf` lido pelo NGINX. A validação antecede a recarga. Em caso de erro, a função recoloca em disco a última versão e interrompe a troca. Confira a resposta pública e os logs do NGINX após cada recarga.

```bash
aplicar_rota() {
  local candidato=$1 atual pronto
  atual=$(mktemp "$(dirname "$VHOST")/.rota-anterior.XXXXXXXX")
  pronto=$(mktemp "$(dirname "$VHOST")/.rota-nova.XXXXXXXX")
  cp -p -- "$VHOST" "$atual" || return 1
  cp -p -- "$candidato" "$pronto" && mv -f -- "$pronto" "$VHOST" || return 1
  if ng -t && ng -s reload; then
    rm -f -- "$atual"
  else
    mv -f -- "$atual" "$VHOST"
    return 1
  fi
}
aplicar_rota "$REGISTRO/demo.conf"
sha256sum "$VHOST" > "$REGISTRO/rota-publicada.sha256"
DESTINO_PROVA='https://loja.example/pedido%2F65?cor=azul%20claro&x=%2b#volta'
LINK_PROVA=$(python3 deploy/demo/verificar.py "$PUBLIC_ORIGIN" "$DESTINO_PROVA")
printf '%s\n' "$LINK_PROVA" > "$REGISTRO/link-prova.txt"
```

Registre o projeto Compose, os serviços próprios em `colocacao.json`, os limites, os nomes dos volumes e o checksum da marca externa. Mantenha o mesmo domínio, chave FF1, tweak, identificador de instalação, projeto e arquivos de configuração. Os exemplos de parada abaixo correspondem a um projeto com API, Cassandra e Redis próprios e uma entrada preexistente. Use os mesmos argumentos Compose da publicação. Omita da lista qualquer serviço compartilhado ou em outro host.

Na mesma sessão Bash, informe em `PROJETO_DEMO` o nome do projeto da demo. Mantenha os arquivos Compose e de ambiente usados ao subi-lo. Com a API em funcionamento, registre os volumes efetivamente montados e o prefixo usado no Redis.

```bash
volumes_da_demo() {
  local servico
  for servico in cassandra redis; do
    docker inspect --format '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}} {{.Destination}}{{println}}{{end}}{{end}}' \
      "$(demo ps -aq "$servico")" || return 1
  done
}
volumes_da_demo > "$REGISTRO/volumes.antes"
sha256sum "${EMISSION_MARKER_DIR:?}/emission.json" > "$REGISTRO/marca.sha256"
INSTALLATION_ID=$(demo exec -T api node --input-type=module -e \
  "import {loadConfig} from './dist/config/config.js'; console.log(loadConfig().installation)")
```

**Quando a margem cair.** Compare o `MemAvailable` do host Linux em KiB com `MIN_MARGIN_MIB × 1024`. O relatório de qualificação também identifica a fase em `failures` quando a margem cai. Restabeleça a rota anterior e aguarde a troca de workers do NGINX. Pare primeiro a API para que ela conclua as requisições em curso e, em seguida, os serviços de dados próprios. Com a demo parada, confira a resposta anterior e a saúde do vizinho. Preserve os contêineres parados, seus volumes e a marca externa para a retomada.

```bash
awk -v piso="${MIN_MARGIN_MIB:?}" '/^MemAvailable:/ {
  printf "disponível %.2f MiB, margem %.2f MiB\n", $2 / 1024, piso
}' /proc/meminfo
sha256sum -c "$REGISTRO/rota-publicada.sha256"
aplicar_rota "$REGISTRO/anterior.conf"
# Os novos workers assumem a entrada depois que o sinal de recarga é recebido.
for tentativa in $(seq 1 30); do
  if resposta recuperada && cmp -s "$REGISTRO/anterior.status" "$REGISTRO/recuperada.status" &&
    cmp -s "$REGISTRO/anterior.body" "$REGISTRO/recuperada.body"; then break; fi
  sleep 1
done
demo stop api
demo stop cassandra redis
demo ps -a
resposta recuperada
cmp "$REGISTRO/anterior.status" "$REGISTRO/recuperada.status"
cmp "$REGISTRO/anterior.body" "$REGISTRO/recuperada.body"
volumes_da_demo | cmp - "$REGISTRO/volumes.antes"
sha256sum -c "$REGISTRO/marca.sha256"
curl -fsS "$URL_SAUDE_VIZINHO" | cmp - "$REGISTRO/vizinho.body"
```

A comparação byte a byte serve para uma resposta estável. Para um portal dinâmico, registre antes e confira depois o status, cabeçalhos e conteúdo que o identificam. Se o checksum indicar que outra publicação alterou a rota, reconcilie a mudança antes de substituir o arquivo. Se o vizinho ou a resposta anterior não voltarem, mantenha os dados da demo e confira a configuração em disco, o resultado da recarga e a disponibilidade do upstream anterior.

**Retomada.** Refaça o pré-voo com os vizinhos em uso e ajuste a colocação ou o orçamento até que caibam na margem aprovada. Confirme os mesmos volumes e o checksum/identidade da marca, sem restaurar snapshots. Inicie os serviços de dados próprios, aguarde CQL e Redis, inicie a mesma API e confira sua prontidão privada. Publique a rota da demo com `aplicar_rota "$REGISTRO/demo.conf"`. Use o link salvo antes da reversão para testar a persistência. O exemplo abaixo usa o Redis próprio da demo e o mesmo prefixo de instalação. Para um Redis compartilhado, use sua conexão autorizada e remova apenas a chave desse vínculo.

```bash
volumes_da_demo | cmp - "$REGISTRO/volumes.antes"
sha256sum -c "$REGISTRO/marca.sha256"
aguardar() {
  for tentativa in $(seq 1 60); do
    if "$@"; then return 0; fi
    sleep 2
  done
  return 1
}
demo start cassandra redis
aguardar demo exec -T cassandra cqlsh -e 'SELECT release_version FROM system.local'
aguardar demo exec -T redis redis-cli PING | grep -qx PONG
demo start api
aguardar demo exec -T api node -e 'fetch("http://127.0.0.1:3000/internal/ready").then(r => process.exit(r.ok ? 0 : 1))'
aplicar_rota "$REGISTRO/demo.conf"
LINK_PROVA=$(cat "$REGISTRO/link-prova.txt")
for metodo in GET POST; do
  chave="$INSTALLATION_ID:${LINK_PROVA##*/}"
  demo exec -T redis redis-cli DEL "$chave" >/dev/null
  test "$(demo exec -T redis redis-cli EXISTS "$chave")" = 0
  python3 deploy/demo/verificar.py "$PUBLIC_ORIGIN" "$DESTINO_PROVA" "$LINK_PROVA" "$metodo"
done
```

**Ensaio local T065 de 23/11/2026.** No Docker Desktop, um projeto já servia a resposta `200 portal-anterior-v1` pelo NGINX e o vizinho respondia `200 vizinho-saudavel-v1`. Um segundo projeto publicou a API, um Cassandra 5.0.6 e um Redis 7.4.6, reaproveitando a entrada. A criação pela entrada devolveu `201` para o vínculo `e7LonFs`. Como contraprova, parar somente a API deixou a raiz servindo o HTML da demo e fez o link devolver `503`. A configuração do proxy ainda apontava para a demo.

Para testar o alarme sem exaurir memória, o laboratório usou duas cópias de uma coleta com NGINX existente. A cópia intacta passou. Em uma amostra estável da fase de uso da segunda cópia, o disponível foi ajustado para **191 MiB**, com margem configurada de **192 MiB** e RAM total mantida. O consolidador retornou 1 com a única falha `margem do host abaixo do mínimo em uso`. A troca real de rota foi exercitada em resposta a essa indicação simulada.

Com a configuração anterior validada e recarregada, a entrada voltou a entregar `200`, `Content-Type: text/plain`, `Cache-Control: no-store` e o corpo anterior. O vizinho continuou saudável, e os contêineres dele e da entrada conservaram seus identificadores e instantes de partida. A API, o Redis e o Cassandra da demo foram parados. Ao retomá-los, os nomes e pontos de montagem dos volumes, a marca de emissão, o vínculo com seu vencimento e a linha de reserva coincidiram com o registro anterior. GET e POST com cache frio retornaram `302`, `Cache-Control: no-store` e o valor literal `Location: https://loja.example/pedido%2F65?cor=azul%20claro&x=%2b#volta`. A margem real da VPS permanece sujeita ao pré-voo no host compartilhado.
