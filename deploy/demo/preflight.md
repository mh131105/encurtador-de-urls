# Medir a memória disponível para a demo

Os 2 GB pertencem ao host inteiro. Antes de publicar, registre o nome da máquina, a janela de observação, a carga dos vizinhos e os serviços que ficarão em outro host. Execute os comandos Linux no host do Docker. No Docker Desktop, o kernel e os cgroups pertencem à VM Linux.

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

O ensaio local e as medições pendentes da VPS estão no [relatório de qualificação](qualificacao.md).

## Medição local em 23/11/2026

O laboratório usou uma VM QEMU/HVF ARM64 isolada com 2 vCPUs e 2 GiB de RAM, Alpine Linux 3.23.4, Docker 29.5.2 e cgroup v2. No pré-voo da oitava rodada, o kernel observou 2.013.712 KiB de RAM, zero swap e 11.614.057 KiB livres na partição de dados. Estavam abertas as portas TCP 22 (SSH da VM) e 18080 em loopback (vizinho sintético). As imagens da API e do NGINX já estavam carregadas, sem contêineres da aplicação em execução.

O vizinho respondia a GET em loopback, mantinha uma alocação de 160 MiB e acrescentava 64 MiB por cinco segundos a cada dez. Nos 35 segundos de pré-voo encerrados às 02h49min38s de Manaus (UTC−4), 70 observações registraram RSS entre 179.796 e 245.348 KiB e pico histórico de 245.348 KiB. As 70 sondas responderam, com máximo de 11,52 ms. O contador global de OOM estava em zero. O menor `MemAvailable` foi 1.511.724 KiB. A margem para variações dos vizinhos e do sistema foi de **192 MiB**. A conta 1.511.724 KiB ÷ 1.024 − 192 MiB resultou em 1.284,29 MiB. O ensaio local usou o teto arredondado de **1.284 MiB**.

Após remover os serviços e volumes do perfil local, outra janela de 35 segundos mediu a mesma VM com o vizinho em uso. As 69 sondas responderam, com máximo de 9,30 ms. O menor `MemAvailable` foi 1.554.864 KiB. O perfil com Cassandra em outro host reservou 232 MiB aos três contêineres locais. O [relatório](qualificacao.md) identifica as imagens e as medidas de cada execução. A carga e a margem da VPS real dependem de observação em uma janela representativa.

Para reproduzir esse vizinho na VM descartável, o comando abaixo inicia um servidor de loopback. O processo toca o bloco alocado no início de cada ciclo. Em outro terminal, meça a saúde com `curl -fsS -w '%{time_total}\n' -o /dev/null http://127.0.0.1:18080/`, o RSS em `/proc/PID/status` e a memória do host durante pelo menos três oscilações.

```sh
python3 - <<'PY'
from http.server import BaseHTTPRequestHandler, HTTPServer
from threading import Thread
from time import sleep

def carga():
    base = bytearray(160 << 20)
    while True:
        pico = bytearray(64 << 20)
        sleep(5)
        del pico
        sleep(5)

class Vizinho(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"ok")
    def log_message(self, *args):
        pass

Thread(target=carga, daemon=True).start()
HTTPServer(("127.0.0.1", 18080), Vizinho).serve_forever()
PY
```
