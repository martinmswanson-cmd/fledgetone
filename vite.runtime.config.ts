import { defineConfig } from 'vite';

// The web games runtime (src/runtime/player.ts) as one ES module: dist-runtime/bos-player.js
export default defineConfig({
  publicDir: false,
  // Library mode leaves these for the bundler that uses it; this file runs as it is in a browser
  // (VITE_BOS_RUNTIME: the plugins' WebAssembly is found next to bos-player.js, see pluginSources.ts)
  define: { 'process.env.NODE_ENV': JSON.stringify('production'), 'import.meta.env.VITE_BOS_RUNTIME': JSON.stringify('1') },
  build: {
    outDir: 'dist-runtime',
    emptyOutDir: true,
    lib: { entry: 'src/runtime/player.ts', formats: ['es'], fileName: () => 'bos-player.js' },
    rollupOptions: { output: { codeSplitting: false } },
    assetsInlineLimit: 100000000,
  },
});
