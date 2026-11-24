# Instalar o XISPA

Você pode ter o XISPA funcionando no seu computador antes de escolher um domínio ou contratar um servidor. Nas cinco etapas abaixo, você vai instalar a versão pronta, encurtar o endereço do Google e conferir se o mesmo link continua abrindo depois de reiniciar os serviços. Se preferir trabalhar com o código-fonte, faça a etapa 1 e siga pelo [caminho com Git](#compilar-do-código-fonte).

## Usar as imagens do Docker Hub

### 1. Preparar o computador

O Docker executa os serviços que formam o XISPA. O Compose inicia todos com um único comando. Você precisa de acesso à internet no primeiro download, Docker com **Compose 2.24.0 ou superior** e um terminal com Bash, `curl` e `tar`. As imagens estão disponíveis para processadores Intel/AMD de 64 bits e ARM de 64 bits.

| Seu sistema | Onde instalar e digitar os comandos |
| --- | --- |
| **Windows** | Instale o WSL 2 com uma distribuição Linux, como o Ubuntu. Se ainda não tiver WSL, execute `wsl --install` no PowerShell **como administrador** e reinicie o PC. Instale e abra o Docker Desktop. Habilite sua distribuição em **Settings → Resources → WSL Integration**. Para o restante do tutorial, abra **Ubuntu** pelo menu Iniciar e use aquele terminal. [Instalar o WSL](https://learn.microsoft.com/pt-br/windows/wsl/install) · [Docker Desktop para Windows](https://docs.docker.com/desktop/setup/install/windows-install/) · [Integração com WSL](https://docs.docker.com/desktop/features/wsl/) |
| **macOS** | Instale o Docker Desktop para o seu processador (Apple silicon ou Intel), abra o aplicativo e aguarde o Docker iniciar. Digite os comandos no aplicativo **Terminal**. [Docker Desktop para Mac](https://docs.docker.com/desktop/setup/install/mac-install/) |
| **Linux** | No terminal da sua distribuição, instale o Docker Engine e o plugin Docker Compose. Use uma conta com acesso ao serviço Docker. [Instalar o Engine](https://docs.docker.com/engine/install/) · [Instalar o Compose](https://docs.docker.com/compose/install/linux/) |

Nesse terminal, confira o Docker e o Compose.

```sh
docker info
docker compose version
```

O primeiro comando deve mostrar a seção `Server`. O segundo deve informar a versão do Compose. Se houver erro de conexão, abra o Docker Desktop ou inicie o serviço Docker no Linux antes de continuar.

### 2. Baixar a versão 0.1.3

Crie uma pasta nova e permanente no seu diretório pessoal. Se `xispa-local` já existir, escolha outro nome para a instalação nova. Para retomar uma instalação que você já usa, vá à [etapa 5](#parar-e-retomar).

```sh
mkdir ~/xispa-local && cd ~/xispa-local
```

Dentro de `xispa-local`, baixe o pacote e entre na pasta extraída.

```sh
curl -fLO https://github.com/mh131105/encurtador-de-urls/releases/download/v0.1.3/encurtador-0.1.3.tar.gz
tar -xzf encurtador-0.1.3.tar.gz
cd encurtador-0.1.3
ls compose.yaml scripts/iniciar.sh
```

Se aparecerem `compose.yaml` e `scripts/iniciar.sh`, você está na **pasta da instalação**. Execute ali os próximos comandos. Esse caminho dispensa Git e Node.js.

### 3. Iniciar os serviços

Para usar o XISPA nesse computador com a porta padrão, execute o comando abaixo. **Se você precisa de outra porta ou quer compartilhar links no seu domínio, escolha o endereço antes da primeira execução.** [Escolher a porta e o endereço dos links](#escolher-a-porta-e-o-endereço-dos-links)

```sh
bash scripts/iniciar.sh
```

O Docker baixa as imagens. A mensagem `Aguardando o Cassandra aceitar consultas...` aparece enquanto o banco inicia. Espere até o terminal mostrar **`Instalação pronta. Abra http://localhost:8080/`**. Os serviços continuam em execução quando o comando termina.

### 4. Criar e abrir o primeiro link

1. No navegador desse computador, abra <http://localhost:8080/> ou o endereço que você escolheu.
2. Em **URL de destino**, cole `https://www.google.com/` e clique em **Encurtar**.
3. Quando aparecer **Link criado.**, clique em **Copiar** e guarde o endereço curto. Ele começa com o endereço da sua instalação e termina em um código de sete caracteres.
4. Cole o link curto em uma nova aba. O Google deve abrir. Guarde **o link curto** para o teste seguinte.

<a name="parar-e-retomar"></a>

### 5. Parar e retomar

Volte à pasta da instalação (no exemplo, `cd ~/xispa-local/encurtador-0.1.3`) e execute um comando de cada vez.

```sh
docker compose stop
docker compose start
docker compose ps
```

Na lista, os quatro serviços devem aparecer em execução. `nginx` serve a página, `api` cria e resolve links, `cassandra` os guarda e `redis` acelera as consultas. Aguarde o banco iniciar e abra **o mesmo link curto** da etapa 4. Ele deve levar ao Google. Se o banco ainda estiver iniciando, repita o iniciador para aguardar a confirmação de prontidão. O guia de arquitetura acompanha esse mesmo clique por dentro dos quatro serviços. [Como o XISPA funciona](https://github.com/mh131105/encurtador-de-urls/blob/main/docs/arquitetura.md)

## Compilar do código-fonte

Depois de preparar o Docker na etapa 1, instale também o Git. Os comandos abaixo baixam o código da versão 0.1.3 para uma pasta nova e usam o Docker para compilar a API e a interface. Caso precise de outra porta ou de um domínio próprio, defina-os já no comando do iniciador, como na instalação pelas imagens prontas. [Instalar o Git](https://git-scm.com/install/) · [Escolher porta e domínio](#escolher-a-porta-e-o-endereço-dos-links)

```sh
git clone --branch v0.1.3 --depth 1 https://github.com/mh131105/encurtador-de-urls.git ~/xispa-codigo
cd ~/xispa-codigo
bash scripts/iniciar.sh --build
```

Ao ver **Instalação pronta**, faça as etapas [4](#4-criar-e-abrir-o-primeiro-link) e [5](#parar-e-retomar). Nesse caminho, a pasta da instalação é `~/xispa-codigo`. Sempre use `--build` ao repetir o iniciador. As opções de porta e domínio abaixo também funcionam com essa opção.

## Escolher a porta e o endereço dos links

A **porta** é o número depois de `:` no endereço. Para uma **nova** instalação na porta 8091, substitua o comando da etapa 3 por `HTTP_PORT=8091 bash scripts/iniciar.sh`. A página e os links passarão a usar <http://localhost:8091/>. Para manter duas instalações no mesmo computador, use pastas, portas e nomes de projeto diferentes. Por exemplo, em uma segunda pasta nova, use `COMPOSE_PROJECT_NAME=xispa-teste HTTP_PORT=8091 bash scripts/iniciar.sh` se essa porta estiver livre.

O iniciador salva a porta e o endereço em `.env` na primeira execução. Ao retomar, usa os valores salvos e avisa se o terminal fornecer valores diferentes. `PUBLIC_ORIGIN` é o endereço que os usuários verão nos links, incluindo `http://` ou `https://` e a porta, se necessária. **Cada link já compartilhado depende de o endereço original continuar acessível.**

### Reproduzir o endereço mostrado no vídeo

Para usar `xispa.test` só no seu computador, adicione esta linha ao arquivo de nomes locais do sistema **onde você abre o navegador**, preservando as linhas existentes.

```text
127.0.0.1 xispa.test
```

No Linux e no macOS, o arquivo é `/etc/hosts` e a edição requer permissão de administrador. No Windows, abra o Bloco de Notas como administrador e edite `%SystemRoot%\System32\drivers\etc\hosts`. Se usa o navegador no Windows e o Docker pelo Ubuntu/WSL, faça essa edição no Windows. [Arquivo hosts no Windows](https://support.microsoft.com/en-us/windows/experience/how-to-reset-the-hosts-file-back-to-the-default)

Em uma instalação nova, com a porta 80 livre e disponível para o Docker, use `HTTP_PORT=80 PUBLIC_ORIGIN=http://xispa.test bash scripts/iniciar.sh` na etapa 3. Abra `http://xispa.test` e crie o link para o Google. Para usar a porta 8080, execute `PUBLIC_ORIGIN=http://xispa.test:8080 bash scripts/iniciar.sh` e abra `http://xispa.test:8080`. Esse nome só funciona nas máquinas em que foi configurado.

### Compartilhar fora da própria máquina

Se outra pessoa abrir um link com `localhost`, o navegador tentará encontrar o XISPA **no computador dela**. Para distribuir links pela internet, use um domínio seu e deixe o servidor ligado. O exemplo a seguir usa um servidor Linux com um proxy HTTPS no próprio host. O proxy recebe a conexão segura e a encaminha ao NGINX do XISPA.

1. Escolha um subdomínio e, no provedor de DNS, aponte seu registro `A` para o IPv4 público do servidor. Se publicar um registro `AAAA`, o IPv6 também precisa chegar a esse servidor. Disponibilize as portas públicas 80 e 443 para o proxy.
2. Na etapa 3 da instalação nova, execute `PUBLIC_ORIGIN=https://curto.example.org bash scripts/iniciar.sh`, trocando `curto.example.org` pelo seu nome real. O XISPA continuará escutando em `127.0.0.1:8080`.
3. Configure seu proxy para encaminhar **todos os caminhos** desse domínio para `http://127.0.0.1:8080`. Por exemplo, se usa Caddy como serviço no host, acrescente o bloco abaixo ao `/etc/caddy/Caddyfile`, substitua o domínio e execute `sudo systemctl reload caddy`. O Caddy obtém o certificado HTTPS quando o DNS e as portas estão configurados. [Instalar o Caddy](https://caddyserver.com/docs/install) · [Proxy reverso com HTTPS](https://caddyserver.com/docs/quick-starts/reverse-proxy) · [Serviço no Linux](https://caddyserver.com/docs/running)

   ```caddyfile
   curto.example.org {
       reverse_proxy 127.0.0.1:8080
   }
   ```

4. No celular, pela rede móvel, abra o domínio com `https://`, crie um link e confira que ele também abre o Google. Em uma VPS compartilhada, meça a memória disponível e prepare o backup antes de receber usuários. [Dimensionamento da instalação](https://github.com/mh131105/encurtador-de-urls/blob/main/deploy/demo/preflight.md) · [Backup e recuperação](https://github.com/mh131105/encurtador-de-urls/blob/main/deploy/ha/recuperacao.md)

## Atualizar o formulário de uma instalação existente

Na distribuição 0.1.3, a **página** usa a imagem `mh131105/encurtador-de-urls-web:0.1.3` e a **API** usa `mh131105/encurtador-de-urls:0.1.0`. Para atualizar uma instalação feita pelo Docker Hub, abra o arquivo `.env` na **pasta original** e ajuste apenas a linha `NGINX_IMAGE=mh131105/encurtador-de-urls-web:0.1.3`. Em seguida, baixe e recrie o serviço da página.

```sh
docker compose pull nginx
docker compose up -d --no-deps nginx
```

Se compilou do código, volte ao clone original e guarde suas alterações locais. Use `git fetch --tags origin` e `git switch --detach v0.1.3`. No `.env`, mantenha o nome local de `NGINX_IMAGE` e troque o sufixo da versão para `:0.1.3`. Execute `bash scripts/iniciar.sh --build`.

Recarregue a página e abra um link antigo para verificar o resultado. Para baixar as duas imagens públicas antecipadamente numa máquina nova, os comandos opcionais são `docker pull mh131105/encurtador-de-urls:0.1.0` e `docker pull mh131105/encurtador-de-urls-web:0.1.3`.

## Se a instalação parar

| O que você vê | Como continuar |
| --- | --- |
| `docker: command not found`, erro de conexão ou de permissão | Volte à etapa 1. No Windows, confira a integração do Docker Desktop com a distribuição aberta. No Linux, verifique se o serviço está ativo e se a sua conta tem acesso. [Permissões do Docker no Linux](https://docs.docker.com/engine/install/linux-postinstall/) |
| `port is already allocated` ou `address already in use` | A porta já tem um serviço. Se o iniciador já gravou `.env`, libere a porta e repita o comando. Em uma instalação local que **ainda não emitiu links**, outra saída é editar no próprio `.env` as linhas `HTTP_PORT=8091` e `PUBLIC_ORIGIN=http://localhost:8091` e repetir o iniciador. |
| A página não abre ou um link dá erro logo após a partida | Na pasta da instalação, execute `docker compose ps -a` e `docker compose logs --tail=60 cassandra api nginx`. Aguarde o Cassandra iniciar, corrija o erro indicado e repita o iniciador. |
| O iniciador aponta uma instalação anterior, uma chave ausente ou divergência na marca de emissão | Guarde os arquivos e volumes originais. A marca registra a faixa de códigos já autorizada. Uma instalação manual deve ser retomada com sua configuração original. Para perda ou divergência de dados, siga o [procedimento de recuperação](https://github.com/mh131105/encurtador-de-urls/blob/main/deploy/ha/recuperacao.md) antes de voltar a criar links. |
| O iniciador informa que outro está em execução | Aguarde o processo terminar. Se ele foi interrompido e você confirmou que nenhum iniciador continua ativo nessa pasta, remova apenas a trava do iniciador com `rmdir state/.iniciando` e repita o comando. Preserve os arquivos em `state/emission/`. |

Para manter seus links, guarde a pasta da instalação, incluindo `.env` (configuração), `api.env` (chave secreta de emissão) e `state/` (identidade e marca de emissão), **e o volume de dados do Cassandra**. Esse volume é gerenciado pelo Docker e fica fora da pasta extraída. Para parar o serviço, use `docker compose stop`. A opção `docker compose down -v` apaga os volumes, inclusive o banco dos links. O Redis guarda um cache que pode ser reconstruído. Mantenha uma cópia durável da marca de emissão separada do backup do banco. [Como fazer o backup](https://github.com/mh131105/encurtador-de-urls/blob/main/deploy/ha/recuperacao.md)
