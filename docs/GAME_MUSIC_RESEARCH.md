# Teach Bo's Beatbox to Speak Game Music

A small set of tools produces game-music moods, and those tools carry over from game to game. Bo's Beatbox already has most of the adaptive plumbing they need but is short on musical vocabulary. Music-psychology research finds that **tempo mainly sets energy and mode mainly sets brightness**, and that these cues add up in a predictable way. A model built only on individual cues predicted **77–92% of listener ratings** ([Eerola et al. 2013](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2013.00487/full)), so a non-expert can steer mood with just a few controls. The scores most praised for beauty add five moves on top of that:

1. Borrowed-chord and modal colour: ♭VI–♭VII–I, Lydian, Mixolydian.
2. One theme re-dressed for each place or state: Odyssey's 8-bit sections, Banjo-Kazooie's re-orchestrations, Breath of the Wild's day and night versions.
3. Groove "costumes" such as the underwater waltz and big-band swing.
4. Deliberate silence: Breath of the Wild's gaps of up to 13 seconds, Minecraft's randomly timed cues.
5. Music wired to play state: Ocarina of Time's 8-bar segments that recombine at random and fade to battle music as enemies approach.

Bo's Beatbox already has states, a transition matrix, intensity stems, in-key stingers and engine exports, which covers the 2000s middleware model well. It is missing:

- 8th-note swing and groove templates.
- The scales and progressions behind fantasy, desert and horror colour (whole tone, octatonic, Phrygian dominant, ♭VI–♭VII–I, chromatic mediants).
- Waltz, jig, swing and march drum styles.
- A second tier of adaptive tools: orchestration skins, parameter curves that drive filter and tempo, and generative scheduling with silence.

The best order of work is a cheap vocabulary pack first (scales, progressions, swing, drummer styles and twelve new starters), then accompaniment generators, then the runtime features. One caveat applies to every number below. The researchers had search summaries only, never full pages. Nintendo publishes no BPMs or keys. Most tempos here are therefore transcriptions, aggregator readings or conventions, and they are labelled as such.

*How to read the numbers in this report.* **[C]** means a linked source states the value. **[T]** is a human or fan transcription (MuseScore, Hooktheory, sheet-music sites). **[A]** is an automated BPM aggregator (Tunebat, SongBPM, 12notez). Aggregators measure cover recordings and often report double or half time; one Mario theme shows up anywhere from 97 to 108 BPM ([Tunebat](https://tunebat.com/Info/Super-Mario-Main-Theme-Super-Mario-Bros/4FkhUEKaSHerpzdoq3qneS)). **[E]** is an estimate or conventional scoring practice that no source confirmed. Treat every [E] range as an editable default, not a measurement.

## Hardware limits defined five eras of game sound

Until about 2000, the console decided the sound more than the composer did. The Atari 2600's TIA had **2 channels and only 32 pitches per tone type**, which did not line up with equal temperament, so 2600 music sounds out of tune ([AtariAge forum](https://forums.atariage.com/topic/256832-is-the-pokey-chip-so-much-better-than-the-tia/)). The NES 2A03 had five channels: two pulse waves with **12.5/25/50/75% duty cycles** and 16 volume levels, a fixed-volume triangle usually used for bass, a noise channel, and 1-bit DPCM ([Battle of the Bits](https://battleofthebits.com/lyceum/View/2A03%20(soundchip)); [VGMPF](https://www.vgmpf.com/Wiki/index.php?title=2A07)). The Game Boy replaced the triangle with a **user-drawn 32-step, 4-bit wave channel** ([gbdev](https://gbdev.gg8.se/wiki/articles/Gameboy_sound_hardware)). The C64 SID got its character from three voices plus ring modulation, hard sync and an analog multimode filter that varied from chip to chip ([Wikipedia: MOS 6581](https://en.wikipedia.org/wiki/MOS_Technology_6581)).

The 16-bit split was a split in philosophy. The SNES was a **sampler**: 8 voices at 32 kHz, an echo with delay in 16 ms steps, and an 8-tap FIR filter on the echo path ([fpga-spc700](https://github.com/brandonpelfrey/fpga-spc700); [Furnace SNES doc](https://www.mintlify.com/tildearrow/furnace/chips/sample/snes)). The Genesis was a **synthesizer**: 6 four-operator FM channels with 8 algorithms. One channel could play 8-bit PCM drums, and a low-volume flaw (the "ladder effect") added grit that Yuzo Koshiro reportedly liked ([Wikipedia: YM2612](https://en.wikipedia.org/wiki/Yamaha_YM2612); [ConsoleMods](https://consolemods.org/wiki/Genesis:Audio_Chip_Notes)).

After that, CD audio, the PlayStation's 24-voice SPU with 512 KB of RAM ([DuckStation source](https://git.morozoff.pro/aiden/duckstation/src/commit/278aa86d1407898d531ba6231ffc4dc5f6ed41f6/src/core/spu.h)) and LucasArts' iMUSE (1991) moved the problem from timbre to interactivity. iMUSE embedded **markers and jump hooks** in the MIDI so that a theme could finish properly when the player left an area ([Wikipedia: iMUSE](https://en.wikipedia.org/wiki/IMUSE); [Mix'n'Mojo](https://mixnmojo.com/features/sitefeatures/LucasArts-Secret-History-Monkey-Island-2-LeChucks-Revenge/9)). In the HD era, Halo combined vertical layering with horizontal re-sequencing ([Splice](https://splice.com/blog/adaptive-music-video-games/)). Since about 2008, indie composers pick their era on purpose: Shovel Knight was written in FamiTracker with Konami's VRC6 expansion chip ([Shovel Knight wiki](https://shovelknight.fandom.com/wiki/Shovel_Knight_Original_Soundtrack)).

| Era | Hardware / technology | What limits the sound | Typical tempo and feel | Rhythm habits | Signature timbres | Sourced landmarks | Closest route in Bo's Beatbox today |
|---|---|---|---|---|---|---|---|
| Early PSG and arcade (1977–1990) | Atari TIA and POKEY, NES 2A03, Game Boy, C64 SID, PC Engine 6× wavetable ([HuC6280](https://en.wikipedia.org/wiki/Hudson_Soft_HuC6280)) | 2–6 voices, fixed waveforms, 4-bit volume, drivers updated once per 60 Hz frame | Fast and bright, 120–200 [E]. Tempos snap to frame ticks: at 60 Hz with 4 rows per beat, 6 ticks per row = 150, 7 = 128.6, 8 = 112.5 BPM (arithmetic) | Arpeggiated "fake chords", octave-jumping bass, noise-channel drums, echo faked on a second pulse | Pulse 12.5% (thin), 25% (bright), 50% (hollow); stepped triangle bass; LFSR noise | Super Mario Bros. 1985, Zelda 1986 (Koji Kondo) | Chiptune starter, Chip Lead (25% pulse), Chip Bass, Chip Drums, Braids/Plaits engines, Lo-Fi bit crush. **Missing:** duty switching, voice budget, frame-locked tempo |
| 16-bit (1988–1996) | SNES SPC700/S-DSP sampler; Genesis YM2612 FM + PSG | SNES: 64 KB shared sample RAM, soft Gaussian interpolation. Genesis: 4-op FM, 8-bit DAC drums | SNES lyrical and orchestral; Genesis 120–150 funk and house [E] | Longer loops (1–3 min), 7th chords and fusion harmony [E] | "Orchestra in a box" plus echo (SNES); FM slap bass, metallic bells, crunchy drums (Genesis) | Streets of Rage (Koshiro), Sonic (Masato Nakamura) ([Composer Code](https://composercode.com/video-game-composers/)); Donkey Kong Country (David Wise, custom instruments) ([Wikipedia](https://en.wikipedia.org/wiki/David_Wise_(composer))) | Orchestra through Lo-Fi (lower rate) plus Delay at 48–96 ms with feedback and Filter LP approximates SNES echo [E]; optional Surge XT for FM. **Missing:** OPN-style 4-op FM, ladder effect, FIR echo |
| 32/64-bit, CD and PC (1987–2001) | Amiga Paula 4× 8-bit with hard left/right ([VGMPF](https://www.vgmpf.com/Wiki/index.php?title=8364)); PC OPL2 9× two-op FM ([Wikipedia](https://en.wikipedia.org/wiki/Yamaha_OPL)); PS1 SPU; N64 software mixing; CD audio | Sample RAM; streamed audio traded interactivity for fidelity | Set by genre (rock, techno, trip-hop); song-length tracks | Tracker effect columns, iMUSE branch points | Soft, roomy N64 samples (downsample to ~16–22 kHz, LPF ~6–8 kHz, 25–40% reverb [E]) | Monkey Island 2 (iMUSE), Ocarina of Time, Banjo-Kazooie, Silent Hill | Orchestra plus master Hall plus Lo-Fi tone approximates N64. Game tab transitions cover iMUSE-style switching. **Missing:** tracker view, in-music hooks |
| HD and middleware (2000–2015) | DVD/streaming, live orchestras, FMOD/Wwise | Production budget, not chips | Intensity layers instead of fixed tempo; combat and exploration share tempo and key | Ostinato strings, taiko, adaptive stems | Choir, full orchestra, licensed songs | Halo chant ([Wikipedia](https://en.wikipedia.org/wiki/Halo_Original_Soundtrack)); Red Dead Redemption stems all at **130 BPM in A minor** [C] ([Wikipedia](https://en.wikipedia.org/wiki/Music_of_Red_Dead_Redemption)); Dead Space sections recorded separately for layering ([EA](https://s204.q4cdn.com/701424631/files/doc_news/2008/10/1/338525.pdf)) | **Strongest coverage:** Orchestra, Choir, Epic Orchestral/Cinematic starters, intensity stem groups, FMOD/Wwise package |
| Modern indie (2008–2026) | Cheap DAWs and trackers; deliberate era palettes | Taste | Widest range: rubato ambient to very fast chases | Anything; hybrids common | Chip-plus-reverb, ambient piano, synthwave, hybrid orchestral | Shovel Knight; Undertale (2015) ([Bandcamp](https://tobyfox.bandcamp.com/album/undertale-soundtrack)); Minecraft; Hollow Knight: Silksong (2025) ([Bandcamp](https://christopherlarkin.bandcamp.com/album/hollow-knight-silksong-original-soundtrack)) | Lo-Fi, Synthwave, Ambient and Chiptune starters, HUMAN, Pump, Lo-Fi insert |

The most useful lesson for Bo's Beatbox from this history is that **each era's sound is a recipe of constraints, not a sample library**. Bo's Beatbox can already approximate the HD and indie eras closely. It approximates the 8-bit era only loosely, because it has no duty-cycle switching, voice limits or frame-tick timing. For the 16-bit era it offers only general-purpose effects. The tempo quantization from frame ticks is a detail nobody would think to ask for, and it is exactly what makes a chip track feel authentic. It costs almost nothing to add as a toggle.

## Genres and track types follow stable tempo-and-timbre defaults

Game genres settle on a default sound, and the main variable is tempo, which follows gameplay speed. Racing, fighting and arena shooters sit around 130–180 BPM, and exploration, strategy and survival around 60–110 [E]. "Setting" genres such as space, western, cyberpunk and pirate depend more on instrument choice than on tempo. The sourced cases show how far a single instrument decision carries:

- **Halo** opens with Gregorian-style chant, because Bungie wanted "ancient, epic and mysterious"; Martin O'Donnell summed up his influences as "a little Samuel Barber meets Giorgio Moroder" ([Wikipedia](https://en.wikipedia.org/wiki/Halo_Original_Soundtrack)).
- **DOOM (2016)** is built from **7-, 8- and 9-string guitars, vintage Soviet synthesizers** and drums pushed through valve distortion and tape ([Bethesda](https://bethesda.net/ko-KR/news/inside-the-doom-score-mick-gordon-interview)).
- **Persona 5** uses acid jazz ([Siliconera](https://www.siliconera.com/persona-5s-soundtrack-comes-acid-jazz-influences/)).
- **Hades** is in a genre Darren Korb calls "Mediterranean prog rock Halloween", and Korb picks one genre per game "to help unify it" ([Wikipedia: Darren Korb](https://en.wikipedia.org/wiki/Darren_Korb)).
- **Castlevania: Symphony of the Night** mixes baroque and rock, with harpsichord leads over orchestra and electric guitar ([Wikipedia: Michiru Yamane](https://en.wikipedia.org/wiki/Michiru_Yamane)).

| Game genre | Musical style | BPM | Meter | Feel | Rhythm | Keys / modes | Instruments | Sourced examples |
|---|---|---|---|---|---|---|---|---|
| Platformer (classic) | Chip pop, calypso/Latin, J-fusion, funk | 120–170 [E]; Green Hill Zone 150 [A] ([Tunebat](https://tunebat.com/Info/Green-Hill-Zone-Theme-From-Sonic-the-Hedgehog-Video-Game-Players/6Hjix4LVz9TgCqJ75XLZyt)) | 4/4, some 3/4 | Bright, bouncy | Syncopated octave bass, backbeat | Major, Mixolydian; minor for fortresses | 2 pulse + triangle + noise; FM slap bass | Super Mario Bros. (C major, cut time, calypso [C]); Sonic |
| Platformer (modern indie) | Synth plus piano, whimsical orchestra | 90–175 [E] | 4/4 | Emotional, kinetic | Four-on-the-floor or breakbeat, arpeggios | Minor/Dorian with major lifts | Synths, piano | Celeste (Lena Raine) |
| JRPG | Orchestral/romantic, prog-rock battles, jazz | Field 90–130, town 80–110, battle 140–180 [E] | 4/4; 3/4 towns and love themes | Melodic, nostalgic | March snare, galloping 16ths in battle | Major field; minor/chromatic battle | Strings, brass, harp, piano, rock band | Persona 5 acid jazz [C] |
| Western RPG / open world | Ambient orchestral, folk, choir | Explore 60–110, combat 120–160 [E] | 4/4, free | Vast, melancholic | Rubato pads, sparse low drums | Aeolian/Dorian, drones | Strings, horns, choir, hurdy-gurdy, fiddle | — |
| Action-adventure | Hollywood hybrid orchestral | 80–150 [E] | 4/4; 7/8 or 5/4 in bosses | Cinematic | Taiko ostinato, string spiccato | Minor/Dorian | Orchestra, choir, solo world instrument, synth bass | Breath of the Wild "Hinox Battle": tribal drums, low horns, then brass ([RPGFan](https://www.rpgfan.com/music-review/the-legend-of-zelda-breath-of-the-wild-original-soundtrack/)) |
| Metroidvania (gothic) | Baroque plus rock/metal | 120–170 [E] | 4/4, 3/4, 6/8 | Gothic, dramatic | Harpsichord arpeggios, rock drums | Harmonic minor | Harpsichord, organ, strings, guitar | Symphony of the Night [C] |
| Metroidvania (isolated) | Dark ambient, chamber orchestra | 60–120 or unpulsed [E] | Free | Lonely, alien | Drones, sparse pulses | Chromatic, Phrygian | Pads, strings, piano | Hollow Knight: soft piano theme grows to orchestra ([GameTruth](https://www.gametruth.com/guides/10-indie-games-with-mind-blowing-soundtracks/)) |
| Shooter (epic) | Orchestra plus chant plus rock | 80–160 [E] | 4/4 | Epic, mysterious | Chant intro, then rock ostinato | Minor/modal | Choir, strings, guitar | Halo [C] |
| Shooter (arena metal) | Industrial/synth metal | 120–180 with half-time feels [E] | 4/4, polymetric riffs | Aggressive | Chugs, short syncopated "energy bursts" ([PC Gamer](https://www.pcgamer.com/doom-composer-mick-gordon-one-of-the-pre-conditions-of-the-project-was-no-metal/)) | Phrygian/chromatic | Extended-range guitar, Soviet synths, sub [C] | DOOM [C] |
| Racing | City-pop fusion (80s), techno/rave (90s), rock | 130–175 [E] | 4/4 | Exhilarating | Four-on-the-floor, breakbeats | Mixolydian (fusion), minor (techno) | Synths, slap bass, TR drums | Wipeout licensed electronica ([Wikipedia](https://en.wikipedia.org/wiki/Wipeout_(video_game))) |
| Puzzle | Folk/chip, house | 100–150 with speed-up tiers [E] | 4/4 | Hypnotic | Loop; speeds up under danger | Minor (Korobeiniki) | Chip, synth | Tetris speeds up near the top ([Tropedia](https://tropedia.fandom.com/wiki/Songs_in_the_Key_of_Panic); [American Songwriter](https://americansongwriter.com/behind-the-classic-tetris-video-game-theme/)) |
| Survival / sandbox | Ambient piano, minimal electronic | 50–100 or unpulsed [E]; Minecraft cluster ~72–88 felt [A] | Free/4/4 | Lonely, peaceful | Placed irregularly, long silences | Mostly major | Piano, pads | Minecraft (below) |
| Horror | Dark ambient, industrial, aleatoric orchestra | Unpulsed or 40–100 [E] | Free | Dread | Stingers, clusters, heartbeat | Clusters, tritones; "safe room" calm | Prepared strings, distorted guitar, noise | Silent Hill, Dead Space, Resident Evil (below) |
| Stealth | Tense hybrid, breakbeat | Sneak 70–100, alert 140–170 [E] | 4/4 | Suspense to panic | Low pulse ostinato, alert stinger | Minor/chromatic | Synths, low strings, percussion | — |
| Cozy / life sim | Acoustic pop, bossa, folk | 80–120 [E] | 4/4, 3/4, 6/8 | Warm | Light shuffle, pizzicato, mallets | Major, Lydian, maj7/add9 | Guitar, piano, marimba, flute | Animal Crossing: a track for every real hour ([Billboard](https://www.billboard.com/culture/lifestyle/animal-crossing-composer-new-horizons-music-interview-9390953/)) |
| Roguelike | One genre fusion per game | 100–180 [E] | 4/4, odd meters | Driving | Ostinato riffs, stems per biome | Minor/Phrygian/Dorian | Bouzouki, lavta, bağlama + metal guitars | Hades [C] ([WSHU](https://www.wshu.org/culture/2020-12-04/darren-korbs-metal-inspired-soundtrack-for-hades)) |
| Cyberpunk | 90s techno, industrial, downtempo | 90–140 [E] | 4/4 | Cold, pulsing | 16th arps, four-on-the-floor | Minor/Phrygian | Hardware and modular synths | Cyberpunk 2077 chose 90s "punch and energy" over synthwave ([Inverse](https://www.inverse.com/gaming/cyberpunk-2077-music-composers-interview)) |
| Western | Spaghetti-western, Americana | 70–130 [E] | 4/4, 6/8, 2/4 gallop | Lonesome | Gallop rhythm | Minor/Dorian | Baritone guitar, harmonica, whistle, trumpet | Red Dead Redemption stems [C] |
| Pirate / sea | Shanty, jig, swashbuckler | 90–140 [E] | 6/8, 4/4, 3/4 | Rollicking | Jig compound rhythm, stomps | Major/Mixolydian/Dorian | Fiddle, concertina, accordion, voices | — |
| Neo-chip indie | Chiptune plus modern mixing | 100–180 [E]; Megalovania 120–130 [A] ([Tunebat](https://tunebat.com/Info/Megalovania-Video-Game-Music-Box/6PjPPJKA4n6qwqTO3fbbhD)) | 4/4, 6/8 | Nostalgic, high energy | NES arpeggio chords | Minor with chromatic flair | 2A03 + VRC6 | Shovel Knight [C], Undertale |

In-game track types follow tighter conventions than genres, and they map directly onto Bo's Beatbox starters and Game-tab features. Two conventions are documented. Victory fanfares are "a few seconds of fanfare and then a very quickly looped follow-up" that plays while the player sorts rewards ([Musica Mundana](https://www.chaoticblue.com/blog/2013/05/musica-mundana-victory-themes-for-real-this-time/)). The NES Final Fantasy victory theme turns on an **I–♭VI–♭VII** move ([Game Music Analysis Club](https://gamemusicanalysisclub.substack.com/p/3-victory-theme-final-fantasy-nes)). The rest of this table is common practice [E].

| Track type | Length / loop | BPM [E] | Meter | Mode | Core instruments | Start from in Bo's Beatbox |
|---|---|---|---|---|---|---|
| Title / main theme | 30 s–3 min, intro + loop | 80–140 | 4/4 (3/4 lyrical) | Major or heroic Dorian | Brass lead, full palette | Title Screen (76, D) |
| Menu | 30–90 s | 80–110 | 4/4 | maj7/9, Lydian | E-piano, brushed drums | Lo-Fi or Jazz |
| Overworld / field | 1–3 min (longest loop) | 100–140 | 4/4, 6/8 | Major/Mixolydian | Brass melody, strings, snare | Overworld Adventure (116, C) |
| Town / village | 1–2 min | 80–115 | **3/4 or 6/8 common** | Major/Lydian/Mixolydian | Flute, ocarina, accordion, guitar, harp | Cozy Village (100, F) |
| Shop | 30–60 s | 90–130 | Swing or bossa | Major 6/9 | E-piano, vibes, nylon guitar | Shop (112, shuffle); Latin bossa |
| Dungeon / cave | 1–2 min | 60–110 | 4/4 or free | Minor, Phrygian, whole-tone | Low strings, pads, mallets, heavy reverb | Dungeon Crawl (84, D minor) |
| Underwater | 1–2 min | 60–100 (dotted-half pulse) | **3/4** | Major/Lydian | Harp, pads, vibes, flute; low-pass | *None; proposed below* |
| Ice / snow | 1–2 min | 80–130 | 4/4 or 3/4 | Lydian or minor | Celesta, glock, sleigh bells, music box | Angelic + mallets |
| Desert | 1–2 min | 90–140 | 4/4 maqsum, 6/8 | **Phrygian dominant**, harmonic minor | Oud-like pluck, darbuka, drone | *None; needs scale* |
| Forest / jungle | 1–2 min | 90–130 | 4/4, 6/8 | Dorian, pentatonic | Marimba, flute, hand drums, kalimba | Celtic or Ambient |
| Lava / fire | 1–2 min | 110–160 | 4/4, 7/8 | Phrygian, diminished | Low brass, timpani, taiko, guitar, organ | Epic Orchestral + Taiko |
| Sky | 1–2 min | 110–150 | 4/4, 6/8 | Major/Lydian | Flute, harp, choir "ah" | Angelic (66, C Lydian) |
| Castle | 1–3 min | 110–160 | 4/4, 3/4 | Harmonic minor | Organ, harpsichord, choir | Classical + Pipe Organ |
| Battle | 45–90 s + intro | 140–180 | 4/4 | Minor/Dorian | Rock band + strings/brass | RPG Battle (140, D minor) |
| Boss / final boss | 1–6 min, phases | 150–200 or half-time 70–90 | 4/4, 7/8, 5/4 | Phrygian, diminished | Organ, choir, guitar, brass | Boss Fight (150, phases) |
| Victory | 2–8 s + short loop [C] | 120–160 | 4/4 | Major, ♭VI–♭VII–I | Brass, timpani | Victory stinger |
| Game over | 3–10 s one-shot | 60–100 | Free | Minor, chromatic descent | Solo brass/organ | Game over stinger |
| Hurry-up | Warning + same theme faster | +20–50% | Same | Same | Same | *Gap: no runtime tempo multiplier* |
| Sad / love | 1–3 min | 50–90 | 3/4 common | Minor / maj7 | Piano, cello, solo violin, harp | Classical, Cinematic |
| Chase | 30–120 s | 160–200 | 4/4 | Minor | String 16ths, toms, synth bass | Horror (chase), Racing |

Environment conventions come from three places. The first is founder games. The Super Mario Bros. underwater theme is a C major 3/4 waltz that started the "waltz on water" trope; Kondo reportedly finished it first because it was "easy to imagine" ([TV Tropes](https://www.tvtropes.org/pmwiki/pmwiki.php/Main/WaltzOnWater); [MarioWiki](https://mariowiki.com/Underwater_Theme)). The second is orchestral semiotics. The celesta, made famous by the *Nutcracker*, signals "fantasy, winter scenes, dreams, and suspended time" ([Wikipedia: Celesta](https://en.wikipedia.org/wiki/Celesta)). The third is exotic shorthand. RuneScape's desert track "Sarcophagus" sits mostly in **Phrygian dominant** and moves into Hungarian minor ([RuneScape Wiki](https://runescape.wiki/w/Sarcophagus)). That shorthand comes with a well-known orientalism critique, so desert presets should offer real maqam-flavoured material, not just the augmented-second cliché. Bo's Beatbox has no Phrygian dominant scale, but a non-expert can get it today. Phrygian dominant is the 5th mode of harmonic minor, so set SCALE to **Harmonic minor on A** and treat **E** as home.

## Beautiful scores reuse five moves Bo's Beatbox can teach

The games people call beautiful share a short list of techniques. Each one maps onto a control in Bo's Beatbox or a feature it could add.

### Zelda: modal cadences, playable motifs and music that reacts

Ocarina of Time's Hyrule Field is the template for segment-based adaptive music. Koji Kondo built it from **eight-measure components played in random combinations**, and in his words, "as you got closer to an enemy, they would smoothly transition into fighting music" ([Iwata Asks OoT3D](https://nintendo.com/en-gb/Iwata-Asks/Iwata-Asks-The-Legend-of-Zelda-Ocarina-of-Time-3D/Vol-1-Sound/2-Koji-Kondo-Upends-the-Tea-Table/2-Koji-Kondo-Upends-the-Tea-Table-231296.html); [GlitterBerri](https://glitterberri.com/ocarina-of-time/1101-interviews/playing-the-ocarina/)). Standing still shifts it to a quieter melody ([VGFacts](https://vgfacts.com/game/thelegendofzeldaocarinaoftime/trivia-15337)).

Breath of the Wild turned the formula upside down. Sound director Hajime Wakai made **piano the main instrument for the first time in the series**, to bring out ambient sound and an open world ([Nintendo Everything](https://nintendoeverything.com/breath-of-the-wild-composers-on-changing-up-zeldas-music-formula-and-more/)). In "Field (Day)", silence outweighs melody, with **gaps of up to 13 consecutive seconds** ([Zelda Dungeon](https://www.zeldadungeon.net/musical-musings-listening-closely-to-the-emptiness-of-breath-of-the-wilds-hyrule-field-day/)). Locations ship as separate **Day and Night** versions ([Zelda Wiki](https://zeldawiki.wiki/wiki/The_Legend_of_Zelda:_Breath_of_the_Wild_Original_Soundtrack)). Classic motifs hide in the riding music, such as Zelda's Lullaby stretched out behind the daytime piano ([Game Informer](https://gameinformer.com/b/features/archive/2017/03/19/the-secret-music-of-the-legend-of-zelda-breath-of-the-wild)). Manaka Kataoka also put a deliberate break into the main theme to stand for Link's first breath after a 100-year sleep ([Zelda Universe](https://zeldauniverse.net/2017/06/15/the-composer-of-breath-of-the-wilds-main-theme-gives-details-on-its-creation-and-purpose/)).

The harmonic side of Zelda is less well documented. The ♭VI–♭VII–I overworld cadence and the I–♭VII–IV Mixolydian field loop are transcription-level observations. The Lost Woods melody (F–A–B) is often called Lydian, but a forum analysis argues it is better read as an Fmaj7#11 outline, i.e. modal mixture ([Zelda Dungeon forum](https://www.zeldadungeon.net/forum/goto/post?id=1431791)).

### Mario: rhythm that follows movement, one theme in many costumes

Kondo replaced a "laid-back" prototype piece with a Ground Theme whose **tempo matched the game's speed and the rhythm of Mario's movements**. It is in **C major, cut time, with a calypso rhythm** ([Wikipedia](https://en.wikipedia.org/wiki/Super_Mario_Bros._theme); [Super Mario Wiki](https://www.mariowiki.com/Ground_Theme_(Super_Mario_Bros.))). The "100 BPM" figure that circulates is a sheet-music setting, most likely counting half notes ([FluteTunes](https://www.flutetunes.com/tunes.php?id=132)). Sources call the feel syncopated, but whether its 8th notes are actually swung is disputed.

Later games treat the score as a set of layers and costumes:

- **Dire, Dire Docks** (Super Mario 64) fades in a synth layer and a percussion layer depending on where the player is ([Super Mario Wiki](https://www.mariowiki.com/Dire,_Dire_Docks_(theme))).
- **Galaxy 2** adds percussion when Mario rides Yoshi, and a Dash Pepper raises the tempo and adds a violin run ([Super Mario Wiki](https://www.mariowiki.com/Yoshi_Athletic_BGM)).
- **Hurry-up:** a warning fanfare at 100 time units, then faster music; Super Mario Land speeds up again at 50 ([Super Mario Wiki: Timer Warning](https://www.mariowiki.com/Timer_Warning); [Time Limit](https://www.mariowiki.com/Time_Limit)). Community measurements put Super Mario 3D World's hurry-up tracks **about 20% faster** ([GameFAQs](https://gamefaqs.gamespot.com/boards/718915-super-mario-3d-world/68404712)).
- **Galaxy 2's Beat Blocks** switch in time with the music after **three warning beeps** ([Super Mario Wiki](https://mariowiki.com/Beat_Block_Galaxy)).
- **Wonder** ties musical sound effects to actions: a ground-pound plays a drum roll and a sprint triggers a string flourish ([1UP Vault](https://1upvault.substack.com/p/review-super-mario-bros-wonder)).

Galaxy's sound came from a rejection. Mahito Yokota first wrote about **28 Latin-style tracks**. Kondo told him to drop any image of Mario as "cute" and aim for "cool" ([Wikipedia: SMG OST](https://en.wikipedia.org/wiki/Super_Mario_Galaxy_Original_Soundtrack)). Kondo said he had **never been conscious of using** a Latin Mario sound ([Iwata Asks SMG p.1](https://iwataasks.nintendo.com/interviews/wii/super_mario_galaxy/2/1)). Miyamoto then picked Kondo's "Egg Planet" blind for its space-like feel, which pointed the score toward orchestra. Yokota composed and arranged almost everything, and Kondo wrote four pieces ([Iwata Asks SMG p.0](https://iwataasks.nintendo.com/interviews/wii/super_mario_galaxy/2/0)).

Odyssey reuses the same tunes as **8-bit arrangements in its 2D sections** ([Super Mario Wiki](https://www.mariowiki.com/Super_Mario_Odyssey_(Nintendo_Music))). Bubblaine's underwater version keeps the arrangement but switches to sustained notes and a **low-pass filter** ([Timofeeva](https://annatimofeeva.substack.com/p/what-makes-a-video-game-soundtrack)).

### Minecraft: beauty through restraint and randomly timed silence

C418 deliberately wrote music that "at first made no sense for the game's visuals": beautiful, ambient and haunting. He let tracks **start and stop at seemingly random intervals**, and that became a defining trait of the game ([Twenty Thousand Hertz / Shorefire](https://shorefire.com/releases/entry/twenty-thousand-hertz-reveals-how-the-music-sounds-of-minecraft-were-made)). The Guardian compared his sparse motifs to Satie and Eno ([Pop-Music.ca](https://www.pop-music.ca/c418-minecraft-volume-alpha-green-vinyl.html)).

How long the default gap between tracks lasts is disputed: claims run from about 2.75 to 10–20 minutes ([Minecraft Wiki](https://minecraft.wiki/w/Music); [Modrinth](https://modrinth.com/project/BRMcBUdz)). In 2025 Mojang turned the gap into a player setting, **Music Frequency: Default / Frequent / Constant**, and added a "Now Playing" toast ([Minecraft Feedback, 1.21.6](https://feedback.minecraft.net/hc/en-us/articles/37432144057997-Minecraft-Java-Edition-1-21-6-Chase-the-Skies)). Each update since 2020 has added a composer instead of replacing anyone: Lena Raine, Aaron Cherof, Amos Roddy in 2025 ([Minecraft Wiki](https://minecraft.wiki/w/Minecraft:_Chase_the_Skies_(Original_Game_Soundtrack))), and fingerspit (Paula Ruiz) for Chaos Cubed in May 2026 ([Minecraft.net](https://www.minecraft.net/en-us/article/chaos-cubed-composer-interview)).

The aggregator tempos cluster around **72–88 felt BPM** once double-time readings are halved, and the keys are mostly major. In Minecraft the emotion comes from gentle melancholy in a major key, not from minor keys. The maj7/add9 chord vocabulary often credited to C418 is plausible but was not confirmed by any source.

### Other acclaimed scores: a signature voice and music bound to play

Four other scores add useful mechanisms:

- **NieR: Automata** gives area themes quiet, medium and dynamic versions, each with and without vocals ([Medium](https://medium.com/the-sound-of-ai/a-beautiful-song-the-adaptive-music-of-nier-automata-4b29e5d7f2f3)). During hacking, a real-time "Tone Filter" re-synthesizes the music as 48 sine tones, giving an 8-bit version ([Game Developer](https://gamedeveloper.com/audio/how-platinum-8-bit-ize-s-i-nier-automata-i-s-music-on-the-fly)).
- **Outer Wilds** gives each of five travelers a diegetic instrument. The parts stay in sync across planets and add up to the full piece ([Game Developer](https://www.gamedeveloper.com/audio/everything-but-lost-exploring-the-mesmerising-musical-legacy-of-outer-wilds)).
- **Animal Crossing: New Horizons** has 24 hourly themes, each with rain and snow variants ([Animal Crossing Wiki](https://animalcrossing.fandom.com/wiki/Category:Hourly_theme)).
- **Journey** uses Tina Guo's solo cello as the player's voice ([Bandcamp](https://austinwintory.bandcamp.com/album/journey)).

Banjo-Kazooie shows the cheapest form of re-costuming. Grant Kirkhope ran all 16 MIDI channels at once, **muted the ones that didn't fit an area**, and crossfaded instrument sets as Banjo crossed invisible thresholds ([Kotaku](https://kotaku.com/i-love-how-banjo-kazooie-s-music-changes-as-i-play-1845544436); [Original Sound Version](https://www.originalsoundversion.com/take-a-look-behind-banjo-kazooies-dynamic-soundtrack/)). Bo's Beatbox's web runtime synthesizes music from note data, so this kind of "orchestration skin" would cost almost no file size. Audio-stem middleware cannot match that advantage.

| Track (game, year) | Tempo | Meter | Key / mode | What makes it work | Provenance |
|---|---|---|---|---|---|
| Ground Theme (Super Mario Bros., 1985, Kondo) | ~100 per half note; ~180–200 per quarter [T] | Cut time [C] | C major [C] | Calypso; tempo matched to Mario's movement; a kept triplet; staccato with rests | [Wikipedia](https://en.wikipedia.org/wiki/Super_Mario_Bros._theme), [FluteTunes](https://www.flutetunes.com/tunes.php?id=132) |
| Underwater (Super Mario Bros.) | ~150–170 per quarter [T] | 3/4 [C] | C major [C] | Founder of the underwater waltz | [TV Tropes](https://www.tvtropes.org/pmwiki/pmwiki.php/Main/WaltzOnWater) |
| Underground (Super Mario Bros.) | ~100–110 [T] | 4/4 | C; octave-leaping bass [T] | No percussion, lots of rest | Unverified |
| Overworld (Zelda, 1986) | ~120–150 [T] | 4/4 | B♭ major [T] | ♭VI–♭VII–I cadence, triplet fanfare pickups | Unverified transcription |
| Hyrule Field (Ocarina of Time, 1998) | ~130–150 [T] | 4/4 | G/D major [T] | 8-bar segments recombined at random; idle and battle states [C] | [Iwata Asks](https://nintendo.com/en-gb/Iwata-Asks/Iwata-Asks-The-Legend-of-Zelda-Ocarina-of-Time-3D/Vol-1-Sound/2-Koji-Kondo-Upends-the-Tea-Table/2-Koji-Kondo-Upends-the-Tea-Table-231296.html) |
| Zelda's Lullaby (Ocarina of Time) | ~80–96 [T] | 3/4 | G major [T] | A three-note cell grows into a lullaby | Unverified |
| Ocarina songs (system) | — | — | D4, F4, A4, B4, D5 [common knowledge] | Every song is 3–8 notes from five pitches, all inside D Dorian | Unverified |
| Clock Town, Days 1–3 (Majora's Mask, 2000) | Day 1 ~110–120, faster later [T] | 4/4 | Major, darkening | One theme re-arranged with rising tempo and tension | Unverified |
| Outset Island (Wind Waker, 2002) | Dotted quarter ≈ 60 [T] | 6/8 jig | G major [T] | Fiddle, whistle, drones = home | Unverified |
| Field Day (Breath of the Wild, 2017, Kataoka) | Free/rubato | Free | Pentatonic/Lydian fragments [T] | Piano dabs, up to 13 s of silence [C] | [Zelda Dungeon](https://www.zeldadungeon.net/musical-musings-listening-closely-to-the-emptiness-of-breath-of-the-wilds-hyrule-field-day/) |
| Dire, Dire Docks (Super Mario 64, 1996) | ~70–80 [T] | 4/4 | D♭ major [T] | Synth and percussion layers fade in by location [C] | [Super Mario Wiki](https://www.mariowiki.com/Dire,_Dire_Docks_(theme)) |
| Egg Planet (Galaxy, 2007, Kondo) | ~110–130 [T] | 4/4 | Major | Miyamoto's blind pick set the orchestral direction [C] | [Iwata Asks](https://iwataasks.nintendo.com/interviews/wii/super_mario_galaxy/2/0) |
| Gusty Garden (Galaxy, Yokota) | ~150–160 [T] | Cut-time feel | D major with modulation lift [T] | Big string tune, harp glissandi, key lift | Unverified |
| Comet Observatory (Galaxy) | ~90–110 per quarter [T] | 3/4 | E♭/F [T] | Waltz with celesta and harp; instruments added as the Observatory is restored | Unverified |
| Jump Up, Super Star! (Odyssey, 2017, Naoto Kubo) | ~140–150 swung [T] | 4/4 | C, modulating [T] | Big-band swing (~2:1 ratio [E]), ii–V–I, final key change | Unverified |
| Tostarena (Odyssey) | ~110–130 [T] | 4/4 | Major/minor | Mariachi costume plus 8-bit version in 2D [C] | [Super Mario Wiki](https://www.mariowiki.com/Tostarena:_Night) |
| Sweden (Minecraft, 2011, C418) | 88 [A] | 4/4 | D major [A] | Sparse, soothing | [12notez](https://12notez.in/song/sweden-c418) |
| Subwoofer Lullaby (C418) | 73–75 [A] | 4/4 | C major [A] | — | [audiokeychain](https://www.audiokeychain.com/track/QAk/c418-subwoofer-lullaby) |
| Wet Hands (C418) | 148 [A], ≈74 felt | — | A major [A] | — | [12notez](https://12notez.in/song/wet-hands-c418) |
| Mice on Venus (C418) | 111 [A]; 58 in a fan MIDI | — | C major [A] | — | [12notez](https://12notez.in/song/mice-on-venus-c418), [Pianotify](https://pianotify.com/midi-player/JiNwMftU/mice-on-venus) |
| Pigstep (Lena Raine, 2020) | 170 / ~85 half-time [T] vs 113 [A] | 4/4 | A minor [T] vs E minor [A] | Sources conflict; prefer the transcription | [Hooktheory](https://www.hooktheory.com/theorytab/view/lena-raine/pigstep), [SongBPM](https://songbpm.com/@lena-raine/pigstep---stereo-mix) |
| Otherside (Lena Raine, 2021) | ~92 [A] | 4/4 | G major, turns minor midway | Major-to-minor pivot | [Tunebat](https://tunebat.com/Info/otherside-Lena-Raine-Minecraft/4PtJNlcpEGyNAkYy44m5fI), [CBR](https://www.cbr.com/lena-raine-greatest-track/) |

### Getting these sounds in Bo's Beatbox today

**Mario Ground feel.** Start from the Platformer starter and raise the tempo to about 180–200. Use Chip Lead, Chip Bass and Chip Drums. Write short, staccato notes that land just before the beat (the "and" of 2), and leave rests inside the hook. To end with the A♭–B♭–C cadence, turn SCALE lock off for the last bar and use the CHORD stamp's Major chord type on A♭, B♭ and C.

**Mario underwater.** Add a 3/4 time-signature change and write legato. That is the whole trick.

**Odyssey's 8-bit swap.** Duplicate the melody, bass and drum tracks onto the Chip instruments. Make the copies a separate Game-tab state, "2D", with a Crossfade transition.

**Zelda overworld.** Use French Horn and Trumpet over Violins (short/spiccato) and Timpani. Add triplet pickups into each phrase, and use the same ♭VI–♭VII–I stamp at cadences.

**Hyrule Field.** Write four 8-bar Explore sections A–D, a sparse Idle section and a Battle section, all at the **same tempo**. Use loop variations A–D for the Explore sections. Bo's Beatbox cannot yet pick segments at random, so this is the closest approximation.

**Breath of the Wild sparseness.** Use Concert Grand at low velocity with HUMAN on. Leave whole bars empty, aiming for 10+ seconds of silence, and lay a Birds or Seashore bed underneath. Duplicate the section into a Night state with Celesta and Violins and about 15% slower.

**Minecraft.** Use the Ambient or Lo-Fi starter at 72–88 BPM in C or D major, with Concert Grand or Rhodes over a Halo or Glass pad. Set Reverb to 4–6 s or master Cathedral, and write melodies of a few notes with long rests. The engine's random silence gaps cannot be authored yet.

**Galaxy.** Use 3/4 at about 100 BPM. Arpeggiate Harp upward, sparkle with Celesta and Music Box, and add Voices "Ooh", French Horn and the Heaven master reverb. Put each new layer in its own intensity stem group so the Observatory can "restore" itself.

## Tempo sets energy and mode sets brightness: mood recipes inside Bo's Beatbox

The psychology gives non-experts two levers and one warning. **Mode was the strongest single emotional cue, followed by tempo, register, dynamics, articulation and timbre** ([Eerola et al. 2013](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2013.00487/full)). When mode and tempo disagree, **listeners lean slightly on tempo** (Gagnon and Peretz 2003, via [Hunter et al.](https://sites.utm.utoronto.ca/sites/sites.utm.utoronto.ca.glenn_website/files/download/HunterEtAl2010.pdf)). In practice, a minor-key "sad" cue at 140 BPM reads as tense or energetic, not sad. Register ranks third: high registers suggest wonder and whimsy, low registers suggest threat.

Film scholarship adds a harmonic lever. Frank Lehman ties cinematic **wonder** to non-functional chromaticism, especially chromatic mediants: chords a third apart that share one note, such as C to A♭ or C to E ([Lehman, *Hollywood Harmony*](https://www.prestomusic.com/books/products/8394361--hollywood-harmony-musical-wonder-and-the-sound-of-cinema); [ICanCompose](https://www.icancompose.com/advanced-harmonic-vocabulary-part-2-chromatic-mediants/)). In Howard Shore's Lord of the Rings, Hobbits get diatonic harmony, Men get modal harmony and **Elves get chromatic mediants** ([Music and the Moving Image](https://scholarlypublishingcollective.org/uip/mmi/article-abstract/11/2/37/uip)). Lydian, the only major mode with a raised note (#4), is the textbook bright "wonder" mode ([Splice](https://splice.com/blog/music-modes-lydian)).

The cheat sheet below uses **only features Bo's Beatbox has today**. Progression names are exactly as they appear in its Chord progression tool. BPMs are conventions [E].

| Mood | Start from | Tempo | SCALE lock | Chord progression tool | Drummer | Core instruments | Inserts / master | Game tab |
|---|---|---|---|---|---|---|---|---|
| Heroic fantasy | Overworld Adventure, Epic Orchestral | Theme 80–110; battle 120–150 | Major or Mixolydian | IV–V–iii–vi (lift); i–VI–III–VII (epic) in minor; hand-stamp ♭VI–♭VII–I endings | None or Backbeat (low energy) + Timpani | French Horn, Trumpet, Violins, Cellos, Choir, Timpani | Reverb 2–3.5 s; master Hall | Victory, Level up stingers |
| Whimsical / fairy | Puzzle, Angelic | 90–140 | Lydian | I–V–vi–IV with CHORD Maj7/Add9 | None | Celesta, Glockenspiel, Pizzicato, Flute, Bassoon (short), Harp | Reverb 1.2–2 s; Pro EQ air shelf | Item found stinger |
| Celtic / tavern | Celtic, Fantasy Tavern | 100–130 per beat | Dorian or Mixolydian | Hand-stamp I–♭VII–IV–I or i–IV | No 6/8 style yet; use the step sequencer | Fiddle, Whistle, Bagpipes drone, Accordion, Mandolin, Acoustic toms | Small room 0.6–1.2 s; HUMAN on | Day/Evening states |
| Dark fantasy | Dungeon Crawl, Boss Fight | Dread 60–90; boss 130–170 | Harmonic minor or Phrygian | i–VII–VI–V (andalusian); i–iv–VI–V (sad) | Half time | Choir, Chapel Organ, Cellos, Trombone, Tuba, Timpani, Solo Violin | Master Cathedral (7 s) | Boss phases |
| Eastern | Eastern | Calm 60–80; fight 120–160 | Japanese (in) or Major pentatonic | Pedal tones rather than progressions | Taiko kit | Koto, Shakuhachi, Shamisen, Erhu | Pitch bend for slides | — |
| Action / combat | RPG Battle, Boss Fight, Racing | 140–180 | Minor or Phrygian | i–VII–VI–VII (dark); i–VI–III–VII (epic) | Two-step DnB, Half time or Four on the floor at high energy, plus Fills | Violins short, Trombone short, Taiko, Reese/Wobble bass, FX rows | Pump from kick; Reverb 1–1.8 s; Build-up & drop; Key change up | Intensity stems; phases |
| Horror | Horror | Free or 40–72; chase 140–170 | Off (clusters) or Phrygian | None; hand-draw | None; heartbeat on step sequencer | Tremolo strings, Cellos, Music Box, Goblins/Rain pads, Sub Drop, Impact, Reverse Crash | Lo-Fi wow; master Cathedral or fully dry | Danger stinger; Ambient/Tension/Climax stems |
| Wonder / awe | Angelic | 60–90 | Lydian | IV–V–iii–vi; hand-stamp I–♭VI and I–III | None | Harp (Arpeggiate up), Celesta, Voices "Ooh", Violins long, French Horn solo, Crystal pad | Master Heaven (11 s) | — |
| Sadness | Classical, Cinematic | 50–80 | Minor | i–iv–VI–V (sad); vi–IV–I–V | None | Concert Grand, Solo Violin, Cellos, English Horn | Reverb 1.8–2.5 s | — |
| Stealth | Stealth | 80–110 | Minor or Phrygian | i–VII–VI–VII (dark) over a held bass note | Half time (low energy) | Pizzicato, Cellos short, Closed hat 16ths, Synth bass + Filter | Filter LP ~3–6 kHz, opened on Alert | Same tempo in every state; Danger stinger |
| Triumph | Title Screen, Epic Orchestral | 100–140 | Major | VI–VII–i–i (anthem) with the last chord stamped Major | None + Timpani roll | Trumpet, French Horn, Timpani, Crash | Master Hall | Victory stinger |
| Cozy | Cozy Village, Lo-Fi | 70–100 | Major or Major pentatonic | I–vi–IV–V with 7ths on; Maj7 vamps | Boom bap or Funk (low energy), or none | Marimba, Kalimba, Classical guitar, Recorder, Flute, Pizzicato, Rhodes | Lo-Fi tone; small room | Day/Evening states |

### Fantasy

**Heroic fantasy** works because it combines a bright mode, a big melodic leap and a borrowed-chord cadence. Begin in Overworld Adventure or Epic Orchestral at 90–110 BPM in a major key. Write the melody on French Horn, opening with a rising 4th or 5th, then moving stepwise with dotted rhythms. Double it an octave up on Trumpet only at the climaxes, and keep the horns above about C3 so they stay clear [E].

Run the Chord progression tool with IV–V–iii–vi ("lift") in the Held style for verses. Then build the cadence by hand: turn SCALE lock off for one bar and stamp Major chords on ♭VI, ♭VII and I (A♭, B♭, C in C major). That ♭VI–♭VII–I move is the same family as Final Fantasy's victory cadence ([Game Music Analysis Club](https://gamemusicanalysisclub.substack.com/p/3-victory-theme-final-fantasy-nes)). Put Timpani on downbeats with rolls into each section. Add Choir on "ah" only in the final 8 bars, and use the master Hall reverb. The most common mistake is letting everything play at once with no foreground melody [E].

**Whimsical or fairy fantasy** is the same idea pushed high and light. Set SCALE to Lydian, which gives the raised 4th that sounds magical ([Splice](https://splice.com/blog/music-modes-lydian)), and pick a 3/4 or 6/8 meter at 90–140 BPM. Stamp Maj7 and Add9 chords. Write staccato lines on Celesta, Glockenspiel, Pizzicato and Flute, and use short Bassoon notes for comedy. Keep the bass pizzicato or leave it out entirely. Avoid minor, which reads as sinister rather than whimsical [E].

**Celtic and tavern** music has documented conventions. Jigs are in 6/8 (the beat is a dotted quarter), reels are in 2/2, and both run at roughly the same beat rate ([Chiff & Fipple](https://www.chiffandfipple.com/t/whats-the-reel-tempo-supposed-to-be/4238)). Forum estimates put reels around 90–120 and jigs around 100–127 ([Chiff & Fipple](https://forums.chiffandfipple.com/viewtopic.php?p=36928)). The common keys are **A Dorian, D Mixolydian, E Dorian and A Mixolydian** ([MIT tune collection](https://web.mit.edu/~santucci/www/tunes/tunes.pdf)).

In Bo's Beatbox, start from Celtic or Fantasy Tavern and set SCALE to Dorian or Mixolydian. Hold the tonic and 5th on Bagpipes or Accordion under everything as a drone. Lead with Fiddle and Whistle, and stamp I–♭VII–IV–I by hand (D–C–G–D in D Mixolydian). Folk sounds wrong when it is quantized rigidly. Until 8th-note swing exists, turn HUMAN on and lengthen the first note of each pair of 8ths by hand to get the long-short lilt.

**Dark fantasy** keeps the orchestra and drops the brightness. Use Harmonic minor or Phrygian with i–VII–VI–V (andalusian) or i–iv–VI–V. Phrygian's ♭II (E minor to F) gives the half-step menace [E]. Put Choir and Chapel Organ on sustained chords, give the melody to Cellos, and add clustered Trombone and Tuba, Timpani, and Solo Violin for "tragic beauty". Use the master Cathedral reverb. For boss fights, try a 3/4 meter at 130–170 BPM. Don't end on a major chord, and don't reach for metal unless the game is metal [E].

**Eastern fantasy** works best with restraint. Use SCALE Japanese (in) or Major pentatonic (the Chinese gong scale), and Koto, Shakuhachi, Shamisen or Erhu with pitch-bend slides and grace notes. Taiko drives the fight scenes. Keep Chinese and Japanese idioms separate, and avoid the "pentatonic plus gong" caricature [E].

### Action

Combat music sits at **140–180 BPM** for standard battles and either higher or a heavy half-time for bosses [E]. Start in RPG Battle or Boss Fight with SCALE Minor. Generate i–VII–VI–VII in the 16th arpeggio style and keep the bass on one note under it. Write a 16th-note ostinato on Violins (short/spiccato), accenting in groups of 3+3+2 sixteenths [E]. Ratchet or Arpeggiate do most of the work.

Use the Drummer's Two-step DnB or Half time at high energy, with tom-run Fills before section changes. Layer Taiko on 8ths, use Trombone (short) for stabs, and add a Reese or Growl bass sidechained with Pump from the kick. Put a Riser before every phase change and an Impact plus Sub Drop on the downbeat, or let the Build-up & drop generator place them. Keep reverb to 1–1.8 s so the ostinato stays clear [E].

For **DOOM-style metal**, the documented recipe starts with plain sine waves and noise pushed through parallel chains of **distortion, bit crushers, fuzz, phasers, tape echo and spring reverb** ([Wikipedia: Mick Gordon](https://en.wikipedia.org/wiki/Mick_Gordon)). The music is written as short syncopated "energy bursts" that don't mask gunfire ([PC Gamer](https://www.pcgamer.com/doom-composer-mick-gordon-one-of-the-pre-conditions-of-the-project-was-no-metal/)). In Bo's Beatbox, run a Synth Designer sine through Distortion and Lo-Fi, add Distortion guitar power chords (CHORD Power), and set Reese bass under a Techno kit. For Doom Eternal, Gordon described **four music categories: exploration, incidental, medium combat and high-level combat** ([Sifter](https://www.sifter.com.au/post/the-ingredients-of-doom-composer-mick-gordon-on-the-soundtrack-of-doom-eternal)). Make those the four Game-tab states.

**Boss phases** follow a standard shape [E]. Phase 1 states the theme. Phase 2 adds choir or percussion stem groups and uses Key change to go up a semitone or whole step. Phase 3 either raises the tempo 5–10% or drops to a half-time breakdown before a full tutti returns. Wire these as Game-tab states with Riser or Impact transitions. The usual failure is constant maximum density with no "breath" sections, which tires players over long loops.

### Horror

Horror has the best-documented techniques of any mood, and they reward restraint:

- **Clusters:** Penderecki-style sound masses of adjacent semitones, glissandi and scratch tones ([Big Think](https://bigthink.com/high-culture/horrifying-classical-music/)).
- **Tritones and clashes:** the tritone, long called the "devil's interval", and The Exorcist's clash of off-beat dominant-type 7ths against on-beat diminished 7ths ([Morrow, Carleton](https://carleton.ca/aah/wp-content/uploads/sites/24/Morrow-.pdf)).
- **Withheld resolution:** music that hangs "in limbo" instead of landing home ([JUNO Awards](https://junoawards.ca/blog/the-sound-of-fear-how-music-makes-the-ordinary-terrifying/)).
- **Aleatoric orchestra:** Jason Graves recorded the Dead Space orchestra producing eerie effects as a "toolbox", avoided electronics, and recorded each section separately for adaptive layering ([Bloody Disgusting](https://bloody-disgusting.com/news/121169/dead-pixels-exclusive-dead-space-extraction-interview-with-games-composer-jason-graves/); [EA](https://s204.q4cdn.com/701424631/files/doc_news/2008/10/1/338525.pdf); [Game Informer](https://gameinformer.com/b/features/archive/2011/01/23/dead-space-interview-composer-jason-graves)).
- **Industrial melancholy:** Akira Yamaoka chose industrial for Silent Hill's "cold and rusty feeling" ([Spelmusik interview](https://www.silenthillmemories.net/creators/interviews/2002.07.16_yamaoka_spelmusik_en.htm)) and aimed at "loneliness, sadness, anxiety" rather than plain scary music ([MusicRadar](https://www.musicradar.com/artists/rather-than-simply-writing-scary-music-i-wanted-to-express-loneliness-sadness-anxiety-and-the-psychological-aspects-of-fear-we-speak-to-video-game-horror-soundtrack-godfather-akira-yamaoka-about-the-legacy-of-silent-hill)).
- **Save-room calm:** Resident Evil's save-room themes use **only two or three chords** under a looping simple melody ([Laced Records](https://www.lacedrecords.co/blogs/blog/vgm-subgenres-the-anxious-calm-of-resident-evil-save-room-music)).

In Bo's Beatbox, start from the Horror starter (72 BPM, with drone, string clusters, warped music box, silence and a chase section). For **dread**, turn SCALE lock off and draw three or four adjacent semitones on Violins Tremolo and Cellos (for example C, C♯, D, D♯). Bend them slowly apart or together with pitch bend. Under that, hold a low drone on the Goblins or Rain pad with a slow Filter sweep, plus a Sub Drop every few phrases [E].

For **corrupted innocence**, play a simple tune on Music Box. Put Lo-Fi wow on it and set HUMAN pitch to its ±12 cent maximum so it sounds detuned and warped.

For a **scare**, empty every track for 0.5–2 s before the hit. Then fire an Impact with a Reverse Crash leading into it, or use the Game tab's Danger stinger. Use only a few scares per level, because overused stingers stop working [E]. For space, use the master Cathedral reverb for isolation, or go completely dry for claustrophobia.

For a **chase**, switch to a 140–170 BPM state. Use a heartbeat-style double kick on the step sequencer that speeds up, a 16th string ostinato and Intensity driving the Climax stem group.

For a **Silent Hill colour**, use a swung Breakbeat kit at 80–95 BPM, Distortion guitar tremolo, Mandolin and a Seashore noise bed through Lo-Fi bit crush [E].

For a **save room**, write two or three chords on Rhodes and Glass pad at 60–75 BPM. Add a maj7 or 9th so the music never fully relaxes [E].

### Wonder, sadness, stealth, triumph and cozy

**Wonder** needs a slow harmonic rhythm and a reveal. Use Angelic at 60–90 BPM with SCALE Lydian, changing chord once every one or two bars. At the reveal, stamp a chromatic-mediant Major chord by hand: I to ♭VI (C to A♭) or I to III (C to E). Lehman's research ties exactly this kind of chord move to cinematic wonder. Arpeggiate Harp upward, add Celesta sparkle and Voices "Ooh", and give the melody to a solo French Horn. Automate a crescendo over 8–16 bars into the reveal chord under the master Heaven reverb [E].

**Sadness** needs slow tempo, minor mode and legato together, because tempo can override mode. Use 50–80 BPM with i–iv–VI–V, solo Concert Grand, Solo Violin or English Horn, and falling two-note "sigh" figures. Stamp Sus4 then Major on the same root to create a suspension. In a major key, stamp a Minor chord on IV (C–F–Fm–C) for an aching borrowed-chord colour [E].

**Stealth** keeps one tempo and key across all states so the layers can crossfade on the bar. Use the Stealth starter (96, B minor) with low Pizzicato, closed-hat 16ths and a Filter low-pass at 3–6 kHz on the synth bass. Hold the percussion and brass stems at zero until Alert, where Intensity opens them and an automated Filter sweep brightens the mix [E].

**Triumph** must end firmly on the tonic. Run VI–VII–i–i (anthem) and stamp the final chord Major, which gives ♭VI–♭VII–I plus a Picardy-style lift. Add a timpani roll and a crash on the last chord, and optionally a Key change up for the final pass.

**Cozy** avoids prominent kicks and sharp attacks. Use Cozy Village or Lo-Fi at 70–100 BPM with Maj7 and Add9 chords on Marimba, Kalimba, Classical guitar and Recorder. Warm it with Lo-Fi tone and a small room. Keep loops at 2–3 minutes and write Day and Evening variants, following Animal Crossing's model of changing the arrangement with the clock ([Nookipedia](https://nookipedia.com/wiki/Kazumi_Totaka)).

## Eighteen additions would close the gaps, starting with vocabulary

The research points to one pattern. **The techniques behind the most-loved game music are mostly cheap to implement, and Bo's Beatbox lacks several of them** in its musical vocabulary:

- Nintendo's cadence (♭VI–♭VII–I), film's chromatic mediants, the underwater waltz, the jig lilt and Odyssey's swing all need a scale, a progression, a meter-aware drum style or a swing setting Bo's Beatbox doesn't have.
- The adaptive features it lacks map onto documented mechanisms: Banjo-Kazooie's channel-muting skins, Odyssey's underwater low-pass, Mario's hurry-up tempo, Minecraft's randomized silence and Galaxy 2's beat-locked platforms.
- Mature tools show what composers expect. Wwise offers pre-entry and post-exit regions and cue-based sync ([wwiser docs](https://github.com/bnnm/wwiser/blob/master/doc/EDITOR.md)). Elias offers per-layer variations and "agility", where 6 tracks × 6 variations give 46,656 combinations ([Game Developer](https://www.gamedeveloper.com/audio/composing-adaptive-music-for-games---advanced-concepts-in-elias)). Ableton and Bitwig offer per-note and per-clip chance ([Ableton](https://www.ableton.com/en/manual/launching-clips/); [Bitwig](https://www.bitwig.com/userguide/latest/operators/)). Cubase offers articulation maps ([Steinberg](https://www.steinberg.help/r/cubase-pro/15.0/en/cubase_nuendo/topics/expression_maps/expression_maps_technique_dialog_r.html)).
- Peggle Blast generated in-key peg-hit notes in real time from the key root plus scale intervals, covering 48 key/scale combinations ([Audiokinetic](https://blog.audiokinetic.com/peggle-blast-peg-hits-and-the-music-system/)). That is the template for in-key sound effects in a synthesized runtime.

Effort here means: **Small** = data or preset additions inside an existing module; **Medium** = a new generator, panel or runtime option inside an existing module; **Large** = a new synthesis engine or runtime subsystem.

| Rank | Addition | Research basis | Extends | Effort |
|---|---|---|---|---|
| 1 | **Nintendo and film progression pack** (table below) | ♭VI–♭VII–I victory/overworld cadence; chromatic mediants and wonder (Lehman); Shore's A/F mediant pairs ([PianoWithJonny](https://pianowithjonny.com/piano-lessons/cinematic-chords-the-ultimate-guide/)); Lydian I–II | Smart tools › Chord progression | Small |
| 2 | **Scale pack**: whole tone, octatonic (half-whole and whole-half), Phrygian dominant, harmonic major, melodic minor, Lydian dominant, Locrian, double harmonic / Hungarian minor, hirajoshi, yo, chromatic | Desert Phrygian dominant / Hungarian minor ([RuneScape Wiki](https://runescape.wiki/w/Sarcophagus)); octatonic for dread ([Guitar Composer's Toolbox](https://www.guitarcomposerstoolbox.com/piano-scales/g-diminished)); Shore's harmonic major | SCALE lock, Fit to scale, Chords for a melody | Small |
| 3 | **Swing and groove engine**: 8th-note swing (50–75%), per-track and per-clip swing, groove templates (big-band ~2:1, shuffle, jig lilt, calypso anticipation, bossa, lo-fi 55–62% [E]) | Odyssey big band; Celtic lilt; cozy shuffle; calypso Ground Theme | SWING setting, timeline, Drummer, Quantize | Medium |
| 4 | **Drummer style pack** with meter awareness (table below) | Waltzes for underwater, towns and love themes; 6/8 jigs; marches; Hinox's tribal build; Doom's high-combat blasts | Drummer, Fills | Medium |
| 5 | **Twelve game starters** (specs below) | Each tied to a franchise finding | Starters | Small each (full fidelity needs ranks 1–4) |
| 6 | **Accompaniment generators**: waltz oom-pah-pah, Alberti bass, harp glissando, strum patterns, string spiccato ostinato (3+3+2), celesta/music-box sparkle, horn fanfare (1-3-5-8 with triplet pickup), tonic/5th drone | Galaxy harp and celesta; Zelda fanfares; Celtic drones; action ostinatos | Bass from chords, Arpeggiate, TOOLS | Medium |
| 7 | **Parameter curves beyond stem volume**: a game parameter drives filter cutoff, tempo multiplier, reverb send, bit crush and mono. Presets: Underwater (LPF + longer reverb), Hurry-up (+20% / +50% stepped, with warning stinger), Low health, Hacking (mono + bit crush) | Odyssey Bubblaine LPF; Mario hurry-up; Galaxy 2 Dash Pepper; Mario Kart Wii final lap ([forum](https://mariokartwii.com/showthread.php?tid=1948&pid=12201)); NieR Tone Filter | Game tab › Intensity; web runtime; game kit `setParameter` | Medium |
| 8 | **Orchestration skins**: per-state maps from each track to instrument, mute and FX, crossfaded while the notes keep playing. One-click 8-bit, Music Box, Solo Piano and Night skins | Banjo-Kazooie variable mix; Odyssey 8-bit 2D sections; Breath of the Wild day/night | Game tab states, web runtime, exports | Medium–Large |
| 9 | **Generative scheduler plus note/clip chance**: pools per state with weights and no-repeat; min/max silence gaps (Default/Frequent/Constant presets); per-phrase probability; seeded RNG; 10× preview with percent-silence stats | Minecraft random timing and 2025 Frequency setting; BotW 13 s gaps; Hyrule Field random 8-bar segments; Spore and No Man's Sky ([Wikipedia](https://en.wikipedia.org/wiki/Development_of_Spore); [Digital Trends](https://digitaltrends.com/gaming/no-mans-sky-music)) | Game tab, loop variations A–D, piano roll, runtime | Medium–Large |
| 10 | **Articulation switching and an extended palette**: per-note articulation lane (long / short / pizz / tremolo / col legno / sul ponticello / harmonics); cluster-glissando and random-pitch-in-range tools; waterphone, bowed metal, prepared piano, sleigh bells, mark tree, bodhrán, hurdy-gurdy, slide whistle | Dead Space aleatoric toolbox; Penderecki clusters; ice sleigh bells; Celtic bodhrán (currently faked on toms) | Orchestra group, Sound Effects, TOOLS | Medium (tools) / Large (samples) |
| 11 | **Beat, bar and marker callbacks, beat-map export and in-key SFX** (`playSfxInKey(sfx, degree, quantize)`) | Galaxy 2 Beat Blocks with 3-beep warning; Peggle in-key peg hits; Wonder's musical action SFX | Game kit players, web runtime, SFX maker "Tune to key" | Medium |
| 12 | **Motif library and transforms**: retrograde, augmentation, mode shift, fragment, re-harmonise to the local chord, "where used" view | Zelda motifs recycled across titles; hidden motifs in BotW; Journey's cello as protagonist | Piano roll TOOLS, ghost notes | Medium |
| 13 | **Transition hooks and tails**: in-section exit cues and conditional jump hooks, pre-entry pickups, post-exit tails, custom-cue quantize, audition of any matrix cell from any beat, plus scripted-playtest and random stress-test modes | iMUSE hooks; Wwise pre-entry/post-exit; transition bugs that only show up at arbitrary entry points | Game tab transition matrix, Audition like the game | Medium |
| 14 | **Mood pad** (valence × arousal mapped to SCALE brightness, tempo, intensity and skin) plus a **tempo/mode conflict warning** | Additive cues (77–92%); tempo overrides mode; Melodrive's valence/arousal model ([Medium](https://medium.com/the-sound-of-ai/twitch-plays-melodrive-using-comments-to-play-ai-generated-music-fde92497d414)) | Starters, project settings | Medium (warning: Small) |
| 15 | **Variant grid**: time-of-day × weather, plus a Day/Night generator (swap instruments, −10–20% tempo, thin the arrangement [E]) | Animal Crossing 24 × 3; BotW day/night | Builds on rank 8 | Medium |
| 16 | **Hardware chip modes**: NES (duty 12.5/25/50/75, 4-bit volume, voice budget, 60/50 Hz tick macros, frame-locked tempo), Game Boy 32×4-bit wave, SNES echo (16 ms steps + FIR) and Gaussian softening, Genesis 4-op FM with ladder grit | Era hardware facts; Shovel Knight's VRC6; Furnace sets the bar ([GitHub](https://github.com/tildearrow/furnace)) | Chiptune group, Lo-Fi, plugins | Large (frame-locked tempo toggle: Small) |
| 17 | **Proximity stems and a 2D listener map** with emitter export to Godot/Unity | Outer Wilds; Dire, Dire Docks zones; NieR singer proximity | Game tab, engine exports | Large |
| 18 | **Constrained-instrument song designer** (e.g. 5-pitch ocarina; checks 3–8 note length; exports the button sequence) | Ocarina songs as gameplay and leitmotif (pitch set unverified) | Piano roll + SCALE lock | Small |

### Progressions, scales and drum styles to add

These progressions are new. None duplicates the existing twelve.

| Progression (in C) | Name / use | Basis |
|---|---|---|
| A♭–B♭–C (♭VI–♭VII–I) | Mario/Zelda cadence: level clear, victory, heroic overworld | FF victory analysis [C]; Zelda/Mario use [T] |
| C–B♭–F–C (I–♭VII–IV–I) | Mixolydian adventure, Celtic, open field | Hyrule Field [T]; Irish Mixolydian [C] |
| C–A♭–C (I–♭VI–I) and C–E–F (I–III–IV) | Chromatic-mediant wonder and hero's journey | Lehman [C, thesis level]; specific mappings [E] |
| C–D/C (I–II, Lydian) | Whimsy, magic, Galaxy-style lift | [Splice](https://splice.com/blog/music-modes-lydian) |
| Am–D (i–IV, Dorian) | Ancient, folk, the ocarina's sound | Irish Dorian [C] |
| Em–F (i–♭II, Phrygian) | Menace, dark fantasy, stealth | [E] |
| Am–E–F–E (i–V–♭VI–V, harmonic minor) | Castle, gothic, Castlevania-style | [E] |
| Am–Fm and A–F (mediant pairs) | Tragic grandeur, sudden scale, Elvish otherness | Shore excerpt [C] |
| C–F–Fm–C (I–IV–iv–I) | Minor-plagal ache: sad, wistful cozy | [E] |
| Minor piece ending on a major I | Picardy finish for triumph after struggle | [E] |
| Cmaj7–Fmaj7 vamp (add9 option) | Ambient, Minecraft-style calm, menus | [E]; Minecraft voicings unverified |
| Am–Am(maj7)–Am7–Am6 | Line cliché: noir, melancholy | [E] |
| Alternate dim7 and dominant-type 7th; C–F♯ pedal | Horror clash and tritone dread | Exorcist analysis [C] |
| Am–C♯m (i–♯iii) | Horror and dark-fantasy chromatic shock | [E] |

| Scale | Notes from C | Mood use | Workaround today |
|---|---|---|---|
| Whole tone | C D E F♯ G♯ A♯ | Dream, unreality, magic flourishes | SCALE off |
| Octatonic (half-whole / whole-half) | C D♭ E♭ E F♯ G A B♭ / C D E♭ F G♭ A♭ A B | Menace, horror, dim7 colour | Stamp Dim chords a semitone apart |
| Phrygian dominant | C D♭ E F G A♭ B♭ | Desert, Hijaz, villain | Harmonic minor on F, treat C as home |
| Harmonic major | C D E F G A♭ B | Shore-style Elvish/heroic colour | None |
| Melodic minor / Lydian dominant | C D E♭ F G A B / C D E F♯ G A B♭ | Jazz city (Odyssey), mischievous brightness | None |
| Locrian | C D♭ E♭ F G♭ A♭ B♭ | Darkest mode, unstable tension | None |
| Double harmonic / Hungarian minor | C D♭ E F G A♭ B / C D E♭ F♯ G A♭ B | Desert, gypsy, gothic | None |
| Hirajoshi / Yo | C D E♭ G A♭ / C D F G A | Japanese melancholy or folk brightness (Kakariko-style [T]) | Japanese (in) is close |
| Chromatic | All 12 | Clusters, horror | SCALE off |

| Drummer style | Meter / BPM [E] | Pattern sketch | Use |
|---|---|---|---|
| Waltz | 3/4, 80–180 | Kick on 1, light snare/brush on 2 and 3 | Underwater, town, love, Galaxy observatory |
| Jig / compound | 6/8, dotted quarter 100–127 | Bodhrán 8ths accented on 1 and 4, long-short lilt | Celtic, Outset-style islands, pirate |
| Big-band swing | 4/4, 120–220 | Ride "ding ding-a ding", hi-hat on 2 and 4, feathered kick | Odyssey city, shop, Persona-style menus |
| Shuffle | 4/4, 90–150 | Swung 8th hats, backbeat | Kart, cozy, shop |
| March / snare cadence | 2/4 or 4/4, 100–130 | Snare flams and rolls, kick on 1 and 3, cymbal on phrase starts | Heroic overworld, title, military |
| Calypso | Cut time, 90–100 per half note | Kick on 1 plus anticipations, cowbell/shaker 8ths | Classic Mario ground, beach |
| Bossa nova | 4/4, 120–140 | 3-2 rim clave, dotted kick, shaker 16ths | Shop, menu, lounge |
| Maqsum | 4/4, 100–130 | Dum-tek-tek-dum-tek | Desert |
| Orchestral battle ostinato | 4/4, 130–170 | Taiko 8ths with flams, timpani downbeats, 3+3+2 accents | Action-adventure, boss |
| Tribal build | 4/4, 90–130 | Low toms swelling from sparse to dense | Hinox-style mini-boss, lava |
| Blast beat | 4/4, 180–240 | Alternating kick and snare 16ths | Doom-style high combat |
| Heartbeat / no-drums | Free or 60–80, accelerating | Lub-dub kick; timpani rolls and cymbal swells only | Horror, orchestral cues without a kit |

### Ready-to-build starter templates

Each starter below is meant to be built from existing instrument names. Tempos and keys are design choices [E]. Where a spec draws on a franchise, it follows that franchise's sourced devices, not unpublished official values. Horror, boss and dungeon starters already exist, so the dark entries here are deliberately different variants.

| Starter | BPM | Key / mode | Meter | Instruments | Sections / Game states | Signature devices | Needs |
|---|---|---|---|---|---|---|---|
| **Hyrule Field** (Zelda-style overworld) | 132 | B♭ major / Mixolydian | 4/4 | French Horn, Trumpet, Violins short, Cellos, Double Bass, Harp, Timpani, Acoustic kit snare | Explore A–D (8 bars each), Idle (strings + harp), Threat, Battle; all at one tempo, transitions on the next bar | Triplet pickups, ♭VI–♭VII–I, I–♭VII–IV | Ranks 1, 4 (march), 9 (random segments) |
| **Cosmic Waltz** (Galaxy-style) | 100 | E♭ major with Lydian A♮ colour | 3/4, then a cut-time "Flight" section at 150 | Violins/Violas/Cellos long, Harp, Celesta, Music Box, Glockenspiel, Voices "Ooh", French Horn, Timpani, Crystal pad | Observatory → Restored 1–3 (Intensity stem groups add layers) → Flight with Key change up | Imaj7/IVmaj7, harp glissandi, master Heaven | Ranks 4 (waltz), 6 (harp glissando) |
| **Big Band City** (Odyssey-style) | 145 swung | C major, final key change | 4/4 | Trumpet, Muted Trumpet, Trombone, saxes, Upright piano, Double Bass, Acoustic kit (ride), Voices | Intro, Head (A A B A), Solo, Festival chorus with Key change up | ii–V–I with 7ths, shuffled 8ths | Ranks 3, 4 (swing), 6 (walking bass) |
| **Blocky Ambient** (Minecraft-style) | 76 | C or D major | 4/4, loose | Concert Grand (soft), Rhodes, Halo/Glass pad | 3–5 cues of 1–3 min, each followed by silence | Few-note melodies, maj7/add9, 4–6 s reverb, HUMAN on | Ranks 1 (maj7 vamp), 9 (gaps) |
| **Wild Field** (BotW-style sparse) | 72, rubato | D major pentatonic with Lydian G♯ | Free 4/4 | Concert Grand, Birds/Seashore bed; Celesta + Violins for night | Field Day, Field Night (−15% tempo), Landmark (withheld theme), Riding (16th piano chords) | 30–60% rests, ≥10 s gaps | Ranks 8, 9 |
| **Underwater Waltz** (SMB/DKC tradition) | 84 | F Lydian | 3/4 | Harp, Vibraphone, Glass pad, Flute, Pizzicato | Shore and Deep: same notes, Deep adds Filter LP (~800 Hz [E]) and longer reverb | Waltz lilt, low-pass, chorus | Ranks 4, 7 |
| **Desert Bazaar** | 116 | E Phrygian dominant | 4/4 maqsum | Sitar, Shehnai, Flute, Bongos & Percussion, Dulcimer/pad drone | Market (day), Ruins (night, sparse), Danger | Drone plus augmented second, ornamented melody | Ranks 2, 4 |
| **Clock Town Countdown** (Majora-style) | 112 → 124 → 140 | G major → Dorian → Phrygian | 4/4 | Accordion, Pizzicato, Clarinet, Marimba, Woodblock kit | Day 1, Day 2, Day 3, Final Hours; each with a tempo change; Danger stinger between | Same melody, rising tempo, darkening mode | Buildable today; better with rank 7 |
| **Industrial Fog** (Silent Hill-style) | 88 | E Phrygian | 4/4 swung breakbeat | Breakbeat kit, Distortion guitar tremolo, Mandolin, Goblins/Rain pads, Seashore noise, Sub Drop | Fog (drone + scrape), Otherworld (noise wall), Lament (melancholy guitar) | Lo-Fi + Distortion, 8 s reverb | Rank 3 |
| **Save Room** | 66 | A minor with maj7/9 | 4/4 | Rhodes, Glass pad, Concert Grand | One 2–3 chord loop, 60–90 s | Two or three chords, no bright tonic [C] | Buildable today |
| **Gothic Cathedral Boss** (dark fantasy) | 150 (dotted half = 50) | D harmonic minor with Phrygian ♭II | 3/4 | Choir, Chapel Organ, Cellos, Trombone, Tuba, Timpani, Solo Violin, Chimes | Phase 1 theme; Phase 2 adds choir + Key change up; Phase 3 half-time breakdown → tutti; Lament (piano, after the kill) | Dm–B♭m mediant shock, master Cathedral | Ranks 1, 4 (waltz) |
| **Arena Metal** (Doom-style action) | 130, with double-time sections | D Phrygian | 4/4 with 7/8 bars | Distortion guitar (Power chords), Growl/Reese bass, Techno + Acoustic kits, Synth Designer sine through Distortion + Lo-Fi, Impact, Sub Drop | Exploration, Incidental, Medium combat, High combat (Gordon's four categories [C]) | Short syncopated bursts, i–♭II, blasts in High | Rank 4 (blast beat) |

## Conclusion

The main point for Bo's Beatbox is that its adaptive engine is already ahead of its musical vocabulary. Its state machine, transition matrix, stingers and synthesizing runtime are close to what middleware provides. Yet a user still cannot select the most famous cadence in Nintendo history, swing an 8th note, set a waltz drum pattern or pick the scale that makes a desert sound like a desert. Those are the cheapest fixes on the list, and they unlock most of the starters people will reach for first. The synthesizing runtime also turns two expensive middleware features into cheap ones. Orchestration skins and in-key sound effects cost almost nothing when the game receives notes instead of audio files. That makes "one theme, many costumes", the move shared by Banjo-Kazooie, Odyssey and NieR, a feature where Bo's Beatbox could lead rather than follow.

The research also reframes what "beautiful" means for a tool. The scores praised most are defined as much by what they withhold as by what they play: BotW's silences, C418's random entrances, Kataoka saving the melodies for the right moment. A DAW normally helps users add notes. A game-music DAW also needs tools that remove them: note chance, silence gaps, sparseness controls and a warning when tempo and mode work against the chosen mood. Building those subtractive tools into Bo's Beatbox would set it apart from both general DAWs and middleware.

Two gaps remain for follow-up work. The first is to check the transcription-level BPMs and keys against primary scores or audio before they appear in user-facing copy. The best sources are Schartmann's book on the Super Mario Bros. soundtrack and Kondo's interviews. The second is to confirm what FMOD, Wwise and Elias already offer for auditioning, so that ranks 13–14 are positioned as real differentiators.
