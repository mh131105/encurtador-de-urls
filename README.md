# <img src="web/src/assets/xispa.svg" alt="XISPA" width="300">

[**Ver a demonstração**](#demonstração) · [Instalar](#instalar) · [Arquitetura](docs/arquitetura.md) · [Docker Hub](https://hub.docker.com/r/mh131105/encurtador-de-urls)

O XISPA é um encurtador de URLs que você pode hospedar no seu próprio domínio. Cole um endereço na página e compartilhe o link gerado. Ele usa um código de sete caracteres e leva ao destino original, inclusive à seção indicada depois de `#`. Qualquer pessoa pode criar ou abrir um link sem cadastro.

O projeto também serve para estudar sistemas distribuídos. A mesma aplicação pode rodar em uma máquina com Docker ou usar várias réplicas da API e distribuir os dados entre nós do Apache Cassandra.

## Demonstração

O vídeo de 26 segundos mostra o formulário criando o link `xispa.test/aSPUXMZ`. Ao abri-lo, o navegador chega à página inicial do Google. O domínio foi configurado só para a demonstração local.

https://github.com/user-attachments/assets/ff9dd577-704b-40ae-8df5-d19741b0fd76

[Baixar o vídeo (MP4)](https://github.com/mh131105/encurtador-de-urls/releases/download/v0.1.3/demonstracao.mp4) · [Abrir o Google](https://www.google.com/)

## Instalar

Você precisa do Docker com o Compose 2.24.0 ou mais recente. Os comandos abaixo são para um terminal de Linux ou macOS. No Windows, use o terminal do WSL com a integração do Docker Desktop habilitada. O guia explica os pré-requisitos, a troca da porta e a configuração de um domínio. [Guia de instalação](docs/instalacao.md)

### Usar as imagens prontas do Docker Hub

Este caminho dispensa Git, Node.js e compilação. Baixe o pacote da versão 0.1.3 e inicie o serviço na sua máquina.

```sh
curl -fLO https://github.com/mh131105/encurtador-de-urls/releases/download/v0.1.3/encurtador-0.1.3.tar.gz
tar -xzf encurtador-0.1.3.tar.gz
cd encurtador-0.1.3
bash scripts/iniciar.sh
```

O pacote contém a configuração. O Docker baixa as imagens da API e da página, além do Cassandra e do Redis. [API no Docker Hub](https://hub.docker.com/r/mh131105/encurtador-de-urls) · [Página no Docker Hub](https://hub.docker.com/r/mh131105/encurtador-de-urls-web)

### Clonar e compilar o projeto

Use este caminho para examinar ou modificar o código. O Docker compila a API e a página a partir dos arquivos do clone.

```sh
git clone https://github.com/mh131105/encurtador-de-urls.git
cd encurtador-de-urls
bash scripts/iniciar.sh --build
```

## Usar o encurtador

1. Abra [localhost:8080](http://localhost:8080/) no computador em que instalou o serviço.
2. Cole o endereço completo em **URL de destino** e clique em **Encurtar**.
3. Clique no link gerado para abrir o destino ou em **Copiar** para guardá-lo.

Um link que começa com `localhost` funciona no computador da instalação. Para compartilhá-lo com outras pessoas, configure o domínio e o HTTPS antes de criar os links que pretende distribuir. Eles usam o endereço definido em `PUBLIC_ORIGIN`. [Instalação e domínio próprio](docs/instalacao.md)

Para parar e retomar o serviço, use `docker compose stop` e `docker compose start` na mesma pasta. Os links dependem dos volumes de dados, da chave em `api.env` e do diretório `state/emission/`. [Backup e recuperação](deploy/ha/recuperacao.md)

### Criar um link pela API

```sh
curl -i http://localhost:8080/api/v1/encurtar \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://www.google.com/"}'
```

O serviço responde `201 Created` com o endereço em `short_url`. Abra esse endereço com o navegador ou consulte-o com `curl -i` para ver o `302` e o destino em `Location`. A rota `POST /api/v1/redirecionar` também aceita o JSON com `short_url` e devolve o mesmo redirecionamento. Um link desconhecido ou vencido recebe `404`.

## Como funciona

O Cassandra confirma a gravação antes de a API entregar o link. O vínculo é imutável e vence após dez anos civis. O Redis acelera as consultas repetidas. Se ele ficar indisponível, a API busca o destino no Cassandra.

O guia de arquitetura explica como as réplicas emitem códigos distintos, como o banco distribui os vínculos e quais falhas cada topologia tolera. A instalação local e a recuperação de dados foram exercitadas. A vazão de produção e a tolerância à perda de um host ainda dependem de ensaios em infraestrutura independente. [Arquitetura](docs/arquitetura.md) · [Topologia distribuída](deploy/ha/topologia.md) · [Medições da instalação local](deploy/demo/qualificacao.md)

## licença

[Licença Apache-2.0](LICENSE)
