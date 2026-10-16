# The open-source release

Fledgetone's code went public under GPL-3.0-or-later in version 2026.10.16-10: the terms of use
(the question and answer before "Who can use it?", sections 3, 9 and 14), the permission for
exported files in src/audio/exportLicence.ts, and links to the source on the home page, the guide,
the licences page and Help › Source code.

One step is left: the GPL plugins (Surge XT, OB-Xd, Dexed, Dragonfly and the rest) are still left
out of fledgetone.com (scripts/build-site.mjs deletes their folder; see netlify.toml and
src/audio/plugins/builtinHost.ts). Now that the source is published, the site can carry them: build
it with VITE_GPL_PLUGINS=1, stop deleting `app/fledgetone-plugins/gpl`, and update those comments,
CONTRIBUTING.md and README.md, which describe the site build as having no GPL plugins.
