import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The app lives under /genie (like the other sites behind nginx). In development, API requests go to the server on
// :3018; in production the server serves this build itself.
const SERVER = process.env.GENIE_SERVER ?? 'http://localhost:3018';

export default defineConfig({
  base: '/genie/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    // the content policy only allows files from the site itself, so nothing (fonts, icons) may be inlined as a data: URL
    assetsInlineLimit: 0,
  },
  server: {
    port: 5186,
    strictPort: true,
    // the object form keeps the browser's Host header (the shorthand rewrites it), which the server's same-site check compares with Origin
    proxy: {
      '/genie/api': { target: SERVER },
    },
  },
});
