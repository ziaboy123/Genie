import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// the fonts are part of the build (served from Genie itself, like everything else the page loads)
import '@fontsource-variable/bricolage-grotesque/opsz.css';
import '@fontsource-variable/dm-sans/opsz.css';
import './styles/app.css';
import { App } from './App.tsx';
import { SessionProvider } from './lib/session.tsx';

createRoot(document.getElementById('root')!).render(<StrictMode><SessionProvider><App /></SessionProvider></StrictMode>);
