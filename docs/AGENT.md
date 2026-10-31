# Working with your own agent

Fledgetone has no assistant built in, no account and no keys. Instead, an agent you already
use (one that can use MCP tools, the Model Context Protocol) can read your song and **suggest** changes.
You hear each suggestion before and after, and accept it (one undo step) or dismiss it. The agent
never changes the song itself, and nothing is accepted for you.

**Fledgetone sends nothing anywhere. Your agent sends what it reads to whoever runs it.**

This page is for setting it up, and it's also what the agent reads (the helper serves it to the
agent as `fledgetone://docs/ops`): the ops an agent suggests with, the song summary it reads, and
the connection between the studio and the helper.

- [Setting it up](#setting-it-up)
- [Two ways to work: files, or live with the studio](#two-ways-to-work)
- [Hearing a song file: render and listen](#hearing-a-song-file)
- [The tools](#the-tools)
- [The ops](#the-ops)
- [The song as the agent reads it](#the-song-as-the-agent-reads-it)
- [Suggestion files](#suggestion-files)
- [The connection](#the-connection)
- [Security and privacy](#security-and-privacy)

## Setting it up

You need Node 22 and a copy of the Fledgetone repository.

```sh
cd tools/cli && npm install && cd ../..
npm run build:cli
node tools/cli/dist/fledgetone.mjs --help
```

The helper is `fledgetone mcp`: an MCP server your agent starts and talks to over stdio. Point
`--root` at the folder with your songs (the agent can read and write files only there).

Add it to your agent's MCP settings as a server started by a command. An agent whose MCP
servers are listed in a JSON file takes something like this:

```json
{
  "mcpServers": {
    "fledgetone": {
      "command": "node",
      "args": ["/path/to/fledgetone/tools/cli/dist/fledgetone.mjs", "mcp", "--root", "/path/to/your/songs"]
    }
  }
}
```

To hear song files without the studio (`render_file`, and `listen` with a file; on the command
line `fledgetone render` and `fledgetone listen`), the helper renders them in a browser on your
computer that it starts and closes itself, with no window. That needs the app's renderer,

```sh
npm run build:runtime    # dist-runtime/fledgetone-render.js
```

playwright-core (which `npm install` in `tools/cli` brings: it's optional there, and downloads no
browser), and a browser: an installed Google Chrome or Chromium is found by itself (Edge too);
without one, `npx playwright-core install chromium` in `tools/cli` downloads one, or `--browser
<path>` names one. Behind a proxy, set `HTTPS_PROXY` (and `NODE_EXTRA_CA_CERTS` if it has a
certificate of its own) so recordings can download.

Songs with plugins from other sites (not Fledgetone's built-in ones) aren't rendered: the helper
doesn't run plugins from the internet, and says which tracks use them. Export those songs from
the studio instead.

Options of `fledgetone mcp`:

| Option | What it does |
| --- | --- |
| `--root <folder>` | The only folder the agent's file tools reach (default: the folder it starts in). Songs (`.fledgetone.json`, `.json`), suggestion files (`.json`) and audio (`.wav`, `.mp3`) only. |
| `--port <n>` | The studio connects on `127.0.0.1:47123`; another port, or `0` for any free one (the pairing message says which). If 47123 is taken by another program, the helper doesn't move to another port by itself: it says so (on stderr, and `connect_studio` answers with what to do), tries 47123 again at each `connect_studio`, and the file tools work meanwhile. A port given with `--port` that's taken stops the helper with an error. |
| `--dev` | Also let the dev server's pages connect (`localhost:5173` and `5200`). For working on Fledgetone itself. |
| `--allow-origin <url>` | Also let pages from this exact origin connect (another dev server, a checking script). Can be given more than once. |
| `--studio` | Also serve the studio itself on `127.0.0.1:47200` and let it connect: for Safari and Brave, which won't let fledgetone.com reach the helper, and for a copy of the app on your computer (see [The studio from the helper](#the-studio-from-the-helper)). `--studio-port <n>` for another port, `--app <folder>` for another build. |
| `--samples <folder>` | Instrument recordings for renders, laid out like `public/fledgetone-samples` (the default, in a copy of the repository). |
| `--offline` | Renders download nothing: an instrument whose recordings aren't in the samples folder or kept from before can't play, and the render says so. |
| `--browser <path>` | The browser renders use (else Chrome, Playwright's Chromium, Edge, then the usual places). Also `FLEDGETONE_BROWSER`. |
| `--timeout <seconds>` | The longest a render or listen may take (default 600). |

## Two ways to work

**Files.** Give the tools a `file` and they read that song. `suggest` with `file` and `out` writes
a suggestion file; you apply it yourself:

```sh
node tools/cli/dist/fledgetone.mjs apply song.fledgetone.json more-bass.suggestion.json -o song-2.fledgetone.json
```

`apply` never writes over the song it reads, and refuses a suggestion whose song has changed
since (see [Suggestion files](#suggestion-files)).

**Live.** The agent calls `connect_studio` and tells you a 12-character code, like `K7QM-3XPD-9TBW`. In
Fledgetone, choose *Let an agent connect…* and type it, and tick what the agent may do: read the
song (always), see what you select, suggest changes, listen. Then the agent reads the song as it
is on screen, and its suggestions appear on the Suggestions panel with a title, an explanation,
what changes, any warnings, and a before-and-after to hear. Disconnect at any time from the panel.

## Hearing a song file

`listen` with `file` renders bars of a song file and measures them, on your computer, with no
studio open; `render_file` writes the song (or some bars of it) as a WAV or MP3 file in `--root`.
Both render exactly as the app's Export does (the same code, built into
`dist-runtime/fledgetone-render.js`), so what the agent measures is what the musician would
export. On the command line, `fledgetone listen` and `fledgetone render` do the same (see
[tools/cli/README.md](../tools/cli/README.md)).

A listen gives the same report as a live one, and more:

```json
{
  "range": { "fromBar": 9, "toBar": 17 },
  "seconds": 16,
  "heard": "the song as it is",
  "renderMode": "playback",
  "mix": {
    "lufs": -14.2, "shortTermMaxLufs": -12.0, "truePeakDbtp": -1.0, "crestDb": 9.1,
    "regions": [{ "name": "sub bass (under 60 Hz)", "db": -3.3 }, { "name": "bass (60-200 Hz)", "db": -3.4 }],
    "master": { "limiterMaxGrDb": 2.1, "clipperMaxDb": null }
  },
  "bars": [{ "bar": 9, "lufs": -14.8 }, { "bar": 10, "lufs": -14.0 }],
  "tracks": [{ "id": "track-2", "name": "Bass", "lufs": -20.1, "truePeakDbtp": -9.8, "crestDb": 11.2, "regions": [] }],
  "checks": [{ "id": "mud", "level": "note", "title": "Muddy low mids", "detail": "...", "trackIds": ["track-3"] }],
  "findings": ["Muddy low mids: There's 6.1 dB more between 200 and 500 Hz than ..."]
}
```

- `mix`: integrated loudness (LUFS), the loudest 3 seconds (whole 3-second windows only: `null`
  for less than 3 seconds), true peak (dBTP), crest (peak against
  average, dB), the balance (each part of the spectrum against the whole, dB), and how much the
  master's limiter and clipper took off the peaks (dB; `null`: the clipper is off).
- `bars`: the loudness of each bar (a bar under 0.4 seconds has none: `null`).
- `tracks` (with `perTrack: true`): each track that plays in the bars, rendered alone through its
  own strip, sends and the shared reverb and delay, without the master section.
- `checks` and `findings`: what the Mix check finds, in plain words, worst first (against the
  streaming target, -14 LUFS). Without `perTrack` only the checks that need no tracks (the level,
  the limiter, the clipper).

With `suggestion` (a suggestion file in `--root`, as `suggest` writes) or `ops`, it renders the
bars twice, before and after, and answers `{before, after, difference}`. `difference` has the
changes of the mix's numbers (after minus before), of each track's, and bar by bar. Its `lufs`
(the mix's, and each track's) compares the same moments of both renders: each one's own
integrated loudness can read the after louder when a change makes its quiet parts quieter still
(the gate then leaves them out), so it isn't simply the after's `lufs` minus the before's:

```json
{
  "bars": [
    { "bar": 4, "beforeLufs": -18.8, "afterLufs": -18.8, "lufsChange": 0, "differenceDb": null, "changed": false },
    { "bar": 5, "beforeLufs": -18.6, "afterLufs": -18.5, "lufsChange": 0.1, "differenceDb": -41.3, "changed": true }
  ],
  "changedBars": { "fromBar": 5, "toBar": 7 },
  "summary": ["Bars 5 to 6 sound different (what changed is up to -41.3 dBFS); the other bars sound the same."]
}
```

`differenceDb` is the level of what changed: the after's samples minus the before's, in dBFS
(`null`: the same; a bar a tempo change moved, so that it starts or ends at another time in the
after than in the before, can't be lined up, and counts as changed). A bar has `changed` when
that is above -70 dBFS. Renders are exact (the same song
renders to the same samples every time), so a bar the suggestion doesn't reach comes out the same,
and `changedBars` is where it's heard (often a bar or so past the notes it adds, as they ring
out). A suggestion file whose song has changed since it was made, or that was made for another
song, is refused, as `fledgetone apply` refuses it.

Limits are the live listen's: at most 64 bars or 90 seconds (before and after each), one listen or
render at a time, 10 listens a minute. `render_file` makes at most 10 minutes of audio, never
writes over a file unless `overwrite: true`, and only `.wav` and `.mp3` files inside `--root`.

The first time a song uses a recorded instrument, its recordings download from fledgetone.com (the
same files, from the same addresses, the app downloads); they're kept (in `~/.cache/fledgetone`,
or `FLEDGETONE_CACHE`) so they download once. The browser the helper starts reaches nothing else.

## The tools

| Tool | What it does |
| --- | --- |
| `studio_status` | Whether a studio is connected, what you allowed, how many suggestions are waiting |
| `connect_studio {waitSeconds?, newCode?}` | The pairing code and what to tell you; with `waitSeconds` (up to 60) it waits for you to type it |
| `get_song {file?}` | The song summary (below) |
| `get_notes {file?, trackId?, clipId?, fromBar?, toBar?, cursor?}` | Notes with their ids, 2000 at a time |
| `get_automation {file?, trackId?, param?}` | Automation lanes with every point |
| `get_view` | What you have open and selected (if you allow it) |
| `wait_for_changes {since?, timeoutSeconds?}` | Waits (up to 25 seconds) for an edit, a selection, a suggestion accepted or dismissed, or a message from you (`user_message`). The helper keeps the last 200 events, and your messages apart from them (an edit never pushes one out); if some after `since` were dropped unread, the answer has `missed: true` and a hint: call `get_messages` and answer its `unanswered` |
| `listen {fromBar, toBar, suggestionId? \| ops?}` | Renders up to 64 bars (90 seconds) in the studio and measures it: loudness, true peak, balance, findings. Notes held into the range are heard, as the song plays them, and so is the release of one that ends just before it (it renders from up to 8 bars earlier and measures only the range, what the master's limiter and clipper did included; a note the sustain pedal holds counts, one a trim hides doesn't). One at a time, 10 a minute, never while the song plays ("busy", also when Play is pressed during one), and only if you allow listening |
| `listen {file, fromBar, toBar, perTrack?, suggestion? \| ops?}` | The same for a song file, rendered on your computer with no studio open, bar by bar, with each track's own with `perTrack`, and before and after with a suggestion file or ops (see [Hearing a song file](#hearing-a-song-file)) |
| `render_file {file, out, fromBar?, toBar?, format?, sampleRate?, bitDepth?, overwrite?}` | Writes a song file (or bars of it) as a WAV or MP3 file in the working folder, as Export makes it, with its length, loudness and true peak |
| `suggest {title, explanation, ops, focus?}` | A suggestion on your panel (live), or with `file` and `out` a suggestion file (the answer gives `regions`, where its changes are heard). At most 5 waiting, one every 3 seconds, 500 ops, 5000 added notes. Its before-and-after plays every place its changes are heard (see [What a suggestion's before-and-after plays](#what-a-suggestions-before-and-after-plays)). `focus` (`{fromBar, toBar}`) is bars you'd like heard as well: played along with them if it fits, never instead of them |
| `preview_suggestion {ops, file?}` | A dry run: what the ops would change, warnings, errors |
| `get_suggestion {id?}`, `withdraw_suggestion {id}` | A suggestion's status (waiting, changed, accepted, undone, dismissed, out of date, other song), whether the musician heard it as it is (`heard`: Suggested played through every region, each to its end; never while it's `changed` and not made again yet), where its changes are heard (`regions`) and how that was found (`regionsBy`: `"rules"`, or `"rules and sound"` with `soundRegions`, the bars where the song renders differently with it, only while you're allowed to listen; `finding: true` while that's under way; `notBySound` when it can't be: the song is too long, the suggestion would make it too long, or the render failed, with `mayRingOn` when a tail the studio can't know may ring on past the regions. Without Listen you read the rules' regions alone and what a before-and-after of those plays, `heard` is whether Suggested played through every one of the rules' regions, there's no `finding`, and `notBySound` is only the song or the suggestion being too long to check: nothing you read moves with what the check by sound found), the stretches its before-and-after plays one after another (`audition`), and, when they can't hold every region, the bars left out (`unheard`) and the limit that left them out (`limit`: `"64 bars"` or `"90 seconds"`); `focusLeftOut` when your focus didn't fit. Or take one back |
| `say {text, about?, replyTo?}` | A short message on your panel (plain text, 4000 characters, one a second); `replyTo` (the id of one of your messages) shows it as the answer to it |
| `get_messages {since?, limit?}` | The conversation both ways, oldest first, 50 at a time (`last` back as `since` for the next page, `more` if there are more), with `unanswered`: your messages the agent hasn't replied to. Reading your messages shows them to you as seen |
| `point_at {target, note?}` | Highlights a track, a clip, bars, a marker or a control for you (one a second) |
| `list_instruments`, `list_presets`, `list_starters`, `list_params`, `list_inserts`, `list_master` | What there is to choose from, with keys, defaults and ranges |
| `check_file {file}`, `diff_files {a, b}` | What the app would change opening a file; what changed between two |

There is no tool to accept a suggestion, and there never will be: only you accept.

### What a suggestion's before-and-after plays

A suggestion counts as heard only once the musician has heard every place its changes can be heard
(its `regions`, in whole bars, overlapping and touching ones joined): its Suggested side has
played through each of them, to its end, at least once (stopping early, or hearing only Now, is
hearing it in part). The regions are found two ways, and are both together, so they're never
fewer bars than the truth. First by rules:

- notes or a clip: their bars, and past them as they ring out: the instrument's release, then
  the track's own Delay and Reverb for as long as they ring (a delay until its repeats have
  fallen 60 dB, at the song's slowest tempo; a setting a lane moves at its longest, whether the
  lane is the track's automation, a clip's controller lane, CC 91 and 93 or one MIDI learn maps
  to a setting, or a clip's step lane), and those of every bus and return it plays into and the
  master reverb and delay it sends to (or a lane of any kind moves its send to), one after
  another; and, when another track's Pump ducks to that track's notes (it follows that track, or
  the drums), as long as the ducked track rings on; and, when that track is a proxy (the game's
  dialogue or sound effects, which every other track ducks under), wherever the others dip, from
  the dip's look-ahead before it to past its release by each of their tails. A note plays its
  whole length, past its clip's end too, so it's heard until it stops. Some instruments play a
  note by the notes before it, so a note added, changed or taken away (or a clip) changes later
  ones too: a recorded instrument that plays two takes of its notes in turn and a guitar's strums
  (down or up after the last), notes that play only on some passes, and a plugin instrument (whose
  own state the studio can't know: not sure) are heard from the change to where the track stops;
  a monophonic synth along the notes joined to it (each starting before the one before has rung
  out); an instrument where a new note can end one still sounding (every recorded instrument, by
  a bowed string's legato change, a fourth repeat of a pitch, or too many notes at once; the keys,
  wavetable pad and brass synths, whose voices run out; the designed synth in mono) along every
  note sounding over the change, to where it stops, and the notes joined to those, in the song as
  it is and as suggested (a short note added under a long held one cuts it there, and taking one
  away lets the held note ring on); and a swung clip all of it (its swing is decided over the
  whole clip: its own swing, or the song's for a clip with none of its own that starts off the
  song's 16th grid), as is a clip with a groove feel that takes its part from its track (chords
  or lead is decided by all its notes); on a track with notes that play only on some passes, a
  clip's change (its notes, its length, linking it to its copies or unlinking it) is heard from
  the clip's start, since its run of copies, and so its pass, can change;
- a change that makes a track's feel clips (a groove feel with no part of its own) play as
  another part: renaming the track ("Keys" to "Bass"), its notes anywhere (low notes far off
  moving its middle pitch), a Drum Rack's pad names: wherever those clips play, with their tail;
- a change of a track's sound (its level, pan, mute, instrument, synth sound, EQ, inserts, sends,
  routing, distance) or any of its automation (a lane holds its first value before its first
  point and its last after its last, so a lane is never heard only at its points; a send's,
  an instrument's or an insert's lane the same): wherever that track plays, its clips in the
  song as it is and as suggested, each with its tail (its notes ringing out, and its effects),
  and, for a bus or a return, wherever the tracks playing into it or sending to it play;
- a change of a clip with controller lanes (bend, mod, sustain, CCs) or step lanes (moved,
  resized, taken away, its notes): wherever its track plays (what the lanes hold carries into
  the track's later clips);
- a tempo or time signature change at bar N: bar N to the end of the song, from the change before
  it (or bar 1) when it glides or the change after it glides into it (a glide speeds up or slows
  down the bars before its own); the song's tempo or time signature, the master, a solo, or
  anything else: the whole song;
- a name, a marker or a link between clips: nothing to hear (but see the passes and the feel
  clips above).

Then by sound: the studio renders the whole song as it is and as suggested (in the background,
as soon as the suggestion arrives, never while the song plays, or when the musician presses
Hear, while the before-and-after already plays the rules' regions: the card says "Finding where
it changes…", and anything it finds besides makes the suggestion heard only in part until that's
played too) and compares them bar by bar, as `listen` with
ops does: every bar whose difference is above -70 dBFS joins the regions (`regionsBy` is then
`"rules and sound"`, and `soundRegions` names those bars). A song longer than 4 minutes (the
musician's song as it is: a suggestion can't make it so) isn't rendered whole, nor one a
suggestion would make longer than 5 minutes: its regions are the rules' alone (`notBySound`), and
the card says it wasn't checked by sound. If a tail the studio doesn't know is in them (a plugin
instrument or effect, an instrument's release it can't read), `mayRingOn` is true and Accept
always asks the musician for its second press: hearing it can't count as all of it. A suggestion file's `regions`
(file mode) are the rules' alone: `listen` with the file and the ops says where it sounds
different.

The before-and-after plays the regions one after another, in order, looped as one, each with the
bar before it (to hear it come in) when that fits too; a region that fits only without it is
played without it, never cut. Now and Suggested switch at the same place in the same region. All
of it is at most 64 bars and 90 seconds (in the slower of the song as it is and as suggested). A
region that doesn't fit is played as far as it does; what's left of it and every region after it
is `unheard` (a master change on a long song, say: the whole song is more than 90 seconds), the
card says which regions are heard and which aren't and which limit it was, and Accept takes it
only with a second press. Your `focus` is played too if it fits in what's left, else left out
(`focusLeftOut`). So for a change the musician can hear in one go, keep it to one place, or a few
close together.

**Names in what changes.** The names in a suggestion's words (a track's, a clip's, a marker's: you
may have written them) are shown on the card as names apart, never as part of the sentence. In
the plain words you get back (`changes`, `warnings`, `notes`, `preview_suggestion`, errors) each
name is in double quotes with its own quote and bracket characters taken out, so a name can't close
the quotes; your own name for yourself is shown without quote and bracket characters, and none at
all if it would read as the app's name (in any script's look-alike letters).

### Talking with the musician

The musician can write to the agent from the message box at the foot of the Suggestions panel. A
message goes only when they press Send (or Enter), only to the paired helper, and carries only
what they chose: the text (at most 2000 characters), the suggestion they asked about ("Ask about
this" on a card gives `suggestionId`), and their selection if they ticked "Include what I've
selected" while the agent may see it (`context: {selectedTrackId?, selectedClipIds?, editingClipId?, bars?}`, by the ids `get_song` and `get_view` give them).

The agent gets each message from `wait_for_changes` (event `user_message`) and can read the whole
conversation with `get_messages`. Each message on the panel says where it is: *Sent* (the helper
has it), *Seen by your agent* (it came back from `wait_for_changes` or `get_messages`, or the agent
replied to it), or *Not sent — the agent isn't connected* with **Retry**. A message that wasn't
sent is never sent later by itself; Retry sends it again with the same id, and the helper keeps it
once.

Each pairing is a connection of its own. A message not sent in one connection can be retried
only in it: after a new pairing it says *Not sent — that connection ended*, and the musician can
put it back in the box to send it as a new message. What goes with a message is decided at each
send and retry: the selection only while the agent may see it, the suggestion's id only while
that suggestion is on the panel. On the panel an earlier connection's messages are set off by a
line ("Earlier, with your agent (name)"), each agent's message with the name it came with. The
agent gets exactly what the musician sees: control characters and invisible characters go
(hidden tag text, word joiners, soft hyphens, stray variation selectors, direction overrides,
blank braille outside braille). Kept only where they do something: a joiner (ZWNJ, ZWJ) singly
between two visible characters, a direction mark (LRM, RLM, ALM) singly next to visible text,
emoji or text presentation right after a visible character, and the flags of England, Scotland
and Wales (any other tag sequence leaves the plain black flag).

Nothing of the conversation is saved: the studio keeps it for the tab (a reload clears it), the
helper in memory until the studio disconnects, the last 200 messages each way. Neither writes it
to the song or to disk.

**Etiquette.** The agent works alongside the musician, not for them:

- answer their questions first, plainly, with `say` and `replyTo`, and check `get_messages`' `unanswered` now and then (always after `missed`);
- ask before suggesting big changes (a new part, a new arrangement, the tempo, the whole mix);
- keep each suggestion small, one idea at a time, and say why in plain words;
- don't flood the panel: a message or two, then wait for them (`wait_for_changes`).

When no studio is connected, the live tools answer: *No studio is connected — call
connect_studio and ask the user to type the code in Fledgetone.*

## The ops

A suggestion is a list of ops, applied in order:

```json
{ "opsVersion": 1, "ops": [ { "op": "set_track", "trackId": "track-1", "volumeDb": -6 } ] }
```

(The tools take the list as `ops`; suggestion files hold both fields.)

**Units are the app's own.** Song positions are bars from 1 (bar 5 is the start of the fifth
bar; 5.5 is half way through it in 4/4). A note's `start` and `length` are in bars inside its
clip (0.25 is a quarter note in 4/4, 0.0625 a 16th, the shortest). A note that starts in its
clip plays its whole length, even past the clip's end, as the studio plays it and exports it.
Pitches are names with an
octave: `"C4"` is middle C, `"F#2"`, `"Bb3"`. On drum tracks a note can also be a row's name:
`kick`, `snare`, `clap`, `closedHat`, `openHat`, `tomLow`, `tomMid`, `tomHigh`, `cowbell`, `crash`,
`ride`. Velocity is 0 to 1 (0.8 if left out). Levels are dB; pan is -1 (left) to 1 (right); sends,
distance and automation values are 0 to 1.

**Ids** come from `get_song` (tracks, clips, markers, tempo changes) and `get_notes` (notes). An
op that makes something can name it with `ref`, and later ops in the same suggestion use it as
`"$name"` wherever an id goes:

```json
[
  { "op": "add_track", "instrument": "synthDesigner", "name": "Lead", "ref": "lead" },
  { "op": "set_synth_preset", "trackId": "$lead", "preset": "Supersaw lead" },
  { "op": "add_clip", "trackId": "$lead", "startBar": 9, "lengthBars": 4, "ref": "hook" },
  { "op": "add_notes", "clipId": "$hook", "notes": [{ "pitch": "A4", "start": 0, "length": 0.5 }] }
]
```

**Errors** name the op (counting from 0) and the field, like `ops[3].notes[1].pitch: "H2" isn't a
pitch`, and nothing is applied (what an op gave is quoted back made plain and at most 40
characters). The warnings and what changes, which the musician reads on the card, never quote
text an op gave: a setting given a value that isn't one of its choices says so, "(left as it
was)". **Values out of range** are brought into range with a warning
(a volume of +12 dB becomes +6 dB). **Big jumps in level** are warnings too: a track up by more
than 6 dB (by its fader, its EQ, its compressor's makeup, a parametric EQ or multiband band, or
its fader, buses and the master together), a track unmuted (one that sits 12 dB or more under the
rest of the mix is only a note), a Distortion or Saturation driven much
harder, a Delay fed back at 80% or more, automation of any of those drawn high, the master up by
more than 3 dB, the Loud master or the clipper switched on. Every result is checked the way a
saved song is when it opens, so a suggestion can never hold what a song file couldn't. A
suggestion adds at most 5000 notes, copies of clips (linked or not) included.

Linked clips (clips that share a pattern, `linkedTo` in the song summary) follow each other: change
the notes of one and its copies change too, as in the studio.

Suggestions can't (in this version): change swing, add sounds, audio clips, video or plugins,
change recorded takes, the clip launcher, the game parts, insert or delete bars, or the shared
reverb and delay.

### Notes

**`add_notes`** `{clipId, notes: [{pitch, start, length, velocity?}]}`: adds notes to a clip.

```json
{ "op": "add_notes", "clipId": "clip-12", "notes": [{ "pitch": "D2", "start": 0.5, "length": 0.25, "velocity": 0.7 }] }
```

**`change_notes`** `{clipId, notes: [{id, pitch?, start?, length?, velocity?}]}`: changes notes by
id; only the fields given change.

```json
{ "op": "change_notes", "clipId": "clip-12", "notes": [{ "id": "note-40", "pitch": "E2", "velocity": 0.5 }] }
```

**`remove_notes`** `{clipId, noteIds} | {clipId, all: true} | {clipId, fromBar, toBar}`: removes
notes by id, all of them, or those starting in a range of song bars (`toBar` not included).

```json
{ "op": "remove_notes", "clipId": "clip-12", "fromBar": 7, "toBar": 9 }
```

**`transpose_notes`** `{clipId, semitones, noteIds?}`: moves pitches up or down (-48 to 48). A note
that would leave the instrument's range stays where it is (with a warning). Not on drum tracks.

```json
{ "op": "transpose_notes", "clipId": "clip-12", "semitones": -12 }
```

### Clips

**`add_clip`** `{trackId, startBar, lengthBars, name?, notes?, ref?}`: a new note clip (not on an
audio track, a bus or a return).

```json
{ "op": "add_clip", "trackId": "track-3", "startBar": 17, "lengthBars": 4, "name": "Outro bass", "notes": [{ "pitch": "D2", "start": 0, "length": 4 }] }
```

**`move_clip`** `{clipId, toBar?, trackId?}`: to another bar, another track (that plays the same
kind of notes), or both.

```json
{ "op": "move_clip", "clipId": "clip-12", "toBar": 9 }
```

**`resize_clip`** `{clipId, lengthBars}`: a new length (notes past the end stay in the clip but
don't play).

```json
{ "op": "resize_clip", "clipId": "clip-12", "lengthBars": 8 }
```

**`remove_clip`** `{clipId}`.

```json
{ "op": "remove_clip", "clipId": "clip-12" }
```

**`duplicate_clip`** `{clipId, toBar, trackId?, linked?, ref?}`: a copy at `toBar`; `linked: true`
links it to the original (they then play the same notes).

```json
{ "op": "duplicate_clip", "clipId": "clip-12", "toBar": 17, "linked": true, "ref": "again" }
```

Audio clips and take folders play recordings: ops can't change them.

### Tracks

**`add_track`** `{instrument, name?, ref?}`: a new track with the instrument's usual starting
settings. `instrument` is a key from `list_instruments` (instruments that need sound files or a
plugin can't be added).

```json
{ "op": "add_track", "instrument": "realCello", "name": "Cello", "ref": "cello" }
```

**`set_track`** `{trackId, volumeDb?, pan?, mute?, solo?, name?, reverbSend?, delaySend?, distance?, output?}`:
the mixer: volume -60 to +6 dB, pan -1 to 1, reverb send 0 to 3, delay send 0 to 1, distance (how
far back on the stage) 0 to 1, output a bus's track id or `null` for the master.

```json
{ "op": "set_track", "trackId": "track-2", "volumeDb": -9, "pan": -0.3, "reverbSend": 0.25 }
```

**`set_eq`** `{trackId, low?, mid?, high?}`: the 3-band EQ, -24 to +12 dB each.

```json
{ "op": "set_eq", "trackId": "track-2", "low": -3, "high": 1.5 }
```

**`set_insert`** `{trackId, insert, settings}`: an insert's settings, merged onto what it has.
The inserts: `distortion`, `compressor`, `chorus`, `filter`, `pump`, `lofi`, `gate`, `echo` (the
Delay), `reverb`, `human`, `peq`, `mbc`, `saturate`, `monoLow`. `list_inserts` gives each one's
settings with defaults and ranges. `on: true` switches it on.

```json
{ "op": "set_insert", "trackId": "track-2", "insert": "filter", "settings": { "on": true, "type": "lowpass", "cutoff": 1200 } }
```

**`set_instrument`** `{trackId, instrument}`: another instrument for the track (its clips stay).
Not to or from a bus or a return, and not between the Drop pad and an instrument once the track
has clips.

```json
{ "op": "set_instrument", "trackId": "track-4", "instrument": "synthDesigner" }
```

**`set_synth_preset`** `{trackId, preset}`: a Synth Designer track plays one of the presets
(`list_presets`).

```json
{ "op": "set_synth_preset", "trackId": "track-4", "preset": "Warm pad" }
```

### Automation

**`set_automation`** `{trackId, param, points: [{bar, value, curve?}]}`: draws a lane (replacing
the one there). `param` is from `list_params`: `volume`, `pan`, `filterCutoff`,
`filterResonance`, `reverbSend`, `delaySend`, `eqLow`, `eqMid`, `eqHigh`, an insert's setting like
`fx:reverb.mix` (drawing it switches the insert on), or `send:<return track id>`. A point's value
is the lane's height, 0 (bottom) to 1 (top); `curve` (-1 to 1) bends the line to the next point:
above 0 starts slow and speeds up, below 0 starts fast and settles.

```json
{ "op": "set_automation", "trackId": "track-1", "param": "filterCutoff", "points": [{ "bar": 13, "value": 0.2 }, { "bar": 17, "value": 0.9, "curve": 0.5 }] }
```

**`remove_automation`** `{trackId, param}`.

```json
{ "op": "remove_automation", "trackId": "track-1", "param": "filterCutoff" }
```

### Tempo

**`set_tempo`** `{bpm}`: the starting tempo, 40 to 240. Markers held to their time keep their time.

```json
{ "op": "set_tempo", "bpm": 96 }
```

**`add_tempo_change`** `{bar, bpm, ramp?, ref?}`: a new tempo from a bar (`ramp: true` glides into
it from the change before).

```json
{ "op": "add_tempo_change", "bar": 17, "bpm": 104, "ramp": true }
```

**`remove_tempo_change`** `{id}`.

```json
{ "op": "remove_tempo_change", "id": "tempo-3" }
```

### Markers

**`add_marker`** `{bar, name?, ref?}` (one marker to a bar), **`move_marker`** `{markerId, bar}`,
**`rename_marker`** `{markerId, name}`, **`remove_marker`** `{markerId}`. Markers name the song's
sections.

```json
{ "op": "add_marker", "bar": 25, "name": "Bridge" }
{ "op": "move_marker", "markerId": "marker-2", "bar": 9 }
{ "op": "rename_marker", "markerId": "marker-2", "name": "Chorus" }
{ "op": "remove_marker", "markerId": "marker-2" }
```

### Master

**`set_master`** `{levelDb?, glue?, ott?, width?, loud?, clipper?}`: the master section. `levelDb`
-24 to +12; `glue` one of `standard`, `gentle`, `punchy`, `tight`, `off`; `ott`, `width`, `loud`
and `clipper` are merged onto what they have (`list_master` gives their settings and ranges).

```json
{ "op": "set_master", "levelDb": -1, "width": { "on": true, "amount": 1.2 } }
```

## The song as the agent reads it

Bars are four quarter notes long whatever the time signature: every bar number you send or read
(`startBar`, `fromBar`, `regions`, a note's `bar`...) counts those. In a song not in 4/4 the
musician's ruler numbers measures instead, so the sentences the studio writes for them (a
suggestion's `changes` and `warnings`, the card) name the measures the ruler shows ("at bars 9-10"
for your bar 7 in 3/4; "Bar 666 beat 2 is past the end of the timeline" for your bar 500), and
lengths in quarter notes, while the numbers stay your bars. In 4/4 the two are the same. A
before-and-after too long to hear at once is cut where a measure starts (part way through a bar, after a measure of another length: `audition` and `unheard` can then hold part-bars). In those sentences the
names of tracks, clips and markers (yours or the musician's) are marked as names, and a lane's
points are counted from 1.

`get_song` gives a summary of schema `fledgetone.agent-song/1`, at most 30 KB (detail is left out
first, and `omitted` says what):

| Field | What it is |
| --- | --- |
| `schema`, `revision` | The schema, and the studio's edit count (0 for a file): `wait_for_changes` tells you when it moves on |
| `app` | `{version, projectVersion}` of the app that read it |
| `songId`, `name` | The song's id (the same through renames) and name |
| `tempo` | `{bpm, changes: [{id, bar, bpm, ramp}]}` |
| `meter` | `{base: "4/4", changes: [{bar, meter}]}` |
| `key` | The key the notes suggest ("D minor"), or null |
| `lengthBars`, `lengthSeconds` | To the end of the last clip |
| `loop` | `{inBar, outBar, on}` |
| `markers` | `[{id, name, bar, seconds, heldTo: "bar" \| "time"}]` |
| `sections` | `[{name, fromBar, toBar}]`, from the markers (or every 4 or 8 bars without any) |
| `tracks` | `[{id, name, instrument: {key, name, category}, role, volumeDb, pan, mute, solo, reverbSend, delaySend, distance?, eq?, output?, sends?, inserts: [{insert, settings}], automation: [{param, label, fromBar, toBar, pointCount, points}], synthPreset?, folder?, stemGroup?, mixTrack?}]`. `role` is drums, bass, pad, lead, fx or other; `inserts` lists those that are on, with the settings that differ from their defaults |
| `clips` | `[{id, trackId, name, startBar, lengthBars, kind: "notes" \| "audio" \| "takes", notes, range?, linkedTo?}]`: `notes` is how many, `range` the lowest to highest pitch ("C2-G3") or the drum rows |
| `master` | `{levelDb, glue, ott, width, loud?, clipper?, monoLow}` |
| `omitted` | What was left out to stay small |

It never holds sounds, video or plugin settings. `get_notes` gives notes as
`{id, clipId, trackId, pitch, start, bar, length, velocity}` (`start` in the clip, `bar` in the
song).

## Suggestion files

`suggest` in file mode writes, and `fledgetone apply` reads:

```json
{
  "format": "fledgetone-suggestion",
  "version": 1,
  "songId": "the song's id",
  "touchedHashes": { "clip:clip-12": "b1fcf5be2e60cf4b", "track:track-2": "c6e5eab17555d55c" },
  "title": "A kalimba answer",
  "explanation": "Two notes answer the phrase in bar 8.",
  "opsVersion": 1,
  "ops": []
}
```

`touchedHashes` are fingerprints of what the ops touch, as it was when the suggestion was made.
When it's applied (or accepted in the studio): the song unchanged, it applies; changed elsewhere
but not in what it touches, it applies again to the song as it is now (in the studio it's made
again when the musician hears it); something it touches changed or went, it's out of date and
isn't applied. A track's mute, solo, name and colour don't count (the musician's mute and solo
stay as they are when it goes in). In the studio, a suggestion out of date waits again once what
it touches is as it was (an undo, say), and Accept takes a suggestion in one press only as the
musician last heard it, on the song as it is; otherwise the first press offers "Accept without
listening" and a second, separate press accepts it. A suggestion made before another song was opened can't be
accepted at all. The same ops on the same song always give the same new ids, so what you heard is what
you get. Applied to a song that already holds ids made for it (the same suggestion applied a
second time), they get new ones (`<id base>~2`, `~3`...), so no two things ever share an id.

## The connection

The studio is a page in your browser, the helper a program on your computer; they talk over a
WebSocket on `127.0.0.1` only. Messages are JSON text frames:

```json
{ "v": 1, "id": "r7", "kind": "req", "method": "get_song", "params": {} }
{ "v": 1, "id": "r7", "kind": "res", "result": { "schema": "fledgetone.agent-song/1" } }
{ "v": 1, "kind": "event", "method": "changed", "params": { "revision": 12 } }
```

An error answer is `"error": {"code", "message"}` in place of `result`.

**Pairing**, once per connection, before anything else:

1. The helper makes a code (12 characters of Crockford's base 32, `0123456789ABCDEFGHJKMNPQRSTVWXYZ`:
   60 bits, shown as `K7QM-3XPD-9TBW`; typed O counts as 0, I and L as 1) and the agent tells
   you. It lasts 10 minutes, and is used up once a studio pairs.
2. The studio connects to `127.0.0.1:<port>`, the port in its box; the helper sends `hello` with its nonce S: `{protocol: 1, nonce, server}`.
   A program on the port that opens the connection but sends no `hello` within 10 seconds, or
   sends something else, is told apart: the studio says the helper isn't answering on that port,
   or that the program on that port refused the connection; only a `hello` of another protocol
   version asks you to update the command line tools.
3. The studio sends a `pair` request with its nonce C and nothing about the code: `{protocol: 1, nonce: C, app, permissions}`.
4. The helper proves first: `{proof: HMAC-SHA-256(code, "C.S.server.A"), nonce: <S for the next try>, attemptsLeft}`.
   A is the address `127.0.0.1:<port>` with the port the helper listens on. The studio shows
   `attemptsLeft` only as a whole number from 0 to 5, and counts the tries itself too (never more
   than five a connection, whatever the other end says).
5. The studio checks that proof against the code you typed, with A the address it dialed. If it
   doesn't match (a typo, the wrong port, or a program that isn't the helper your agent started),
   it says so and sends nothing more; you can type the code again (a new try, bound to the new nonces).
6. Only if it matched does the studio send `pair_confirm` with `{proof: HMAC-SHA-256(code, "S.C.studio.A")}`.
   The helper checks it and answers `{server, agent}`: paired. No song data moves before this.

The code itself never travels. Binding A into both proofs means a program on one port that
passes the frames on to the real helper on another (a relay, which would read everything) can't
pair: the helper's proof is for its own port, the studio checks it against the port it dialed,
and they differ. Every try is counted before the helper works anything out, and
it works out one at a time: five tries on a connection close it, twenty on one code retire the
code (ask the agent for a new one). A `pair_confirm` with a wrong proof closes the connection.

**What's left to guess at.** Without a password-authenticated key exchange, one side has to prove
it knows the code first, and that proof could be tried against guesses offline. Here it's the
helper, to whatever connects to it: a program on your computer could collect up to twenty such
proofs per code. A 60-bit code that lasts ten minutes is far beyond guessing that way, but it's
why the code is long, why it's good for one pairing only, and why the studio never proves itself
to anything that hasn't proved itself first (so a program waiting on the port gets nothing it
could guess from).

**Requests** (helper to studio): `get_song`, `get_notes`, `get_automation`, `get_view`,
`preview_suggestion`, `suggest`, `get_suggestion`, `withdraw_suggestion`, `listen`, `say`,
`point_at`. Each needs what you allowed: reading for the gets, previews, `say` (with `replyTo`) and `point_at`;
seeing your selection for `get_view`; suggesting for the suggestion requests; listening for
`listen`. Otherwise the studio answers `not_allowed`.

**Events** (studio to helper): `changed` (a new revision), `view`, `suggestion` (`{id, status}`:
accepted, undone (Undo took it out; a redo makes it accepted again), dismissed, out of date,
changed, other song (another song was opened), withdrawn), `permissions`, `bye`, and
`user_message` (`{id, text, at, suggestionId?, context?}`, sent only when the musician presses
Send; the helper keeps it plain text, drops one that isn't well formed, and keeps a retried id
once). **Helper to studio:** `user_message_status` (`{ids, status}`: `received` once the helper
has a message, `seen` once the agent has read it); the studio marks a message *Not sent* if no
`received` comes within 5 seconds or the connection goes. Suggestions,
messages and `point_at` never open the panel or take the keyboard focus, and `point_at` can't
point at anything in the Suggestions panel.

**Limits:** frames up to 2 MB; a ping every 15 seconds (no answer: the connection is dropped);
requests time out after 15 seconds (listening after 2 minutes); and the tools' own limits above.

## The studio from the helper

Safari and Brave don't let a page from fledgetone.com connect to a program on your computer. For
them, the helper can serve the studio itself: start it with `--studio`

```json
"args": ["/path/to/fledgetone/tools/cli/dist/fledgetone.mjs", "mcp", "--root", "/path/to/your/songs", "--studio"]
```

and open the address it says on stderr, `http://127.0.0.1:47200/` (or `/app/`), in your browser
on the same computer. It's the same app, served from a build in your copy of the repository
(`npm run build`, or `npm run build:site`; `--app <folder>` for another), and the helper lets it
connect. Its saved songs and settings are its own, apart from fledgetone.com's (a browser keeps
them per address): save a song as a file to move it between the two.

`fledgetone studio [--port 47200] [--app <folder>]` serves it on its own; a helper started apart
from it then needs `--allow-origin http://127.0.0.1:47200` to let it connect.

## Security and privacy

- **Nothing leaves your computer because of Fledgetone.** The app sends nothing anywhere, the
  helper listens on `127.0.0.1` only, and neither has an account or a key. Your agent, though,
  sends what it reads to whoever runs it (a cloud model's provider, usually): connect only an agent
  you'd show the song to.
- **You choose, every time.** Pairing is per session, by a code you type. The agent reads only
  what you allowed (read-only until you tick more), and it can only suggest: there's no way for it
  to accept, save, export or delete. Untick something and it stops at once: a selection about to
  be sent isn't, and a listen under way stops and answers `not_allowed`. Selecting clips isn't an
  edit, so an agent that may not see what you select doesn't hear of it as a `changed` either.
- **Only Fledgetone's own pages connect.** The helper refuses pages from other sites (the Origin
  must be `https://fledgetone.com`, the studio it serves itself with `--studio`, or the dev server
  with `--dev`; never a page with no origin of its own, `null`: a file opened from disk reads so,
  but so does any website's sandboxed frame, which could then spend the code's tries), any address
  but `127.0.0.1:<port>` exactly (so another site can't reach
  it through a name of its own pointed at your computer), and a second studio while one is paired.
- **Only the helper you started, on the port you typed.** The pairing proof works both ways, the
  helper's first, and both proofs are bound to the helper's address (`127.0.0.1:<port>`): a program
  that took the port first can't pass for the helper, nor pass the connection on to the real
  helper on another port (the proofs don't agree across two ports), and the studio sends it
  nothing about the code or the song. The helper never moves to another port by itself when its
  own is taken (it says so), the agent says the port with every code, and the studio starts at the
  usual port each time rather than one typed before.
- **Files stay in their folder.** The agent's file tools reach only `--root`, and only songs,
  suggestion files and audio. `apply` never writes over the song it reads, and `render_file`
  writes only audio files, never through a link or over a file unless asked.
- **Renders stay on your computer.** The browser that renders a file is started by the helper
  with no window, opens only a page the helper serves on `127.0.0.1`, and is refused every other
  address but one: the app's own site, for the recordings of instruments it doesn't have yet (the
  same files the app downloads; nothing about the song is sent). With `--offline` it downloads
  nothing. It's closed when the render ends, also when it fails or takes too long.
- **Nothing a program on the port says is shown before it has proved itself.** If the pairing is
  refused, the dialog says why in the studio's own words (by the error's code), never the words
  the other end sent; nor is the name it gives in its `hello`.
- **What an agent writes is shown as plain text**, its names cut to 64 characters. The names it
  gives in ops (a track's, a clip's, a marker's) are kept the same way: no control, invisible or
  direction characters ever reach the song, and a name of nothing visible is refused.
- **What the agent reads of a song is plain text too.** A song file's names and ids (and the words
  built from them: what a suggestion changes, why it's out of date, a listen's tracks) reach the
  agent without control characters or invisible ones (hidden tag text, zero-width characters,
  direction overrides), by the same rule as your messages. An id that held them is read, and can
  be named in ops, without them; if it would then read as another id (or as nothing), it's read
  as `<id>~<6 letters>` instead (more letters if another id already reads so: a file can be made
  to), the same in every answer, so each id names one thing only. The command line prints nothing
  from a file with terminal escapes in it.
- **Each pairing is its own.** An agent sees, withdraws and listens to only the suggestions it
  made while paired this time, never those of an agent paired before.
- **What you write to the agent** goes only when you press Send, only to the paired helper, and
  carries your selection only if you tick "Include what I've selected" (and allow it to see what
  you select). It's kept in memory only (the tab, and the helper until you disconnect), never saved.
- **Logs** go to stderr, never into the protocol.
