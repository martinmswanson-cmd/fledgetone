# The open-source release

Fledgetone's code went public under GPL-3.0-or-later in version 2026.10.16-10, at
https://github.com/martinmswanson-cmd/fledgetone: the terms of use (the question and answer before
"Who can use it?", sections 3, 9 and 14), the permission for exported files in
src/audio/exportLicence.ts, the code of conduct, and links to the source on the home page, the
guide, the licences page and Help › Source code. The site's footer credits Netlify, for its Open
Source plan.

From 2026.10.16-11 the website build has the GPL plugins (Surge XT, Dragonfly, Plateau, setBfree):
`build:site` sets VITE_GPL_PLUGINS=1. Their licences need the source published alongside, so keep
the repository public while fledgetone.com carries them; scripts/plugins/ has how each is built
and families.json the upstream commit.
