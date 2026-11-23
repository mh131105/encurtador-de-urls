import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Heading } from '@astryxdesign/core/Heading';
import { InternationalizationProvider } from '@astryxdesign/core/i18n';
import ptBR from '@astryxdesign/core/locales/pt-BR.generated.js';
import { Theme } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral/built';
import wordmark from './assets/xispa.svg';
import { Shortener } from './Shortener';
import './theme.css';

function App() {
  return (
    <InternationalizationProvider locale="pt-BR" messages={{ 'pt-BR': ptBR }}>
      <Theme theme={neutralTheme}>
        <main>
          <div className="shortener">
            <Heading level={1} className="identity">
              <img className="wordmark" src={wordmark} width={2220} height={772} alt="XISPA" />
              <span>Encurtador de URLs</span>
            </Heading>
            <Shortener />
          </div>
        </main>
      </Theme>
    </InternationalizationProvider>
  );
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<StrictMode><App /></StrictMode>);
}
