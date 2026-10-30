import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';

// The command line (tools/cli/src/fledgetone.ts) as one Node 22 module: tools/cli/dist/fledgetone.mjs.
// The app's own plain-logic modules it uses (src/agent, src/store...) are bundled in; its
// dependencies (the MCP SDK, ws, zod; playwright-core, found at run time for rendering) stay
// outside and load from tools/cli/node_modules, so `npm install` in tools/cli comes first. The version and the agent guide (docs/AGENT.md) are
// written in, so the bundle doesn't need the repository beside it.
const version = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version;
// (the look-alike letters in src/agent/lookAlikes.ts are Unicode's confusables data: its licence goes with the bundle)
const unicodeNotice = readFileSync('scripts/look-alikes-LICENSE.txt', 'utf8').trim().split('\n').map((l) => `// ${l}`.trimEnd()).join('\n');
const external = [...builtinModules, ...builtinModules.map((m) => `node:${m}`), /^@modelcontextprotocol\/sdk(\/|$)/, /^ws(\/|$)/, /^zod(\/|$)/, /^playwright(-core)?(\/|$)/];

export default defineConfig({
  publicDir: false,
  define: {
    __FLEDGETONE_VERSION__: JSON.stringify(version),
    __AGENT_DOC__: JSON.stringify(readFileSync('docs/AGENT.md', 'utf8')),
  },
  build: {
    outDir: 'tools/cli/dist',
    emptyOutDir: true,
    target: 'node22',
    ssr: 'tools/cli/src/fledgetone.ts',
    minify: false,
    sourcemap: false,
    rollupOptions: {
      external,
      output: { format: 'es', entryFileNames: 'fledgetone.mjs', banner: `#!/usr/bin/env node\n${unicodeNotice}` },
    },
  },
});
