# Fledgetone

A music studio that runs in the browser. Arrange tracks and clips on a timeline, write in a piano
roll, play 198 instruments (synths, EDM basses, drum kits, recorded instruments and your own
sounds), mix with per-track effects, buses, returns and automation, record from MIDI or a
microphone, and export WAV, MP3, Ogg, stems or video. It also scores to picture (timecode, hit
points, a reference video) and exports adaptive music for games (states, stems, stingers and
players for the web, Unity, Godot, FMOD and Wwise).

Nothing is uploaded anywhere: songs autosave in the browser and save to `.fledgetone.json` files.

**Using it:** [GUIDE.md](GUIDE.md), also inside the app (the Guide button, or press `?`).

## Running it

Requires Node 22.

```sh
npm install
npm run dev            # dev server at http://localhost:5173
npm test               # unit tests
npm run build:single   # dist-single/index.html: the whole app in one HTML file
npm run build:site     # dist-site/: fledgetone.com, the home page at / and the app at /app/
```

`build:single` inlines the scripts, styles and icon into one file that can be hosted anywhere;
that's the file published as `fledgetone.html` on twobirdsworkshop.com. The real instruments'
recordings (`public/fledgetone-samples/`) are hosted next to it.

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
tonejs-instruments (Karoryfer, University of Iowa and VSCO 2 recordings), the FluidR3 and Musyng
Kite General MIDI soundfonts, Versilian Studios' VSCO 2 Community Edition and VCSL, and Karoryfer's Black
And Green Guitars. Their licences differ (CC BY 3.0, CC BY-SA 3.0 and CC0, among others); the
full list with links and licences is in the Credits section of [GUIDE.md](GUIDE.md#credits) and
in the app under Guide > Credits, generated from `src/credits.ts`.

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
