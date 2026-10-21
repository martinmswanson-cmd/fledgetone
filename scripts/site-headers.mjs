// The cache rules for fledgetone.com. Netlify reads _headers from the top of what it publishes, but
// the app's own rules (public/_headers) land in dist-site/app/ with the app: this puts /app in front
// of each of their addresses and adds the home page's rules (its videos and pictures).
const SITE_RULES = `
# Every page: not framed by other sites, files taken for what they say they are, the address
# shared only as far as the site, and the microphone (recording) and MIDI for this site alone
/*
  Content-Security-Policy: frame-ancestors 'self'
  X-Frame-Options: SAMEORIGIN
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: microphone=(self), midi=(self), camera=(), geolocation=()
# The worker that retires the studio's old one (site/sw.js): always checked afresh
/sw.js
  Cache-Control: no-cache
# The home page's videos and pictures: a day
/video/*
  Cache-Control: public, max-age=86400
/img/*
  Cache-Control: public, max-age=86400
# The tools' downloads (scripts/tools-site.mjs): zips, saved rather than opened, and checked
# afresh each time (each site build makes them again under the same names); their READMEs as
# plain text in the browser (each by name: the host matches a * only at the end of an address)
/tools/fledgetone-game-music-players.zip
  Content-Type: application/zip
  Content-Disposition: attachment
  Cache-Control: no-cache
/tools/fledgetone-fledge-synth.zip
  Content-Type: application/zip
  Content-Disposition: attachment
  Cache-Control: no-cache
/tools/fledgetone-drop-effects.zip
  Content-Type: application/zip
  Content-Disposition: attachment
  Cache-Control: no-cache
/tools/fledgetone-song-player.zip
  Content-Type: application/zip
  Content-Disposition: attachment
  Cache-Control: no-cache
/tools/game-music-players/README.md
  Content-Type: text/plain; charset=utf-8
/tools/fledge-synth/README.md
  Content-Type: text/plain; charset=utf-8
/tools/drop-effects/README.md
  Content-Type: text/plain; charset=utf-8
/tools/song-player/README.md
  Content-Type: text/plain; charset=utf-8
/tools/LICENSE.txt
  Content-Type: text/plain; charset=utf-8
`;

/** The site's _headers, from the app's (whose addresses start at the app's own folder). */
export function siteHeaders(appHeaders, base = '/app') {
  const moved = appHeaders.replace(/^\/(?=\S)/gm, `${base}/`);
  return `# Written by scripts/build-site.mjs from public/_headers (the studio, at ${base}/) and the home page's rules.\n\n${moved.trimEnd()}\n${SITE_RULES}`;
}
