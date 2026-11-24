# Requisitos do XISPA

## Requisitos funcionais

| ID | Requisito |
| --- | --- |
| <a name="rf-001"></a>**RF-001** | Permitir criar links sem cadastro, login ou chave de acesso. Em `POST /api/v1/encurtar`, receber o destino no campo JSON `url` e responder `201 Created` com o endereço em `short_url` somente após a confirmação da gravação. |
| <a name="rf-002"></a>**RF-002** | Aceitar destinos HTTP e HTTPS absolutos com host válido e caracteres Unicode. Guardar o endereço original, incluindo caminho, escapes, consulta e fragmento, sem acessar o site de destino. Responder `400 Bad Request` se o destino for inválido. |
| <a name="rf-003"></a>**RF-003** | Formar o endereço curto com a origem pública configurada pelo operador e o caminho `/{codigo}`. Usar exatamente sete caracteres entre `0–9`, `A–Z` e `a–z`, distinguindo maiúsculas e minúsculas. |
| <a name="rf-004"></a>**RF-004** | Emitir um código exclusivo por criação confirmada, inclusive para destinos repetidos e pedidos simultâneos em réplicas distintas. Ocultar a sequência interna de emissão e impedir a reatribuição de um código, mesmo após o vencimento. |
| <a name="rf-005"></a>**RF-005** | Responder `503 Service Unavailable` sem `Location` quando a API não puder confirmar a gravação. Impedir que o proxy repita um POST já encaminhado. Tratar uma nova submissão do cliente como um novo pedido de criação. |
| <a name="rf-006"></a>**RF-006** | Permitir a resolução sem autenticação por `GET /{codigo}` ou por `POST /api/v1/redirecionar` com o endereço curto no campo JSON `short_url`. Para um vínculo vigente, responder `302 Found`, com o destino em `Location` e `Cache-Control: no-store`. Preservar os escapes existentes, converter o host internacional sem escapes para ASCII (IDNA) e codificar os demais caracteres internacionais literais com escapes percentuais UTF-8. |
| <a name="rf-007"></a>**RF-007** | Aceitar nos dois POSTs corpos `application/json` em UTF-8 de até 1 MiB, inclusive. Responder `400` a tipo de conteúdo incorreto, corpo maior ou inválido, campo obrigatório ausente ou endereço curto fora da origem e do formato aceitos. Responder `404 Not Found`, sem `Location` e com `Cache-Control: no-store`, a caminho público inválido ou código desconhecido ou vencido. |
| <a name="rf-008"></a>**RF-008** | Manter o vínculo vigente até completar dez anos civis da criação, no mesmo horário UTC, inclusive para vencimentos após 2038. Para uma criação em 29 de fevereiro, usar 28 de fevereiro se o ano final for comum. Preservar o instante de vencimento do vínculo no cache, no banco e após reinícios ou restaurações. |
| <a name="rf-011"></a>**RF-011** | Preservar os links vigentes e a emissão de novos códigos ao reiniciar a instalação na mesma origem, com os dados persistentes, a chave e a marca de emissão preservados, inclusive com o cache vazio. |
| <a name="rf-013"></a>**RF-013** | Permitir que qualquer réplica resolva o vínculo logo após o `201`. Consultar o armazenamento persistente se o cache estiver vazio, inválido ou indisponível. Responder `503` sem `Location` se não houver entrada vigente no cache nem confirmação do banco. |
| <a name="rf-014"></a>**RF-014** | Preservar a exclusividade dos códigos após falhas de reserva ou restauração de backup. Manter a geração e o limite das faixas autorizadas em uma marca durável fora do banco. Alertar sobre o esgotamento da faixa. Suspender criações com `503` sem `Location` enquanto não houver faixa segura e continuar resolvendo vínculos vigentes. |
| <a name="rf-016"></a>**RF-016** | Oferecer em `/` um campo identificado para o destino e a ação **Encurtar**. Indicar envio, sucesso e erro. Impedir envios duplicados enquanto houver um pedido em andamento. Manter o valor digitado em caso de erro. |
| <a name="rf-017"></a>**RF-017** | Exibir o `short_url` confirmado como link clicável. Oferecer a ação **Copiar**, confirmar a cópia quando ela ocorrer e permitir seleção manual quando o navegador bloquear a cópia automática. |
| <a name="rf-018"></a>**RF-018** | Servir o formulário em `/` e os arquivos estáticos em `/assets/`, na mesma origem da API. Responder `404` para arquivo ausente. Permitir abrir links curtos com o JavaScript desativado. |

## Requisitos não funcionais

| ID | Requisito |
| --- | --- |
| <a name="rnf-009"></a>**RNF-009** | Distribuir o código sob a licença Apache-2.0, com imagens prontas e instruções de compilação, configuração do domínio e da chave, expansão, backup e restauração. Permitir auto-hospedagem em uma ou várias máquinas com a mesma imagem da API e a interface previamente compilada. |
| <a name="rnf-010"></a>**RNF-010** | Permitir a execução em um host compartilhado com 2 GB de RAM total. Manter o pico agregado dos serviços locais dentro do orçamento de memória medido, preservando a margem do sistema e dos serviços residentes durante partida, repouso, uso e reinício. Permitir a configuração de limites de memória e o uso de um Cassandra auto-hospedado em outro host. |
| <a name="rnf-012"></a>**RNF-012** | Na topologia distribuída, manter a criação e a resolução pela mesma origem pública após a perda de um host. Alternar a entrada de tráfego automaticamente e distribuir as réplicas da API, os dados e a marca de emissão entre domínios de falha independentes. |
| <a name="rnf-015"></a>**RNF-015** | Em infraestrutura dimensionada, sustentar 100 milhões de criações confirmadas e 1 bilhão de resoluções corretas em 24 horas, com média de 100 bytes por destino. Durante a indisponibilidade do cache, sustentar as mesmas taxas médias com dez consultas persistentes por gravação de vínculo. |
| <a name="rnf-019"></a>**RNF-019** | Permitir o uso do formulário em tela de celular e por teclado, com foco visível. Anunciar envio, resultado e erro a leitores de tela. |
| <a name="rnf-020"></a>**RNF-020** | Implementar a API e os testes de contrato em TypeScript para Node.js. Usar React, TypeScript e Astryx na interface. Manter os vínculos no Apache Cassandra e permitir reconstruir o cache Redis a partir dos dados persistidos. |
| <a name="rnf-021"></a>**RNF-021** | Dimensionar o espaço de códigos e o armazenamento para até 365,3 bilhões de vínculos em dez anos sob a carga de RNF-015. Iniciar a emissão de identificadores internos em `62⁴`. |
| <a name="rnf-022"></a>**RNF-022** | Permitir a medição de vazão, erros, latências p95 e p99 por rota, leituras persistentes, acertos de cache e uso de disco. Medir separadamente a memória da instalação e a do host. Restringir as rotas de saúde e métricas à rede privada. |
