# Desenvolver e testar

A API está em `src/` e a página React em `web/`. O repositório usa Node.js 24.22.3 e npm. Os arquivos de instalação e operação ficam em `deploy/`. [Instalação a partir do código](README.md#clonar-e-compilar-o-projeto) · [Arquitetura](docs/arquitetura.md)

## Trabalhar na interface

Inicie a pilha pelo [guia de instalação](docs/instalacao.md). Em outro terminal, na raiz do clone, instale as dependências da página e inicie o Vite.

```sh
npm --prefix web ci
API_ORIGIN=http://127.0.0.1:8080 npm --prefix web run dev
```

Abra o endereço que o Vite imprimir. As alterações em `web/src/` aparecem ao salvar os arquivos. O formulário usa a API da instalação local e os links criados abrem na origem configurada nela. A interface usa os componentes e o tema do Astryx. Para consultar um componente, execute `npm --prefix web run astryx -- component Button`. [Astryx](https://github.com/meta/astryx)

## Verificar uma alteração

A suíte de integração requer Docker Compose, Bash, Python 3 e um navegador. Execute estes comandos na raiz do clone.

```sh
npm --prefix web ci
./web/node_modules/.bin/playwright install --with-deps chromium
bash tests/ops/ci.sh
```

No macOS com Google Chrome instalado, é possível usar `PLAYWRIGHT_CHANNEL=chrome bash tests/ops/ci.sh` depois de `npm --prefix web ci`. A suíte cria seu próprio projeto Compose, exercita a API, os bancos, o NGINX e o navegador, e remove os recursos de teste ao terminar. O GitHub Actions roda a mesma suíte nos pushes e pull requests. [Workflow de integração](.github/workflows/ci.yml)

Para conferir apenas a compilação da API, use `npm ci` e `npm run build` na raiz. Para a página, use `npm --prefix web ci` e `npm --prefix web run build`. Em um pull request, descreva qual comportamento mudou e como foi verificado.
