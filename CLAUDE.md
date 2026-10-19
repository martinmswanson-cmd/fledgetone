# Working on Fledgetone

Start with [README.md](README.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

## Keep the studio and Pocket in step

Fledgetone has two interfaces over one engine and one song: the **studio** (on a computer) and
**Pocket** (on a phone, `src/pocket/`). Every update, to either one, includes a look at the other:

- **A feature or a fix in one**: decide whether it belongs in the other too, and do it there, or
  say why not.
- **Anything about how a song is made or kept** (clips, notes, tracks, markers, the loop, the
  project file): make a song in one and open it in the other, and check it looks and plays right
  in both (Pocket's sections are the song's markers, so the studio shows them on its timeline).
- **Words about the other interface** (the studio's menus and notices describe Pocket, Pocket's
  Share and settings describe the studio): keep them true.
- **The docs**: GUIDE.md has a section for each, and the Learn lessons and their screenshots
  (`learn/shots/`, taken by `scripts/guide-shots/capture.mjs`) show both.
