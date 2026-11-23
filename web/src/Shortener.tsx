import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { flushSync } from 'react-dom';
import { Button } from '@astryxdesign/core/Button';
import { Link } from '@astryxdesign/core/Link';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useAnnounce } from '@astryxdesign/core/hooks';

type Submission =
  | { kind: 'idle' | 'pending' }
  | { kind: 'invalid' | 'error'; message: string }
  | { kind: 'success'; shortUrl: string };

function isHttpUrl(value: unknown): value is string {
  return typeof value === 'string' &&
    /^https?:\/\/[^/\\?#\s]/i.test(value) &&
    !/[\s\\]/.test(value) &&
    URL.canParse(value);
}

function LinkResult({ shortUrl }: { shortUrl: string }) {
  const [copy, setCopy] = useState<'idle' | 'copied' | 'manual'>('idle');
  const manual = useRef<HTMLInputElement>(null);
  const instructionId = useId();
  const announce = useAnnounce();
  const confirmation = 'Link copiado.';

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shortUrl);
      // A primeira confirmação já é anunciada pela mudança de texto na região de status.
      if (copy === 'copied') announce(confirmation, 'polite');
      setCopy('copied');
    } catch {
      // Na primeira tentativa o campo precisa estar montado antes de receber o foco.
      flushSync(() => setCopy('manual'));
      manual.current?.focus();
      manual.current?.select();
    }
  }

  function collapseSelection(event: KeyboardEvent<HTMLInputElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const field = event.currentTarget;
    if (field.selectionStart === field.selectionEnd) return;
    // Em campos somente leitura, alguns navegadores mantêm a seleção ao usar as setas.
    const position = event.key === 'ArrowLeft' ? field.selectionStart : field.selectionEnd;
    event.preventDefault();
    field.setSelectionRange(position, position);
  }

  return (
    <div className="result">
      <div className="result-actions">
        <Link href={shortUrl} hasUnderline>{shortUrl}</Link>
        <Button label="Copiar" size="lg" clickAction={copyLink} isInterruptible={copy === 'manual'} />
      </div>
      <p role="status" id={instructionId}>
        {copy === 'copied' && confirmation}
        {copy === 'manual' && 'Use o comando Copiar do seu dispositivo para copiar o endereço selecionado.'}
      </p>
      {copy === 'manual' && (
        <TextInput label="Endereço para cópia manual" value={shortUrl} isReadOnly ref={manual} aria-describedby={instructionId}
          onKeyDown={collapseSelection} />
      )}
    </div>
  );
}

export function Shortener() {
  const [url, setUrl] = useState('');
  const [submission, setSubmission] = useState<Submission>({ kind: 'idle' });
  const sending = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const announce = useAnnounce();
  const pending = submission.kind === 'pending';

  function showInputError(message: string) {
    setSubmission({ kind: 'invalid', message });
    input.current?.focus();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;
    if (!isHttpUrl(url)) {
      const message = 'Informe uma URL completa que comece com http:// ou https://.';
      // O TextInput anuncia mudanças de status. Uma nova tentativa pode manter o mesmo erro.
      if (submission.kind === 'invalid' && submission.message === message) announce(message, 'assertive');
      showInputError(message);
      return;
    }

    sending.current = true;
    setSubmission({ kind: 'pending' });
    try {
      const response = await fetch('/api/v1/encurtar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
        redirect: 'error',
      });
      if (response.status === 400) {
        showInputError('O serviço recusou esta URL. Confira o endereço e tente novamente.');
      } else if (response.status !== 201) {
        setSubmission({ kind: 'error', message: 'O serviço está indisponível. Tente novamente.' });
      } else {
        const data = await response.json().catch(() => null);
        const shortUrl: unknown = data?.short_url;
        if (isHttpUrl(shortUrl) && /^https?:\/\/[^/?#@]+\/[0-9A-Za-z]{7}$/i.test(shortUrl)) {
          setSubmission({ kind: 'success', shortUrl });
        } else {
          setSubmission({ kind: 'error', message: 'O serviço devolveu uma resposta inválida. Tente novamente.' });
        }
      }
    } catch {
      setSubmission({ kind: 'error', message: 'Falha de conexão. Confira sua rede e tente novamente.' });
    } finally {
      sending.current = false;
    }
  }

  return (
    <>
      <form noValidate onSubmit={submit}>
        <TextInput
          label="URL de destino"
          htmlName="url"
          type="url"
          size="lg"
          value={url}
          onChange={value => {
            setUrl(value);
            setSubmission({ kind: 'idle' });
          }}
          isRequired
          isReadOnly={pending}
          placeholder="https://exemplo.com/artigo"
          autoComplete="url"
          autoCapitalize="none"
          hasSpellCheck={false}
          enterKeyHint="go"
          ref={input}
          status={submission.kind === 'invalid' ? { type: 'error', message: submission.message } : undefined}
        />
        <Button label="Encurtar" type="submit" variant="primary" size="lg" isLoading={pending} />
      </form>
      <p role="status" className="feedback">
        {pending && 'Encurtando o link…'}
        {submission.kind === 'success' && 'Link criado.'}
      </p>
      <p role="alert" className="feedback error">
        {submission.kind === 'error' && submission.message}
      </p>
      {submission.kind === 'success' && <LinkResult shortUrl={submission.shortUrl} />}
    </>
  );
}
