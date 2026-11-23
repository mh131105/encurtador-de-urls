import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { once } from 'node:events';

// npm run test:browser -- http://127.0.0.1:8080 [--real]
const { origin, hostname, protocol } = new URL(process.argv[2] ?? 'http://127.0.0.1:5173');
const real = process.argv.includes('--real');
const absentCode = process.env.BROWSER_ABSENT_CODE;
if (real && !/^[0-9A-Za-z]{7}$/.test(absentCode ?? '')) {
  throw new Error('Informe em BROWSER_ABSENT_CODE um código Base62 de sete caracteres cuja ausência foi verificada no Cassandra.');
}
const internationalPath = '/café%2F東京?q=mão%2b茶&nome=caf%C3%A9#índice🌍';
const expectedTarget = '/caf%C3%A9%2F%E6%9D%B1%E4%BA%AC?q=m%C3%A3o%2b%E8%8C%B6&nome=caf%C3%A9#%C3%ADndice%F0%9F%8C%8D';
const creationURL = `${origin}/api/v1/encurtar`;
// No ensaio controlado, o navegador resolve o domínio do laboratório sem alterar o DNS do host.
const labDomain = hostname === 'encurtador.test' && !real;
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL,
  args: labDomain ? ['--host-resolver-rules=MAP encurtador.test 127.0.0.1', '--no-proxy-server'] : [],
});
const landing = createServer((req, res) => {
  if (req.method !== 'GET' || req.url !== expectedTarget.split('#')[0]) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Destino do ensaio');
});
try {
  let destination = 'https://loja.example' + internationalPath;
  if (real) {
    landing.listen(0, '127.0.0.1');
    await once(landing, 'listening');
    destination = `http://127.0.0.1:${landing.address().port}${internationalPath}`;
  }
  const context = await browser.newContext({ viewport: { width: 360, height: 780 }, locale: 'pt-BR' });
  const page = await context.newPage();
  const input = page.getByRole('textbox', { name: /URL de destino/i });
  const submit = page.getByRole('button', { name: 'Encurtar', exact: true });
  const copy = page.getByRole('button', { name: 'Copiar', exact: true });
  const requests = [];
  page.on('request', request => {
    if (request.url() === creationURL && request.method() === 'POST') requests.push(request);
  });

  const home = await page.goto(origin);
  assert.equal(home?.status(), 200);
  assert.match(await home.headerValue('content-type'), /text\/html/i);
  assert.equal(await page.title(), 'XISPA · Encurtador de URLs');
  const heading = page.getByRole('heading', {level: 1, name: 'XISPA Encurtador de URLs', exact: true});
  const logo = heading.getByRole('img', {name: 'XISPA', exact: true});
  await logo.waitFor();
  await logo.evaluate(image => image.decode());
  await page.setViewportSize({width: 280, height: 640});
  assert.ok(await logo.evaluate(mark => {
    const ink = mark.getBoundingClientRect();
    const heading = mark.closest('h1').getBoundingClientRect();
    return ink.width > 0 && ink.height > 0 &&
      ink.left >= heading.left - 1 && ink.right <= heading.right + 1;
  }));
  await page.setViewportSize({width: 360, height: 780});
  await input.waitFor();
  assert.equal(await copy.count(), 0);
  await page.keyboard.press('Tab');
  assert.ok(await input.evaluate(el => el === document.activeElement));
  await page.keyboard.press('Tab');
  assert.ok(await submit.evaluate(el => {
    const style = getComputedStyle(el);
    return el === document.activeElement && el.matches(':focus-visible') &&
      (parseFloat(style.outlineWidth) > 0 || style.boxShadow !== 'none');
  }));
  const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  assert.ok(await fits());

  const invalidURL = 'ftp://destino.example';
  await input.fill(invalidURL);
  function recordAnnouncements(role, expectedText) {
    return page.evaluateHandle(({role, expectedText}) => {
      const regions = () => document.querySelectorAll(`[role="${role}"]`);
      const lastText = new WeakMap(Array.from(regions(), region => [region, region.textContent.trim()]));
      const messages = [];
      const observer = new MutationObserver(() => {
        for (const region of regions()) {
          const text = region.textContent.trim();
          if (text && text !== lastText.get(region) && (!expectedText || text === expectedText)) {
            messages.push({region, text});
          }
          lastText.set(region, text);
        }
      });
      observer.observe(document.body, {childList: true, characterData: true, subtree: true});
      return {messages, observer};
    }, {role, expectedText});
  }
  const recorder = await recordAnnouncements('alert');
  for (const attempt of [1, 2]) {
    assert.ok(await input.evaluate(el => el === document.activeElement));
    await page.keyboard.press('Enter');
    await page.waitForFunction(({recorder, attempt}) => recorder.messages.length >= attempt,
      {recorder, attempt}, {timeout: 4000}).catch(cause => {
        throw new Error(`Faltou o anúncio de erro da tentativa ${attempt}`, {cause});
      });
    const announcement = await recorder.evaluateHandle((rec, index) => rec.messages[index], attempt - 1);
    const text = await announcement.evaluate(message => message.text);
    assert.match(text, /URL.*https?/i);
    // getByRole exclui regiões ocultas da árvore de acessibilidade.
    const alert = page.getByRole('alert').filter({hasText: text});
    assert.ok(await alert.evaluate((el, message) => el === message.region && el.getAttribute('aria-live') !== 'off', announcement));
    assert.ok(await input.evaluate(el => el === document.activeElement && el.getAttribute('aria-invalid') === 'true'));
    assert.equal(await input.inputValue(), invalidURL);
    assert.equal(requests.length, 0);
    // O Astryx limpa a região persistente quando o anúncio termina.
    await alert.waitFor({state: 'detached', timeout: 5000});
    assert.equal(await recorder.evaluate(rec => rec.messages.length), attempt);
    await announcement.dispose();
  }
  await recorder.evaluate(rec => rec.observer.disconnect());
  await recorder.dispose();
  const error = await input.evaluate(el => {
    const ids = [el.getAttribute('aria-errormessage'), el.getAttribute('aria-describedby')];
    return ids.filter(Boolean).join(' ').split(/\s+/)
      .map(id => document.getElementById(id)?.textContent).join(' ');
  });
  assert.match(error, /URL|http/i);
  assert.equal(requests.length, 0);
  console.log('OK · celular e teclado, dois anúncios para a mesma URL inválida, foco e valor preservados, zero POSTs');
  await input.fill(destination);

  async function failedAttempt(status, message) {
    const count = requests.length;
    await page.route(creationURL, route => status === 'offline'
      ? route.abort('failed')
      : route.fulfill({ status, json: {} }), { times: 1 });
    await input.press('Enter');
    if (status === 400) {
      await page.waitForFunction(() => document.querySelector('input[aria-invalid="true"]'));
      assert.match(await page.locator('body').innerText(), message);
    } else {
      await page.getByRole('alert').filter({ hasText: message }).first().waitFor();
    }
    assert.equal(requests.length, count + 1);
    assert.equal(await input.inputValue(), destination);
    assert.equal(await copy.count(), 0);
  }
  if (!real) {
    await failedAttempt(400, /recusou esta URL/i);
    await failedAttempt(503, /indisponível/i);
  }
  // Apenas esta tentativa é interrompida. No modo real, a próxima chega ao NGINX.
  await failedAttempt('offline', /conexão|rede/i);
  console.log('OK · falha e recuperação preservam a URL digitada');

  if (real) {
    const prefix = 'https://loja.example/';
    const bodyBytes = 1024 * 1024 + 1;
    const tooLong = prefix + 'a'.repeat(bodyBytes - Buffer.byteLength(JSON.stringify({ url: prefix })));
    await input.fill(tooLong);
    await submit.focus();
    const [rejected] = await Promise.all([
      page.waitForResponse(r => r.url() === creationURL && r.request().method() === 'POST'),
      page.keyboard.press('Enter'),
    ]);
    assert.equal(rejected.status(), 400);
    assert.equal(await rejected.headerValue('location'), null);
    assert.equal(Number(await rejected.request().headerValue('content-length')), bodyBytes);
    await page.waitForFunction(() => document.querySelector('input[aria-invalid="true"]'));
    await page.getByText(/O serviço recusou esta URL/).first().waitFor();
    assert.ok(await input.evaluate(el => el === document.activeElement));
    assert.ok((await input.inputValue()) === tooLong);
    await input.fill(destination);
    console.log('OK · POST de 1 MiB + 1 recebeu 400, com URL preservada e foco no campo');
  }

  const requestsBeforeCreation = requests.length;
  const { promise: pending, resolve: resume } = Promise.withResolvers();
  // Mantém o POST pendente para tentar o segundo envio. Em modo real, o navegador
  // continua o pedido original pelo NGINX e recebe a resposta da API sem alterações.
  const fixture = `${origin}/k7Q2aZ9`;
  await page.route(creationURL, async route => {
    await pending;
    if (real) await route.continue();
    else await route.fulfill({ status: 201, json: { short_url: fixture } });
  });
  const responsePromise = page.waitForResponse(r => r.url() === creationURL);
  await input.press('Enter');
  await page.getByRole('status').filter({ hasText: /encurtando|enviando/i }).first().waitFor();
  await page.keyboard.press('Enter');
  await input.evaluate(el => el.form.requestSubmit());
  resume();
  const response = await responsePromise;
  assert.equal(response.status(), 201);
  const { short_url: short } = await response.json();
  assert.equal(new URL(short).origin, origin);
  assert.match(new URL(short).pathname, /^\/[0-9A-Za-z]{7}$/);
  await copy.waitFor();
  assert.equal(requests.length, requestsBeforeCreation + 1);
  assert.deepEqual(requests.at(-1).postDataJSON(), { url: destination });
  const link = page.getByRole('link', { name: short, exact: true });
  assert.equal(await link.getAttribute('href'), short);
  await page.getByRole('status').filter({ hasText: /criado|sucesso/i }).first().waitFor();
  assert.ok(await fits());
  console.log('OK · um único POST enquanto pendente e link igual ao JSON de confirmação');

  await link.focus();
  await page.keyboard.press('Tab');
  assert.ok(await copy.evaluate(el => el === document.activeElement));
  const secure = await page.evaluate(() => window.isSecureContext);
  if (protocol === 'https:' || ['127.0.0.1', 'localhost', '[::1]'].includes(hostname)) assert.ok(secure);
  if (labDomain && protocol === 'http:') assert.equal(secure, false);
  if (secure) {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
    const confirmations = await recordAnnouncements('status', 'Link copiado.');
    for (const attempt of [1, 2]) {
      const sentinel = `Antes da cópia ${attempt}`;
      await page.evaluate(text => navigator.clipboard.writeText(text), sentinel);
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), sentinel);
      assert.ok(await copy.evaluate(el => el === document.activeElement));
      await page.keyboard.press('Enter');
      await page.waitForFunction(expected => navigator.clipboard.readText().then(text => text === expected), short);
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), short);
      await page.waitForFunction(({confirmations, attempt}) => confirmations.messages.length >= attempt,
        {confirmations, attempt}, {timeout: 4000}).catch(cause => {
          throw new Error(`Faltou o anúncio de sucesso da cópia ${attempt}`, {cause});
        });
      const message = await confirmations.evaluateHandle((rec, index) => rec.messages[index], attempt - 1);
      assert.ok(await page.getByRole('status').evaluateAll((regions, message) =>
        regions.includes(message.region) && message.region.getAttribute('aria-live') !== 'off', message));
      // O Astryx publica no próximo frame. Conte também um eventual segundo anúncio do mesmo Enter.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await confirmations.evaluate(rec => rec.messages.length), attempt, 'Um anúncio por cópia');
      await message.dispose();
    }
    await confirmations.evaluate(rec => rec.observer.disconnect());
    await confirmations.dispose();
    const cdp = await browser.newBrowserCDPSession();
    const { browserContextIds } = await cdp.send('Target.getBrowserContexts');
    assert.equal(browserContextIds.length, 1);
    for (const allowWithoutSanitization of [false, true]) {
      await cdp.send('Browser.setPermission', {
        permission: { name: 'clipboard-write', allowWithoutSanitization }, setting: 'denied',
        origin, browserContextId: browserContextIds[0],
      });
    }
    assert.equal(await page.evaluate(async () =>
      (await navigator.permissions.query({ name: 'clipboard-write' })).state), 'denied');
  } else {
    assert.equal(await page.evaluate(() => typeof navigator.clipboard), 'undefined');
  }
  const manual = page.getByRole('textbox', { name: /manual/i });
  const accessibility = await context.newCDPSession(page);
  async function checkManualCopy() {
    assert.ok(await copy.evaluate(el => el === document.activeElement));
    const buttonReady = await copy.evaluateHandle(button => {
      const observed = [];
      document.addEventListener('focusin', () => {
        observed.push(!button.matches(':disabled, [aria-disabled="true"]'));
      }, { once: true });
      return observed;
    });
    await page.keyboard.press('Enter');
    await manual.and(page.locator(':focus')).waitFor({ timeout: 4000 });
    assert.deepEqual(await buttonReady.jsonValue(), [true], 'Copiar deve aceitar outra tentativa ao focar o campo manual');
    await buttonReady.dispose();
    assert.equal(await manual.inputValue(), short);
    assert.ok(await manual.evaluate(el => el.readOnly &&
      el.selectionStart === 0 && el.selectionEnd === el.value.length));
    await page.getByRole('status').filter({ hasText: /Use o comando Copiar.*endereço selecionado/i }).waitFor();
    const { nodes } = await accessibility.send('Accessibility.getFullAXTree');
    const field = nodes.find(node => node.role?.value === 'textbox' && node.name?.value === 'Endereço para cópia manual');
    assert.match(field?.description?.value ?? '', /Use o comando Copiar.*endereço selecionado/i);
  }
  await checkManualCopy();
  await page.keyboard.press('ArrowRight');
  assert.ok(await manual.evaluate(el => el === document.activeElement && el.selectionStart === el.selectionEnd));
  await page.keyboard.press('Shift+Tab');
  await checkManualCopy();
  await accessibility.detach();
  console.log(secure
    ? 'OK · duas cópias confirmadas por Enter, cada uma com o link integral e um anúncio, e duas tentativas manuais com seleção e instrução'
    : 'OK · HTTP em domínio de laboratório, duas tentativas manuais por teclado selecionaram o link e mostraram a instrução');

  if (real) {
    const assets = await page.locator('script[src], link[rel="stylesheet"]').evaluateAll(elements =>
      elements.map(el => el.src || el.href));
    assert.ok(assets.some(url => new URL(url).pathname.endsWith('.js')));
    assert.ok(assets.some(url => new URL(url).pathname.endsWith('.css')));
    for (const url of assets) {
      assert.equal(new URL(url).origin, origin);
      assert.match(new URL(url).pathname, /^\/assets\//);
      assert.equal((await context.request.get(url)).status(), 200);
    }
    for (const path of ['/assets/arquivo-inexistente.js', '/caminho/invalido']) {
      const missing = await context.request.get(origin + path, { maxRedirects: 0 });
      assert.equal(missing.status(), 404, path);
      assert.equal(missing.headers().location, undefined);
      if (!path.startsWith('/assets/')) assert.equal(missing.headers()['cache-control'], 'no-store');
    }
    const expectedDestination = new URL(destination).origin + expectedTarget;
    const controls = [[short, expectedDestination], [`${origin}/${absentCode}`, undefined]];
    if (process.env.BROWSER_ZERO_DESTINATION) {
      controls.push([`${origin}/0000000`, process.env.BROWSER_ZERO_DESTINATION]);
    }
    const entries = new Set([origin]);
    if (process.env.BROWSER_ADDITIONAL_ENTRY) entries.add(new URL(process.env.BROWSER_ADDITIONAL_ENTRY).origin);
    for (const entry of entries) {
      for (const [shortURL, location] of controls) {
        const path = new URL(shortURL).pathname;
        const responses = await Promise.all([
          context.request.get(entry + path, { maxRedirects: 0 }),
          context.request.post(`${entry}/api/v1/redirecionar`, { data: { short_url: shortURL }, maxRedirects: 0 }),
        ]);
        const status = location === undefined ? 404 : 302;
        for (const response of responses) {
          assert.equal(response.status(), status, entry + path);
          assert.equal(response.headers().location, location, entry + path);
          assert.equal(response.headers()['cache-control'], 'no-store', entry + path);
        }
        console.log(`OK · ${entry}${path}, GET e POST ${status} com cabeçalhos conferidos`);
      }
    }
    // O navegador segue o 302 real até o servidor HTTP de destino do próprio ensaio.
    const [navigation] = await Promise.all([
      page.waitForResponse(r => r.url() === short && r.request().isNavigationRequest()),
      page.waitForURL(expectedDestination),
      link.click(),
    ]);
    assert.equal(navigation.status(), 302);
    assert.equal(await navigation.headerValue('location'), expectedDestination);
    assert.equal(await navigation.headerValue('cache-control'), 'no-store');
    assert.equal(page.url(), expectedDestination);
    assert.match(await page.locator('body').innerText(), /Destino do ensaio/);
    console.log('OK · NGINX, assets, POSTs reais e clique até o destino com caminho, consulta e fragmento Unicode');
  }
} finally {
  await browser.close();
  if (landing.listening) {
    landing.close();
    await once(landing, 'close');
  }
}
