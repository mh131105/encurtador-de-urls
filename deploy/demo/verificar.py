"""Cria, consulta e confere um vínculo na entrada NGINX, sem seguir o 302."""
import http.client
import ipaddress
import json
import os
import re
import subprocess
import sys
import urllib.parse


JSON_LIMIT = 1024 * 1024
HEADER_LIMIT = 3 * JSON_LIMIT + 4096  # Mesmo orçamento do proxy da distribuição.
http.client._MAXLINE = HEADER_LIMIT


class HeaderReader:
    def __init__(self, stream):
        self.stream = stream
        self.remaining = HEADER_LIMIT

    def readline(self, size):
        line = self.stream.readline(min(size, self.remaining + 1))
        self.remaining -= len(line)
        if self.remaining < 0:
            raise SystemExit("Cabeçalhos da resposta excedem o limite da distribuição")
        return line


class VerificationResponse(http.client.HTTPResponse):
    def begin(self):
        # O parser HTTP continua responsável por status, cabeçalhos e framing do corpo.
        stream = self.fp
        self.fp = HeaderReader(stream)
        try:
            super().begin()
        finally:
            self.fp = stream


def request(origin, method, path, body=None):
    url = urllib.parse.urlsplit(origin)
    connections = {"http": http.client.HTTPConnection, "https": http.client.HTTPSConnection}
    if url.scheme not in connections:
        raise ValueError("Informe uma origem HTTP ou HTTPS")
    client = connections[url.scheme](url.netloc, timeout=8)
    client.response_class = VerificationResponse
    data = None if body is None else json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    try:
        client.request(method, path, body=data,
                       headers={"Content-Type": "application/json"})
        reply = client.getresponse()
        with reply:
            payload = reply.read(JSON_LIMIT + 1) if reply.status == 201 else b""
            if len(payload) > JSON_LIMIT:
                raise SystemExit("Corpo da resposta de criação excede 1 MiB")
            return reply.status, reply.headers, payload
    finally:
        client.close()


def whatwg_host(host, setting):
    ascii_host = os.environ.get(setting)
    if ascii_host is None:
        # O codec idna da biblioteca padrão de Python converte ß em ss; a API usa WHATWG.
        script = "process.stdout.write(require('node:url').domainToASCII(require('node:fs').readFileSync(0, 'utf8')))"
        try:
            ascii_host = subprocess.run(["node", "-e", script], input=host, text=True,
                                        stdout=subprocess.PIPE, check=True).stdout
        except FileNotFoundError:
            raise SystemExit(f"Host internacional: informe {setting} ou disponibilize Node.js")
    if not ascii_host or not ascii_host.isascii() or re.search(r"[\s:/?#@\\]", ascii_host):
        raise SystemExit("Nome ASCII esperado para o host internacional inválido")
    return ascii_host


def canonical_origin(origin):
    if not re.fullmatch(r"https?://[^/?#@\s\\]+/?", origin, re.I):
        raise SystemExit("Origem pública inválida")
    try:
        url = urllib.parse.urlsplit(origin)
        host = url.hostname
        port = url.port
        if not host or port == 0:
            raise ValueError()
        if ":" in host:
            if "%" in host:
                raise ValueError()
            host = "[" + ipaddress.IPv6Address(host).compressed + "]"
        elif (not host.isascii() or "%" in host or
              re.search(r"(?:^|\.)(?:[0-9]+|0x[0-9a-f]*)\.?$", host, re.I)):
            try:
                host = str(ipaddress.IPv4Address(host))
            except ValueError:
                host = whatwg_host(host, "VERIFICAR_ORIGEM_HOST_ASCII")
        suffix = "" if port in (None, {"http": 80, "https": 443}[url.scheme]) else f":{port}"
        return f"{url.scheme}://{host}{suffix}"
    except ValueError:
        raise SystemExit("Origem pública inválida") from None


def location_for(destination):
    if destination.isascii():
        return destination
    # Capture só o host: a porta, as credenciais e a grafia do restante pertencem ao vínculo.
    host = re.match(r"^https?://(?:[^/?#]*@)?(?P<host>\[[^\]]+\]|[^:/?#]+)", destination, re.I)
    if host and not host["host"].isascii() and "%" not in host["host"]:
        ascii_host = whatwg_host(host["host"], "VERIFICAR_HOST_ASCII")
        start, end = host.span("host")
        destination = destination[:start] + ascii_host + destination[end:]
    return re.sub(r"[^\x00-\x7f]+", lambda part: urllib.parse.quote(part[0]), destination)


def verify(origin, destination, short=None, only_method=None):
    origin = canonical_origin(origin)
    expected = location_for(destination)
    if short is None:
        status, _, reply = request(origin, "POST", "/api/v1/encurtar", {"url": destination})
        if status != 201:
            sys.exit(f"A criação retornou HTTP {status}, esperado 201")
        short = json.loads(reply)["short_url"]
    match = re.fullmatch(re.escape(origin) + r"/([A-Za-z0-9]{7})", short)
    if not match:
        raise SystemExit("Link fora da origem ou do formato esperado")
    code = match[1]
    for method, path, body in [
        ("GET", "/" + code, None),
        ("POST", "/api/v1/redirecionar", {"short_url": short}),
    ]:
        if only_method and method != only_method:
            continue
        status, headers, _ = request(origin, method, path, body)
        if (status, headers.get("Location"), headers.get("Cache-Control")) != (302, expected, "no-store"):
            raise SystemExit(f"{method} retornou HTTP {status} com status ou cabeçalhos divergentes do esperado")
    return short


if __name__ == "__main__":
    origin, destination, *saved = sys.argv[1:]
    if len(saved) > 2 or (len(saved) == 2 and saved[1] not in ("GET", "POST")):
        sys.exit("Uso: verificar.py origem destino [link_curto [GET|POST]]")
    if destination == "-":
        data = sys.stdin.buffer.read(JSON_LIMIT + 1)
        if len(data) > JSON_LIMIT:
            sys.exit("O destino em stdin excede 1 MiB")
        try:
            destination = data.decode("utf-8")
        except UnicodeDecodeError:
            sys.exit("O destino em stdin precisa estar em UTF-8")
    print(verify(origin, destination, *saved))
