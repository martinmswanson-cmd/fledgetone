# Fledgetone

A music studio that runs in the browser. Arrange tracks and clips on a timeline, write in a piano
roll, play more than 200 instruments (synths, EDM basses, drum kits, recorded instruments and your
own sounds) and hundreds of built-in plugins, mix with per-track effects, buses, returns and
automation, record from MIDI or a microphone, and export WAV, MP3, Ogg, stems or video. Producer
tools help with beats (an 808 designer, a drum designer, flipping samples, vocal chains, arranging
a loop into a song). It also scores to picture (timecode, hit points, a reference video) and
exports adaptive music for games (states, stems, stingers and players for the web, Unity, Godot,
FMOD and Wwise).

Nothing is uploaded anywhere: songs autosave in the browser and save to `.fledgetone.json` files.

It's published at [fledgetone.com](https://fledgetone.com), where it can also be installed as an
app that works offline.

**Using it:** [GUIDE.md](GUIDE.md), also inside the app (the Guide button, or press `?`).

## Running it

Requires Node 22.

```sh
npm install
npm run dev            # dev server at http://localhost:5173
npm test               # unit tests
npm run build          # dist/: the production build, as published
npm run build:single   # dist-single/index.html: the whole app in one HTML file
npm run build:site     # dist-site/: fledgetone.com, the home page at / and the app at /app/
```

## Publishing

fledgetone.com is built by Netlify from `master` on every push (`netlify.toml`: `npm run
build:site`, without the GPL plugins, below): the home page at `/` and the app at `/app/`, with the real instruments' recordings
(`public/fledgetone-samples/`) and the built-in plugins (`public/fledgetone-plugins/`) next to
the app, and the service worker that makes it installable and offline-ready (production builds
only). `public/_headers` sets the app's cache rules (moved under `/app/` by `scripts/site-headers.mjs`);
`site/sw.js` retires the worker installed when the app lived at the root. The old addresses on twobirdsworkshop.com
(`/fledgetone.html`, `/fledgetone`, `/bos-beat-box` and `/bos-beat-box.html`) redirect there;
twobirdsworkshop.com still serves `fledgetone-samples/` and `fledgetone-plugins/` as the app's
fallback download addresses.

`build:single` inlines the scripts, styles and icon into one file that runs when opened from a
file (it fetches the recordings and plugins from the fallback addresses). It isn't published; it
has no service worker and can't be installed.

`build:site` is what Netlify publishes on fledgetone.com (see `netlify.toml`): the home page in
`site/` (plain HTML and CSS, no build step of its own) at `/`, the app built under `/app/`, and
the guide at `/guide/`, a page per section of GUIDE.md (`scripts/guide-site.mjs`), so the site's
guide always matches the app's. Its screenshots are taken from the studio by
`scripts/guide-shots/capture.mjs` (the list, with where each one goes, is `shots.mjs`): run it
again after changing the look of something they show.
Old links to the app at the root (`fledgetone.com/#s=...`) are forwarded to `/app/`.

## Finding your way around

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how the app is built, what happens when you edit,
  play, save and export, and where to start for common changes. Read this first.
- [docs/CODEMAP.md](docs/CODEMAP.md): every source file and what it is, by folder.
- [CONTRIBUTING.md](CONTRIBUTING.md): setting up, the checks, and the code's conventions.
- [HANDOFF.md](HANDOFF.md): the project's working notes: what's finished, what's next, known
  issues.

The stack: React 19, TypeScript, zustand, Tone.js 15 on the Web Audio API, Tailwind and Vite.

## Credits

The recorded instruments come from free sample libraries: the Salamander Grand Piano,
tonejs-instruments (Karoryfer and VSCO 2 recordings), the FluidR3 and Musyng Kite General MIDI
soundfonts, Versilian Studios' VSCO 2 Community Edition and VCSL, the University of Iowa Musical
Instrument Samples, Karoryfer's libraries (guitars, saxophones, basses, a drum kit) and a few
more. Their licences differ (CC BY 3.0, CC BY-SA 3.0 and CC0, among others); the built-in plugins
are open source (MIT, BSD), and the Classics play public-domain scores. The full list with links
and licences is in the Credits section of [GUIDE.md](GUIDE.md#credits) and in the app under
Guide > Credits, generated from `src/credits.ts`.

## Licence

Using the app is covered by the [terms of use](TERMS.md): what you make with Fledgetone is yours.


Fledgetone is free software: you can redistribute it and/or modify it under the terms of the
GNU General Public License as published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version. It is distributed in the hope that it will be
useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
FOR A PARTICULAR PURPOSE. See [LICENSE](LICENSE) for the full text.

Copyright (C) 2026 the Fledgetone authors.

The recorded sounds and built-in plugins keep their own licences (see Credits above).

### The name and logo

The licence covers the code, not the Fledgetone name or logo (`src/assets/fledgetone.png`,
`public/favicon.svg`, `public/apple-touch-icon.png`). You're welcome to fork and change
Fledgetone, but please give your version its own name and logo, so nobody mistakes it for this
one. Saying your version is "based on Fledgetone" is fine. See [TRADEMARKS.md](TRADEMARKS.md).
