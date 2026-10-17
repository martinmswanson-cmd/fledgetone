// The cache rules for fledgetone.com. Netlify reads _headers from the top of what it publishes, but
// the app's own rules (public/_headers) land in dist-site/app/ with the app: this puts /app in front
// of each of their addresses and adds the home page's rules (its videos and pictures).
const SITE_RULES = `
# The worker that retires the studio's old one (site/sw.js): always checked afresh
/sw.js
  Cache-Control: no-cache
# The home page's videos and pictures: a day
/video/*
  Cache-Control: public, max-age=86400
/img/*
  Cache-Control: public, max-age=86400
`;

/** The site's _headers, from the app's (whose addresses start at the app's own folder). */
export function siteHeaders(appHeaders, base = '/app') {
  const moved = appHeaders.replace(/^\/(?=\S)/gm, `${base}/`);
  return `# Written by scripts/build-site.mjs from public/_headers (the studio, at ${base}/) and the home page's rules.\n\n${moved.trimEnd()}\n${SITE_RULES}`;
}
