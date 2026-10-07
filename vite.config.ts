import react from '@vitejs/plugin-react'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig, type Plugin } from 'vite'

/**
 * Write dist/third-party-licenses.txt: the licence text of every npm package bundled into the
 * build. MIT and ISC ask that their copyright and permission notice travel with every copy,
 * and minification drops the notices from the code itself. build-single.mjs embeds the same
 * text in the one-file HTML.
 */
function thirdPartyLicenses(): Plugin {
  return {
    name: 'third-party-licenses',
    apply: 'build',
    generateBundle() {
      const roots = new Map<string, string>()
      for (const id of this.getModuleIds()) {
        const m = id.replace(/\\/g, '/').match(/^(.*\/node_modules\/)((?:@[^/]+\/)?[^/]+)\//)
        // Only code that ends up in the bundle (type-only and fully tree-shaken modules don't)
        if (m && this.getModuleInfo(id)?.code) roots.set(m[2], m[1] + m[2])
      }
      const sections = [...roots]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, dir]) => {
          const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
          const file = readdirSync(dir).find((f) => /^licen[cs]e(\.(md|txt))?$/i.test(f))
          const text = file && existsSync(join(dir, file)) ? readFileSync(join(dir, file), 'utf8').trim() : `License: ${pkg.license ?? 'see package'}`
          return `${name} ${pkg.version} (${pkg.license ?? 'unknown licence'})\n${'='.repeat(60)}\n${text}`
        })
      this.emitFile({
        type: 'asset',
        fileName: 'third-party-licenses.txt',
        source: `Bo's Beatbox includes the following open-source software.\n\n${sections.join('\n\n\n')}\n`,
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), thirdPartyLicenses()],
})
