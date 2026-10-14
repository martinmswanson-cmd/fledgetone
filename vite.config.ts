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
      // Libraries compiled into a package's WebAssembly, whose notices the package's own licence file doesn't carry
      if (roots.has('wasm-media-encoders')) sections.push(CODEC_NOTICES)
      // The built-in plugins (public/bos-beat-box-plugins/, compiled from scripts/plugins/)
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
export default defineConfig({
  plugins: [react(), thirdPartyLicenses()],
})
