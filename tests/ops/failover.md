# Ensaio de perda de um host

Use uma instalação dedicada com os domínios de falha da [topologia de referência](../../deploy/ha/topologia.md). Registre distribuição dos serviços, digests, RF, consistências, relógios e saúde inicial. Reponha os componentes e confirme a sincronização e o quórum entre cenários.

Antes de cada retirada, crie vínculos de controle com escapes, consulta e fragmento. Guarde cada destino e o `short_url` após o `201`. Teste pela mesma origem pública, abrindo um vínculo anterior e outro criado durante a falha. Em cada API sobrevivente, confirme as duas rotas sem seguir o `302`, com `Cache-Control: no-store` e `Location` integral. Para comprovar leitura persistente, esfrie apenas a chave de teste antes de cada método. O [verificador HTTP](../../deploy/demo/verificar.py) compara a representação correta de destinos ASCII e Unicode.

| Retirada | O que observar |
| --- | --- |
| Um host da API | O balanceamento encaminha à réplica restante. Uma criação confirmada antes e outra durante a falha continuam resolvendo para os destinos originais. |
| A entrada NGINX ativa | A sonda do balanceador detecta a perda e o mesmo endereço público volta a criar e resolver pelos dois métodos sem intervenção no cliente. |
| O Redis | A criação e a resolução continuam. Os acertos do cache param de subir e as leituras CQL acompanham as consultas frias. |
| Um nó Cassandra com RF 3 | Os dois sobreviventes mantêm quórum, atendem links confirmados e aceitam novas criações. Em cenário isolado com cache frio, retire um segundo nó e verifique que criação e leitura persistente devolvem `503` sem `Location`. |
| Um host do armazenamento da marca | As APIs sobreviventes veem a geração e o teto duráveis mais recentes. Force uma nova reserva em uma API sem saldo e confirme sua LWT e o vínculo criado. Na perda total da marca, a criação devolve `503` e links vigentes continuam resolvendo. |

Para qualquer host que acumule serviços, exercite a perda conjunta desses componentes e confira a versão da marca em todos os leitores. Antes de restabelecer a criação após uma restauração, use a [marca externa atual e a sequência de recuperação](../../deploy/ha/recuperacao.md).

Registre hora UTC da falha, última operação confirmada, primeira criação e primeira resolução bem-sucedidas, erros observados e hora da recomposição. Compare com os pares de controle e as [métricas por processo](metricas.md). Esses dados permitem medir a interrupção no ambiente ensaiado. Uma execução com contêineres no mesmo host não cobre a perda física desse host.
