# Fledgetone Pocket: a phone version (on hold)

On hold until the current work is finished. A separate, simpler phone interface over the same engine and project files, so a song started on a phone opens on a computer and back.

## In it
- Start: a starter by genre, or empty.
- 16 big pads (drums, chops) and a step sequencer.
- A simple note editor: melodies and 808 lines in the scale, big grid, zoom.
- Record vocals with the vocal chain presets, hard tune and doubles.
- A light mixer: level, mute, solo, one-tap reverb, Bass Drive, clipper.
- Arrange: song form, drops, beat switches.
- Export an MP3, share a link, or open it on a computer.

Left out at first: automation lanes, plugins, game kits, video, notation, the detailed editors.

## Risks
- Memory: phones (iPhones most) close heavy pages. Use the lighter recordings, load only what the song uses, cap tracks and effects.
- iPhone: the silent switch can mute web audio, no Web MIDI, recording latency varies by phone.
- Testing: Safari/WebKit can't be tested from the build environment (its browser download host is blocked); test on a real iPhone.
- Two interfaces: every new feature needs a "does this go in Pocket?" call. The shared engine keeps this manageable.

## Plan
1. A clickable prototype of the screens, tried on a real phone first.
2. Build in stages: pads and steps, then the note editor, then vocals and export.
3. Installable to the home screen, like the desktop app.
