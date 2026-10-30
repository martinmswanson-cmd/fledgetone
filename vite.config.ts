import react from '@vitejs/plugin-react'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'
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
      // Libraries compiled into a package's WebAssembly, whose notices the package's own licence file doesn't carry
      if (roots.has('wasm-media-encoders')) sections.push(CODEC_NOTICES)
      // The Bravura music font that vexflow embeds (its own licence, the SIL OFL, isn't in vexflow's licence file)
      if (roots.has('vexflow')) sections.push(readFileSync(join(process.cwd(), 'scripts/fonts/OFL-Bravura.txt'), 'utf8').trim())
      // Unicode's confusables data (src/agent/lookAlikes.ts, the look-alike letters: its notice is a comment the minifier drops)
      if ([...this.getModuleIds()].some((id) => id.replace(/\\/g, '/').endsWith('/src/agent/lookAlikes.ts'))) sections.push(readFileSync(join(process.cwd(), 'scripts/look-alikes-LICENSE.txt'), 'utf8').trim())
      // The built-in plugins (public/fledgetone-plugins/, compiled from scripts/plugins/)
      sections.push(readFileSync(join(process.cwd(), 'scripts/plugins/LICENSES.txt'), 'utf8').trim())
      // The GPL ones, in the builds that have them (VITE_GPL_PLUGINS=1: npm run build:full)
      if (process.env.VITE_GPL_PLUGINS === '1') sections.push(readFileSync(join(process.cwd(), 'scripts/plugins/LICENSES-GPL.txt'), 'utf8').trim())
      this.emitFile({
        type: 'asset',
        fileName: 'third-party-licenses.txt',
        source: `Fledgetone includes the following open-source software.\n\n${sections.join('\n\n\n')}\n`,
      })
    },
  }
}

/** The MP3 and Ogg Vorbis encoders inside wasm-media-encoders (its WebAssembly). */
const CODEC_NOTICES = `LAME MP3 encoder (LGPL-2.0-or-later), inside wasm-media-encoders
${'='.repeat(60)}
The MP3 encoder is LAME (https://lame.sourceforge.io), licensed under the GNU Library General
Public License, version 2 or later (https://www.gnu.org/licenses/old-licenses/lgpl-2.0.html). It
is compiled to a separate WebAssembly module, unmodified; its source and the build used are at
https://github.com/arseneyr/wasm-media-encoders and https://sourceforge.net/projects/lame/files/.
You may replace that module with your own build of LAME.


libogg and libvorbis (BSD-3-Clause), inside wasm-media-encoders
${'='.repeat(60)}
Copyright (c) 2002-2020 Xiph.org Foundation

Redistribution and use in source and binary forms, with or without modification, are permitted
provided that the following conditions are met:
- Redistributions of source code must retain the above copyright notice, this list of conditions
  and the following disclaimer.
- Redistributions in binary form must reproduce the above copyright notice, this list of
  conditions and the following disclaimer in the documentation and/or other materials provided
  with the distribution.
- Neither the name of the Xiph.org Foundation nor the names of its contributors may be used to
  endorse or promote products derived from this software without specific prior written
  permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR
IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE FOUNDATION OR CONTRIBUTORS
BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF
THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`

// https://vite.dev/config/
/**
 * Which build this is, shown at the bottom of the app and written to dist/version.json, so a
 * glance tells whether the site runs the version expected: the version (package.json, the top of
 * CHANGELOG.md), the commit it was built from (Netlify's COMMIT_REF, else git's) and when.
 */
const pkgVersion: string = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).version
const commit = (() => {
  if (process.env.COMMIT_REF) return process.env.COMMIT_REF.slice(0, 7)
  try {
    return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return 'unknown'
  }
})()
const builtAt = new Date().toISOString()

function versionFile(): Plugin {
  return {
    name: 'version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: `${JSON.stringify({ version: pkgVersion, commit, builtAt }, null, 2)}\n` })
    },
  }
}

/**
 * Files in public/ the app needs offline. Not the install icons: the browser keeps its own copy
 * when installing, so keeping them too would only add to the first visit's download. Nor the
 * recordings and plugins: the app keeps those itself (recordingStore.ts).
 */
const SHELL_PUBLIC_FILES = ['favicon.svg', 'manifest.webmanifest']

/** Chunks loaded only when the musician asks for them, not kept ahead (they're kept once fetched): the agent's side of the studio (AgentStudio) and what only it uses. */
const ON_DEMAND = ['AgentStudio']

function onDemandOnly(bundle: Record<string, { type: string; name?: string; imports?: string[]; dynamicImports?: string[] }>): Set<string> {
  const chunks = Object.entries(bundle).filter(([, c]) => c.type === 'chunk')
  const out = new Set(chunks.filter(([, c]) => ON_DEMAND.includes(c.name ?? '')).map(([f]) => f))
  // ...and the chunks every importer of which is one of those
  for (let more = true; more; ) {
    more = false
    for (const [f] of chunks) {
      if (out.has(f)) continue
      const importers = chunks.filter(([, c]) => c.imports?.includes(f) || c.dynamicImports?.includes(f)).map(([g]) => g)
      if (importers.length && importers.every((g) => out.has(g))) {
        out.add(f)
        more = true
      }
    }
  }
  return out
}

/**
 * Write dist/sw.js, the service worker (src/pwa/sw.js), with this build's list of files to keep:
 * the page, everything Vite emitted (scripts, styles, images) but what's loaded only on demand
 * (ON_DEMAND), and the favicon. Its id is a hash of
 * those files, so a build that changes nothing makes the same worker and browsers see no update.
 */
function serviceWorker(): Plugin {
  return {
    name: 'service-worker',
    apply: 'build',
    writeBundle(options, bundle) {
      const out = options.dir ?? join(process.cwd(), 'dist')
      const ondemand = onDemandOnly(bundle)
      const emitted = Object.keys(bundle).filter((f) => f !== 'index.html' && !f.endsWith('.map') && f !== 'version.json' && f !== 'third-party-licenses.txt' && !ondemand.has(f))
      const files = ['index.html', ...SHELL_PUBLIC_FILES.filter((f) => existsSync(join(out, f))), ...emitted.sort()]
      const hash = createHash('sha256')
      for (const f of files) hash.update(f).update(readFileSync(join(out, f)))
      const html = readFileSync(join(out, 'index.html'), 'utf8')
      const fontCss = [...html.matchAll(/<link[^>]+href="(https:\/\/fonts\.googleapis\.com\/css2[^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'))
      // The page is kept under the scope's own address ('./'), which is what a visit asks for
      const precache = files.map((f) => (f === 'index.html' ? './' : f))
      const source = readFileSync(join(process.cwd(), 'src/pwa/sw.js'), 'utf8')
        .replace("'__FLEDGETONE_BUILD__'", JSON.stringify(hash.digest('hex').slice(0, 12)))
        .replace("'__FLEDGETONE_VERSION__'", JSON.stringify(pkgVersion))
        .replace('__FLEDGETONE_PRECACHE__', JSON.stringify(precache))
        .replace('__FLEDGETONE_FONT_CSS__', JSON.stringify(fontCss))
      writeFileSync(join(out, 'sw.js'), source)
    },
  }
}

export default defineConfig({
  plugins: [react(), thirdPartyLicenses(), versionFile(), serviceWorker()],
  // The one-file build (npm run build:single / build:full) folds everything into one HTML file, so
  // its script must be one file too: no lazily loaded chunks (scripts/build-single.mjs inlines it)
  ...(process.env.VITE_SINGLE === '1' ? { build: { rollupOptions: { output: { inlineDynamicImports: true } } } } : {}),
  define: {
    __APP_VERSION__: JSON.stringify(pkgVersion),
    __APP_COMMIT__: JSON.stringify(commit),
    __APP_BUILT__: JSON.stringify(builtAt),
  },
})
