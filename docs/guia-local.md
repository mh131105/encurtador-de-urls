# Guia local do encurtador de URLs

Execute os comandos deste guia na raiz do repositório. A primeira instalação e o exemplo de criação estão no [README](../README.md).

## Testar em uma instalação descartável

A suíte cria um projeto Compose isolado, constrói as imagens, testa a API, o Cassandra, o Redis e o formulário pelo NGINX e encerra os volumes de teste. O procedimento e a opção para Google Chrome estão no [README](../README.md#verificar). O primeiro build baixa as dependências e as imagens oficiais.

## O que foi verificado localmente

| Ensaio | Resultado |
| --- | --- |
| HTTP, Cassandra e Redis | Criação confirmada, leitura pelas duas rotas, vencimento civil com cache frio e quente, reservas concorrentes e recuperação após respostas perdidas. A restauração física foi conferida em outro keyspace. [Recuperação](../deploy/ha/recuperacao.md) |
| Distribuição e navegador | A CI local de 23/11/2026 aprovou os 77 testes Node com Cassandra e Redis disponíveis, sem omissões, e os dez testes Python do verificador de redirecionamento. Com a API real atrás do NGINX, o verificador leu um destino pela entrada padrão e conferiu o mesmo cabeçalho de 3.145.570 bytes por GET e POST. Nas entradas NGINX da demo e de HA, o código ativo `0000000` devolveu `302` e o código de ausência confirmada devolveu `404` por GET e POST. As duas entradas preservaram o limite dos POSTs. No Chrome, o formulário publicado manteve a URL após o `400` e aceitou a correção. Em uma cópia com o redirecionamento alterado de 302 para 301, a suíte retornou código 1 e interrompeu a sequência. [CI local](../tests/ops/ci.sh) |
| Memória da demo | Em Linux com cgroups v2, os 14 testes Python do pré-voo, do coletor e do relatório passaram. Com a imagem da 20ª rodada em uma VM de 2 GiB e vizinho sintético, a pilha completa atingiu 1.105,68 MiB no reinício, dentro do orçamento de 1.345 MiB. O mínimo disponível no host foi de 548,64 MiB. Com Cassandra em outro host do laboratório, o pico local foi de 92,82 MiB para um orçamento de 232 MiB. Houve zero OOM nos dois ensaios. T004 e T021 aguardam medição com os vizinhos da VPS. [Qualificação da demo](../deploy/demo/qualificacao.md) |
| HA e carga | A configuração do NGINX foi exercitada com duas réplicas locais. A amostra de carga confirmou 10 criações e 100 resoluções com zero destinos trocados. O failover entre hosts (T025) e a carga de 24 horas (T027) aguardam infraestrutura e autorização. [Topologia](../deploy/ha/topologia.md) · [Amostra e roteiro de carga](../tests/load/relatorio.md) |

Na CI local de 23/11/2026, o POST de resolução respondeu nas três entradas com `302` aos 65 s, `Cache-Control: no-store` e o destino integral. Ao esgotar o prazo de 90 s, as três devolveram `503` sem `Location`. Para reproduzir com Cassandra e NGINX, execute `mise exec -- bash tests/ops/ci.sh` conforme as [instruções da suíte integrada](../README.md#verificar).

## Subir a página e conservar os links

O [procedimento de primeira instalação](../README.md#executar-localmente) constrói as duas imagens, cria a chave e a marca de emissão e inicia a pilha em loopback. O [exemplo da API](../README.md#demonstração-da-api) verifica uma criação e as duas rotas de resolução. Em uma instalação existente, siga as instruções para conservar a mesma identidade de emissão. [Emissão, backup e restauração](../deploy/ha/recuperacao.md)

Para levar a distribuição a outra máquina da mesma arquitetura, construa as imagens no host de build. Use o registro do operador ou transfira-as em um arquivo. Também são necessários o arquivo `compose.yaml` e o diretório `deploy/`. `API_IMAGE` e `NGINX_IMAGE` aceitam referências imutáveis. Mantenha o mesmo nome de projeto Compose, domínio, chave e diretório da marca de emissão ao reiniciar uma instalação. A marca deve permanecer em armazenamento durável, independente da restauração do Cassandra.

```sh
# Na máquina em que as imagens foram construídas com as etiquetas padrão
docker save -o encurtador-0.1.0.tar encurtador-api:0.1.0 encurtador-nginx:0.1.0
# Na máquina que recebeu o arquivo
docker load -i encurtador-0.1.0.tar
```

As duas consultas devolvem `302`, `Cache-Control: no-store` e o mesmo destino em `Location`. Os dois POSTs aceitam até **1.048.576 bytes** de corpo JSON, incluindo chaves, aspas e espaços. Um corpo maior recebe `400` sem `Location`. No formulário, a URL recusada continua no campo para correção e novo envio.

### Abrir um link com acentos

O destino `https://loja.example/café%2Fpedido?q=mão%2b#índice` fica gravado como foi enviado. Tanto um código antigo quanto um recém-criado devolvem `https://loja.example/caf%C3%A9%2Fpedido?q=m%C3%A3o%2b#%C3%ADndice` no cabeçalho. O cliente solicita `/caf%C3%A9%2Fpedido?q=m%C3%A3o%2b` à loja e usa o fragmento para abrir a seção. Escapes existentes preservam a grafia, inclusive `%2b`. Um destino inteiramente ASCII sai byte a byte como foi aceito.

Na CI, o Chrome abriu o link criado pelo formulário contra o Cassandra real. O servidor de destino só devolveu `200` ao receber o caminho e a consulta exatos, e o navegador conservou o fragmento. Uma conferência adicional no Chromium seguiu tanto o GET quanto o POST pela entrada NGINX até esse destino.

A criação também aceita ideogramas e emoji. Por exemplo, `/東京%2F?q=茶%2b#🌍` chega como `/%E6%9D%B1%E4%BA%AC%2F?q=%E8%8C%B6%2b#%F0%9F%8C%8D`. Um nome de domínio internacional como `café.example` é transmitido como `xn--caf-dma.example`. Se o próprio nome já contém escapes, a API os mantém e codifica em UTF-8 apenas seus caracteres internacionais literais. O redirecionamento preserva a grafia do caminho e da porta, inclusive em destinos com escapes existentes e segmentos `..`.

Na raiz, com as dependências da API instaladas, estes comandos verificam os bytes de GET e POST e a requisição seguinte. O primeiro ensaio troca bytes entre os parsers HTTP do Node em memória. O segundo segue de fato as duas rotas até um servidor em loopback, para vínculos novos e antigos, e verifica o valor original no armazenamento e no cache controlados. Cada rota lê uma vez a fonte persistente com o cache frio e a consulta seguinte encontra o vínculo no cache.

```sh
npm exec -- tsc -p tsconfig.test.json
node --test --test-name-pattern='acentos' .test-dist/tests/contract/resolver.test.js
```

Com Cassandra e Redis de teste configurados, execute também `node --test --test-name-pattern='Cassandra independente|Unicode literal no Cassandra' .test-dist/tests/contract/criar.test.js`. O teste de Unicode consulta o texto original após o `201` por uma conexão CQL separada, confere o valor no Redis e mede uma leitura no banco com o cache frio e um acerto no cache aquecido para cada rota.

Para publicar a correção, reconstrua as imagens da API e do NGINX e atualize as entradas antes das APIs. Cada byte UTF-8 representado por `%HH` ocupa três bytes no cabeçalho. Se houver outro proxy na frente do NGINX, configure-o para aceitar cabeçalhos de resposta de 3 MiB mais a margem de 4 KiB usada pela distribuição. A qualificação de memória da VPS precisa considerar esse buffer nas rotas de resolução. [Regras do NGINX](../deploy/nginx/rotas.conf) · [Buffer de resposta do proxy](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_buffer_size)

Em uma instalação de teste, o comando abaixo cria vínculos e compara o destino completo nas duas rotas, inclusive no limite do JSON. Também verifica a recusa dos dois POSTs um byte acima do limite. Para conferir a correção da URL no Chromium e os cabeçalhos de um código ausente nas duas rotas, siga o [ensaio do navegador com a API real](#testar-o-navegador-com-a-api-real).

```sh
node tests/ops/redirecionamento.mjs "$PUBLIC_ORIGIN"
```

Para parar mantendo os dados, execute `docker compose stop`. Para voltar a abrir os mesmos links, execute `docker compose start` e aguarde a prontidão do Cassandra.

Se a demo compartilha a entrada NGINX e a memória disponível cai abaixo da margem do pré-voo, restabeleça a rota anterior e pare apenas os serviços da demo. O guia mostra como conferir a saúde do vizinho e reabrir o mesmo link após a retomada. [Reversão e retomada da demo](../deploy/demo/qualificacao.md#reverter-a-publicação-e-retomar-a-mesma-demo)

### Configuração e operação

| Ajuste | Como usar |
| --- | --- |
| Domínio e porta | `PUBLIC_ORIGIN` é a origem pública canônica, incluindo a porta se necessária. `HTTP_PORT` controla a porta publicada. `HTTP_BIND` começa em loopback. Aponte o proxy TLS do operador para o NGINX. Mantenha a origem das URLs já distribuídas. |
| Serviços externos | Remova de `COMPOSE_PROFILES` os serviços externos e exporte `CASSANDRA_CONTACT_POINTS`, `CASSANDRA_PORT`, `CASSANDRA_DATACENTER`, `CASSANDRA_KEYSPACE` e `REDIS_URL` conforme o destino. Os arquivos CQL de exemplo usam `encurtador` e `datacenter1`. |
| Identidade e segredos | Guarde `api.env` e a marca externa. Preserve `FF1_KEY`, `FF1_TWEAK` (hexadecimal, vazio por padrão) e `INSTALLATION_ID` nas réplicas. Escolha um ID exclusivo por instalação que compartilhe Redis. Credenciais do banco, se exigidas, usam `CASSANDRA_USERNAME` e `CASSANDRA_PASSWORD`. |
| Prazos | `DB_TIMEOUT_MS`, `CACHE_TIMEOUT_MS` e `REQUEST_TIMEOUT_MS` limitam a espera. `CLOCK_TOLERANCE_SECONDS` acrescenta margem ao TTL físico. A aplicação verifica o vencimento exato a cada leitura. [Conferência dos relógios](../deploy/demo/relogios.md) |
| Demo | Meça a memória dos vizinhos e a margem antes de definir limites na VPS. No ensaio, selecione `DEMO_REDIS_MODE=externo` para usar o Redis compartilhado e `DEMO_NGINX_MODE=existente` para usar a entrada já instalada. O guia descreve as portas, o prefixo de teste e a medição dos serviços novos. [Pré-voo](../deploy/demo/preflight.md) · [Qualificação](../deploy/demo/qualificacao.md) |
| Expansão e recuperação | Para passar a três réplicas do keyspace existente, altere o RF e conclua o repair antes de atender com `LOCAL_QUORUM`. A retomada após restauração exige congelar a emissão e comprovar a marca externa. [Expansão de RF 1 para RF 3](../deploy/ha/topologia.md#expandir-o-keyspace-existente-de-rf-1-para-rf-3) · [Recuperação](../deploy/ha/recuperacao.md) |
| Indicadores | As sondas e métricas ficam na porta interna da API. O NGINX protege esses caminhos. [Métricas](../tests/ops/metricas.md) · [Ensaio de failover](../tests/ops/failover.md) · [Amostra de carga e qualificação pendente](../tests/load/relatorio.md) |

Para executar o servidor Node diretamente, instale com `npm ci`, compile com `npm run build` e inicie com `node --env-file=api.env dist/server.js` mais a configuração de origem e endpoints acessíveis nesse host. A API escuta em `PORT` (3000 por padrão). Para repetir a suíte fora do Compose, forneça um Cassandra 5 **de testes** com permissão para criar keyspaces efêmeros, e Redis **de testes** acessível em `REDIS_URL` e `TEST_REDIS_URL`. Com esses endereços no ambiente, `npm test` compila fontes e testes e executa a suíte nativa.

### Diagnosticar a inicialização de uma réplica

Defina `PUBLIC_ORIGIN` com uma origem HTTP(S) e forneça `FF1_KEY` com 32, 48 ou 64 dígitos hexadecimais. Defina `CASSANDRA_CONSISTENCY=ONE` na demo e `LOCAL_QUORUM` no perfil distribuído, no arquivo indicado por `API_ENV_FILE` em cada host. Uma réplica com configuração inválida encerra antes de escutar, com código 1. O diagnóstico identifica a variável e omite o valor.

Em `CASSANDRA_CONTACT_POINTS`, separe os nós por vírgula. Por exemplo, `CASSANDRA_CONTACT_POINTS=cassandra.prod.example.,db-b` passa ao driver o nome DNS absoluto do primeiro nó com o ponto final. Em uma rede privada do Docker, a API compilada acessou o Cassandra 5.0.6 usando apenas `cassandra.prod.example.` e respondeu `200` a `GET /internal/ready`. A lista também aceita IPv4 e IPv6. Defina a porta comum dos nós em `CASSANDRA_PORT`. Um nome com rótulo vazio entre dois pontos, como `cassandra..example`, encerra a inicialização com `Configuração inválida em CASSANDRA_CONTACT_POINTS`.

Em `REDIS_URL`, use um nome DNS como `redis://cache.example:6379/0` ou um endereço IPv6 entre colchetes como `rediss://[::1]:6380/0` para Redis com TLS. Se houver um `%` no host, confira os dois dígitos hexadecimais que o seguem. Um host como `cache%ZZ` faz a réplica encerrar com `Configuração inválida em REDIS_URL`. Com um escape completo, o cliente Redis encaminha o nome ao resolvedor preservando o escape. Use o nome tal como cadastrado no DNS. Nas credenciais, o cliente decodifica uma vez caracteres como `%40` (arroba) e `%25` (percentual).

Consulte as sondas diretamente na porta da API. `GET /internal/live` devolve `200` quando o processo atende HTTP. Em `GET /internal/ready`, uma leitura de `system.local` bem-sucedida devolve `200`, inclusive com Redis indisponível. Uma falha de leitura ou o fim do prazo HTTP devolve `503`. Os prazos padrão são 100 ms para o cache, 5 s para o banco e 15 s para a requisição. Ao receber `SIGTERM`, a réplica fecha a escuta, aguarda as conexões em curso até `REQUEST_TIMEOUT_MS` e fecha os clientes de dados.

A consulta ao Redis usa até `CACHE_TIMEOUT_MS`, limitada à metade do prazo HTTP restante depois de ler o pedido. Por exemplo, com 40 ms restantes e um limite de cache de 100 ms, a API espera até 20 ms pelo Redis. Se o cache demorar mais ou devolver um destino inválido, GET e POST consultam o Cassandra. Para um vínculo ativo, a API devolve `302` com o destino original e preenche o cache em segundo plano. Se a leitura persistente falhar, responde `503` sem `Location`. O contador `cqlRead` registra cada tentativa de leitura no banco. [Ensaio dos prazos](../tests/ops/metricas.md#prazo-de-consulta-ao-cache-t052) · [Ensaio com Redis e Cassandra](../tests/ops/metricas.md#entrada-inválida-no-cache-t049)

Para repetir esses casos na raiz do repositório com respostas controladas do Redis e do Cassandra, execute os dois comandos abaixo.

```sh
npm exec -- tsc -p tsconfig.test.json
node --test .test-dist/tests/contract/resolver.test.js
```

As entradas NGINX da demo e de HA aguardam até 310 s entre leituras da API. Esse intervalo cobre todo o domínio de `REQUEST_TIMEOUT_MS`, de 1 a 300.000 ms, e deixa a API emitir o seu próprio `503` no vencimento. Ao colocar outro proxy ou balanceador na frente dessas entradas, configure também seu tempo de espera para comportar o prazo escolhido. O ensaio da CI usa vínculos criados no Cassandra descartável, prazo HTTP de 90 s e um atraso controlado antes de enviar os cabeçalhos de resolução. [Teste direto e pelas duas entradas](../tests/ops/prazo-proxy.mjs) · [Diretiva de espera do NGINX](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_read_timeout)

O Compose calcula o prazo de parada da API somando `REQUEST_TIMEOUT_MS`, `DB_TIMEOUT_MS` e cinco segundos para o fechamento do processo. Com os padrões de 15 s e 5 s, o Docker espera até 25 s antes de forçar a parada. Para ajustar os dois prazos no Compose, exporte as variáveis no terminal ou defina-as no arquivo `.env` usado pela interpolação e recrie a API. Por exemplo, 25.000 ms de HTTP e 3.000 ms de CQL produzem 33 s. O script de CI abre um POST de resolução, solicita `docker compose stop api`, conclui o envio após 11 s e exige o redirecionamento íntegro e código de saída zero.

Na raiz, estes comandos verificam o diagnóstico da API compilada para configurações inválidas e confirmam que os controles DNS e IPv6 chegam à chamada de `listen`. O teste intercepta essa chamada antes de abrir a porta. O teste de sondas usa o parser HTTP com respostas CQL controladas.

```sh
npm exec -- tsc -p tsconfig.test.json
node --test .test-dist/src/config/config.test.js .test-dist/src/http/health.test.js
```

No ensaio da imagem da API, os hosts `cache%ZZ` com `redis://` e `rediss://` encerraram com código 1, saída padrão vazia e somente o nome da variável na mensagem de erro. Em contêineres isolados com `--network none`, as configurações `redis://cache.test:6379/0` e `rediss://[::1]:6380/0` permitiram consultar `GET /internal/live` em loopback e receber `200`. Essa sonda observa a escuta da API e funciona independentemente de uma conexão ao Redis.

Com TCP local e o Cassandra de testes configurado, execute também `node --test .test-dist/tests/integration/servico.test.js`. O ensaio mantém um POST de resolução aberto, envia `SIGTERM`, confere o fechamento da escuta e termina de enviar o corpo. A conexão original deve receber `302` com o destino gravado no Cassandra e `Cache-Control: no-store`, mesmo com o Redis indisponível.

## Rodar uma rodada de desenvolvimento

Na raiz do repositório, o primeiro comando verifica o projeto e mostra as etapas. O segundo inicia uma rodada do Codex com o Spec Kit.

```sh
./.specify/desenvolver --check
./.specify/desenvolver
```

Nas duas etapas, o Codex segue a [persona do agente de engenharia](../AGENTS.md). Ele retoma as tarefas existentes, implementa um lote local, executa os testes e registra as evidências de aceite. Para continuar depois da revisão, execute o segundo comando novamente. Os ensaios de escala e o deploy na VPS exigem infraestrutura própria. Em outro ambiente, instale o Spec Kit com `uv tool install specify-cli==1.4.3`, disponibilize o Codex CLI autenticado e use a versão de Node.js definida em `.tool-versions`. Com mise, `mise install` instala essa versão.

## Interface local

Execute na raiz. O Vite informa a URL no terminal e atualiza a página quando um arquivo de `web/src/` muda.

```sh
mise exec -- npm --prefix web ci
mise exec -- npm --prefix web run dev
```

Abra `/` no endereço informado pelo Vite. Preencha **URL de destino** e acione **Encurtar**. Durante a espera, envios adicionais ficam bloqueados. Depois do `201`, o link retornado pode ser aberto ou copiado em **Copiar**. Se o navegador bloquear a cópia, use o endereço selecionado para copiá-lo manualmente. Após um erro, o campo preserva o destino para correção ou nova tentativa. Se você enviar novamente com Enter a mesma URL inválida, o campo mantém o foco e a região de alerta repete a mensagem.

### Resolver pelo proxy do Vite

Em uma instalação de desenvolvimento, configure a API com `PUBLIC_ORIGIN=http://127.0.0.1:5173` para que os links retornados pelo formulário abram pelo Vite. No terminal da interface, use `API_ORIGIN` para indicar onde a API escuta. O Vite encaminha tanto `/api/` quanto o caminho de um código de sete caracteres.

```sh
API_ORIGIN=http://127.0.0.1:3000 npm --prefix web run dev -- --port 5173 --strictPort
```

Ao resolver um código, o proxy do Vite aceita até 3 MiB + 4 KiB de cabeçalhos na resposta da API. Isso comporta o `Location` de 3.145.570 bytes do ensaio com acentos em um corpo JSON de 1 MiB.

Com o Vite e a API de teste em execução, rode o ensaio abaixo em outro terminal, na raiz. Ele confere os arquivos de desenvolvimento e cria quatro vínculos pelo Vite. Em seguida, resolve os vínculos concorrentemente e compara o `302`, o `Cache-Control: no-store` e o `Location` de GET e POST nas duas entradas. Os controles incluem destinos ASCII de 12.000 e 20.480 bytes, corpos de exatamente 1 MiB em ASCII e com acentos, e a recusa com `400` um byte acima do limite. [Ensaio do proxy](../web/tests/proxy.mjs)

```sh
node web/tests/proxy.mjs http://127.0.0.1:5173 http://127.0.0.1:3000
```

### Reproduzir o ensaio com respostas controladas

Com o Vite em execução, abra `/tests/formulario.html` na mesma origem. Essa página carrega o formulário de produção e permite controlar a resposta ao POST. O painel abaixo do formulário mostra a contagem de envios e o corpo recebido. O endereço de exemplo serve para conferir o texto e a cópia do resultado.

1. Digite `ftp://destino.example` e pressione Enter com o foco no campo. Aguarde o fim do primeiro anúncio e pressione Enter de novo. Confira um anúncio de erro por tentativa, o foco e o valor preservados e a contagem de POSTs em zero.
2. Escolha **Aguardar confirmação** no painel. Digite `https://loja.example/a%2Fb?cor=azul#detalhes` e acione **Encurtar** duas vezes. Confira o estado de espera, um único POST e a URL original no JSON.
3. Acione **Confirmar com 201**. Confira o link `https://s.example/k7Q2aZ9` e use **Copiar**. Com a permissão de cópia negada no navegador, confira a seleção manual do endereço.
4. Repita com **400**, **503** e **Falha de rede**. Confira que o endereço continua preenchido e que trocar para **201 imediato** permite tentar novamente.

### Testar a cópia por teclado

Use HTTPS com certificado aceito pelo navegador ou uma origem de loopback, como `http://127.0.0.1`, para testar a permissão de escrita na área de transferência. Depois do `201`, use Tab para chegar a **Copiar** e pressione Enter. Com a permissão concedida, aguarde o anúncio **Link copiado.** e cole o endereço em um editor de texto. Copie outro texto no editor, volte ao botão do mesmo link e pressione Enter de novo. Confira um novo anúncio de sucesso e cole novamente para verificar que o endereço confirmado voltou por inteiro à área de transferência.

Com a permissão negada, o foco passa para **Endereço para cópia manual**, com o endereço inteiro selecionado. A instrução para usar o comando Copiar do dispositivo aparece na página e integra a descrição acessível do campo.

Para repetir a cópia manual, pressione a seta para a direita no campo. A seleção se desfaz. Volte a **Copiar** com Shift+Tab e pressione Enter. O foco volta ao campo, o link confirmado inteiro fica selecionado novamente e a instrução de cópia manual continua disponível na região de status.

Em um domínio HTTP de laboratório, como `http://encurtador.test`, o Chromium oferece a seleção manual já no primeiro Enter porque a API da área de transferência fica indisponível nessa origem. Para reproduzir os dois contextos no mesmo computador, inicie o Vite com o nome de teste permitido.

```sh
__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=encurtador.test mise exec -- npm --prefix web run dev -- --host 127.0.0.1 --port 5173
```

Em outro terminal, rode os dois comandos, ajustando 5173 à porta informada pelo Vite. O ensaio abre o formulário de produção e controla a resposta ao POST de criação. Somente o Chromium do segundo comando resolve o nome de laboratório para 127.0.0.1. No macOS com Chrome instalado, acrescente `PLAYWRIGHT_CHANNEL=chrome` antes de cada comando.

```sh
mise exec -- npm --prefix web run test:browser -- http://127.0.0.1:5173
mise exec -- npm --prefix web run test:browser -- http://encurtador.test:5173
```

Para repetir no JavaScript de produção, sirva o build e rode os mesmos dois comandos na porta 5174. Com respostas de criação controladas, o Google Chrome e o Chromium fixado no projeto passaram nas duas origens. Em loopback, o teste gravou um texto diferente antes de cada Enter, leu o link completo na área de transferência e contou uma nova confirmação em região de status acessível a cada acionamento. Nos dois contextos de cópia manual, conferiu foco, seleção e descrição do campo na árvore de acessibilidade. No modo `--real`, o Google Chrome e o Chromium também confirmaram as duas cópias e os dois anúncios após criar o link pela API atrás do NGINX.

```sh
mise exec -- npm --prefix web run build
python3 -m http.server 5174 --bind 127.0.0.1 --directory web/dist
```

### Testar o navegador com a API real

Na raiz do repositório, aponte `PUBLIC_ORIGIN` para o NGINX da instalação de teste. O primeiro comando consulta o Cassandra e devolve um código de sete caracteres cuja posição FF1 está abaixo de `FIRST_ID`. O alocador nunca emite códigos dessa faixa. A chave e o tweak permanecem dentro do contêiner da API.

```sh
BROWSER_ABSENT_CODE=$(docker compose exec -T api node --input-type=module - < tests/ops/fixtures/codigo-ausente.mjs)
export BROWSER_ABSENT_CODE
mise exec -- npm --prefix web run test:browser -- "$PUBLIC_ORIGIN" --real
```

Também é possível informar um código já verificado com `SELECT code FROM links WHERE code='…'` no keyspace de teste. Conserve esse controle ausente durante o ensaio. O navegador verifica GET e POST sem seguir redirecionamentos. O código ausente deve devolver `404` sem `Location`. O vínculo criado pelo formulário deve devolver `302` com o destino integral. Ambos devem incluir `Cache-Control: no-store`. A CI também prepara `0000000` ativo **no próprio keyspace descartável** e verifica seu `302` nas entradas NGINX da demo e de HA. Para uma instalação de teste onde esse vínculo já existe, defina `BROWSER_ZERO_DESTINATION` com o destino esperado. `BROWSER_ADDITIONAL_ENTRY` permite conferir os mesmos códigos por uma segunda entrada que atenda o mesmo domínio público.

Na verificação de T057, o navegador registrou dois anúncios na região de alerta, um após cada Enter, com a URL e o foco preservados e zero POSTs de criação. O ensaio passou tanto com respostas controladas quanto com a página publicada pelo NGINX e a API real.

No ensaio de T031, o Chrome abriu o formulário compilado com essas respostas controladas. Dois acionamentos durante a espera geraram um POST. A colagem confirmou a cópia e, com a escrita na área de transferência bloqueada em uma janela de 320 px, o campo de cópia manual recebeu foco com o endereço inteiro selecionado. A validação integrada pela API e pelo NGINX corresponde a T033.

Para consultar um componente e gerar o build estático, execute na raiz.

```sh
mise exec -- npm --prefix web run astryx -- component Button
mise exec -- npm --prefix web run build
```

O build gera `web/dist/` para publicação pelo NGINX. A página de ensaio é exclusiva do desenvolvimento. Os serviços de integração com Cassandra e Redis dependem de um Docker Engine em execução.
