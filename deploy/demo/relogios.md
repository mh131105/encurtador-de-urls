# Conferir o desvio dos relógios

O Cassandra usa seu relógio para expirar o registro. A API calcula o TTL a partir do tempo restante até `expires_at`, arredondado para cima, e acrescenta um segundo e `CLOCK_TOLERANCE_SECONDS`. A leitura na API aplica o vencimento civil exato. Verifique se a diferença entre os relógios cabe nessa tolerância antes de qualificar a retenção.

## Medição nos hosts

Identifique o host Linux de cada réplica da API e de cada nó Cassandra. Para contêineres em VM, use o relógio da VM que os executa. Confira a tolerância efetiva em cada réplica. No Compose, o comando abaixo lê o valor da API em execução e aplica o padrão de 5 segundos quando a variável está ausente.

```sh
docker compose exec -T api node -e 'console.log(process.env.CLOCK_TOLERANCE_SECONDS ?? "5")'
```

Execute na raiz do repositório, a partir de um dos hosts do par. Preencha `TOLERANCIA` com o valor conferido e `OUTRO_HOST` com o endereço SSH do outro host. O exemplo usa Python 3 no host de medição e GNU `date` no remoto.

```sh
TOLERANCIA=5
OUTRO_HOST=cassandra-1
python3 deploy/demo/relogios.py "$TOLERANCIA" ssh -o BatchMode=yes "$OUTRO_HOST" date +%s%N
```

O programa registra a hora local imediatamente antes do comando e depois da resposta. Ao subtrair ambos os instantes da leitura remota, obtém os limites inferior e superior do desvio, incluindo o tempo do SSH. Um valor negativo indica que o remoto está atrasado. A medição pressupõe relógios estáveis durante a consulta. Se o serviço de sincronização indicar um salto nesse intervalo, descarte a amostra e repita.

| Saída | Interpretação | Ação |
| --- | --- | --- |
| `DENTRO` (0) | Todo o intervalo cabe na tolerância, incluindo as bordas. | Registre o par, a data UTC, o intervalo e a tolerância. |
| `ACIMA` (1) | Até o menor desvio possível em valor absoluto excede a tolerância. | Confira a sincronização dos hosts e repita a medição após a correção. |
| `INCONCLUSIVO` (2) | O intervalo cruza um limite ou a leitura falhou. | Verifique o acesso e repita com menor latência. |

Cubra cada par de hosts de API e Cassandra. Em uma instalação distribuída, inclua também os pares entre réplicas da API e entre nós Cassandra. Se as réplicas tiverem tolerâncias diferentes, compare com a menor. Guarde os intervalos com as medições da instalação e repita quando mudar a sincronização ou a topologia.

## Reproduzir a conferência local

Os comandos usam um segundo processo que lê o relógio da própria máquina. O segundo comando soma oito segundos apenas à leitura devolvida. O terceiro usa tolerância zero para exercitar o intervalo inconclusivo.

```sh
python3 deploy/demo/relogios.py 5 python3 -c 'import time; print(time.time_ns())'
python3 deploy/demo/relogios.py 5 python3 -c 'import time; print(time.time_ns() + 8_000_000_000)'
python3 deploy/demo/relogios.py 0 python3 -c 'import time; print(time.time_ns())'
```

No ensaio local, os intervalos foram `[-4, 23] ms` (dentro de ±5000 ms), `[7996, 8023] ms` (acima de ±5000 ms) e `[-4, 23] ms` (inconclusivo para ±0 ms). Os limites variam com a duração do comando. As medições da VPS e dos hosts de HA seguem pendentes.
