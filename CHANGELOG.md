# Changelog

What's new in each version of Fledgetone, newest first. Your version is shown at the bottom left
of the studio: click it to read this list. Each version is named after the day it came out (a
second update on the same day gets `-2`, and so on).

## Unreleased

- **A song with thousands of tracks, clips or markers opens in seconds**: a short share link or song file with 1,500 tracks froze the page for over two minutes (and then opened again by itself at every start), and one with 60,000 clips or markers for over a minute. A song now opens with at most 256 tracks, 10,000 clips, 5,000 markers, 4,000 tempo changes, 400 time signature changes, 256 takes in a clip, 200 stingers, 50,000 points in an automation or expression lane (500,000 in all) and a few thousand sounds and game rules (the app's own songs have a few of each), and says plainly what past that was left out, when you open the file, when you open the link, and to your agent if a suggestion would go past it. Opening a song with many clips also no longer takes longer and longer the more clips it has.
- **A song can't grow past what it opens with**: an edit that would put more than 20,000 notes in a clip (select all and duplicate, again and again), or take a song past any of the most it opens with, isn't made, and says why, in the studio and in Pocket. Before, the song kept it while open, but opened again without the notes past that, without a word, and the next autosave lost them.
- **A last session that opens without some of it is kept whole**: if the song autosaved in your browser (or a session offered back) holds more than a song opens with, as an older version could save, it opens without the part past that and says so, and its full copy is kept in the browser, apart, so nothing writes over it. Going back to such a kept version says what it opened without too; the version itself stays as it was.
- **A song that froze the app isn't opened again by itself**: a song that took more than a few seconds to show when it opened is now offered at the next start (the Restore banner and Pocket's start screen) rather than opened again by itself, as a song that stopped the app from showing already was.
- **Your agent hears every change of what you select once you allow it**: ticking "See what I select" after connecting, then putting the selection back as it was when you connected, told your agent nothing, so it went on thinking the old selection was still there.
- **Redo is read out like Undo**: a Redo that puts an accepted suggestion back into your song is now said by a screen reader, as Undo already was.
- **Your agent is disconnected when the studio stops showing**: when something went wrong and the studio showed its recovery screen, your agent stayed connected and could go on reading the song and making suggestions no one could see. It's now disconnected, and told the studio stopped showing.
- **A Game tab switch pressed late goes round the loop**: a switch pressed too late for the next line while a state loops, when the next line it could reach was after the loop goes back to its start, was timed as if the song played straight on. With a tempo change at the loop's end it landed between beats, and with a phrase timing it waited a whole extra phrase instead of switching where the loop ends. It now follows the loop round, at the loop's own tempo, and switches on the next line it plays.
- **Stop, Pause or another state calls off a switch on its way**: pressing Stop or Pause (or another state) while a switch was waiting for its line still played its impact, riser or fill a moment later, at full loudness, and then moved the song to the new state; a switch moved to a later line played its cue on the line it missed. Now nothing of a switch that hasn't reached its line plays (a riser already rising fades out), the button stops pulsing, and the cue comes on the line the switch lands on. A stinger or bridge that has already started still plays out after Stop, as before.
- **A Drum Rack pad you play doesn't silence the song's next hit**: a pad played live just before a song hit in the same choke group took the song's hit out (it never sounded, and the pad you played rang on). The later hit now cuts the earlier one when it comes, whichever was played first. Exports are unchanged.
- **The studio never goes blank**: if something goes wrong while the studio or Pocket is drawn, a plain screen now takes its place, offering to set the song that's open aside and start fresh. The song isn't deleted: it's kept in Versions and offered back when the app opens, and a song that stopped the app from showing is never opened again by itself at the next start (the Restore banner and Pocket's start screen say so).
- **A song with hundreds of thousands of notes opens**: a short share link or a song file with a clip of about 200,000 notes left the studio blank, again at every reload. A song now opens with at most 20,000 notes in a clip and 200,000 in all (the busiest starter has under 800), and says plainly how many notes past that were left out; drawing and working out a song's highest and lowest no longer breaks on a long list.
- **Pointing at a control tells your agent nothing about your screen**: unless you let it see your view, your agent gets the same answer when it points at a control whether that control is on screen or not (it could tell what was open from the answer). With See ticked, it's told when there's no such control on screen, as before.
- **Glue off takes away the bus it made, whatever its name**: in a song whose Glue bus had an id like "toString", switching Glue off left the bus in place.
- **An agent's out-of-range Loud crunch is pointed out**: a crunch below 0 was quietly set to 0 without a warning (one above 1 was already pointed out).
- **A Game tab switch lands on the line even when you press close to it**: switching state "on the next beat" or bar without a stinger, pressed closer to the line than the studio plays ahead (often, with Stable playback or once playback had settled), started the new state between lines, up to about a third of a second off. It now goes to the next line it can reach, and starts on it.
- **A suggestion that can't go in is never reported as accepted**: when a suggestion couldn't be put into your song, your agent was briefly told you had accepted it before being told it was waiting again, and a screen reader said it was waiting for you as well as that it couldn't go in. Now your agent hears nothing, and a screen reader says only that nothing was changed.
- **A Multi Sampler note sliding while its clip's bend moves**: a note with its own slide in a clip whose bend lane changed while the note was still sliding kept playing the lane's bend from when the note started (an A sliding up a tone under a lane that went up a tone halfway through stayed up to two semitones low), and live it came out differently again. The lane's change now adds to the slide from where it happens, live and in exports alike.
- **A Drum Rack hit due just after Stop or Pause stays silent**: a pad hit due a moment after you pressed Stop or Pause (within about 15 milliseconds) still played a short burst, at up to nearly full loudness the closer it was. It now never starts; a pad already sounding fades from where it is, as before, and a choke between pads that are sounding still fades the one cut.
- **Songs with a plugin instrument and the shared delay export the same every time**: on the Twin Analog (and any instrument that makes a faint sound from the moment it is loaded), a song sending to the delay came out a hair different from one export to the next (far too quiet to hear, but the files weren't identical). The delay now hears nothing in the silence before the song starts, so the same song always exports to the same file. Exports otherwise sound exactly as before.
- **A song naming a word every page object has built in opens safely**: a song file, share link, kept version or saved session with a track playing "toString", "constructor" or another such word as its instrument left the studio blank, again at every reload. Such a track is now left out like any instrument this version doesn't have (the rest of the song opens, and says a track couldn't be read). A sound in My sounds naming one is left out, and your agent can no longer suggest one. Ids and notes named so are read as plain names, and a share link can no longer slip settings into a track that way.
- **Accept is all or nothing**: if a suggestion can't be put into your song, nothing of it goes in, your undo steps are as they were, and the card says so.
- **Settings from a file stay in the studio's own ranges**: a song file or link with a track EQ beyond the EQ's own range (−24 to +12 dB) played it far louder than the studio can set; it is now brought into range, as are a frozen track's level, notes and markers placed impossibly far away, a reference video's start, a time signature change past the end, and a stinger's note loudness.
- **The command line and game kit read names as names**: `fledgetone list` and `--bits` given such a word say what they take, and the game kit's player treats a stem group or effect named so as a plain name.
- **A Multi Sampler note's own bend under a clip's bend**: a note with its own bend (drawn on it, or played on an MPE keyboard) in a clip with a bend lane played the lane's bend alone, its own lost (an A bent up a tone under a lane of a semitone played a semitone up). On the Multi Sampler each note bends on its own, so its own bend now adds to the clip's (and to the keyboard's main pitch wheel), live and in exports, as an MPE note's does.
- **A suggestion's before-and-after compares like with like**: where the stretch you asked to hear starts with a note still ringing from before it, the song as it is and the song with the suggestion were each rendered from their own run-in, landing up to about a millisecond apart, so every bar read as "sounds different" when only one had changed. Both are now rendered from the same start and line up exactly, in the studio's before-and-after and in your agent's listen.
- **Stop and Pause call off the notes about to play**: a note or drum hit due just after you pressed Stop or Pause had already been handed to its instrument, and on many instruments it still played, often at full length (the drum kits and drum machines nearly at full loudness, the Space Clav and other keys, brass, pads, Slap Bass, Sub-Bass, the Analog Lead, the 808 Bass, every recorded instrument, the Slicer, the Sampler and the Multi Sampler). They now never start; what was already sounding fades out as before (drum hits ring out), and with Pause the note plays once when you press Play again. A recorded note let go during its swell (a bowed cello's) fades from where it had got to instead of jumping to full loudness, and the sound of a key let go (a piano's damper) no longer plays after Stop where the note would have ended. Exports are unchanged.
- **The metronome stops with you**: a click due just after you pressed Stop or Pause still sounded; it no longer does, and after Pause it clicks once when you play again.
- **Game tab switches land on the line**: switching state with a stinger or bridge timed to the next bar or beat let the song's note on that line sound before the song stopped (and a brass or pad note rang on under the stinger), and the stinger started a little late, by the delay between the studio and your speakers. The song now stops on the line, the stinger, cue and bridge start on it, and a plain switch lands on it too.
- **A long bent note begun under a shorter one keeps its bend**: on an instrument that bends as a whole (the built-in synths, Fledge Synth, the recorded instruments), a long note with its own bend begun while a shorter bent note was still held jumped to its unbent pitch where the shorter note's tail would have ended (about a second after it, on the piano, violin and cello), and stayed there to its end. The same happened to a bent note begun a little later, after a plain note had cut the shorter note's tail short. It now keeps its own bend throughout, live and in exports.
- **A scooped note's tail under a clip's bend that ends**: a note sliding up into its pitch (its own bend back at rest) kept the clip's last bend through its tail when the clip's bend went back to rest after it; its tail now goes back with the clip, as a plain note's does, live and in exports.
- **A key you play stays in tune after a bent song note**: while a song note's bend rang on through its tail, a key played on the same instrument (the on-screen piano, a MIDI keyboard, note repeat, the pads) sounded at that bend (an E played just after a C bent up a tone came out as an F sharp). The song note's tail now lets go of its bend just before your key, as it does for the song's own next note.
- **A suggestion's before-and-after plays the right notes of a section that repeats**: where a note was held from before the stretch you hear (a long pad chord), the copy it belongs to was counted as the first of its run, so notes that play only on some passes ("1st of every 3") played in the before-and-after, your agent's listen and stems where the song doesn't play them (or the other way round). Which notes of a clip swing is also decided as in the whole song there.
- **Odd setting names from an agent read as plain words**: a setting, insert or choice an agent names with a word every page object has built in ("toString", "constructor") is no longer taken for one of the studio's own names; it is read as plain words like any other unknown name.
- **Stop and Pause are silent at once**: a note due a moment after you pressed Stop or Pause (up to a quarter of a second later, more while the page was busy) could still start after every other sound had been let go, and then rang its whole length. Nothing new now starts once you press them; what was sounding fades as before, and audio clips still fade out over a couple of milliseconds instead of cutting.
- **A Drum Rack pad cut short by its choke group fades from where it is**: a pad cut while it was fading in stayed silent until the cut, and one cut while it was fading out (as chopped samples do at their ends) jumped back to its full loudness until the cut. It now fades from the level it had reached, live and in exports (songs made from chopped samples can export very slightly differently where one chop cuts another in its fade).
- **Pocket's play button says "Pause" while playing**, as it pauses (it said "Stop" to screen readers).
- **Linking a clip to its copies is heard**: in a section with notes that play only on some passes ("1st of every 2", "50% of the time"), linking a clip to its copies, or unlinking it, starts a new run of copies, so its notes and those of every later copy play on other passes. A suggestion's before-and-after now plays all of that, from the clip on, as it does for a change of notes; with no such notes, a link is still nothing to hear. A change late in a clip like that now plays the clip from its start too.
- **Renaming a track can be heard, and the before-and-after now plays it**: a clip with a groove feel that takes its part from its track (no part chosen) plays as the bass, chords or lead by the track's name and the notes of all its clips, so renaming "Keys" to "Bass", or adding low notes far off, changes how it plays. Such a change is now heard wherever those clips play, and a note added to one of them plays the whole clip, since chords or lead is decided by all its notes. A clip's feel in a before-and-after that starts during a held note now plays as it does in the song. Exports sound exactly as before.
- **Changing a designed drum kit's sounds** in a suggestion is now listed under What changes and heard where the track plays (it was left out).
- **Plainer settings under What changes**: the track a Pump follows by its name, not a code; switches as "on" and "off", not "true" and "false"; choices as the studio's menus name them ("low-pass", "kick and snare", "1/4 dotted", "club (-6 LUFS)"); and a master part switched on (OTT, stereo width, Loud, clipper) with what it's set to, as a track's effect is.
- **A suggestion's before-and-after in a song in 3/4 or 7/8** plays the whole measures of the bars your agent asked you to hear when they fit, and a measure only partly played is listed whole among those not heard, so no measure is named as both heard and not heard.
- **Stop and Pause no longer bring a fading note back up**: on the recorded instruments (cello, strings, organ, piano, flute and the rest), pressing Stop or Pause while a note was dying away after its end made it jump back to its full loudness for a moment before it faded again. It now carries on fading from where it was. A Drum Rack pad fading out at its end likewise.
- **A note's own slide in a clip with a bend or vibrato lane** plays as written: the clip's bend, said again every sixteenth note even at rest, pulled the slide back for a moment each time (up to two semitones), live and in exports. While a note's own bend is away from centre, it now wins over the clip's.
- **A bent note's tail stays bent**: on an instrument that bends as a whole (the built-in synths, Fledge Synth, the recorded instruments), a note with its own bend went back to its unbent pitch the moment it ended, so its release rang at the wrong pitch, and recorded MPE takes exported differently from how you played them. Its bend now stays through its release, until the instrument's next note or a clip's bend takes over, as it does when you play live (where another note sounds on past its end, that one goes back in tune as before).
- **The sound of a key let go follows the bend**: the piano's damper, the harpsichord's jack and the guitar's string sound now play at the bent pitch, as the note does, instead of at its unbent pitch.
- **A note held to the end of a loop across a change of tempo** now sounds to the loop's end: it was cut by the tempo where it started (a loop of 120 then 60 BPM went silent 2 seconds early), live and in seamless loop exports.
- **A slide after a hold-up**: when the page was held up just as a note with its own slide was due, the note started late but its slide didn't, so it came in part way up. It now starts at the start of its slide (exports were never affected).
- **No more freezes from long bent notes**: a long note with vibrato or a slide under many short notes (a 16-bar vibrato under chords) could freeze the studio for half a minute and play almost silent on Analog Keys and the other built-in synths; it now plays smoothly. Recorded instruments, the Multi sampler and the 808 do less work for it too.
- **Two bent notes overlapping stay in tune**: on an instrument that bends as a whole, when the first of two bent notes ended, the one still sounding jumped to its unbent pitch until it ended. It now keeps its own bend.
- **Fledge Synth bends before a wide slide or dive**: where a note slid or dived more than two semitones later on, the bends before it played twelve times too wide (a semitone became an octave), or ones sent earlier too narrow after it. Each now plays as written.
- **Recorded instruments follow every bend**: on the grand piano and the other recorded instruments, a note could stop following a clip's bend or vibrato (or your wheel) once a later note's own bend had been sent, and stayed at its old pitch.
- **Very long bends**: a slide or vibrato on a note longer than about 30 seconds lost its start, so notes beginning early under it played unbent.
- **A suggestion's before-and-after in a song with a change of time signature** plays as much as fits again: after one measure of another length (a bar of 3/4 in a 4/4 song), it played a single bar, or nothing, and the suggestion could never count as heard. It now stops where a measure starts, even part way through a bar.
- **Plainer cautions on suggestions**: "Removing notes found none to remove in …" instead of an internal name and number; a clip that starts inside the timeline but wouldn't fit before its end now says so, instead of "past the end of the timeline"; one bar is "1 bar" and one quarter note "1 quarter note"; and where the song is silent, a louder suggestion says it plays turned down because the song is silent there.
- **A short note under a long held one is heard to the held note's end**: on a recorded instrument (a bowed violin's change of note, a fourth quick repeat of the same pitch, or too many notes at once), the keys, pad and brass synths, and the designed synth in mono, a new note ends a note still sounding, so adding one short note can silence eight bars of a held note, and taking it away lets them ring again. A suggestion's before-and-after now plays every note sounding over the change to where it stops, so one press can no longer accept bars you haven't heard. Songs sound exactly as before.
- **A swung song's clip is heard whole**: in a clip that plays the song's swing (new songs start with some) and starts off the song's grid of sixteenth notes, one note added can change which of its notes swing, all through the clip. A suggestion's before-and-after now plays all of that clip, so one press can't accept bars you haven't heard.
- **Undoing an unrelated edit** puts a suggestion you'd heard back as it was: it no longer asks you to hear it again, and your agent reads it as heard again.
- **Plainer words on suggestions**: "bar 52 wasn’t heard" for one measure in a song in 5/4 or 9/4 (not "weren’t"); the bars your agent asked you to hear, when they're played, are no longer listed among those you didn't hear; cautions name a track's effects and their settings as the studio shows them ("Mono bass frequency", "Multiband compressor low crossover", "the master OTT depth"), and an effect newly turned on is described with its settings ("frequency 300", not "freq none to 300").
- **Your agent reads a suggestion as the song is now**, straight after an edit, instead of as it was a moment before.
- **Your agent no longer reads a suggestion as heard** while the song has changed under it and it hasn't been made again yet.
- **A suggestion's before-and-after plays everything a note change changes**: some instruments play a note by the notes before it (recorded instruments that take turns between two recordings of each note, a guitar strumming down then up, notes that play only on some passes of a section, plugin instruments, a monophonic synth carrying on from the last note, a swung clip), so adding or taking away one note changes later ones too, up to the end of the song. Where a suggestion is heard now counts all of that, so one press can no longer accept changes you haven't heard. Songs sound exactly as before.
- **Let your own agent suggest changes (optional)**: if you use an agent that can use MCP tools, it can now read your song and suggest changes, from notes and levels to effects, automation and tempo. Each suggestion appears on a new **Suggestions** panel with what it changes in plain words; you hear it before and after on the same bars, then **Accept** it (one undo step) or **Dismiss** it. Nothing changes until you accept, the agent connects only with a code you type in **View › Let an agent connect…**, and Fledgetone sends nothing anywhere: your agent sends what it reads to whoever runs it. Not in the phone apps.
- **Reply to your agent**: the Suggestions panel now has a message box, so you can answer your agent, ask it questions or tell it what you'd like, and **Ask about this** on a suggestion asks about that one. Your messages and its answers show in order, each of yours saying whether it was sent and seen. Only what you type is sent, only when you press Send; your selection goes along only if you tick it; a message that couldn't be sent waits for you to press **Retry**. Nothing of the conversation is saved.
- **Fledgetone on the command line**: a new program for people who work with song files, or with an agent of their own. It describes a song, lists its notes, checks a file, compares two songs, starts one from a starter, applies a suggested change to make a new song (never over the old one), measures an export's loudness, and turns a song into a share link and back. An agent you already use can read a song file through it and suggest changes, which you apply yourself. Fledgetone sends nothing anywhere; your agent sends what it reads to whoever runs it. How to set it up is in the agent guide in the repository.
- **Render and listen to a song file, with no studio open**: the command line can now make a WAV or MP3 of a saved song (or of some bars, or one file per track), made exactly as Export makes it, and listen to bars of it: how loud they are, their peaks and balance, bar by bar and track by track, with the Mix check's findings in plain words. Given a suggested change, it listens before and after and says which bars sound different. Your agent can do the same with song files. It all happens on your computer, in a browser it starts and closes by itself with no window; the only thing it downloads is an instrument's recordings the first time a song uses it, from fledgetone.com, as the app does, and they're kept so that happens once (through your proxy, if you use one). Songs with plugins from other sites aren't rendered this way (it says which tracks): export those from the studio.
- **The studio for Safari and Brave, from your own computer**: those browsers won't let fledgetone.com connect to the agent's helper, so the helper can now serve the studio itself, on your computer only (`--studio`), and let it connect. The Connect dialog's help says how.
- **The JX10, DX10, EPiano and Piano plugins now play every note of a chord**: they kept only the last note that started at the same moment, so a chord sounded as its top note alone. Songs using them sound different now (fuller: the chords as written). A note that ended just as the next one started on them no longer hangs on, and neither does a note whose end met a controller lane's change. Stop and Pause fade them out over about 10 ms instead of cutting the JX10 dead with a click. A loud Piano chord no longer clicks: where its sound went over its limit, a sample dropped to silence (the same Piano below that level is unchanged).
- **Controller lanes after Stop or a loop going round**: where no clip has set a controller yet, a plugin's controllers now go back to where a fresh copy of it starts them, with its preset's own values, instead of a guessed middle or MIDI's usual resting place. The organ's speaker no longer switches to Slow after Stop or each time round a loop when its preset starts it Fast or stopped (8 of its 13 presets), and the JX10's cutoff, resonance, volume and filter lanes (CC 74, 71, 16, 3, 7) no longer stay where they ended. The organ's mod wheel and sustain pedal now switch its speaker without moving its Rotary speed knob. Songs with controller lanes on the organ, the JX10, DX10, EPiano, Piano, Surge XT or a Faust instrument can sound different where playback, a render of some bars, a loop or a game kit's loop starts after a lane; an export of the whole song plays as before.
- **A controller lane that moves a track's setting** (CC 7 volume, 11 expression, 10 pan, 71 resonance, 74 cutoff, 91 reverb, 93 delay) now leaves the track at its own setting until the first clip with the lane, and holds the value one clip leaves until the next clip's lane starts, then steps there, instead of setting the lane's first value from bar 1 and gliding across the gap between clips. Songs with such lanes sound different before their first lane and between clips (as their MIDI already played). A track's own automation lanes play as before.
- **Faust instruments sound the same everywhere**: Piano Model, Waveguide Brass and the other Faust instruments and effects started with a few settings between the steps their knobs show, until their settings were read back and put on again, so an export, a render on the command line and playback could differ, and an export of a song with many of them could come out differently each time on a busy computer. They now start exactly as their knobs say. Songs using them sound very slightly different (Piano Model's and Waveguide Brass's tone a touch), and the same each time. The mda Ambience, Detune and Limiter effects likewise.
- **Trimmed clips' controller lanes**: a lane on a clip you trimmed at its start or end now moves the track's setting (volume, pan, cutoff...) from the value the lane has where the clip now starts and to where it now ends, as the plugin's MIDI already played, instead of jumping to the first point still showing or stopping at the last one. Songs with such lanes sound different there.
- **Volume and expression together**: a track with both a volume (CC 7) and an expression (CC 11) controller lane now plays expression as a share of the volume, as MIDI instruments do, instead of the two lanes taking turns at the fader. Songs with both sound different where they overlap; one alone plays as before.
- **No more jumps or stuck notes on the JX10, DX10, EPiano and Piano**: a note played during the 40 ms fade after Stop or a seek no longer brings the old notes' fading tails back up at once: it waits for them to fall silent (40 ms at most) and plays from there. A burst of controller changes (hundreds at once, as a lane woken mid-song sends) no longer loses the note-off that follows, so the note doesn't hang, and more than 40 notes starting or ending at one moment all play and end (some a few milliseconds later).
- **Surge XT patches sound as they should after a song is opened again**: patches whose two layers (scenes) were set differently, such as Minor 7, Sync Echo and Future Split, changed sound (up to 3.5 dB louder) once a song was saved and opened, or depending on whether the studio had read the plugin's settings yet, so an export, a render on the command line and playback could differ. A setting left alone now leaves the patch as it is, and turning one moves both layers by the same amount, keeping the gap between them. Songs that used such a patch sound as the patch does again.
- **A held note that's bent stays bent** when a loop goes round, after a seek, or when its track is unmuted, on tracks with a controller lane: the bend jumped back to the note's own pitch there until the note ended. The same goes for your keyboard's pitch wheel and knobs while you play along: they stay where you left them as the loop goes round.
- **A bend at the end of a loop no longer carries over to its start**: where the loop's end fell in a bent clip and its start had no bend of its own, the start played out of tune (a tone high, say) when the loop went round, live and in seamless loop and game exports, until the next bend; after a seek it could stay that way. Playback that starts, loops round, jumps, or a track heard again now has the bend the song has there, on plugins and the built-in instruments alike, and a bent note still sounding keeps its bend. Songs without bends sound as before.
- **No more stalls when you move a fader or pan** on a track with long volume and expression (CC 7 and CC 11) lanes, such as a recorded knob: each change could freeze the studio for up to a second and a half during playback; now it takes a few milliseconds. The lanes sound the same.
- **Surge XT patches with a + or & in their name** (Bass+Drums, S&H Classic) loaded silent on some servers: their files now have plain names, and songs that use them find them.
- **A suggestion's before-and-after plays its echoes out**: where a suggestion is heard now counts a note's delay and reverb for as long as they ring (a long delay with high feedback for many bars), with the buses, returns and master reverb and delay the track feeds, instead of a second and a half. Whether the studio checks it by sound is decided by your song as it is, not by how long a suggestion would make it; when it can't check it, the card says so, and if part of it may ring on longer than the studio can know (a plugin, or an instrument's release), Accept always asks for a second press.
- **Hear on a suggestion plays at once**: it no longer waits while the studio checks the whole song by sound; the check runs while it plays, and the card says if it finds more to hear. Checks waiting in the background now carry on one after another, and one whose suggestion was answered, changed or made for another song stops. Bars on a suggestion's card are numbered as the ruler numbers them in songs not in 4/4.
- **Without Listen ticked, your agent no longer learns where your song sounds different from the studio's check by sound**: it reads only where the studio's rules say a suggestion is heard.
- **Agent text that spells the app's name in squared, circled or flag letters**, or with a sign standing for a letter (a euro sign for an e), is now shown in quotes as the agent's, never as the studio's.
- **Echoes and reverb moved by a clip's lanes ring out in full**: a delay or reverb send turned up by a clip's controller lane (CC 93, CC 91), by a step lane, or by a controller you mapped with MIDI learn (to the delay's feedback, say) now counts as the same send drawn as automation. An export no longer fades out such echoes while they're still sounding (one ended 8 seconds in at -33 dB instead of ringing on for 14), and a suggestion's before-and-after plays them out, at the song's slowest tempo. Songs without such lanes export exactly as before.
- **Echoes into a return's or a bus's reverb ring out in full in an export**: a track whose own Delay plays into a bus or sends to a return with a long Reverb (or into the master reverb) had its export faded out while the reverb of the last echoes was still sounding (at about -48 dB); the ring-out now runs for the echoes and then the reverb, one after the other, and the file ends once they've died away. Songs where nothing rings on through another track's effects export exactly as before (all the starters do).
- **A suggestion on a track another track ducks to** (with the Pump following that track, or the drums) is now heard for as long as the ducked track's own echoes and reverb carry the change.
- **Heard while the studio was still checking**: if you heard all of a suggestion while the studio checked it by sound and stopped before the check was done, it now counts as heard once the check finds nothing past what you played, and the card and Accept say that plainly, instead of asking you to hear bars you'd already heard. A song too long to check says so at once, without first announcing a check.
- **Bars by measure everywhere on a suggestion** in songs not in 4/4: its cautions ("past the end of the timeline"), the before-and-after's limit (in quarter notes) and the selection under your message now number bars as the ruler does.
- **Without Listen ticked**, whether your agent reads a suggestion as heard depends only on the bars the studio's rules found, never on the check by sound (nor does anything else it reads).
- **Agent text that spells the app's name with a sign in place of a letter** (a ring for an o, a cross for a t, a bar for an l) is now shown in quotes as the agent's, never as the studio's.
- **Names in a suggestion's cautions**: a caution about an automation point brought into range now shows the track's name apart, as every other caution does, so a name your agent gave a track can't read as the studio's own words; it counts the points from 1 and names their bars by measure, as the ruler does. A send's lane in What changes shows its return's name apart too.
- **Heard, even after hearing another suggestion**: if you heard all of a suggestion while the studio was still checking it by sound, then heard another one before the check was done, the first now still counts as heard once its check finds nothing past what you played.
- **Too long to hear at once, in songs not in 4/4**: the before-and-after now stops where a measure starts, so the bars you hear and those you don't never share a measure, and its loop goes round on a measure.
- **Very short notes in a caution**: a note or clip shorter than a sixteenth note is now said to be that, instead of "a note length of 0 quarter notes".
- **A note that runs past its clip's end** plays its whole length, as it always has; now a suggestion's before-and-after, the check by sound and Accept count it to where it stops, and an export or a render on the command line rings out until it has (one ended 25 seconds early). Songs where no note runs on past the end of the song export exactly as before (all the starters do).
- **Ducking under a proxy track**: a suggestion that changes the dialogue or sound-effects track the rest of the music ducks under is now heard wherever the music dips for it, and as long as the music's echoes and reverb carry the dip.
- **Louder or quieter, as it really is**: a suggestion that turned a part of your song down could say it was about 6 dB louder, because the loudness measure leaves out the quietest parts and the change made more of them quiet enough to be left out. The before-and-after (and the command line's listen) now compares the same moments of both, so a change of level reads as that change. A suggestion that really is much louder is still played turned down.
- **Agent text that starts with a long row of signs** (lines, dots, emoji) before the app's name is now shown in quotes as the agent's, however long the row.
- **A held bent note stays bent when you move the playhead or unmute its track** while it sounds: it went back to its own pitch there (on the built-in Lead and on Fledge Synth, for example), though it still sounded.
- **No more notes bending to a note from elsewhere in the song**: after Stop and Play from another bar, or a jump while playing, the built-in synths and basses (the Lead, Slap Bass, 808 and others) kept sliding along with a bent note from where the song had been, so the notes where it now played went out of tune. A bent note crossing the loop's end no longer bends the loop's start either. A bent note from before a jump now keeps the bend it has until its instrument's next note, which plays in tune (as the song is there).
- **Your keyboard's pitch wheel stays where you hold it as a loop goes round** on the built-in instruments and the recorded ones (the violin, say), as it already did on plugins: it snapped back to centre each time round.
- **Recorded instruments no longer play a tone sharp after a bent note**: on the violin and the other recorded instruments, the notes after a note with its own bend could start at the bent pitch (a whole tone high) where a loop went round, live and in seamless loop and game exports.
- **The Export dialog no longer freezes on songs with long controller lanes** (a recorded mod wheel or expression on many tracks): each click could take up to 3.5 seconds, and during an export the progress bar and Cancel stalled for seconds at a time. Now a click takes a few milliseconds and the export runs without stalls. The files are the same.
- **The game audition pads** keep Tab inside their dialog and give focus back to where it was when they close, as every other dialog does.
- **No more sound going round in a loop between a bus and a return**: a return could play into a bus that sent to that same return, so the sound fed back into itself, louder each time round, up to full level, and kept sounding after Stop. Routes like that can't be made any more: in the track menu and the Mixer, a bus or return that would make a loop is greyed out with the reason ("the sound would go round in a loop"), however long the way round. A song saved with such a loop opens without the send that closes it (the outputs stay), and it plays, exports and renders on the command line without it; `fledgetone check` lists it. Songs without a loop are unchanged.
- **A note bent with its own pitch wheel on an MPE keyboard no longer leaves the instrument out of tune**: on an instrument that bends as a whole (Analog Lead, the basses, the plugins), a note let go while bent left its bend behind, and the song then played a semitone sharp, even after Stop. The note's bend now stays with it while it rings out (and while the sustain pedal holds it), so its tail no longer drops back in pitch when you let the key go; the instrument goes back to the master wheel just before its next note, or once the tail has died away. Stop, Pause and Free memory now also centre your keyboard's pitch wheel and forget it, so the song plays in tune when you start again.
- **Slides and dives stay smooth on a busy computer**: a note's own bend is sent in full when the note starts, so the studio being busy for a moment no longer holds a slide still and then jumps it on (by more than a semitone after a one-second hold-up). A jump, the loop going round, Stop and Pause still drop the rest of it, and the recorded instruments, the designed synths and the basses start each later note at the bend in force when it starts.
- **Bent notes ring out in tune at the end of an export**: in a ring-out (Export, the command line, an export of some bars, stems, freezing a track) a note still sounding at the end of the range froze part way through its bend, and other notes ringing on an instrument that bends as a whole stayed out of tune to the end of the file. They now finish their bends as in the song.
- **Previews and before-and-after of a note held over the start**: a note begun before the bars played and still sounding there now plays with its own chance, Human drift, passes and groove feel, as in the song, instead of as if it were a different clip (a different set of notes, or several dB too loud with a feel's accents).
- **Notes longer than the loop end where the loop goes round**, and ring out from there: a note that ran on past the loop's end kept sounding under its own next copy, so a long pad or drone piled up a copy every time round and got louder and louder (by 25 dB and more), live and in seamless loop exports. A seamless loop file now sounds as the loop does going round. Loops without such notes play and export as before.
- **The export dialog says how long a ring-out really runs**: where a note sounds on past the end of the range, it now says so and gives the time the file can run on for, the same as the file it makes (it said at most 6 seconds for a file that ran on for 15). "1 bars" now reads "1 bar".

## 2026.10.29 — Studio-quality sound: cleaner exports, recordings, pitch and stretch

- **Cleaner time-stretch, Move to key, Tune and Mangle**, in new songs and the ones you already have:
  - **Follow tempo** and warp markers stretch anything tonal (chords, pads, keys, voices, mixes) with a phase vocoder instead of joining short windows: a held chord no longer buzzes between its notes (what lands between them dropped from -15 to -20 dB to under -58 dB at 0.8 to 1.5 times the speed), and the level no longer ripples. Attacks and the drums in a mix stay sharp and on time. Drum loops are heard as drums and stretched exactly as before. The work happens in the background, so the page doesn't stall while a stretch is made.
  - **Move to key** keeps a chord clean (-50 to -74 dB between its notes from 1 to 7 semitones, -35 dB an octave up, against -12 to -25 dB before), with the same length and timing. Clips moved before are made again by themselves when the song is open.
  - **Tune vocal** and **Hard tune** place every cycle of the voice to a fraction of a sample, so the tuned voice no longer gets a hiss over its top (on a test tone pulled 30 cents or moved 2 semitones, the noise over 4 kHz was as loud as the harmonics there; now it's 40 to 90 dB under them). Double this take and Chop my voice get it too.
  - **Mangle**'s **Formant** moves only the voice's resonances, so nothing new comes in between its harmonics and the level stays steady; **Pitch**, **Stretch** and **Squeeze** use the new stretch.
- **Studio-grade pitch for recordings, in new songs and the ones you already have**: a note between two of an instrument's recordings now plays a copy of the nearest one moved to its pitch ahead of time with proper resampling, instead of the recording sped up or slowed down as it plays. The grit that came with it is gone (it was 15 to 52 dB under the note, worst on tuned drum sounds, now more than 90 dB under) and the top end stays as recorded (it lost up to 3.7 dB between 15 and 20 kHz). Harpsichord, glockenspiel, celesta, piano top notes and the like sound cleaner and brighter between their recordings. The same goes for a **Drum Rack** pad's Pitch (tuned hats and cymbals no longer turn harsh), **Sampler** and **Multi Sampler** notes away from their sound's key, **Slicer** keys in Pitch mode, release sounds and the recorded kits' open hats. The copies are made in the background as a song opens, and an export makes every one its song needs before it starts, each only as long as the song's notes play it, within its memory budget (it takes a little longer: about 0.8 s more on a 10-second harpsichord and glockenspiel phrase, 2.3 s to 3.1 s, and 0.3 s more on 20 seconds of the Latin starter); while you play they take up to about 190 MB, the least recently played going first. On a device with little memory a note's copy is made only once it has been played, and an export's copies take at most 64 MB. Clear memory also stops copies still to be made, and an export comes out the same whatever was exported before it. Bends, vibrato and slides still move the pitch as they play, from the nearest copy. A Multi Sampler note away from its sound's key no longer plays its first few milliseconds at the wrong speed (which moved it by up to half a millisecond).
- **Better retro instruments, in the starters and your songs**: the Fiddle, Bagpipes, Dulcimer, Accordion, Shakuhachi, Shamisen, Taiko Drums, Agogô, Crystal and Rain were rendered again from their SoundFonts at full quality, so they keep their top end, held notes loop over about 4.5 seconds instead of 1.7, and plucked and struck notes ring out by themselves instead of stopping dead at 3 seconds. Songs that use them sound clearer at the same level (the Rain is no longer about 2.5 dB louder than it was, and the few Shamisen and Shakuhachi notes that came out louder or quieter than before are back in line). A track you froze before these changes, on one of these, any recorded instrument or the Designed and synthesized kits, plays live with the new sound until it's frozen again. Every other retro instrument no longer stops dead when a note outlasts its 3-second recording (it dies away as it was), and its held notes no longer pulse every 1.7 seconds. In the Eastern and Celtic starters the koto now plays the recorded **Zither (Real)** and the guitar the **Acoustic Guitar (Real)**, at the level they had.
- **Recorded instruments at full quality**: every recorded instrument's files were made again from the original recordings at a higher quality, keeping their top end up to 20 kHz (before, everything over about 16 kHz was cut), so cymbals, hats, strings, harps and pianos sound clearer and more open, in the studio and in exports. They play exactly as before otherwise: same notes, timing, loudness and loops. Songs that use them pick this up on their own; the recordings take about twice the download (about 600 MB in all, fetched an instrument at a time and kept).
- **Clearer recorded instruments**: the **Grand Piano** now plays the Concert Grand's recordings (four loudnesses, every note or two) instead of its old muffled ones, at the level songs had, so songs that use it sound brighter and fuller. Every recording plays at twice the detail, so notes stay exactly as recorded and pitched ones keep their top end; notes and recorded drum hits are no longer detuned for variety (their level still varies), which kept the cymbals and bright instruments from dulling. With Expressive playing, notes played hard (0.9 and up) are no longer filtered at all, so basses and low piano notes keep their definition; soft notes still get darker. A Sampler's sound fades in over 1.5 ms so it doesn't click. Existing songs get all of this. The piano's recordings are evened out note to note (no note jumps out or drops away from its neighbours) and tuned a few cents down to concert pitch, which the Concert Grand gets too. A big set (the pianos, the double bass, the tenor sax, the tremolo strings) loads only the notes the song and your playing ask for, so a Grand Piano track takes about as much memory as it used to; exports decode the song's recordings at twice the detail only while they fit in about 500 MB, and freezes, previews and checks reuse what's already loaded. Phones, tablets, Safari and Firefox are treated as having little memory. The Designed Kit's expressive snare, hats and cymbals keep the level they had.
- **Wider, clearer drum tops**, in new songs and the ones you already have: the **Designed Kit** and the synthesized kits (Techno Kit, Retro Drum Machine, Rhythm Box, Break Kit) play their hats, cymbals and shakers a little wide, as a real kit sounds through a pair of microphones, while the kick, snare, claps and toms stay in the middle. Above 8 kHz the demo songs now spread 3.5 to 5.5 dB wider, closer to professional mixes. In mono the hits are the same sound, about a dB quieter; in stereo they're as loud as before.
- **Make space clears the low mids**: chords, pads and stabs under middle D give 2 dB at 280 Hz, a bass playing over a sub gives 3 dB where its harmonics pile up, and the lead gets 1.5 dB more from 5 kHz up. Compared with professional mixes, ours had 3 to 9 dB too much around 200 Hz. The demo songs use it now, with less low-mid boost on their basses and drums (1 to 2 dB less around 160 to 250 Hz, up to a dB more presence).
- **A cleaner Loud master with Crunch**: each export now also tries clipping only the sound under 3 kHz, letting the hats, cymbals and air pass by the clipper, and keeps whichever way is cleaner at the same loudness (live playback then plays the same way). On Night Rails the top is far less fizzy (4.6 dB less distortion over 2 kHz, a little more on the lows and mids, the sub as strong); on the colour-bass demo drop, clipping everything is still the only way to Club loudness, so it sounds as it did. Distortion is now measured on the left and right channels each, and a Loud master without Crunch stops a little earlier, before the fizz starts (-24 dB of distortion instead of -21).
- **Smoother master glue**: the Standard and Tight master compressors no longer grab fast enough to follow a bass's waves (20 and 15 ms instead of 5 and 3), so the low end is cleaner (6 to 7 dB less of the buzz they added on a held bass) and the drums keep a little more of their snap, at the same loudness. Songs using them sound a touch cleaner.
- **Frozen, bounced and resampled tracks are kept as 24-bit sound** instead of 16-bit, so a part played from one is as clean as the part itself, with no hiss added however many there are. Ones made before still play as they did.
- **Cleaner synths and reverb**, in new songs and the ones you already have:
  - **Fledge Synth**'s wavetables are kept in far finer detail, so leads, plucks and chords from the middle of the keyboard up no longer carry a faint digital fizz (it's now 70 to 85 dB under the note instead of as little as 40). Its LFOs on a level (a tremolo, a gate, a pump) move it smoothly instead of in tiny steps that buzzed.
  - **Synth Designer**'s Drive is worked out at four times the sample rate from 20% up (live and in exports alike), so a driven lead stays clean instead of fizzing (the fizz of a middle drive is now about 88 dB under the note instead of about 60).
  - **The master reverb** soaks up the top where each room would: the **Plate** keeps its shine (from 11 kHz), the **Concert hall** opens to 7.5 kHz and the **Church** stays dark, instead of every room losing everything over 5.5 kHz. It's as loud as before.
  - **Fledge Synth**'s drives (before and after the filters, and on the mids and highs) are worked out at twice the sample rate: a hard drive on a high note folds back 30 to 60 dB less fizz, and the top no longer dulls (it took 2 dB off at 10 kHz and 9 dB at 19 kHz, more with all three on), so driven basses like Crunch Formant and Driven Legato have their air back (3 to 5 dB more over 10 kHz). A Drive **Mix** or the band drive's **Highs** under 100% no longer thins or hollows out the top either, and turning a drive on or off, or its mix down to nothing and back, while notes sound no longer clicks. Its filters glide a step a sample under an LFO or envelope instead of in tiny steps that buzzed, and its **Chorus** is cleaner on bright sounds.
  - The track **Chorus** (and the Space Clav's) adds far less grainy hiss to bright sounds (12 to 21 dB less), at the same level and depth.
  - The track **Reverb** is a real-sounding chamber (early reflections, highs dying first) instead of a plain hiss of noise, at about the same level.
  - The track **Distortion** at its top settings no longer turns bright notes to fizz (from 20 to 45 dB under the note up to 50 to 80 dB under), at the same level.
  - **Fledge Synth**'s driven basses **Driven Legato**, **Hard Clip Stab** and **Clipped Square** are less thick around 200 Hz (6 and 3 dB less there), at the same loudness and with the same low end, so a mix with them no longer piles up in the low mids.
- **Cleaner MP3, OGG and video sound**: compressed exports are now limited exactly like a WAV, at -1 dBTP, instead of 1 to 2 dB lower. Each file is played back once it's made and turned down only by what its peaks went over (usually nothing; about a dB on a crunchy drop, and the message says so), so it's no longer squashed harder than the WAV of the same song: a dB less limiting on an ordinary song, and on the colour-bass demo drop 1.7 dB less distortion at about the same loudness.
- **Compressed exports checked to the end**: every MP3, OGG and video sound that's kept has been played back and measured under -1 dBTP (before, a dense, clipped mix could come out a tenth of a dB over after its last turn-down). Compressed **stems** and **layers** are now limited at -1 like WAV stems and turned down together, so they still add up to the mix; a mixdown's underscore and no-drums versions are turned down together too. The message gives the file's own peak, and Cancel stops an export at once, while it's encoding too. Exported Ogg sound effects play at the level of the WAV ones.
- **How loud will the file sound?** now counts only the song playing since its mix or master last changed, with the level matching as it was while it played.
- **Gapless MP3s**: an MP3 now plays to the exact sample, with no 25 ms of silence at the start and no padding at the end, so MP3 loops and a game's intro + loop run on without a gap.
- **How loud will the file sound?** The app plays every song level-matched (about -15 LUFS), but a file plays at its own level. Once the song has played a few seconds, the Export dialog says how much quieter or louder the file will sound than you heard it, and **Match Streaming (-14 LUFS)** turns the loudness target on in one click.
- **Small fixes**: 16- and 24-bit WAVs scale both halves of the wave alike (a faint bend in the waveform is gone); frozen, resampled and bounced tracks each get their own dither, so many of them together don't add up to a louder hiss; the Lo-Fi, Plaza and Mbira Morning starters are trimmed to sit at the same loudness as the others (Lo-Fi 1.5 dB lower, with 1.5 dB less limiting).

- **GPL plugins in the web runtime kit**: a song that plays Surge XT, Dragonfly, Plateau or the Tonewheel Organ no longer stops the kit. A small window says what the GPL asks of a game, who made the plugin and how to reach them, and lets you export with it or cancel; the kit then plays it, with its licence and a notice of where its source is. A **GPL** tag marks these plugins in the plugin browser, the Plugins menu and their windows.

## 2026.10.28-3 — Two tabs, keyboard clips, game states on bar lines and more fixes

- **Two tabs, one song**: if the song is also open in another tab, that tab's changes are kept as a version ("from another tab" in **File › Versions**) instead of being written over, and the project bar says so. **Free unused** keeps the sounds a song in another tab uses, and **Save** tells you if a sound the song uses couldn't go in the file.
- **Clips from the keyboard**: Tab reaches each track's clips; Enter opens one, Delete deletes it, the arrow keys move it a grid step (Shift: a bar), Ctrl+arrows go to the next clip, and Shift+F10 opens its menu.
- **The Edit menu follows the piano roll**: while a clip is open it reads **Cut notes**, **Copy notes**, **Delete notes** and so on, and acts on the notes.
- **Game states on bar lines**: in 3/4, 6/8 and other meters a song without markers is cut every 8 measures, and game kits carry each state's bar lines, so the web, Godot and Unity players (and FMOD's tempo markers) switch on the right beat after a tempo change. The web runtime kit now carries the plugins its song uses, so it plays without fledgetone.com.
- **Fixes**: recordings and bounces stay lined up when you split, trim, move, comp or change the tempo across a tempo change; Back to the original isn't offered on part of a mangled clip; Slicer's backwards slices stay on their slices when slices are added, removed or re-cut; share links keep the Human feel of chords. In Pocket: jumping back a section waits for the bar line, a vocal take stays on the track it started on, "Play it twice" really links on the starters, a Slicer shows only its slices, and no empty undo steps. Menus that act on a choice no longer act on a single arrow key; Space ticks a focused checkbox; notation prints; pasting a tune into drums says why nothing was pasted; the lesson card is reachable from the keyboard inside a dialog. Plugins: the Phaser, Modal Voice and Ominous Drone no longer blow up or drone too loud, and the Tonewheel Organ, mda EPiano, Analog Snare and Modal Voice are turned down so their loudest notes stay under full scale; the recorded choir's loud notes are in tune; Multi Sampler notes stop on Stop. A song with several Mutable Instruments plugins exports exactly the same every time again, and exporting it many times in a row never runs out of memory. The Phaser's Feedback, Speed, Notch width and Output level stop short of where it rang up too loud. The rhythm game's sound lands on its chart, and the Start audio button stops pulsing when your system asks for less motion.

## 2026.10.28-2 — Safer exports and plugins

- **Fixes**: exporting a game intro + loop with **Normalize** on no longer turns a louder intro up past full scale (it could come out as a loud, clipped blast); the gain now keeps every file's peaks under the ceiling. Any plugin is now held under +12 dBFS whatever its knobs say, so none can run tens of dB too loud without being caught (mda Loudness's Output also stops at +12 dB). Songs with several Mutable Instruments plugins can be exported and frozen as often as you like again: after about 25 exports in one session plugins stopped loading.

## 2026.10.28 — Groove feels, glue, vocal chops, resampling and a big round of fixes

- **Vocal chops**: three new instruments of real voices cut into short syllables, each tuned onto its key, a different syllable every other key, so a tune played on them sounds like a chopped vocal hook. **Airy Vocal Chops** (breathy "ah", "mm", "la", sighs and whispers), **Soul Vocal Chops** (a man singing short "ah"s) and **Shout Vocal Chops** ("hey", "go", "yeah"). In Choir & Voices, in the studio and in Pocket. All from public-domain (CC0) recordings, credited in the guide.
- **Chop my voice**: right-click a vocal (recorded or imported) for Chop my voice, or tap Chop onto keys under a take in Pocket. It cuts the take into its syllables, tunes each onto a note and lays them on the keys of a new instrument, with a clip playing them where you sang them. One Undo takes it away.
- Pocket plays Multi Sampler tracks from the notes now (their sounds are still set up on a computer).
- **Resample**: right-click a clip (or **Tools › Resample…**) to print it, the loop range of the whole mix, or one track's part of it, to a new sound with all its effects (before the master section, unless you tick **Through the master section too**). Then put it on a new audio track, on a new **Slicer** already chopped (at its hits, or into 8 or 16 equal slices, playing in order, as a **stutter** with repeats and 1/32 rolls, or **shuffled**, with its last slice backwards if you like), or make it a **wavetable** for Fledge Synth, played as a bass, lead or pad. One Undo takes it all back. In Pocket, a section's **⋯** has **Resample it into a Slicer** (the whole section, or the track you have open).
- **Mangle** an audio clip (its editor's **Mangle…** menu): half or double speed like tape, pitch up or down keeping the length, stretch ×2 keeping the pitch, **stutter** (the start of every beat repeated at 1/8, 1/16 or 1/32), **shuffle** its 8ths or 16ths into a new order, a **gate** pattern, **crush** (fewer bits, lower rate) and **formant** (the voice bigger or smaller, the pitch the same). Each makes a new sound, about as loud as before and never peaking louder; Undo goes back a step and **Back to the original** undoes them all.
- **Slices played backwards** in the Slicer: click a slice and press **Backwards**. **WRITE Stutter / Shuffle** puts a new 2-bar pattern for the slices at the playhead.
- **Your own wavetables in Fledge Synth**: choose **User table** in an oscillator's table menu, select an audio clip of a held sound (a pad, a vowel, a chord) and press **From the selected clip**. The synth cuts single cycles at the sound's pitch, spread from its start to its end, so **Position** travels through the sound; the picture shows it. The table is saved with the song, your sounds, freezes and exports; a share link carries a lighter copy (8 cycles, a little duller). Presets and songs saved before sound exactly as they did.
- **Groove feels measured from real music**: **GROOVE** in the piano roll gives any clip (drums, bass, chords, leads) a feel taken from real tracks, so the parts no longer sit dead on the grid with tidy velocities: each part a few milliseconds early or late on each 16th, with the accents it was played with, and an **Amount** from 0 to 100%. Eight feels: Bass music tight, Four on the floor tight, Future bass laid back, House shuffle, Hardcore push, Artcore breathe, Artcore bounce and Synthwave drive. Only what was clearly there in the music is in them.
- **Take a groove from audio**: pick an audio clip in the song and its groove is measured and put on the clip you're editing; it's saved with the song and offered for its other clips.
- The **Drummer** can make its beat with one of the feels, and Pocket has a **Feel** button for the whole track (on the pads and in the piano roll).
- **Glue in a style**: Clean, Bass music or Pumping, each level-matched so switching it on doesn't make the song louder. A song with a single drum track now gets its drum bus too.
- **Group and glue**: a track's right-click menu puts the chosen tracks on a drum bus, a bass bus (its low end kept) and a music bus with gentle compression and saturation, in one step.
- **Safer plugins**: a plugin that goes wrong (broken sound, a crash, or far too loud) is muted for a moment and restarted, so it can no longer silence or blast the whole song. A few plugin knobs stop before the point where they blow up or get dangerously loud (Piano Model's Stiffness and Brightness, the Stereo Compressor's Makeup gain, Studio Hall and Plate Reverb's Level, the Phaser's Feedback, Waveguide Flute's Vibrato gain and the Parametric EQ's boosts); settings inside those limits sound as before. Piano Model is turned down 7 dB so its loudest high notes stay under full scale, and **Pizzicato Section** is turned down to sit with the other short strings.
- **Note copy and paste in the piano roll**: Ctrl+C, Ctrl+X, Ctrl+V and Ctrl+D now copy, cut, paste (at the playhead) and duplicate the selected notes, instead of whole clips.
- **Fixes**: Save straight after opening a song keeps all its sounds, and a song opens and saves its sounds even when the browser's storage is full; a file from a newer version tells you what it couldn't read and asks for a new name when saved; audio in clip-launcher slots is saved and shared; linked clips stay linked after reopening; copied clips don't paste onto the wrong kind of track in another song. Recorded audio, frozen and bounced tracks stay in time after a tempo change, and crossfades line up there; seamless loops keep an early note at their start and an even level across the seam with a loudness target; previews (Loop variations, Tune, Sound FX) follow the LISTEN volume. In Pocket: editing keeps studio notes off the grid where they were, a vocal take is kept (and the mic switched off) if you leave mid-take, "Play it twice" really links, scrolling pads and lists doesn't play notes or move sliders, the note bars fit on phones, the first edit is one Undo, and the first tap starts the sound on iPhones. Menus and dialogs behave with the keyboard (Esc, Tab), arrow keys after Undo keep Redo, bar ranges are named right, and the piano roll's key guess no longer picks a key whose notes the song doesn't use. Videos from screen recorders work with Find cuts, the video's own sound in an MP4 no longer clips, the web game kit's test page plays, guide links work, and bending a Multi Sampler note no longer cuts it short.

## 2026.10.24-2 — Fledge Synth even across the keyboard

- **Fledge Synth sounds like one instrument from the bottom of the keyboard to the top.** Its presets' filters now follow the note (basses, leads and keys closely, chords and pads a little less), so low notes are no longer dull and muffled and high notes no longer thin and fizzy next to them; each preset sounds as before on the notes it was made for.
- No more jump in brightness every octave: where the wavetable hands over to its next, plainer level (as it must, so high notes don't alias), the two now fade into each other over a few semitones, and a glide through it is smooth.
- Neighbouring notes start alike: a note's random start (its unison voices, a Steps or Drift LFO) follows its step in the bar, not its pitch.
- The unison's detune narrows a little above middle C (**Detune key**), so a supersaw's high notes don't beat faster and faster; the chorus leaves the lows alone and spreads its voices, so particular notes no longer come out hollow or quieter (the organ most of all).
- Songs saved before keep exactly the sound they had (the new **Even keyboard** switch is off for them); new sounds and every preset have it on.

## 2026.10.24 — Hear the Fledge Synth, see where notes go

- **Hear Fledge Synth before you add it**: a **▶** beside **Fledge Synth** in **Add Track**, the plugin browser and Pocket's instrument lists plays a bass, a lead and chords from its presets (about seven seconds) without adding a track, at about the level of the instrument menu's previews. Press it again to stop.
- **▶ Hear a Fledge Synth preset**: beside the preset picker (studio and Pocket), a button plays a short phrase that suits the sound (a bass riff with a glide, a lead tune, an arpeggio, held chords or one long note) on the track as it sounds now. Choosing another preset stops it; tick **Hear on change** to hear each preset as you step through them.
- Pocket's Fledge Synth preset list keeps each group together (all the basses under Bass, and so on).
- **See where a note will go**: in the piano roll, an outline under the pointer shows where a click will put the note (or chord) and how long it will be; with **Type notes** on, the next note's slot is shaded from the cursor, and pointing at a key on the on-screen piano outlines that note's row.

## 2026.10.23 — Crunch, new presets and steadier drops

- **Short open hat**, a new Drum Designer preset: an open hat that's gone 20 dB within an 8th at house tempo, for the off-beat hat of house and other four-on-the-floor music.
- **Seven Fledge Synth presets for melodic songs**: **Soaring Saw** (a singing supersaw lead), **Silk Stack** (dark held supersaw chords), **Silk Wash** (a wide pad), **Round Root** (a warm bass that holds the chord's root), **Vowel Chop** (like a chopped vocal), **Glass Pluck** (a clear, bell-like pluck) and **Reverse Swell** (a swell into a drop). They're the sounds of the new demo song in the sound recipes. Older presets sound exactly as before.
- **Crunch on the Loud master**: a **Crunch** slider in the Master tab (and a **Crunch** button next to **Loud** in Pocket's mixer) lets the master clip on purpose. Up to 0% it stops before the clipping is heard, as before; turned up, the clipper's knee goes hard and the push can go much further, so a dense drop gets as loud as current bass music and you hear the clipping as crunch on the kick, bass and snare. The -1 dBTP limiter stays last, what you hear stays level-matched, and MP3 and Ogg exports keep their peaks a little lower with it so the decoded file still stays under -1 dBTP. Songs without it sound as they did. The clipper takes the whole sound through its oversampling and clips it twice, a little under the limiter's ceiling, so a busy drop holds steady instead of pumping; MP3 and Ogg exports with any Crunch keep their peaks 1 dB lower.
- **Five loud, crunchy Fledge Synth presets** for modern drops, each note its own sound: **Crunch Formant** (a hard-clipped talking growl), **Resample Chop** (a new slice of the sound on every 16th, crushed), **Clipped Square** (a bright square bass that jumps and glides across two octaves), **Hard Clip Stab** (a short fifth-and-octave stab clipped flat) and **Chip Crunch** (a crushed square lead with a short glide). Older presets sound exactly as before.
- **Two more Drum Designer presets** for future-bass drops: **Hard drop kick** (a click and a driven knock that cut through on small speakers, over a tuned sub that holds the low end a little longer than the Club kick's, so the kick hits instead of just thumping) and **Drop impact** (a deep boom and a noise burst for a drop's first downbeat).
- **New Drum Designer presets**: **Crunch kick** (a hard-driven body whose pitch drop you can hear, a loud click, a short tail so the next kick a 16th later is clear), **Zap kick** (a longer, rubbery drop), **Crunch snare** (tight and driven) and **Sharp tight hat**.
- **Syncopated drop** in the Drummer (studio and Pocket): about six kicks a bar packed one to three 16ths apart (never four on the floor), the snare on two and four, 16th hats leaning on each beat with 32nd or triplet rolls now and then, for modern bass music around 100 BPM.
- **Driven Legato**, a new Fledge Synth bass: one gritty, clipped voice that holds through a riff and glides into each overlapping note instead of starting every note afresh, so a fast bass line sounds like one instrument rather than a string of separate hits. Older presets sound exactly as before.
- **Duck to kick on busy drums**: when the kicks and snares come half a beat apart or closer (as in the Syncopated drop), the holes in the bass are shallower and shorter (about 5 dB instead of up to 18) and the chords pump less, so the bass no longer gets chopped up on every hit; with a separate sub part, the sub takes the hole and the bass above it only a third as much. Sparser drums duck as before.
- A plugin whose settings were changed on its track from outside (a whole new song put in by a script, say) now starts from those settings, not from the last ones read from it while it played.
- **Fixes**: **Duck to kick** no longer ducks a drum kit named like "Sub kick" or "808 sub" to its own hits, and ignores drum notes hidden before a trimmed clip's start; a Loud master export to MP3 or Ogg, or a loudness match interrupted by an undo, no longer leaves live playback louder than the export; with the master clipper on, live playback lines up with the metronome; a plugin's settings changed from outside while it plays are no longer put back by its next read.

## 2026.10.22 — Drums that hit, ducking and a loud master

- **Drums that hit**: the Drum Designer has a **layered kick** (a click, a driven body falling from its punch pitch, and a clean sub tail; **Hardcore tail** keeps the distorted body going through the beat as the bass) and a **layered snare** (a transient, a tuned body, the wires, a clap and a room, or a gated 80s room an 8th long at the song's tempo). Their pitch can follow the song's key, or sit on a note you pick. New presets: **Punch kick**, **Hardcore kick**, **Deep tail kick**, **Club kick**, **Big snare**, **Gated snare**, **Tight snare** and **Crack clap**.
- **New Designed Kits start on the Punch kick and Big snare**: a short kick that leaves the low end to the bass (the old default kick's long tail made most of a mix's sub) and a snare that hits a little over it. Kits you've made already sound as they did.
- **Synthesized kits in place of the unlicensed recordings**: the recorded Acoustic Kit, Breakbeat Kit, 80s Drum Machine, Rhythm Box, Techno Kit and Bongos had no licence, so they're gone, and **Techno Kit**, **Retro Drum Machine**, **Rhythm Box** and **Break Kit** are made by the app itself (**Edit in Drum Designer** opens one as a Designed Kit). Songs and links that used the old kits open on their replacements (the Acoustic Kit on the Studio Kit, the Bongos on Latin Percussion), their notes on the same drums. A track frozen on one of the old kits plays the new sounds until it's frozen again.
- **Accelerating rolls**: the roll painter's **Accelerating** rate turns a note into a roll that speeds up from 8ths to 64ths and gets louder, the build into a drop. In Pocket, hold a lit step and pick **Roll** (over a beat, two beats or a bar).
- **Step lanes**: a row of steps under the piano roll's notes, each holding a value for one of the track's settings (a Fledge Synth macro, any of its other settings, the Filter's cutoff, an effect), so the bass can change its sound on every 16th instead of wobbling at one speed. Drag to draw, right-drag to clear (a cleared step holds), 1/16, 1/32 or triplet steps, **Random** within a range, **Repeat** the first steps, shift them round, and **per note**, so the change follows the notes. Every change glides over 3 ms, so nothing clicks, and plays the same live and in exports. Pocket's piano roll has one lane at a time for the synth's macros.
- **Slides and dives**: Alt-drag a note up or down in the piano roll to slide it to another pitch by its end, and **Dive** makes the selected notes start an octave up and fall to their pitch over a 16th (in Pocket too). Fledge Synth, the basses (Wobble, Growl and Reese now too) and Analog Lead play them; the piano roll says when an instrument can't.
- Automation lanes of plugin settings (Fledge Synth's too) now land where they're drawn when the song plays, not up to 50 ms either side, as they always did in exports.
- **Does it hit?**: under the Mix check, hold the loop (or the song) against finished songs of a style (bass music / dubstep, drumstep, J-core / hardcore, darksynth / pumping, future bass / artcore). Each measurement shows as a meter with the style's range and what to change in plain words: gaps between the hits, a bass that only wobbles at one steady rate, a sub that's too big or not in the middle, the pump, the balance, the loudness, and how far the kick and snare stand out. In Pocket, **Check the drop** (under Mix) gives the short version for the selected section.
- **Starters**: only the eight Chill & World starters remain for now (Lo-Fi, Ambient, Celtic, Fantasy Tavern, Latin, Plaza, Mbira Morning and Eastern), and **New** offers them or a blank song. The other starters, the Classics and the demo song are gone; a new, smaller set is on the way. Songs you made from them, and links to them, still open as they were.
- **Glides that work**: the piano roll's **Legato** tool now runs each note a little into the next, so the Sub-Bass, Analog Lead, Wobble, Growl and Reese basses and Fledge Synth's Legato sounds glide between them (and the same pitch holds on as one note). Notes that only touch still start again, so a bassline of repeated notes keeps its rhythm.
- **Wider, longer pads and leads**: the Wavetable Synth, the Analog Lead and the retro synth pads, synth strings and synth leads now play in stereo, and fade out more slowly (pads about 1.5 s, leads about 0.4 s). The **Supersaw** is about 10 dB louder, as loud as the other pads now, and its chords ring on into each other.
- **Snares and claps sit closer to the kick**: the Drum Designer's snares and claps, and the clap on every kit that has no clap recording, are louder (the claps by up to 14 dB), a couple of dB under the kick.
- **New notes remember their length**: the piano roll and Pocket's piano roll start a new note at the length you last drew or stretched for that kind of part; pads and chords start at a quarter note. In the studio, drag right as you draw a note to stretch it.
- **New tracks start mixed for their part**: pads and chords a little in the reverb, leads in the reverb with a soft dotted-eighth echo, drums and basses dry.
- **Fledge Synth basses that change with every note**: LFOs can now restart with each note, run once like an envelope, or hold while a key is down, with a delay, a rise, smoothing and key tracking; free LFOs follow the song, so playback and exports match. New sources pick a random value per note or step in time (chaos), and the matrix has 16 slots, each with a curve and a source that scales it. The drive can go before the filters, after them (with a cabinet tone) and on the mids and highs only, with tube, bitcrush and downsample kinds, always levelled. The sub now joins clean and mono after all of that. Glide can be legato-only, constant-rate and linear, and the pitch drop can dive in a straight line.
- **Nine new Fledge Synth presets**: Talking Growl, Riddim Cell, Colour Chord Stab, Neuro Reese, Dive Screech and Clean Sub basses, Hardcore Supersaw, Wide Wash and Bright Pluck. Older presets and saved sounds sound exactly as before.
- **Duck to kick**: one click in the Mixer (or **Pump** in Pocket's mixer) makes the song breathe with the drums, in a style you pick (pumping, bass music or future bass / artcore): the bass and sub get a hole for every kick and snare, the chords, pads and leads pump on the kick (5 to 7 dB for pumping styles, about 2 dB for future bass) and are back within a quarter of a second. **Glue** gives the bass the same kind of hole, and its music bus no longer pumps on top of parts that already do.
- **Pump shapes**: the Pump now has a shape, drawn in its panel: **Smooth** (as before), **Hard cut**, **Short tick**, **Long swell**, **Hole for drums**, or your own (drag the points). It can follow the **Snare** or **Kick+snare** as well as the kick. Songs made before keep the Pumps they had.
- **Loud master**: in the Master tab (and **Loud** in Pocket's mixer), makes an export as loud as its style: **Streaming** (-14 LUFS), **Loud** (-9) or **Club** (-6). The lows go in the middle, then a soft clipper shaves the drum and sub peaks and the limiter holds the rest under -1 dBTP, pushed until the song reaches its target, measured as it goes. It stops short rather than let the mix crackle, and says so. Off until you switch it on.
- **Mono below 120 Hz**: a master switch that keeps the low end in the middle whether the Stereo Width is on or not. On for new songs.
- **Listening is level-matched**: you hear every song at about -15 LUFS whatever its master does, so a Club-loud master never blasts you. It comes up slowly (never more than 1 dB a second), goes down at once when something loud arrives, and a safety limiter guards the speakers. The volume slider is now **LISTEN**: it only changes what you hear, never an export. Switch the matching off under Playback in the Master tab.
- **Exports no longer follow the volume slider**: files are made at 0 dB with the master as it's set, so the same song exports at the same level whoever's speakers it was mixed on. The Export dialog has a **Club** target (-6 LUFS), and Pocket's MP3 can be Streaming, Loud or Club (it starts on the Loud master's target).
- The master clipper now holds high sounds near its ceiling too (a clipped 5 kHz came out up to 13 dB over it, for the limiter to catch), and the Stereo Width's "keep the bass in the middle" no longer makes the sound just above 120 Hz a little wider.
- **Fledge Synth riffs that come back each bar**: in Mono and Legato a note that doesn't overlap the last now starts afresh (**Restart each note**), so a riff that repeats sounds the same each time round instead of drifting, and a note's random values go with its step in the bar rather than its pitch, so the riff keeps its shape over the next chord. Notes drawn end to end no longer glide into each other by chance on Legato sounds.
- **Brighter new Fledge Synth sounds**: Neuro Reese, Talking Growl, Dive Screech and Colour Chord Stab carry more top (4 to 8 kHz and above), and Wide Wash has some air; the five moving basses also open and close a little over two bars. Still as loud as before, with no harsh peaks.
- **Low ends that stay in the middle**: Fledge Synth's new **Mono below** keeps everything under it centred (180 Hz in new sounds, 250 Hz in Wide Wash; older sounds keep 120 Hz), whatever the unison, chorus and width do, and the Supersaw keeps its lows in the middle too, so wide chords with low notes no longer widen the low end.
- **Percussion kits don't pump the mix**: Latin Percussion's tumba, conga and claves and Percussion Extras' woodblocks no longer count as kicks and snares for the Pump, live, in exports and in the "Does it hit?" check.
- **MP3 and Ogg exports stay under -1 dBTP when played back**, even Club-loud: they're limited to -2 dBTP (was -1.5), as encoding pushed a dense loud master's peaks about half a dB up.
- **True peaks read as other meters do**: the meters, the limiter and the exports look between the samples at 8 times the sample rate with a finer filter. On a loud, limited master they used to read up to 0.3 dB low; now they're within about 0.1 dB.

## 2026.10.21-2 — Drop pad, bounce to pad and versions

- **Drop pad**: a new track that changes the whole mix while you hold it: **Stutter**, **Filter**, **Tape stop**, **Crush**, **Gate** and **Echo**, always in time. Play it on the phone's big pads (pressing one starts the song) or from a keyboard; with **Rec** on, your moves are written into the song and play every time, in exports too. Add it with **+ Track › Drop pad**.
- **Bounce to a pad**: turn a section (the whole mix or one track) or a vocal take into a sound on a Drum Rack pad, at the same level, ready to play like a drum. A take can also be chopped onto pads at its hits. In Pocket, **Your pads** is a Drum Rack you can play, step and record there.
- **Fledge Synth on the phone**: pick a preset and shape it with big sliders named for what they do (the wobble bass has **Speed up**, **Squelch** and **Grit**), with the wobble rate in time with the song. Every bass preset now has three of them, and the studio's macro knobs show the names too. Synth knob moves can now be undone.
- **Share one sound**: save a track's sound as a small file and open someone else's onto your track.
- **Versions**: **File › Versions…** (and the song's settings in Pocket) lists earlier versions of your songs, kept as you work, and takes you back to any of them.
- **Notes that play only sometimes**: set a note or step to play 75%, 50% or 25% of the time, or only on certain repeats (1st of 2, 4th of 4…). Hold a step in Pocket, or use **Plays** in the piano roll. Exports play the same notes you hear.
- **Roll the beat again**: dice in Pocket's steps (and **Roll beat** in the studio) make new hats and percussion in the beat's style, keeping the kick and snare.
- **Recording**: a sustain pedal already held when you press Record now holds the notes in the take, as you heard them. Lining up recordings by playing a few clicks, and a note when Bluetooth headphones will make takes late.
- **Exported game kits**: the players inside can still ship in any game, closed-source and paid ones too, but changes to the players themselves must now be shared under the GPL. Questions or concerns: martin@twobirdsworkshop.com.
- **On the website**: a new **Tools** page to download the game music players, Fledge Synth, the Drop pad effects and the song player for your own programs, and real gameplay clips of the 2D platformer and the rhythm game on the games page.
- Rack pads at their neutral settings no longer colour the sound slightly.

## 2026.10.21 — Fledge Synth

- **Fledge Synth**, Fledgetone's own synthesizer, made for dubstep, bass music and modern electronic songs. Add it with **Add Track → Fledge Synth**.
  - Two wavetable oscillators (16 tables) with up to 16 unison voices each, warps (sync, bend, squeeze, mirror, quantize, fold, ring), chord and octave stacks, a clean sub, noise and FM.
  - Two filters, side by side or one into the other, including comb and formant (talking basses); each oscillator goes to either, both, or straight out.
  - Four LFOs, including wobble and pump shapes and two you draw yourself, all **in time with the song**. Three envelopes, four macros and an eight-slot mod matrix.
  - Built-in effects: EQ, chorus, phaser or flanger, delay and reverb, plus drive and an OTT.
  - 35 presets in groups: wobble, growl, riddim, tearout, yoi and neuro basses, leads, keys, chords, pads and risers, all at about the same loudness.
  - Its own window, in three tabs, with knobs, a picture of each wave, each LFO and each envelope. Every knob can be automated.
  - Ear-safe: the bass is kept in mono and nothing it plays goes over −1 dB.
- Plugins that use the song's tempo now get it, including tempo changes.
- **Plugins keep up with you**: saving, sharing, exporting, freezing and closing the tab all include a plugin's very latest settings, and a plugin that answers slowly is no longer left out.
- **Automation lanes and plugin knobs**: while a lane moves a plugin's knob, the knob follows it and is marked as automated; delete the lane and it goes back to where you set it. Knobs turned from a MIDI controller now move in the window and are saved.
- A plugin window no longer covers dialogs, and the plugin browser no longer lists keywords as groups of their own.
- **Freeze** from a track's right-click menu now says whether it worked, and asking twice says it's already freezing.
- A song that holds only a synth track is kept like any other: it comes back after a reload and can be restored.

## 2026.10.20-10 — Paste where you mean

- **Paste lands on the track you picked**: click an empty spot on a track's lane (which selects that track) and Ctrl+V puts clips copied from one track there, at the playhead.
- **A typed chord undoes in one go**, along with the clip growing to fit it.
- In the mixer, the effects row of each channel opens that track's effects in the Inspector (**+ Effects** when it has none).
- **Pocket**: on a phone held upright, track names take two lines instead of being cut short.

## 2026.10.20-9 — Your song opens again

- **Your last song opens again by itself** when you come back or reload the page, as it already did on phones. Before, the studio opened an empty song and offered your last one in a small banner, which was easy to miss, and a newer song could replace it. The banner now only offers back a song that **New**, **Open** or a shared link replaced.
- **Rename a track** by double-clicking its name.
- **Typing notes** is steadier:
  - On a drum track the keys start on the kit (A is the kick, S the snare, T the hats), and a key that isn't a drum writes nothing.
  - The piano roll keeps the notes you type in view.
  - Typing past the clip's end stops at the next clip on the track instead of running over it.
  - Backspace keeps its place after Undo.
  - Closing the piano roll puts the piano away.
  - Clicking a key of the on-screen piano can no longer leave a note held.
- **Pocket**:
  - The drum steps stay on the bar you're tapping while the song plays, instead of turning the page under your finger.
  - The note grid opens where the part's notes are.
  - **Rec** says **Stop rec** while recording.
  - "Empty" is now **Blank song** (four empty tracks).
- The New dialog's hint for a blank timeline matches the empty song's: double-click a lane to make a clip.

## 2026.10.20-8 — Type your notes in

- **Type notes in instead of placing them one by one**: open a clip in the piano roll and click **Type notes**. Each key you play on your computer keyboard (or a MIDI keyboard) goes in at a cursor that then moves on, so you can write a melody without playing in time; keys held together make a chord, → leaves a gap and Backspace takes the last step out.
- **An on-screen piano** (**Tools › Piano**) shows which letter plays which note and lights the keys as you play. Drag it anywhere.
- **The big headings on fledgetone.com no longer lose parts of letters on phones**: they're drawn in a solid colour now, which phone browsers can't clip while the moving timeline behind them redraws.
- In **Your first song**, the steps after you open the piano roll scroll the button they point at fully into view, instead of leaving it half off the top of the screen.

## 2026.10.20-7 — Pages for games, creators and scoring, and a smoother first visit

- **fledgetone.com has a page for each kind of maker**: **For games** (adaptive music, sound effects, playable test games and the exports for Godot, Unity, the web, FMOD and Wwise), **For creators** (showcase videos, every length, a version to talk over, stream kits and beat store packages) and **For scoring** (scoring the video you've cut in your own editor: hit points, tempo fitting, timecode, dialogue dips and markers to take back). The home page links to all three under **What will you make?**
- **A smoother first visit**: the welcome offers the quick tour and **Your first song**, with the other tutorials a click away. An empty song now says so, with an **Open a starter** button. The New dialog only warns about replacing your work when there is some.
- First-time visitors no longer see a "new version is ready" notice the moment the studio opens.
- The header no longer jumps down when your work is first saved, and the "saved in this browser only" note waits until the music stops instead of covering the transport.
- **Beat store packages and sound effects get the song's key right more often**: the key guess now listens to the bass note a song opens on, so a song in A minor is no longer called C major (and the same for the many starters it used to mislabel).
- Clearer wording in a few places: the export dialog is **Export audio / video**, menu items that do the same thing share one name, and a few tutorial steps name the right tutorial.
- **Track › New folder with this track** no longer shows a stray code in a message, and **File › Showcase video** opens the export dialog at its top instead of scrolled to the bottom.
- **Tutorials**: in **Your first song**, the export step now waits until you've actually exported the file, so its instructions stay on screen while you follow them. A tutorial card that grows no longer runs off the bottom of the screen, and the "saved in this browser only" note now sits in the bottom corner instead of over the **LEARN** button (and waits until a tutorial is over).

## 2026.10.20-6 — New tutorials

- **Two new tutorials** in the **Learn** menu. **Make a showcase video** walks you through a video of your song's notes to post: tall for phones, smooth 60 fps, your own title. **Find and keep your sounds** covers searching the instruments, starring favourites, saving a sound to My sounds and keeping them in a file.
- **Your first song** now has a step where you swap a part's instrument, and the quick tour is friendlier for first-timers.
- The lessons on fledgetone.com use the plainer names (**Rap Beat**, the **Rap beat** drummer, **Long slide**, **Crisp snare**), with fresh pictures.
- **The guide and every tutorial were checked against the studio** and corrected where they had drifted: menu names, starter counts, the EQ, the horns, export and video options, Pocket, shortcuts and a few tutorial steps that couldn't finish.
- The three-band EQ's labels and curve now show its real bands (below 400 Hz, 400 Hz to 2.5 kHz, above 2.5 kHz).
- The **Cowbell Drive**, **Dark Bounce**, **Blown-Out Hype** and **Rap Beat** starters open with their own names.
- The two films on the home page are scored with sound effects from the studio's own maker: birdsong, wingbeats, wind, a river and crickets in **First Flight**; thrusters, whooshes, thunder, rock hits and the beacon igniting in **Courier**. Their downloadable projects carry the effects too.

## 2026.10.20-5 — A new home page

- **fledgetone.com has a new home page**, with the slogan *Make music for you*. It shows the showcase videos, the three games in Try it in a game, Pocket on a phone, and what makes Fledgetone a real music studio rather than an AI song generator: every note is yours.
- The lessons cover showcase videos (File › Showcase video…) and the 2D platformer and rhythm game.

## 2026.10.20-4 — Fixes

- **EQ is cleaner**: the three-band EQ on tracks now splits the sound so that nudging one band leaves the others alone, and a flat EQ changes nothing.
- **Distortion keeps its level**: turning distortion up no longer makes the sound much louder or quieter.
- **Game music**: in the game player (web, Godot and Unity), a state that fades out now fades smoothly to the end and its pieces stop with it, a short sound that has no recording no longer stops the music, and a stinger plays at the music's level.
- **The game previews**: stopping a song in the preview stops it for good, the platformer's jumps are the same on fast and slow screens, the rhythm game opens again straight away on an unchanged song, and the games no longer take keys meant for shortcuts.
- **Share links** keep your markers, and **linked clips** stay linked after opening a song.
- **Undo**: renaming a clip, or changing a sample's settings, is one undo step rather than one per letter. Ripple edits move the markers and tempo changes with the music.
- **Exports**: an export that you cancel no longer downloads anyway, and a song's ring-out keeps its last echoes.
- **Sound effects maker**: Stop stops every sound that's playing, not just the last.
- **Dragging** a note, clip or knob no longer gets stuck when the browser takes the pointer away (a phone call, a gesture).
- **Updates**: if a part of the studio goes missing after an update, your song is saved before the page reloads.
- Smaller fixes across the studio and Pocket.

## 2026.10.20-3 — Two new games to try your song in

- **Try it in a game** has three games now: pick one at the top.
- **2D platformer**: run and jump to the flag past gaps, spikes and one-eyed blobs, grabbing coins. A blob chasing you switches your song to its chase music and builds the intensity; squash it by landing on it; reach the flag for the win stinger.
- **Rhythm game**: your song plays and its own notes fall down four lanes (kicks left, snares right, the melody moving the way the tune does). Hit D F J K in time for Perfect, Great or Good; a miss muffles the song for a moment. Easy, Normal or Hard, held notes, combos and a grade at the end, and a Timing setting for headphones that play late.

## 2026.10.20-2 — Sharper videos

- **Video (MP4) export looks sharper**: more data for each frame, and a fine grain in the dark background so it no longer breaks into blocks and stripes, even after TikTok or YouTube compress it again.
- **Smooth 60 fps videos**: pick **Frame rate** in the export, **Smooth 60 fps** (the default) or **30 fps**. The notes in a Showcase video glide past the playhead.
- **Title and marks** in the video export: type your own title and the line under it, and show or hide the title, that line, the section names, the time and the waveform. What you hide gives its room to the picture.

## 2026.10.20 — New horns, an "ooh" choir and four new starters

- **New horns**: the **Trumpet**, **Alto Sax**, **French Horn**, **Trombone** and **Tuba (Real)**, and the **Brass Section** made from them, are new recordings with every note at three loudnesses (the trumpet and sax with real vibrato), so they sit in a song with the band. Your songs that use them play the new recordings. The starters' tenor sax and muted trumpet parts now play the new alto sax and trumpet.
- **Choir "Ooh" (Real)**: the same twenty singers on a soft, round "ooh", for pads, lullabies and film scores. The starters' "ooh" voices sing with it now.
- **Four new starters** on the newest recordings: **Cathedral** (both choirs, organ, harp, strings, timpani and bells), **After Hours** (a late-night ballad on brushes, grand piano, upright bass and alto sax), **Plaza** (congas, bongos and claves in son clave, a nylon guitar montuno and a trumpet) and **Mbira Morning** (mbira, balafon, folk harp, hand chimes and a didgeridoo drone).
- **Plainer names** for a few rap styles: the starters **Rap Beat**, **Cowbell Drive**, **Dark Bounce** and **Blown-Out Hype** (in the **Hip-Hop & Rap** group), the Dark melody styles **Sparse bells**, **Sliding piano**, **Fast riff** and **Cowbell riff**, and the drum and 808 presets named after them. Searching the old names still finds them.
- **Keep My sounds safe**: File › **Save my sounds to a file…** puts your saved sounds and starred instruments (and any recordings they play) in one file, and **Open a my sounds file…** brings them into another browser. In Pocket, both are in the song's settings.
- More real **cat**, **frog**, **purr**, **thunderstorm** and **thunder** recordings in the sound effects maker.
- Pocket's short messages now show at the top of the screen, and taps go through them, so they never cover the pads while you record.

## 2026.10.19-3 — A real choir, and your own sounds

- **Choir (Real)**: a choir of twenty real singers, men and women, singing "aah" soft and loud, across the stage as a choir stands. The starters that had a choir sing with it now.
- **Favourites**: star any instrument (★ on its row) to keep it at the top of every instrument list, in the studio and in Pocket.
- **My sounds**: set a sound up once and keep it. The bookmark button beside the instrument in the Track Inspector saves the whole sound (the instrument with its settings, a synth patch, an 808 or kit design, a plugin's knobs, its effects, EQ and sends) under a name, to pick from the top of any instrument list in any song, in the studio or Pocket.

## 2026.10.19-2 — Pocket on one screen

- **Pocket, the phone version, is now one screen**: the whole song as a grid at the top (a row for each section, a column for each track), and the bottom of the screen becomes the instrument of whichever cell you tap. No more tabs: the song, its instruments, singing and the mixer are all on the one screen, as in the studio.
- **Arrange with a tap**: tap a section's letter to loop it; its **⋯** plays it twice (a linked copy), moves it, adds a build-up into it or takes it out. Sections that play the same thing share a letter, and Pocket's sections are the song's markers, so the studio shows them on its timeline.
- **Pads like an MPC** (kick, snare, clap and hat under your thumb), pads and chords in the song's key, one drum's steps at a time, and a **piano roll** made for a phone: draw, stretch and move notes with one finger, scroll with two, and fine-tune a selected note with buttons.
- **Turn the phone** on its side and the grid becomes the studio's timeline, with the instrument beside it. A new song starts with **What are we making?**: a kind of music, a starter, and it plays.

## 2026.10.19 — Real instruments, real sounds

- **New recorded drum kits**: a **Session Kit**, a **Brush Kit** for jazz and ballads, **Latin Percussion** (congas, bongos, timbale, shaker, bells) and **Percussion Extras** (guiro, cabasa, sleigh bells, vibraslap, woodblocks, bell tree, whistle). The piano roll names their rows for what they play.
- **17 more recorded instruments**: a **Studio Grand** and an **Old Upright** piano, **Piccolo**, **Alto Flute**, **Bass Flute**, **Bass Clarinet**, **Soprano Sax**, **Bass Trombone**, **Muted French Horn**, and from around the world a **Folk Harp**, **Glass Harp**, **Mbira**, **Balafon**, **Bowed Psaltery**, **Hand Chimes**, **Gong** and **Didgeridoo**.
- **Longer, fuller notes**: the pianos, harp, bells and pizzicato strings ring for much longer, as the real ones do. A new **Ring** control (Track Inspector) lets any recorded instrument's notes ring on after they end, for dramatic and ambient music, and **Breathe** can be switched off so wind and brass hold long notes without tiring.
- **Sound effects that sound real**: the sound effects maker has a new engine with stereo, real rooms and recordings of the real thing under its sounds (footsteps, doors, glass, metal, cloth, water, fire and more). Three new groups: **Nature** (forest, night, river, ocean, downpour, thunderstorm, thunder, cave, wind in trees), **Places** (city street, cafe, market) and **Creatures** (birds, dogs, cats, wolves, farm animals, bees, and monsters for games). Your old sounds stay exactly as they were.
- Fixed: a plugin's settings window could stay on "Loading the plugin…" in bigger songs. It now always opens.

## 2026.10.18-2 — For streamers and video makers

- **Channel kit** (File › **Channel kit (streams, videos)…**): one song made into a .zip of everything a stream or channel needs: an intro and an outro, seamless loops for Starting soon, Be right back and Ending, three alerts in the song's key and a transition whoosh, all at one loudness, with a README on using them in OBS.
- **Underscore and no-drums versions**: a mixdown can now come with a version without the lead melody (to sit under someone talking) and one without the drums, in one .zip.

## 2026.10.18 — Showcase videos

- **Showcase video** (File › **Showcase video…**, or Export › Video): an MP4 of your song with every note on a piano roll that scrolls past a red playhead, each note lighting up as it plays, as on fledgetone.com. The tracks playing light up above it.
- Videos now come in two shapes: **Widescreen** (1920×1080) for YouTube and **Portrait** (1080×1920) for TikTok, Shorts and Reels, both in full HD.
- Big songs read clearly: a **lane per track** for a big arrangement (or one roll, your choice), doubled parts no longer merge into one note, and notes hit with small **sparkles** (or rings, or just the glow) that shrink as the song gets busier.

## 2026.10.16-16 — Game tools up front

- A **Game** button at the top right opens the game tools (states, intensity, stingers and the game kit export) in one click.
- Picking a game-ready starter opens the Game tab straight away, so you can switch between its states and try its stingers.

## 2026.10.16-15 — Linked clips, chords and riffs, sample packs

- **Linked clips**: **Duplicate linked** (`Ctrl+Shift+D`, or right-click a clip) makes copies that play the same pattern as the original. Edit the notes of any of them and they all change together. Linked clips show a badge (**P1**, **P2**…), and **Make unique** gives a clip back its own notes.
- **Chords, arpeggios and riffs** in the piano roll: click the chords of your key (**I ii iii IV V vi vii°**, or with 7ths) to write a progression from the playhead, voiced smoothly. A fuller **ARP** with eight patterns over one to three octaves. **New riff** writes a pluck riff, lead line or bass line in the key that follows the chords on your other tracks.
- **Sample packs**: **Add Track › Sample pack (folder)…**, or drop a pack's folder under the tracks. Its drums become Drum Rack kits with each sound on its pad (kick, snare, clap, hats…), an instrument's notes become a Multi Sampler, its loops go on an Audio track and its other one-shots on pads of their own. The Drum Rack and the Multi Sampler can load a whole folder too.
- Export: WAV at **88.2** and **96 kHz**, and **24-bit** is now the default.
- The **LAG** warning is more accurate (it could warn when nothing was wrong on some computers or over Bluetooth), and it names your heaviest tracks with a one-click **Freeze** for each.
- The first time your work is saved, a note explains it's kept in this browser only, with a **Save a file** button.
- Many small fixes: mic recordings land exactly in time, some plugin instruments no longer get stuck on a note, MIDI and MPE bends, notation, Pocket in other time signatures, game kits in other time signatures, and more.

## 2026.10.16-14 — Glue

- A new **Glue** switch in the Mixer, for songs that sound like instruments playing side by side rather than one song. It gives each part its own room in the mix, groups the drums and the music on their own buses, ducks the bass under the kick, puts everything in one shared space and spreads the parts out a little. Switch it off at any time, even days later, and your mix goes back to how it was, keeping anything you've changed by hand since.

## 2026.10.16-13 — More reverb

- A track's reverb send now goes up to **200%**, and to **300%** with one click on the **300%** button beside it in the Track Inspector, for very wet and drenched sounds. The mixer's REV knobs go to 200% too.

## 2026.10.16-12 — Recordings first, retro instruments optional

- The instrument lists now lead with the high-quality recorded instruments: each group starts with its recordings.
- The older, lower-quality instruments (the basic computer sounds of the 1990s that Fledgetone started with) are now tucked away in one **Retro** group, hidden until you want them: click **Show retro instruments** at the bottom of any instrument list. Fledgetone remembers your choice.
- Songs that already use a retro instrument still play it exactly as before.

## 2026.10.16-11 — Surge XT and more plugins on fledgetone.com

- Four more free plugins in the studio: the **Surge XT** synth with hundreds of ready-made sounds, the **Dragonfly** reverbs (hall, room and plate), the **Plateau** reverb and the **setBfree** organ. Find them in the Plugins menu.

## 2026.10.16-10 — Fledgetone is open source

- Fledgetone's code is now free software under the GNU General Public License, version 3, with its source on GitHub (github.com/martinmswanson-cmd/fledgetone). The home page, the guide, the licences page and Help › **Source code** link to it.
- The terms of use explain what that means. The files Fledgetone adds to your exports (players and game-engine scripts) are still yours to use in any project, including closed-source and paid games and apps.
- A code of conduct for everyone taking part in the project, linked at the bottom of every page of the site.

## 2026.10.16-9 — Pocket: swipe through the song

- Pocket's Song screen: the tracks now scroll sideways with a swipe instead of squeezing the whole song into the screen, with zoom buttons, the track names staying put on the left, and the view following the playhead while the song plays. Tap a bar number to move there.

## 2026.10.16-8 — Learn: hands-on lessons on fledgetone.com

- **fledgetone.com/learn/**: twelve step-by-step lessons, separate from the guide, each building a real example with screenshots from the studio and an **Open the example in the studio** button: a tour, your first beat, chords and a melody, bass lines and 808s, arranging a song, mixing and mastering, vocals, sound design, scoring a video, game music, exporting and sharing, and making music on your phone. The home page lists them in a new **Learn** section.
- Every page of the site notes that Fledgetone isn't affiliated with the companies and products it names.
- Pocket: **Repeat** moves on to the copy it made (tapping it again carries on after it, instead of stacking copies), and the note grid works out the song's key when a part opens, so its rows no longer move while you paint.
- The tempo finder (FIT › Hit points) says when the song has tempo changes, since its tempos assume one steady tempo.
- **Game › Transition matrix** opens the matrix, not just scrolls to it.
- Export's **Video (MP4)** describes your own video when the music goes on it.
- The Pro EQ's frequency moves with the arrow keys down low too (it kept snapping back under about 150 Hz).
- The Synth Designer shows one second as **1.00 s**, not 1000 ms.

## 2026.10.16-7 — Pocket's early-version notice

- Pocket opens with a notice that the phone version is in its early stages and the desktop experience is much better. It shows each time until you tick **Don't show this again**.
- The studio's phone notice works the same way now (it showed once before), with its own **Don't show this again**.
- The tempo in Pocket's top bar no longer wraps on narrow phones.

## 2026.10.16-6 — Pocket: vocals, drummer, chords and arranging

- **Vocals** in Pocket: record over the song from the phone's microphone (the loop once, or from the playhead), pick a vocal sound, and double, tune or delete each take.
- **Beat**: slide along a row to paint steps, the **Drummer** writes a whole pattern in any of 21 styles, **Fill**, **Clear**, a **Swing** slider, **Loop** a pattern, and a light buzz on the pads (Android).
- **Notes**: slide to paint notes, **Chords** fills a part with a progression in the key (held, pulsing, stabs or an arpeggio), and **Clear**.
- **Song**: **Arrange** tools: repeat the loop, a build-up and drop, and a speed-up into the drop (with or without a drum roll).
- **Mix**: swap a track's instrument, and delete a track.
- A metronome button, the screen stays on while the song plays, the last song opens again by itself, and a MIDI keyboard plugged into an Android phone plays.
- The pattern buttons fit the narrowest phones, and the grids only ring the step playing while the song plays.
- Tune vocal shows a sound-wave icon instead of a magic wand, in the studio too.

## 2026.10.16-5 — Plain icons

- Pocket's **New** button shows a plus, and the studio's **New idea** (sample chops) and **Aux Sends** show a shuffle and waves: no more sparkles, which suggest AI-made music. Nothing in Fledgetone writes music with AI.

## 2026.10.16-4 — Fledgetone Pocket, for phones

- **Pocket**: on a phone, Fledgetone now opens a version made for one. Big drum pads and a step grid for beats, a note grid that has only the notes of the song's key, a whole-song view to tap into any clip, a simple mixer, and an MP3 export straight to the phone's share sheet. It plays the same instruments and songs as the studio: a song started on a phone opens on a computer, and back. See the guide's **Fledgetone Pocket: on a phone**.
- The studio's phone notice offers Pocket, and **Help › Pocket, the phone version** switches to it on any device.

## 2026.10.16-3 — A home page

- fledgetone.com has a home page: what Fledgetone does, with videos, how to install it as an app, and a button to open the studio. The studio itself moves to **fledgetone.com/app/**.
- The guide is on the site too, a page per chapter at fledgetone.com/guide/, and the open-source licences at fledgetone.com/licenses/.
- Old links still work: shared song links made before the move open in the studio, and the app installed before it opens the studio as before.

## 2026.10.16-2 — Up-to-date guide

- The guide matches the app again: the menu bar list covers every menu and item (Plugins and Learn included), game music has a chapter of its own, the Track Inspector is described in its real order, and wrong counts, menu paths and button names are fixed.
- The tour and tutorials describe the screen as it is now (the bottom panel's tabs, the Pump's Trigger, how Save works, the Drummer's 21 styles).
- **Download all** (Master tab › Instruments offline) says how much it fetches: about 280 MB, the built-in plugins included.
- Three drum instruments have plain new names: **80s Drum Machine**, **Rhythm Box** and **Synth Drum**. They sound the same, and songs that use them open as before. The starters' electric piano tracks are now called "E. Piano".
- The terms of use (section 6) now say that a few recorded drum kits come from a collection that states no licence, as the guide's Credits do.
- Opening a shared song link for the first time no longer puts the welcome window over the song.
- **View** lists the **Launcher** tab with the bottom panel's other tabs.
- The open-source licences that come with the app include the notation view's music font (Bravura, SIL Open Font License).

## 2026.10.16 — Demo songs

- **New** has a **Demo songs** section: the demo song (Sunset Stroll) and the five Classics, right under Blank timeline, to open and listen to.

## 2026.10.15-34 — The Classics, settled

- The Classics group keeps just the five classical pieces.

## 2026.10.15-33 — The Classics

- A new **Classics** group of starters in **New**: five complete public-domain pieces (Pachelbel's Canon in D for solo strings and sections, the first movement of Beethoven's "Moonlight" sonata and Debussy's Clair de lune on the concert grand with the pedal, the Prelude of Bach's first cello suite on the solo cello, and Grieg's In the Hall of the Mountain King for orchestra, speeding up to the end), each with its dynamics, rubato and phrasing. Where their notes come from is in the guide's Credits.

## 2026.10.15-32 — Speed up from the clip menu

- Right-click a clip: **Speed up the end** speeds up the last 25% of the block by 25% and snaps back (one click), **Speed up the end + drum roll** goes 50% faster with the roll, and **Speed up the end…** opens the options.

## 2026.10.15-31 — Speed up into the drop

- **Speed up into the drop** (Arrange a beat › Drops & switches, right-click the ruler › **Speed up into here…**, or search *speed up*): the tempo rises over the last part of a block of music (the last 10 to 100%, 25% to start with) by up to double time, evenly or slow-then-fast, and snaps back to the old tempo on the drop (or stays fast). It can roll the snare up into the drop too (8ths, 16ths, then 32nds). It writes ordinary tempo glides, so playback, exports, the metronome and the grid follow it, and one Undo takes it out.

## 2026.10.15-30 — No sound on its own

- Fledgetone makes no sound until you start the audio (a click or a key), even when the browser would allow it: a song the browser reopens after a restart no longer starts playing by itself. Closing or leaving the page silences it at once, even if the browser keeps running in the background.
- Effects that make their own sound (the Shepard tone, noise sources, click tracks) fade out a few seconds after their track goes quiet and come back when it plays, instead of droning on through the whole song and while stopped. Reverb and delay tails fade as before; the infinite reverbs still hold.

## 2026.10.15-29 — Real-sounding guitars

- Guitars that sound like the ones on records: less sharp, in a room, and played the way a guitarist plays. New **Classical Guitar (Real)**: a nylon-string guitar recorded on every note, soft, medium and hard, so no note is stretched from a neighbour's. The starters' classical guitar parts play it, and the **Acoustic Guitar (Real)** (until now the Acoustic Guitar) plays it too, voiced brighter for strumming (it used to be sharpened with an 8 dB treble boost and distortion).
- The real electric guitars' amps sound like a miked amp on a record: the speaker's piercing peak near 4 kHz is taken down, the hardest-picked recordings (much brighter than the rest) play only for accents, and a held chord rings on for 5 or 6 seconds, dying away, instead of stopping after 3 or 4.
- Every guitar plays in a small studio room after its amp (they were recorded dry, in mono), and the electric guitars make the sound of the strings being damped when a note is let go early.
- A chord written as one block on a guitar, banjo or mandolin is strummed: low to high on the way down, high to low when the hand comes back up for a chord that follows closely, quicker the harder it's played.
- The older retro guitars sound darker as well as quieter when played softly, as the other guitars do.

## 2026.10.15-28 — Full names on hover

- In Search and the instrument menus, the result under the pointer (or chosen with the arrow keys) shows its whole name and description instead of cutting it off, and hovering shows it as a tooltip too.

## 2026.10.15-27 — Exports repeat exactly

- Exporting the same song twice now gives exactly the same file, sample for sample, for every instrument, kit, effect and starter (before, two exports could differ by a rounding error in the last bit, more after a distortion).

## 2026.10.15-26 — Install Fledgetone

- Fixed: in the published app the live loudness meter, and the loudness measured for exports, could fail with an error: they work again.
- Install Fledgetone as an app (Help › Install Fledgetone…, or your browser's Add to Dock / Add to Home Screen): its own window, and it opens offline after one visit.
- The app is kept in your browser, so it opens at once and isn't downloaded again; recordings you've used aren't downloaded again either.
- New versions download in the background and show "Version … is ready: Reload". The app never reloads by itself: Reload autosaves first, and What's new opens after it.
- Master tab › Instruments offline shows whether the browser will keep your work when the disk gets full (Storage: protected), with Protect to ask.

## 2026.10.15-25 — A Learn menu

- A **Learn** menu at the top lists the tour and every tutorial, one click each (finished ones ticked, a half-done one picks up where you stopped). The guide and the tour now say where to find them correctly.

## 2026.10.15-24 — New violin in the starters

- The starters' solo violin is the new **Violin (Real)**: every note recorded, warmer and with a player's vibrato.

## 2026.10.15-23 — Flip a sample

- **Flipping a sample**: an audio clip's **tempo and key** are heard from its sound (with how sure, in the clip editor, on the clip and in the Audio track's panel), with one click to set the song to the sample's tempo, stretch the sample to the song's, or move it into the song's key (a re-pitched copy, same length). **Chop sample…** cuts it into up to 16 chops at its hits, in equal parts or by hand (drag, add and remove markers), onto a new Drum Rack's pads, each with its own start, end, fade, reverse, pitch, level and choke (one chop cuts the others, like a classic sampler); **Chop and play** writes a starting pattern that plays them in a new order, and **New idea** another. **Filter out the bass** clears a sample's low end for your own 808.

## 2026.10.15-22 — Warmer, more real strings

- Strings that sound less sharp and more like a record. New real recordings: **Violin**, **Viola**, **Cello** and **Contrabass (Real)**, single players recorded on every note at soft, medium and loud, so no note is stretched from a neighbour's. They were recorded without vibrato in a dead room, so each held note gets a player's vibrato (starting a moment into the note, a little different every time, with the shimmer of the instrument's body), a small stage around it, and a hall's softening of the bow's bite.
- Every bowed string swells in as a bow does (slower the softer it's played) instead of starting at full level, and held notes loop a longer stretch of the recording (up to 3 s, its level held steady) instead of repeating the same 1.5 s.
- A new orchestral track starts with more of the hall's reverb (strings on records sit in a hall).
- The Classical starter's string quartet plays the new violin, viola and cello, in more of the hall; the Cinematic starter's strings and cellos sit further into the hall too.
- The starters no longer add a second, even vibrato on top of strings that already play their own.

## 2026.10.15-21 — Mix and master tools

- **Clipper** on the master: shaves the tallest peaks flat before the limiter, for loud rap and electronic masters, with drive, a hard-to-soft character, a ceiling and a meter of how much it's clipping. Oversampled, so it stays clean, and the same in exports.
- **Reference track**: load a finished song, hear it at your mix's loudness, flip between the two with one A/B button, and see where your tonal balance differs on a spectrum. It stays in your browser and is never exported.
- **Mix check**: renders the song and each track and points out, in plain words and with the track to look at, wide bass, the kick and bass fighting, muddy or harsh spots, parts covering each other, a level wrong for where the song is going, and a master working too hard.
- **Bus presets**: one-click drum, 808/bass, vocal and music buses, with two new bus inserts: **Saturation** and **Mono bass**.
- **Beat store package**: one dialog makes a tagged MP3 preview, the untagged WAV, the stems and an optional cover in one .zip, named with the tempo and key.

## 2026.10.15-20 — Arrange a beat

- **Arrange a beat** (Song menu, the ruler's right-click menu, or search *arrange*): a **Dark melody** generator for trap, drill, rage and phonk (minor, harmonic minor or phrygian with the flat second for tension, sparse rhythms, a repeating motif with a new ending, density, register and **New idea**, the same idea number always writing the same melody), **Drop out** and **Stop** before a drop, **Riser** and **Reverse cymbal** into it, a **Beat switch** (half time, double time or a new drum pattern with the bass following its kicks), **Song form** (intro, hook, verse, hook, verse, bridge, hook, outro from a 4- or 8-bar loop, with section markers) and a **Producer tag** kept in the browser for every project, placed at the start or every few bars with the beat ducking under it. Each is one Undo step.

## 2026.10.15-19 — Rap vocal tools

- Rap vocal tools: **vocal chain presets** on Audio tracks (Clean lead, Aggressive lead, Ad-lib, Phone / radio, Dark and wide, Backing stack: one click, one Undo step), **Hard tune** (fast pitch correction to the song's key, with a natural-to-instant Speed, note holding so it steps cleanly, and more scales: harmonic minor, phrygian, pentatonics), **Double this take** (two new performances panned left and right, a little early or late and a few cents apart, the same every time), and an **Ad-lib track** button that makes a new Audio track with the Ad-lib chain, ready to record.

## 2026.10.15-18 — Drum tools

- **Drum Designer**: a new **Designed Kit** whose every drum you make yourself, synthesized: kicks (punch, pitch sweep, decay, distortion), snares (tone, noise, snap, body), claps (bursts, spread, tail), hats (metal, color, decay), rims, toms, shakers and cowbells, two layers each, with 30 presets named by sound (hard trap kick, punchy drill snare, crisp clap...). Saved with the project; plays the same live and in exports.
- **Hat roll painter** (ROLL… in the piano roll): turn a hat note or a span into a roll at 1/16, 1/16 triplet, 1/32, 1/32 triplet, 1/64 or a stutter, its velocity rising, falling or swelling and its pitch climbing like drill hats.
- **Swing per drum** (GROOVE… in a drum clip's piano roll): swing the hats while the kick and snare stay straight, with groove templates (straight, light swing, heavy swing, lazy, pushed) that set each row's timing and velocity.
- **Note repeat** for finger drumming (MIDI popover): hold a pad and it repeats at 1/8, 1/16, 1/32 or a triplet rate, on the song's grid, its loudness following the pad's pressure; recorded hit by hit.
- Changing a clip's swing (FEEL) while the song plays is now heard at once, and a frozen track follows a change of its clips' swing or a note's own expression.

## 2026.10.15-17 — Heavy bass tools

- Heavy bass tools for trap, drill, rage, phonk and bass music: an **808 designer** on 808 Bass tracks (drive and clip character with a tone control, punch, slide time, decay, a top layer that phones and laptops can hear, tune to key, and six presets from clean and deep to blown out), a **Bass Drive** insert that distorts the mids and highs while the sub stays clean and mono, a **Sub enhancer** (a clean sine under a bass's notes), **Glide** for the monophonic synths, a kick and bass clash check with one-click **Duck under the kick**, and **Reese bass**, **Dark reese** and **Formant growl** presets in the Synth Designer (the Growl bass preset's low end is now centred).

## 2026.10.15-15 — Celesta, recorder and muted trumpet

- New real recordings: **Celesta (Real)** (every key, in stereo), **Recorder (Real)** (tenor, alto and soprano recorders as one instrument) and **Muted Trumpet (Real)** (harmon mute, soft and loud). The starters play them; the older Celesta, Recorder and Muted Trumpet move to the Retro group, so older songs sound as they did.

## 2026.10.15-13 — Clearer terms

- The terms of use start with plain questions and answers: owning and selling your music, credit, game kits in paid games, privacy, lost work, similar songs, content claims and more.
- They also cover loud sound and flashing visualisers, music written by the tools, sounds everyone shares, and an age of 13 or older.
- The scripts and players Fledgetone adds to game kits and game-audio packages can be used in any game or app, closed-source and paid ones included, under any licence. Each such export includes a short licence file saying so.

## 2026.10.15-11 — Terms of use

- Fledgetone has terms of use (**Terms** at the bottom of the page, or **Help › Terms of use**): everything you make is yours, and you're responsible for what you make and use.

## 2026.10.15-10 — Exports repeat exactly

- Exporting the same song twice gives the same file: snares, hi-hats, claps, cymbals, risers and synth noise used to come out a little different every time. Each hit still sounds slightly different from the next.
- With a loudness target, a ring-out export's tails are judged at the file's final level, so a quiet song turned up no longer ends its tails early.

## 2026.10.15-9 — Hear instruments in the menu

- Every instrument in the instrument menus (Add Track and the Track Inspector) has a ▶ button: click it to hear that instrument before choosing it.
- The Instruments tab of the bottom panel is gone: hearing instruments moved into the menus, and its old pads and patterns had been replaced by the starters, the piano roll and the step sequencer. The bottom panel now has more room for the Mixer, EQ and Game panels.

## 2026.10.15-8 — Clearer timeline resize

- The timeline's resize bar sits right under the tracks with a grip on it, and says "more tracks below: drag down" when some tracks are out of view.

## 2026.10.15-7 — FX panel fits the timeline

- With the track FX panel open, the timeline no longer stretches past its last track into empty grey space: the panel is as tall as the timeline and scrolls inside, so the resize bar sits right under the tracks.

## 2026.10.15-6 — Timeline stops at the last track

- Dragging the timeline taller stops at the last track instead of leaving empty grey space under it.

## 2026.10.15-5 — Timeline grows with new tracks

- Adding an instrument grows the timeline just enough to show its track, moving the panels below down with it, instead of hiding it below.

## 2026.10.15-4 — Sound and export fixes

- The timeline resize bar now really changes the timeline's height and moves the Mixer and Instruments panel down with it, whatever the song's length.
- MP3, OGG and video exports keep their peaks under -1.5 dBTP, so they still play back under -1 dBTP after compression.
- Switching a compressor on or off while the song plays no longer makes a held bass note on the other tracks dip.
- Some older recorded instruments (celesta, saxophone, steel-string guitar and others) no longer push the whole mix slightly off centre, which wasted loudness.
- The Riddim starter plays at -14 LUFS like the rest of its group, with a softer snare and the growls up front.
- Recorded electric guitars cost less to play, with no change in sound.
- Ring-out exports end once the tails have died away instead of after a fixed time, so long reverbs and cymbals are no longer cut off.

## 2026.10.15-3 — Taller timeline

- Drag the bar under the timeline to make it taller and see more tracks at once; double-click it to fit every track.

## 2026.10.15-2 — Smoother sound, faster exports

### Sound
- **Lush** room for the master reverb: a smooth, dense, gently shimmering tail, as loud as the concert hall but much lighter on the computer.
- Turning knobs, muting and soloing while a song plays no longer clicks.
- Tracks with a compressor stay exactly in time with the rest of the mix (they used to run a few milliseconds late), live and in exports. The metronome and recorded takes line up with the mix too.
- Recorded instruments get louder with every step of velocity; some used to get quieter where they crossed into their next recorded loudness.
- **Electric Piano (Real)** notes ring on and fade naturally while held; the starters' held electric piano chords use it.
- The glockenspiel, harmonica, short trombone and the studio kit's hats, cymbals and snare stay clearer when played away from their recorded pitch.
- Long reverb rooms ring all the way down, and changing the room or decay while playing no longer cuts the tail or makes playback stutter.
- When an instrument has too many notes ringing, the quietest gives way instead of the oldest.
- Long held pad and drone notes keep sounding past 10 seconds.
- A track set back with Distance keeps its extra reverb when its reverb send is automated.

### Master
- New **Level** control: turns the whole mix up or down just before the limiter.
- Exports' peaks stay at or under -1 dBTP; ring-out exports fade their last moments instead of stopping on a long tail.

### Starter songs
- Every starter plays at a matching loudness for its kind of music (within 1 LU of its target), so switching between them no longer jumps in level. Their level sits on the master Level.
- The double bass no longer drowns out the orchestral starters, and the drums no longer swamp the trap, drill, phonk, dubstep and riddim starters.
- A starter sounds exactly the same every time you open it, and a song's human feel no longer changes when it's reopened, so exports repeat exactly.
- Fixed silent hand drums in two game starters.

### Speed and memory
- Exports use more of your computer at once: about twice as fast on big songs, and stems render several at a time.
- Songs load the notes they play first and start sooner; the rest arrive in the background (on phones and smaller computers, only when needed). Memory at Play start is about a third of what it was.
- Synth Designer sounds take about half as much computer power per note.
- Exports no longer stay in memory after they finish.
- Exports at 44.1 or 48 kHz are equally clean whatever rate your sound card runs at.

### Playing and settings
- Keys played on screen (the instrument browser, piano roll previews, deck pads) sound at once instead of a tenth of a second later.
- The Playback panel shows the delay from a key to its sound.
- If you chose Responsive playback yourself, the app no longer switches you to Stable; when it switches by itself, it tells you.
- An export waiting on a recording that won't download stops after a while and says which instrument failed.
- Exported stems each get their own dither, and the intro + loop export no longer clicks where the loop begins.

## 2026.10.15 — Better sound

### New instruments (free recordings)
- **Studio Kit (Real)**: a recorded drum kit (kick, snare, hats, three toms, crash and ride), each at four loudnesses with two takes, so repeated hits never sound identical. The starters' drum parts use it.
- **Electric Piano (Real)**, **Banjo (Real)**, **Harmonica (Real)**, **Ocarina (Real)**, **Steel Drums (Real)**, **Zither (Real)**, **Solo Voice (Real)** and **Concert Bass Drum (Real)**.
- The older versions they replace moved to the **Retro** group; songs using them sound as before.

### Recordings play more like the real thing
- Recordings are in stereo.
- Held notes keep sounding (they loop smoothly) instead of stopping when the recording ends.
- Soft and loud recordings blend into each other as you play harder, instead of jumping.
- Harpsichord and piano make their key-release sound when you let go.
- Wind and brass players run out of breath on very long notes.

### Space and mix
- **Room styles** for the shared reverb: concert hall, chamber, church, studio room and plate.
- **Distance** (DIST in the Track Inspector): pushes a part further back in the room.
- New orchestral tracks sit where the players sit on stage.
- **Make space** (Mixer): small EQ moves so parts stop covering each other.

### Master
- A look-ahead limiter keeps peaks under -1 dBTP, so exports don't clip.
- **Loudness targets** in Export: streaming, loud, game, podcast, broadcast.
- **Glue styles** for the master compressor: standard, gentle, punchy, tight, off.
- 16-bit exports are dithered.

### Synths
- Ladder filter, drift (analog wander), FM, organ, pulse and vowel waves, wider unison.
- New presets: Analog poly, FM bell, FM electric piano, Organ, Vowel lead, Pulse bass, and five pads.
- Distortion sounds smoother and less harsh.

### Playing
- New tracks get a human feel that suits the instrument.
- **Shape dynamics** in the piano roll: phrases rise and fall like a player's.
- Chords on section instruments spread a few milliseconds, as a section never plays exactly together.

### Speed and memory
- Playback switches itself to stable mode if the page keeps lagging.
- Instrument recordings you haven't used for a while are let go after 3 minutes stopped.
- Songs start faster: a lighter version of each instrument loads first.

## 2026.10.14 — Fledgetone

- The app is now called Fledgetone, with its own logo.
- The starters play recorded orchestral, band and keyboard instruments; the older sounds are in a new **Retro** group.
- Mod wheel is dynamics on every instrument; new Vibrato lane and Swell tools.
- Strings play like strings: portamento on legato, short notes, double stops.
- Recorded rooms for the master reverb.
- **Play backwards** and **Reverse notes**.
- **Math patterns**: music written by a formula.
- **Melody variations**, smarter game transitions and game parameters.
- Faster song opening, shorter share links, and fixes from two bug hunts.
