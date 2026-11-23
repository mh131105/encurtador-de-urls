# Instalar o XISPA

Você precisa de Docker com Docker Compose **2.24.0 ou superior** e um terminal Bash. No Windows, abra o terminal da sua distribuição WSL com a integração do Docker Desktop habilitada. No Linux ou macOS, use seu terminal. Confira a conexão com `docker info` e a versão com `docker compose version`. O arquivo Compose usa a opção `env_file.required`, disponível a partir da versão 2.24.0. A primeira instalação baixa as imagens e pode levar alguns minutos. [Instalar Docker com Compose](https://docs.docker.com/compose/install/) · [Opções de arquivo de ambiente](https://docs.docker.com/compose/how-tos/environment-variables/set-environment-variables/)

## Usar as imagens do Docker Hub

Baixe o pacote da versão 0.1.1. Ele reúne o arquivo Compose, o esquema do Cassandra e o iniciador. As imagens públicas da API e da interface estão disponíveis para Linux amd64 e arm64. Git, Node.js e npm só são necessários para outros fluxos de desenvolvimento.

```sh
curl -fLO https://github.com/mh131105/encurtador-de-urls/releases/download/v0.1.1/encurtador-0.1.1.tar.gz
tar -xzf encurtador-0.1.1.tar.gz
cd encurtador-0.1.1
bash scripts/iniciar.sh
```

Quando o terminal mostrar **Instalação pronta**, abra <http://localhost:8080>, cole um destino e clique em **Encurtar**. Abra o endereço curto para conferir o redirecionamento. Guarde o diretório de instalação em um local persistente.

O iniciador obtém as imagens automaticamente. Se preferir baixá-las antes da instalação, execute os dois comandos no host que vai rodar o serviço.

```sh
docker pull mh131105/encurtador-de-urls:0.1.0
docker pull mh131105/encurtador-de-urls-web:0.1.1
```

### Atualizar o formulário da versão 0.1.0

Para uma instalação feita com as imagens do Docker Hub, abra o `.env` na pasta original e altere a linha da interface para `NGINX_IMAGE=mh131105/encurtador-de-urls-web:0.1.1`. Na mesma pasta, execute os comandos abaixo.

```sh
docker compose pull nginx
docker compose up -d --no-deps nginx
```

Recarregue a página para ver a logo do XISPA. A imagem da API desta distribuição continua na versão 0.1.0. Os links já emitidos usam a origem e os dados da instalação existente.

## Compilar do código-fonte

Instale também o Git. Os compiladores e as dependências JavaScript rodam dentro das imagens de build.

```sh
git clone https://github.com/mh131105/encurtador-de-urls.git
cd encurtador-de-urls
bash scripts/iniciar.sh --build
```

O iniciador salva o modo usado na primeira instalação. Nas próximas execuções, repita o comando da mesma seção.

## Escolher a porta e o endereço dos links

Por padrão, o NGINX atende em `127.0.0.1:8080` e os endereços curtos começam com `http://localhost:8080`. Para usar outra porta, escolha-a na primeira execução.

```sh
HTTP_PORT=8091 bash scripts/iniciar.sh
```

Abra <http://localhost:8091>. A origem que entra nos links acompanha a porta. `HTTP_BIND` configura o endereço de escuta no host. `COMPOSE_PROJECT_NAME` dá um nome próprio aos contêineres e volumes, útil para manter duas instalações independentes. Use um diretório, uma porta e um projeto diferente para cada uma.

### Reproduzir o endereço mostrado no vídeo

Em uma instalação nova, você pode usar `xispa.test` na sua máquina. No arquivo de hosts local, associe `127.0.0.1` a `xispa.test`. Se a porta 80 estiver livre e disponível para o Docker, inicie o encurtador na pasta da instalação.

```sh
HTTP_PORT=80 PUBLIC_ORIGIN=http://xispa.test bash scripts/iniciar.sh
```

Abra `http://xispa.test` e crie um link. Se preferir a porta 8080, use `PUBLIC_ORIGIN=http://xispa.test:8080 bash scripts/iniciar.sh` e abra esse endereço com a porta. A resolução desse nome vale para a máquina configurada.

### Compartilhar fora da própria máquina

Ao abrir um endereço que começa com `localhost`, cada pessoa aponta o navegador para o próprio computador. Para compartilhar no seu domínio, crie um registro DNS para o host e configure um proxy HTTPS com certificado válido. No mesmo host, o proxy pode encaminhar as requisições para `http://127.0.0.1:8080`. Encaminhe a página, os arquivos em `/assets/`, as rotas da API e os códigos ao NGINX da distribuição. A API permanece privada.

Defina a origem pública definitiva **antes de criar os primeiros links**. O comando abaixo configura o encurtador para o domínio de exemplo. A publicação do DNS, o certificado e o proxy ficam sob responsabilidade de quem opera o domínio.

```sh
PUBLIC_ORIGIN=https://curto.example.org bash scripts/iniciar.sh
```

Nesse caso a interface e os links são acessados em `https://curto.example.org`. Para um proxy em outro host, escolha em `HTTP_BIND` o IP privado da máquina do encurtador e limite a porta desse IP ao proxy. A exposição de uma instalação compartilhada também requer pré-voo de memória e backup. [Medição prévia](https://github.com/mh131105/encurtador-de-urls/blob/main/deploy/demo/preflight.md) · [Backup e restauração](https://github.com/mh131105/encurtador-de-urls/blob/main/deploy/ha/recuperacao.md)

## Parar e retomar

No diretório original, os comandos abaixo usam o projeto e os perfis salvos em `.env`.

```sh
docker compose stop
docker compose start
docker compose ps
```

Aguarde o Cassandra aceitar consultas depois da partida. Você também pode repetir `bash scripts/iniciar.sh` (ou `bash scripts/iniciar.sh --build`) para conferir a marca de emissão, a autorização do banco, a prontidão da API e a página inicial. Abra um link criado antes da parada para verificar a continuidade.

Conserve `.env` (origem, porta, projeto e imagens), `api.env` (chave da instalação), o diretório `state/` (identificação e marca de emissão) e o volume Cassandra. O volume Redis guarda o cache e pode ser reconstruído. A opção `docker compose down -v` remove os volumes, inclusive o banco dos links. Para uma cópia recuperável, preserve a marca em armazenamento durável separado da restauração do Cassandra e siga o procedimento de backup antes de mover o serviço. [Recuperação](https://github.com/mh131105/encurtador-de-urls/blob/main/deploy/ha/recuperacao.md)

## Se a instalação parar

- **A porta está ocupada.** Antes da primeira execução, escolha outra `HTTP_PORT`. Se o iniciador já salvou a configuração, libere a porta e repita o mesmo comando. Ele reutiliza a chave e a marca.
- **O Cassandra ou a API ainda não estão prontos.** Consulte `docker compose ps -a` e `docker compose logs --tail=60 cassandra api nginx`. Depois de corrigir a causa, repita o iniciador na mesma pasta. Evite publicar o conteúdo de `api.env`.
- **Já existe uma instalação ou faltam a chave, o volume Cassandra ou a marca.** Mantenha o diretório e seus volumes íntegros. Para uma instalação anterior criada manualmente, retome com o projeto, os arquivos e os comandos originais. Se houve perda de dados, consulte o [procedimento de recuperação](https://github.com/mh131105/encurtador-de-urls/blob/main/deploy/ha/recuperacao.md) antes de autorizar novas criações.
- **Uma execução foi interrompida.** Se `state/.iniciando` permanecer, confirme que nenhum iniciador continua rodando naquele diretório. Só então use `rmdir state/.iniciando` e repita o comando. A trava e o marcador administrativos dentro de `state/emission/` pertencem ao mecanismo de recuperação.
