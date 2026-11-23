# Especificação da funcionalidade — Encurtador de URLs auto-hospedado

**Identificador** `001-encurtador` · **Estado** proposta · **Origem** [PRD do produto](../../PRD.md)

Qualquer pessoa pode criar e abrir um link curto sem conta, login ou chave de API. O operador escolhe o domínio e pode começar em uma VPS compartilhada. A mesma imagem de aplicação atende à implantação distribuída. As prioridades abaixo indicam a ordem de entrega. As quatro histórias são obrigatórias.

## Histórias de usuário e testes independentes

### US1 — Criar um link curto (P1)

Como pessoa que compartilha uma URL longa, quero receber um link compacto pronto para enviar. Esta é a primeira entrega porque produz o vínculo usado pelas demais operações.

- **Dado** um destino HTTP ou HTTPS válido, **quando** envio `{"url":"https://loja.example/cafe?cor=azul#detalhes"}` em JSON a `POST /api/v1/encurtar`, **então** recebo `201 Created` com `{"short_url":"https://s.example/k7Q2aZ9"}`, usando o domínio da instalação e um código de sete caracteres.
- **Dado** que um destino já foi encurtado, **quando** faço outra criação confirmada para o mesmo destino, **então** recebo outro código válido. Cada vínculo permanece imutável.
- **Dado** um destino inválido ou um JSON sem o campo obrigatório, **quando** peço a criação, **então** recebo `400`. Se a gravação de um destino válido não puder ser confirmada, recebo `503` sem `Location`.
- **Dado** que abri `/` no navegador, **quando** preencho o campo e aciono **Encurtar**, **então** vejo o envio em andamento e, após a confirmação, o endereço clicável que posso copiar. Se a cópia automática falhar, consigo selecionar o endereço e copiá-lo manualmente.
- **Dado** que a entrada é inválida ou a API está indisponível, **quando** tento criar o link pela página, **então** recebo uma mensagem que identifica o problema e mantenho o valor digitado para corrigir ou tentar novamente.

Para testar a história isoladamente, enviar os pedidos de criação e conferir status, esquema da resposta, domínio e distinção dos códigos.

### US2 — Abrir o link e receber o destino (P1)

Como destinatário, quero clicar no link curto e chegar ao endereço compartilhado. O navegador e o cliente da API devem obter o mesmo destino.

- **Dado** um vínculo ativo, **quando** abro `GET /k7Q2aZ9` ou envio `{"short_url":"https://s.example/k7Q2aZ9"}` em JSON a `POST /api/v1/redirecionar`, **então** recebo `302 Found`, `Cache-Control: no-store` e `Location: https://loja.example/cafe?cor=azul#detalhes`.
- **Dado** um código desconhecido ou vencido, **quando** uso qualquer uma das rotas com um pedido válido, **então** recebo `404` sem `Location` e com `Cache-Control: no-store`.
- **Dado** um vínculo em cache, **quando** chega o instante de vencimento, **então** as duas rotas passam a responder `404`, inclusive para quem já abriu o link.

Para testar a história isoladamente, preparar um vínculo conhecido e um vencido, consultar pelas duas rotas sem seguir o redirecionamento e comparar status e cabeçalhos.

### US3 — Executar a demonstração em uma VPS compartilhada (P2)

Como operador de uma VPS de 2 GB que já atende outros serviços, quero demonstrar a criação e o redirecionamento dentro da memória que posso destinar ao projeto.

- **Dada** a memória disponível sob carga representativa dos serviços existentes, **quando** preparo a instalação, **então** consigo definir um orçamento inferior à memória disponível, preservando margem explícita para o sistema e os demais serviços.
- **Dado** um orçamento que comporte a pilha local, **quando** inicio os serviços, crio e abro um link e reinicio a pilha com o volume preservado, **então** volto a abrir o mesmo link. O ensaio registra o pico agregado durante a inicialização, o repouso, o uso e o reinício, e termina dentro do orçamento, sem processos mortos por falta de memória (OOM).
- **Dado** que o banco local exceda o orçamento observado e haja outro host disponível, **quando** conecto a instalação a um Cassandra auto-hospedado nesse host, **então** consigo repetir o ensaio com o balanceador, a aplicação e o cache na VPS. O resultado identifica o banco remoto e a execução com todos os componentes locais como pendente de validação.

Para testar a história isoladamente, registrar orçamento e margem antes da instalação, executar o ciclo de uso e reinício, medir o consumo e identificar quais componentes participaram em cada host.

### US4 — Operar com falhas e em escala (P3)

Como operador de uma implantação distribuída, quero manter os links disponíveis durante a perda de um host e demonstrar a capacidade de criação e leitura em infraestrutura dimensionada para o volume.

- **Dada** uma instalação redundante, **quando** um dos hosts sai de serviço, **então** a entrada volta a atender automaticamente, aceitando criações e resolvendo os vínculos confirmados. Uma criação confirmada pode ser lida de imediato por outra instância, inclusive com cache frio.
- **Dada** a indisponibilidade do cache, **quando** consulto um link ativo, **então** recebo o destino confirmado no armazenamento persistente. Se a leitura também estiver indisponível, recebo `503`.
- **Dada** a infraestrutura de referência dimensionada, **quando** executo o ensaio de 24 horas, **então** obtenho as criações e resoluções exigidas em SC-007, com registro da infraestrutura, vazão, erros, latências e consumo.

Para testar a história isoladamente, executar os ensaios de falha, restauração e carga em hosts independentes, com dados de destino conhecidos e resultados conferidos por código.

## Requisitos funcionais

| ID | Requisito verificável |
| --- | --- |
| FR-001 | Aceitar criação pública em `POST /api/v1/encurtar` com JSON contendo `url`. Responder `201` com `short_url` após confirmar a gravação do vínculo. |
| FR-002 | Aceitar destinos absolutos `http` ou `https` com host válido, inclusive com caracteres Unicode literais. Conservar o texto original, caminho, escapes, consulta e fragmento sem acessar o destino. Responder `400` a JSON malformado, campo ausente ou destino inválido. |
| FR-003 | Formar cada link com a origem pública configurada e o caminho `/{codigo}`. Gerar códigos que satisfaçam `^[0-9A-Za-z]{7}$` e preservar a distinção entre maiúsculas e minúsculas. |
| FR-004 | Produzir um código exclusivo por criação confirmada, mesmo sob concorrência e para destinos repetidos. Os códigos publicados devem ocultar a sequência de emissão. Um código permanece associado a um único destino e nunca é reatribuído. |
| FR-005 | Retornar `503` sem `Location` quando a persistência da criação não puder ser confirmada. Se o cliente perder a resposta e repetir o POST, uma segunda criação bem-sucedida pode produzir outro link. |
| FR-006 | Resolver por `GET /{codigo}` e por `POST /api/v1/redirecionar` com JSON contendo `short_url` da origem configurada. Em ambos, retornar `302`, o destino absoluto em `Location` e `Cache-Control: no-store`. No cabeçalho, usar a forma ASCII do host internacional e escapes percentuais dos bytes UTF-8 para os demais caracteres internacionais. Copiar os escapes existentes com a mesma grafia. |
| FR-007 | Responder `400` a JSON, campo, formato ou origem inválidos no POST de resolução. Responder `404`, sem `Location` e com `Cache-Control: no-store`, a caminho público inválido ou código desconhecido ou vencido. |
| FR-008 | Conservar cada vínculo por dez anos civis desde a criação em UTC. Aplicar o mesmo vencimento em cache, persistência, retentativas e restaurações. Um link ativo deixa de resolver exatamente em `expires_at`. |
| FR-009 | Distribuir o código sob a licença Apache-2.0, com instruções para construir a imagem a partir dos fontes TypeScript. A mesma imagem versionada deve iniciar diretamente na VPS e na instalação distribuída, com as dependências de execução já incluídas. Documentar domínio, chave, expansão, backup e restauração. |
| FR-010 | Permitir configurar a demo conforme o orçamento medido da VPS compartilhada e a margem do sistema e dos serviços residentes. Medir o pico agregado dos componentes locais e o consumo total do host. Oferecer configuração para Cassandra externo auto-hospedado se a pilha local ultrapassar o orçamento. |
| FR-011 | Preservar os vínculos ativos e a continuidade da geração de códigos após reiniciar os serviços com os volumes persistentes preservados. |
| FR-012 | Em produção, continuar criando e resolvendo links após a perda de um host, com failover automático da entrada e serviços distribuídos em domínios de falha independentes. |
| FR-013 | Permitir que outra instância resolva um código imediatamente após o `201`, inclusive sem cache. Uma falha do cache aciona leitura persistente. Sem cache válido nem leitura persistente confirmada, a resolução responde `503` sem `Location`. |
| FR-014 | Preservar a exclusividade dos códigos após falhas de reserva, reinícios e restaurações. Só retomar a emissão com um limite seguro de alocação. Alertar sobre capacidade restante e suspender criações com `503` ao esgotar o espaço, mantendo a resolução de vínculos ativos. |
| FR-015 | Sustentar até 100 milhões de criações por dia, com dez consultas lógicas por criação e média de 100 bytes por destino, em infraestrutura dimensionada. Permitir conferência da vazão de leitura persistente com cache indisponível e registrar os indicadores de SC-007. |
| FR-016 | Oferecer em `/` um formulário público com campo de URL identificado e ação de encurtar. Exibir os estados inicial, enviando, sucesso e erro. Enviar um único POST de criação por submissão, impedir envios duplicados enquanto a resposta está pendente e manter o valor digitado em caso de erro. |
| FR-017 | Exibir o `short_url` confirmado como link clicável, permitir copiá-lo e confirmar a cópia apenas quando ela ocorrer. Oferecer seleção manual quando a cópia automática estiver indisponível. O fluxo deve caber em tela de celular, aceitar navegação por teclado, exibir foco visível e anunciar resultados e erros a leitores de tela. |
| FR-018 | Servir a página e seus arquivos estáticos na mesma origem da API. Na implantação, servir os arquivos já compilados em `/` e `/assets/`. Preservar a resposta do serviço para a API, os códigos existentes e os caminhos públicos inválidos. |

## Entidades e casos de borda

- **Vínculo curto.** Código público, destino original, instante de criação e instante de expiração em UTC. O código é a chave de consulta. Todo vínculo ativo pode ser compartilhado e aberto por qualquer pessoa que possua o endereço.
- **Espaço de códigos.** Conjunto de identificadores que a instalação pode emitir. A emissão admite lacunas. Cada identificador já atribuído fica permanentemente indisponível para novo uso.
- **Instalação.** Domínio público e conjunto de vínculos de um operador. Todas as instâncias de aplicação atendem os mesmos endereços curtos.
- **Fronteiras do contrato.** Um destino válido de 200 bytes é aceito. Os 100 bytes representam a média da carga. Alterar a caixa de uma letra consulta outro código. Um registro criado em 29 de fevereiro vence em 28 de fevereiro, à mesma hora UTC, se o ano final não for bissexto. As duas rotas devem lidar com vencimentos posteriores a 2038.

## Critérios de sucesso

| ID | Evidência de aceite |
| --- | --- |
| SC-001 | O teste anônimo cria dois links distintos para o mesmo destino, inclui ao menos um destino válido de 200 bytes e confirma origem, sete caracteres e `201`. Entradas inválidas recebem `400` e uma falha de confirmação recebe `503`. |
| SC-002 | GET e POST devolvem exatamente o mesmo `Location` para um destino com caracteres internacionais e escapes existentes no caminho, na consulta e no fragmento. Os testes verificam os códigos e cabeçalhos de sucesso e erro de FR-006 e FR-007, inclusive origem estrangeira e caminho inválido. |
| SC-003 | Em criações concorrentes por duas instâncias, com interrupção, reinício e reserva de resultado incerto, há zero códigos duplicados entre as criações confirmadas e zero vínculos trocados. A unicidade também é justificada pela exclusividade da reserva e da permutação. |
| SC-004 | Com relógio controlado, um link criado em 2030 resolve até imediatamente antes do vencimento em 2040 e retorna `404` a partir desse instante pelas duas rotas, com cache aquecido e vazio. Repetir para a regra de 29 de fevereiro. |
| SC-005 | Na VPS compartilhada, registrar memória disponível, margem, orçamento e picos agregados da pilha local e do host. Criar e abrir ao menos um link, reiniciar e reabrir o mesmo link. Exigir pico local dentro do orçamento durante a partida, o repouso, o uso e o reinício, com margem preservada e zero OOM na VPS. Registrar a topologia efetivamente aprovada e, quando somente o banco remoto couber, a pendência do ensaio com banco local. |
| SC-006 | Retirar, um por vez, um host de aplicação, a entrada ativa, o cache e um nó de dados. Em cada ensaio confirmar criações, leitura de vínculos por outra instância e identidade do destino após o failover. Sem quórum e com cache vazio, verificar `503` sem `Location`. |
| SC-007 | Em hardware identificado, confirmar 100 milhões de criações e 1 bilhão de resoluções corretas em 24 h. Incluir uma janela de cache indisponível sustentando as médias equivalentes a 100 milhões e 1 bilhão por dia diretamente no armazenamento. Registrar duração da janela, erros, latências p95/p99, consultas ao banco, acertos de cache e uso de disco. |
| SC-008 | Após restauração do alocador, nenhuma criação reutiliza posição já reservada. Se o limite seguro for desconhecido, a emissão permanece suspensa. No último ID utilizável, verificar `503` no próximo pedido de criação e a resolução dos links ainda ativos. |
| SC-009 | Um operador parte do código publicado, identifica a licença, gera a imagem a partir dos fontes TypeScript em uma máquina de build e a inicia em um host com Docker seguindo o guia. As rotas funcionam com o JavaScript já compilado, sem instalar ferramentas de desenvolvimento na VPS. O pacote inclui as configurações da demo e de produção e o procedimento de recuperação. |
| SC-010 | No navegador, criar pelo formulário e conferir que um envio, mesmo acionado duas vezes durante a espera, produz um POST e exibe exatamente o link confirmado. Verificar entrada inválida, `400`, `503`, falha de rede e nova tentativa. Em largura de celular e por teclado, verificar rótulo, foco, anúncio dos estados e cópia com a permissão concedida e negada. |
| SC-011 | Na distribuição, abrir `/` e carregar seus arquivos estáticos da mesma origem. Verificar um asset ausente (`404`), os dois POSTs com seus contratos originais, um código ativo (`302`), um desconhecido e um caminho inválido (`404`). Executar o ensaio com os arquivos gerados fora da VPS. |

**Decisões em aberto.** O percentual mensal de disponibilidade e as metas de latência p95/p99 ficam para decisão do mantenedor. A medição dessas latências e a tolerância à perda de um host integram o aceite desta versão.
