# Medir a memória disponível para a demo

Os 2 GB pertencem ao host inteiro. Antes de reservar recursos para a instalação, registre o nome da máquina, a janela de observação, a carga dos vizinhos e os serviços que ficarão em outro host. Execute os comandos Linux no host do Docker. No Docker Desktop, o kernel e os cgroups pertencem à VM Linux.

```sh
free -m
df -h /
ss -lntup
cat /proc/swaps /proc/pressure/memory
grep '^oom_kill ' /proc/vmstat
docker ps --format '{{.Names}} {{.Ports}}'
```

Observe ciclos habituais dos serviços existentes, incluindo backup e picos. Amostre `MemAvailable`, swap e pressão durante a janela. Registre também `memory.current`, `memory.peak` e `memory.events` dos cgroups dos vizinhos, a sua latência e seus erros. Este comando encontra o cgroup v2 de um processo quando executado no host Linux.

```sh
pid=$(docker inspect -f '{{.State.Pid}}' "$VIZINHO")
grupo=/sys/fs/cgroup$(awk -F: '$1=="0"{print $3}' "/proc/$pid/cgroup")
cat "$grupo/memory.current" "$grupo/memory.peak" "$grupo/memory.events"
while sleep 1; do
  date -u +%FT%TZ
  awk '/^(MemTotal|MemAvailable|SwapFree):/ {print}' /proc/meminfo
done
```

Em MiB, use **teto da pilha = menor MemAvailable observado − margem dos vizinhos e do sistema**. Informe o orçamento em `STACK_BUDGET_MIB` e a margem em `MIN_MARGIN_MIB`, ambos positivos e finitos. Valores fracionários em MiB são aceitos. O limite da pilha pode igualar o orçamento, e a memória disponível pode igualar a margem. Some os limites rígidos de NGINX, API e serviços de dados previstos na VPS. Se o resultado superar o teto, revise a colocação dos serviços antes de iniciar. Para um Cassandra em host próprio, configure `CASSANDRA_CONTACT_POINTS`, `CASSANDRA_PORT`, datacenter e credenciais do keyspace da instalação, e omita o perfil `cassandra`. Para Redis externo, configure `REDIS_URL` e omita o perfil `redis`.

| Item a preencher na VPS | Como registrar |
| --- | --- |
| RAM, swap, disco, portas | Saídas iniciais e finais e caminho do volume de dados |
| Mínimo disponível | Menor `MemAvailable` em toda a janela, convertido de KiB para MiB |
| Picos e saúde dos vizinhos | Cgroups, carga e tempo de resposta representativos |
| Margem, teto e colocação | Valor reservado, justificativa, limites escolhidos por serviço e endereços dos hosts |
| OOM e pressão | Diferença em `oom_kill`, eventos dos cgroups e pressão de memória por fase |

Com o orçamento registrado, execute a [qualificação do perfil escolhido](qualificacao.md).
