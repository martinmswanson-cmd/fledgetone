import { defineConfig, type Plugin } from 'vite';

// The command line's renderer (src/runtime/render.ts) as one ES module: dist-runtime/fledgetone-render.js,
// beside bos-player.js (built first by vite.runtime.config.ts, which empties the folder). The command
// line serves it to a headless browser (tools/cli/src/browserRender.ts). Built like the game runtime:
// the plugins' WebAssembly is found next to it (VITE_BOS_RUNTIME), and it knows the GPL-licensed
// families too. It must never hold the studio's store: the renders take the song they're given.
const noStore: Plugin = {
  name: 'no-timeline-store',
  enforce: 'pre',
  resolveId(source, importer) {
    if (/(^|\/)timelineStore(\.ts)?$/.test(source)) this.error(`the renderer must not import the studio's store (${source}, from ${importer})`);
    return null;
  },
};

export default defineConfig({
  publicDir: false,
  plugins: [noStore],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'import.meta.env.VITE_BOS_RUNTIME': JSON.stringify('1'),
    'import.meta.env.VITE_GPL_PLUGINS': JSON.stringify('1'),
  },
  build: {
    outDir: 'dist-runtime',
    emptyOutDir: false,
    lib: { entry: 'src/runtime/render.ts', formats: ['es'], fileName: () => 'fledgetone-render.js' },
    rollupOptions: { output: { codeSplitting: false } },
    assetsInlineLimit: 100000000,
  },
});
