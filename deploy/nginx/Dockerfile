FROM node:24.22.3-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS web
WORKDIR /build
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM nginx:1.28.0-alpine@sha256:30f1c0d78e0ad60901648be663a710bdadf19e4c10ac6782c235200619158284
COPY --from=web /build/dist/ /srv/encurtador/
COPY deploy/nginx/nginx.conf /etc/nginx/nginx.conf
COPY deploy/nginx/rotas.conf /etc/nginx/encurtador-rotas.conf
