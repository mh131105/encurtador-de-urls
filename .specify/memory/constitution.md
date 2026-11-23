# Constituição do encurtador de URLs

O [PRD](../../PRD.md) define os compromissos do produto. A [especificação](../../specs/001-encurtador/spec.md) descreve o comportamento observável, o [plano](../../specs/001-encurtador/plan.md) detalha a arquitetura e as [tarefas](../../specs/001-encurtador/tasks.md) orientam a entrega.

## Princípios

1. **Acesso público.** Uma pessoa pode criar links pela página inicial e pela API e abrir o destino sem cadastro, login ou chave de acesso. A interface precisa funcionar por teclado, em telas pequenas e com leitor de tela.
2. **Identidade e retenção.** Cada código tem sete caracteres Base62 sensíveis à caixa, oculta a sequência de emissão e identifica um único destino. Um link confirmado pode ser usado imediatamente e vence em dez anos civis. O código jamais volta a ser atribuído, inclusive após falhas e restaurações.
3. **Auto-hospedagem.** Uma mesma imagem de aplicação atende à demo e à instalação distribuída por configuração. O operador controla domínio e dados. A distribuição deve oferecer código aberto, build reproduzível e instruções de operação.
4. **Recursos compartilhados.** Os 2 GB da VPS são do host inteiro. A demo só atende ao critério de memória com orçamento e margem medidos para os serviços vizinhos. Registrar a localização do Cassandra quando o operador usar um host separado.
5. **Capacidade e tolerância a falhas.** O alvo inclui 100 milhões de criações e 1 bilhão de resoluções em 24 horas, com suporte a dez consultas ao banco por gravação quando o cache estiver indisponível. Alegações de vazão e sobrevivência à perda de um host exigem ensaios em infraestrutura dimensionada.

## Governança

Ao alterar um compromisso, registrar a decisão no PRD e revisar os documentos da funcionalidade que dependem dela. Marcar uma tarefa como concluída somente com a evidência de aceite correspondente. Consultar as decisões em aberto diretamente no PRD.

**Versão 1.0.0 · Adoção em 23 de novembro de 2026.**
