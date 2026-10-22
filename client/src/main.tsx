import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// the fonts are part of the build (served from Genie itself, like everything else the page loads)
import '@fontsource-variable/bricolage-grotesque/opsz.css';
import '@fontsource-variable/dm-sans/opsz.css';
import './styles/app.css';
import { App } from './App.tsx';
import { CrashGuard } from './components/ui.tsx';
import { SessionProvider } from './lib/session.tsx';

// a page that breaks shows an apology with a way back, never a blank screen
createRoot(document.getElementById('root')!).render(<StrictMode><CrashGuard><SessionProvider><App /></SessionProvider></CrashGuard></StrictMode>);
