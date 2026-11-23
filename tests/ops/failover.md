# Ensaio de perda de um host

Execute em instalação dedicada seguindo a [topologia de referência](../../deploy/ha/topologia.md). Registre inventário, digests, domínios de falha, datacenter, RF, consistências, sincronização dos relógios e hora UTC. Recupere todos os nós e valide o quórum entre cenários.

Antes de cada falha, crie destinos que contenham escapes, consulta e fragmento. Guarde cada par `short_url` e destino após o `201`. Leia os pares pelas duas APIs, com cache vazio ou prefixo exclusivo desta execução. Use clientes sem redirecionamento automático. Confira `302`, `Cache-Control: no-store` e `Location` idêntico ao destino enviado.

1. Retire o host de uma API. Crie pela origem pública e resolva, pela réplica disponível, um vínculo confirmado antes da falha e um confirmado durante a falha.
2. Retire a entrada NGINX ativa. Acompanhe o endereço público e a sonda do balanceador. Repita criação e ambas as leituras após o failover automático.
3. Retire o Redis. Comprove criação e resolução com contadores de acertos de cache estáveis e consultas CQL crescentes.
4. Retire um único host Cassandra com RF 3. Confira o quórum restante com `nodetool status` e repita os pares conhecidos e a criação. Em cenário separado, esvazie o cache de teste e retire um segundo nó para perder o quórum. Criação e resolução de um destino conhecido devem retornar `503` sem `Location`. Reponha e sincronize os nós.

5. Em ensaio separado, retire um host que atende o diretório externo de emissão. Registre qual réplica do armazenamento assumiu e confira, a partir de cada API sobrevivente, a geração e o teto da última marca confirmada. Prove que ambas continuam criando e resolvendo e que uma nova reserva por LWT ocorre com a mesma marca. Em caso de perda total da marca, confirme que a criação passa a `503` e a resolução dos vínculos vigentes continua. Restaure apenas a versão atual comprovada seguindo o guia de recuperação.

Durante cada uma das retiradas anteriores, inclusive as de host compartilhado entre serviços, registre a disponibilidade da marca externa e compare geração e teto com os da autorização durável. Um failover do armazenamento que exponha uma versão antiga compromete a segurança da retomada.

Para cada cenário, registre o instante da falha, a última operação confirmada, os status e cabeçalhos, os contadores por réplica, a primeira criação e a primeira resolução bem-sucedidas durante a falha e o instante da recuperação. Compare os destinos dos links confirmados antes e depois de recompor o cluster. Publique topologia, amostra, duração e falhas observadas. As metas mensais de disponibilidade e de latência aguardam decisão do mantenedor.
