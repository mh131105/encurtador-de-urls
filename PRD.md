# PRD do encurtador de URLs auto-hospedado

Uma pessoa envia uma URL longa e recebe um link curto que pode compartilhar imediatamente. Quem abre o link chega ao endereço original. A organização que hospeda o serviço controla o domínio e os dados e pode manter os links válidos por dez anos. O código-fonte e as instruções de operação serão distribuídos sob licença open source.

## O que a primeira versão entrega

| Para quem | Resultado esperado |
| --- | --- |
| Quem cria links | Colar uma URL HTTP ou HTTPS na página inicial, encurtá-la e copiar o resultado, ou fazer a mesma criação pela API. Ambos os caminhos dispensam cadastro, login ou chave de acesso. O endereço usa o domínio do operador e exatamente sete caracteres no caminho, além da barra. |
| Quem recebe um link | Abrir o endereço no navegador ou resolvê-lo pela API. Chegar ao mesmo destino, inclusive ao parâmetro de busca ou à seção da página indicada pelo fragmento. Pode-se colar um endereço com caracteres internacionais. O redirecionamento usa UTF-8 e conserva os escapes que a pessoa já informou. |
| Quem hospeda | Publicar a mesma versão numa VPS compartilhada para demonstração ou em vários hosts para alta disponibilidade. Ampliar a instalação preservando os endereços já distribuídos. |

### Jornada na página inicial

Em `/`, a pessoa encontra um campo para a URL e o botão **Encurtar**. A página indica quando o pedido está em andamento e, após a confirmação da API, mostra o link clicável com a ação **Copiar**. Se o navegador bloquear a cópia, o endereço continua selecionável para cópia manual. Um erro de entrada ou de conexão mantém a URL digitada para correção ou nova tentativa. O fluxo deve funcionar no celular, por teclado e com leitor de tela.

A interface usa React 19, TypeScript e Astryx. O operador publica os arquivos já compilados no NGINX que atende o domínio do encurtador. A página usa o contrato público de criação e os links compartilhados continuam abrindo diretamente pelo código.

## Compromissos do produto

- **Endereço curto e estável.** O código usa apenas `0–9`, `A–Z` e `a–z`. Maiúsculas e minúsculas são distintas. A emissão oculta a sequência interna e cada código identifica um único destino durante toda a sua vida. Mesmo depois do vencimento, esse código jamais será atribuído a outro destino.
- **Retenção.** O link funciona imediatamente após a criação confirmada e vence dez anos civis depois. O prazo acompanha o vínculo original em reinícios e restaurações.
- **Capacidade.** O alvo de produção é 100 milhões de criações e 1 bilhão de resoluções em 24 horas. Para cada gravação de link, a instalação deve comportar dez consultas ao banco quando o cache estiver indisponível. Isso equivale, em média, a cerca de 1.157 criações e 11.574 consultas por segundo.
- **Disponibilidade.** Na instalação distribuída, a perda de um host deve permitir que os demais continuem criando e resolvendo links. A demonstração em uma única VPS tem como objetivo comprovar o funcionamento do produto com poucos recursos.
- **Distribuição.** A API e seus testes serão escritos em TypeScript, para que quem trabalha com JavaScript e Node.js possa contribuir. A versão inclui o código-fonte, instruções para reproduzir o build e uma imagem pronta para auto-hospedagem. O mantenedor escolheu a licença [Apache-2.0](LICENSE).

### Por que sete caracteres

Dez anos no volume máximo representam até **365,3 bilhões de links**. Seis caracteres Base62 comportam 56.800.235.584 códigos. Sete comportam 3.521.614.606.208. Mesmo iniciando a alocação em `62^4`, restam 3.521.599.829.872 posições antes de descontar faixas abandonadas. Sete é, portanto, o menor comprimento fixo que atende ao objetivo.

A média de 100 bytes por destino representa até **36,53 TB** de URLs nesse horizonte. Com três cópias, os destinos somam 109,59 TB. Chaves, metadados, compactação e backups exigem espaço adicional. Uma URL individual pode ultrapassar 100 bytes.

## Condição para a demonstração na VPS

**Os 2 GB são a memória total da máquina compartilhada.** O orçamento do encurtador será definido pela memória disponível enquanto os outros projetos estão em uso, descontando uma margem para o sistema e para variações desses projetos. Haverá uma única imagem da aplicação. O operador ajusta limites e endereços dos serviços por configuração.

O ensaio da demo deve medir o pico agregado da pilha desde a partida, incluindo repouso, criação, redirecionamento e reinício com dados persistidos. A pilha cabe localmente quando completa esse ciclo dentro do orçamento e preserva a margem dos demais serviços. O Cassandra também usa memória fora do heap e executa trabalho em segundo plano mesmo com pouco tráfego. Se o banco local ultrapassar o orçamento, a mesma imagem pode usar um Cassandra auto-hospedado em outro host disponível. Essa configuração deve ser identificada no resultado do ensaio. [Orientação de hardware do Apache Cassandra](https://cassandra.apache.org/doc/stable/cassandra/managing/operating/hardware.html).

## Da especificação à entrega

A demo tem aceite próprio. As alegações de alta disponibilidade e de capacidade dependem de ensaios de falha e carga em infraestrutura dimensionada. O percentual mensal de disponibilidade e os limites de latência p95/p99 ainda estão em aberto.

| Documento | Uso |
| --- | --- |
| [Especificação da funcionalidade](specs/001-encurtador/spec.md) | Consultar histórias de usuário, contratos HTTP e critérios observáveis de sucesso. |
| [Plano de implementação](specs/001-encurtador/plan.md) | Entender as decisões de arquitetura, dados, recuperação e implantação. |
| [Tarefas de execução](specs/001-encurtador/tasks.md) | Implementar em ordem de dependência e verificar cada entrega. |

Os compromissos deste PRD orientam a revisão da especificação, do plano e das tarefas antes da implementação. [Fluxo de desenvolvimento do GitHub Spec Kit](https://github.github.com/spec-kit/quickstart).
