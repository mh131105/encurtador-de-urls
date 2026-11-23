"""Exercita verificar.py pela CLI contra uma entrada HTTP de respostas controladas."""
import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
import ssl
import subprocess
import tempfile
import sys
from threading import Thread
import unittest

SCRIPT = Path(__file__).resolve().parents[2] / 'deploy/demo/verificar.py'
LITERAL = 'https://loja.example/café%2Fpedido?q=mão%2b#índice'
LOCATION = 'https://loja.example/caf%C3%A9%2Fpedido?q=m%C3%A3o%2b#%C3%ADndice'
ASCII = 'HTTPS://LOJA.example:443/a/../c%2Fa?q=1%2b#F%2fB'


class Verificador(unittest.TestCase):
    def setUp(self):
        self.requests = []
        self.body_sizes = []
        self.location = LOCATION
        self.creation_status = 201
        self.redirect_status = 302
        self.cache_control = 'no-store'
        case = self

        class Entry(BaseHTTPRequestHandler):
            def do_GET(self):
                case.requests.append(('GET', self.path, None))
                self.redirect()

            def do_POST(self):
                raw = self.rfile.read(int(self.headers['Content-Length']))
                case.body_sizes.append(len(raw))
                body = json.loads(raw)
                case.requests.append(('POST', self.path, body))
                if self.path == '/api/v1/encurtar':
                    reply = json.dumps({'short_url': case.short}).encode()
                    self.send_response(case.creation_status)
                    self.send_header('Content-Length', str(len(reply)))
                    self.end_headers()
                    self.wfile.write(reply)
                else:
                    self.redirect()

            def redirect(self):
                self.send_response(case.redirect_status)
                self.send_header('Location', case.location)
                self.send_header('Cache-Control', case.cache_control)
                self.end_headers()

            def log_message(self, *args):
                pass

        server = self.server = HTTPServer(('127.0.0.1', 0), Entry)
        self.origin = f'http://127.0.0.1:{server.server_port}'
        self.short = self.origin + '/abc0123'
        thread = Thread(target=server.serve_forever, kwargs={'poll_interval': 0.02})
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(thread.join)
        self.addCleanup(server.shutdown)

    def run_cli(self, dest, *args, stdin=None, **environment):
        env = {**os.environ, **environment}
        if 'VERIFICAR_HOST_ASCII' not in environment:
            env.pop('VERIFICAR_HOST_ASCII', None)
        return subprocess.run([sys.executable, str(SCRIPT), self.origin, dest, *args],
                              input=stdin, text=True, capture_output=True, env=env, timeout=10)

    def test_acento_na_criacao_e_nas_duas_rotas_sem_node(self):
        run = self.run_cli(LITERAL, PATH='')
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertEqual(run.stdout.strip(), self.short)
        self.assertEqual(self.requests, [('POST', '/api/v1/encurtar', {'url': LITERAL}),
                                        ('GET', '/abc0123', None), ('POST', '/api/v1/redirecionar', {'short_url': self.short})])

    def test_fragmento_divergente_em_cada_rota(self):
        self.location = LOCATION.replace('#%C3%ADndice', '#errado')
        for method in ['GET', 'POST']:
            run = self.run_cli(LITERAL, self.short, method, PYTHONOPTIMIZE='1')
            self.assertNotEqual(run.returncode, 0)
            self.assertEqual(self.requests[-1][0], method)
            self.assertEqual(run.stdout, '')

    def test_unicode_com_escape_no_host_e_no_caminho(self):
        literal = 'https://例%65.テスト/東京%2F?q=%2b#🧭'
        self.location = 'https://%E4%BE%8B%65.%E3%83%86%E3%82%B9%E3%83%88/%E6%9D%B1%E4%BA%AC%2F?q=%2b#%F0%9F%A7%AD'
        run = self.run_cli(literal, self.short, PATH='')
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertEqual([method for method, _, _ in self.requests], ['GET', 'POST'])

    def test_localizacao_de_60025_e_66025_bytes(self):
        for count in [10000, 11000]:
            literal = 'https://loja.example/' + 'é' * count + '#fim'
            expected = 'https://loja.example/' + '%C3%A9' * count + '#fim'
            self.assertEqual(len(expected), 25 + count * 6)
            for method in ['GET', 'POST']:
                with self.subTest(count=count, method=method):
                    self.requests.clear()
                    self.location = expected
                    run = self.run_cli(literal, self.short, method)
                    self.assertEqual(run.returncode, 0, run.stderr)
                    route = (('GET', '/abc0123', None) if method == 'GET' else
                             ('POST', '/api/v1/redirecionar', {'short_url': self.short}))
                    self.assertEqual(self.requests, [route])
                    self.location = expected[:-1] + 'x'
                    wrong = self.run_cli(literal, self.short, method)
                    self.assertNotEqual(wrong.returncode, 0)
                    self.assertIn(f'{method} retornou HTTP 302', wrong.stderr)
                    self.assertEqual(self.requests, [route, route])

    def test_stdin_json_de_um_mib_e_cabecalho_de_tres_mib(self):
        prefix = 'https://loja.example/a%2Fb?pedido='
        suffix = '&cor=caf%C3%A9#se%C3%A7%C3%A3o'
        remaining = 1024 * 1024 - len('{"url":""}') - len(prefix) - len(suffix)
        literal = prefix + 'é' * (remaining // 2) + 'a' * (remaining % 2) + suffix
        self.location = literal.replace('é', '%C3%A9')
        self.assertEqual(len(self.location), 3145570)
        run = self.run_cli('-', stdin=literal)
        self.assertEqual(run.returncode, 0, run.stderr)
        self.assertEqual(self.body_sizes[0], 1024 * 1024)
        self.assertEqual(self.requests[0][2]['url'], literal)
        self.assertEqual([row[0] for row in self.requests], ['POST', 'GET', 'POST'])
        self.location = self.location[:-1] + 'x'
        for method in ['GET', 'POST']:
            run = self.run_cli('-', self.short, method, stdin=literal)
            self.assertNotEqual(run.returncode, 0)
        self.cache_control = 'a' * 5000
        run = self.run_cli('-', self.short, 'GET', stdin=literal)
        self.assertNotEqual(run.returncode, 0)
        self.assertIn('Cabeçalhos da resposta excedem', run.stderr)

    def test_https_com_origem_canonica_e_porta_padrao(self):
        with tempfile.TemporaryDirectory() as directory:
            setup = Path(directory)
            cert, key = setup / 'cert.pem', setup / 'key.pem'
            subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
                            '-keyout', str(key), '-out', str(cert), '-subj', '/CN=s.example',
                            '-addext', 'subjectAltName=DNS:s.example,DNS:xn--fa-hia.example,IP:::1'], check=True, capture_output=True)
            tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            tls.load_cert_chain(cert, key)
            # O nome e o certificado estão corretos; só o socket de teste é encaminhado ao loopback.
            self.server.socket = tls.wrap_socket(self.server.socket, server_side=True)
            port = self.server.server_port
            (setup / 'sitecustomize.py').write_text(
                'import socket\noriginal = socket.getaddrinfo\n'
                'def local(host, port, *args, **kwargs):\n'
                f'    if host in ("s.example", "xn--fa-hia.example", "::1", "sem-cert.example") and port == 443: return original("127.0.0.1", {port}, *args, **kwargs)\n'
                '    raise OSError("Destino inesperado na prova de TLS")\n'
                'socket.getaddrinfo = local\n')
            env = {'PYTHONPATH': str(setup), 'SSL_CERT_FILE': str(cert)}
            for self.origin, host in [('https://S.Example:443', 's.example'), ('https://S.Example:443/', 's.example'),
                                      ('https://faß.example:443/', 'xn--fa-hia.example'),
                                      ('https://[0:0:0:0:0:0:0:1]:443/', '[::1]')]:
                self.short = f'https://{host}/Abc1234'
                self.requests.clear()
                run = self.run_cli(LITERAL, **env)
                self.assertEqual(run.returncode, 0, run.stderr)
                self.assertEqual(run.stdout.strip(), self.short)
                self.assertEqual(self.requests, [('POST', '/api/v1/encurtar', {'url': LITERAL}),
                    ('GET', '/Abc1234', None), ('POST', '/api/v1/redirecionar', {'short_url': self.short})])
            self.origin = 'https://sem-cert.example'
            self.requests.clear()
            self.assertNotEqual(self.run_cli(LITERAL, **env).returncode, 0)
            self.assertEqual(self.requests, [])
            self.origin = 'https://usu:senha-do-controle@s.example'
            run = self.run_cli(LITERAL, **env)
            self.assertNotEqual(run.returncode, 0)
            self.assertNotIn('senha-do-controle', run.stderr)
            self.assertEqual(self.requests, [])
            self.origin = 'https://S.Example:443/'
            for short in ['https://outra.example/Abc1234', 'https://s.example:444/Abc1234',
                          'http://s.example/Abc1234', 'https://s.example/p/../Abc1234',
                          'https://s.example/%41bc1234', 'https://s.example/Abc1234#fim']:
                self.requests.clear()
                with self.subTest(short=short):
                    self.short = short
                    wrong = self.run_cli(LITERAL, **env)
                    self.assertNotEqual(wrong.returncode, 0)
                    self.assertIn('Link fora da origem ou do formato esperado', wrong.stderr)
                    self.assertEqual(self.requests, [('POST', '/api/v1/encurtar', {'url': LITERAL})])

    def test_ascii_compara_todos_os_bytes(self):
        self.location = ASCII
        self.assertEqual(self.run_cli(ASCII, self.short, PATH='').returncode, 0)
        self.location = ASCII.replace('%2b', '%2B')
        self.assertNotEqual(self.run_cli(ASCII, self.short).returncode, 0)

    def test_host_sem_conversao_falha_antes_da_criacao(self):
        run = self.run_cli('https://faß.example/café', PATH='')
        self.assertNotEqual(run.returncode, 0)
        self.assertIn('VERIFICAR_HOST_ASCII', run.stderr)
        self.assertEqual(self.requests, [])

    def test_status_origem_e_cache_control_divergentes_com_otimizacao(self):
        env = {'PYTHONOPTIMIZE': '1'}
        self.creation_status = 200
        self.assertNotEqual(self.run_cli(LITERAL, **env).returncode, 0)
        self.assertNotEqual(self.run_cli(LITERAL, 'https://outra.example/abc0123', **env).returncode, 0)
        self.assertEqual(len(self.requests), 1)
        self.redirect_status = 301
        self.assertNotEqual(self.run_cli(LITERAL, self.short, 'GET', **env).returncode, 0)
        self.redirect_status = 302
        self.cache_control = 'public'
        self.assertNotEqual(self.run_cli(LITERAL, self.short, 'POST', **env).returncode, 0)

    def test_host_whatwg_e_controle_sem_node(self):
        literal = 'HTTPS://usuário:clé@faß.example:443/a/../café%2f#índice'
        self.location = 'HTTPS://usu%C3%A1rio:cl%C3%A9@xn--fa-hia.example:443/a/../caf%C3%A9%2f#%C3%ADndice'
        for env in [{}, {'PATH': '', 'VERIFICAR_HOST_ASCII': 'xn--fa-hia.example'}]:
            with self.subTest(env=env):
                run = self.run_cli(literal, self.short, **env)
                self.assertEqual(run.returncode, 0, run.stderr)
        self.location = self.location.replace('xn--fa-hia.example', 'fass.example')
        for method in ['GET', 'POST']:
            self.assertNotEqual(self.run_cli(literal, self.short, method).returncode, 0)
        missing = self.run_cli(literal, self.short, PATH='')
        self.assertNotEqual(missing.returncode, 0)
        self.assertIn('VERIFICAR_HOST_ASCII', missing.stderr)


if __name__ == '__main__':
    unittest.main()
