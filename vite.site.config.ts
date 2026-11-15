import { defineConfig } from 'vite';
import { noStore } from './vite.render.config';

// The home page's song player (src/runtime/sitePlayer.ts) as one ES module:
// dist-runtime/fledgetone-site-player.js, beside the other runtimes (built after them, so the folder
// isn't emptied). scripts/build-site.mjs copies it to the site's /player/. Like the command line's
// renderer it renders by Export's own path and must never hold the studio's store.
export default defineConfig({
  publicDir: false,
  plugins: [noStore],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'import.meta.env.VITE_BOS_RUNTIME': JSON.stringify('1'),
  },
  build: {
    outDir: 'dist-runtime',
    emptyOutDir: false,
    lib: { entry: 'src/runtime/sitePlayer.ts', formats: ['es'], fileName: () => 'fledgetone-site-player.js' },
    rollupOptions: { output: { codeSplitting: false } },
    assetsInlineLimit: 100000000,
  },
});
