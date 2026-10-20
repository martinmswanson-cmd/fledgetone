---
title: Chords and a melody
summary: Pick a key, lay down four chords, add a piano part that follows them, then write a tune on the chord notes and let the melody helper answer it.
level: Beginner
time: 20 minutes
---
In this lesson you'll write eight bars of music in A minor: four chords (Am, F, C and G), a piano part that follows them, a four-bar tune and a second four bars that answer it. You don't need to read music or know any theory. Open [the studio](https://fledgetone.com/app/) in another tab and follow along.

### Keys and scales in plain words

A **scale** is a set of seven notes that sound good together. The **key** is the scale plus its home note, the one the music wants to come back to. **A minor** uses only the white keys of a piano, A B C D E F G, with A as home. It sounds a little serious or wistful. **C major** uses the very same white keys but treats C as home, so it sounds brighter.

A **chord** is three or more notes played together. The simplest kind, a **triad**, stacks every other note of the scale: start on A, skip B, take C, skip D, take E, and you have **A minor** (A C E). Start on F instead and you get **F major** (F A C). Every chord in this lesson is built that way, so every one of them fits the key.

### Start with a blank timeline

1. Open the **File** menu and choose **New…**.
2. Click **Blank timeline**. You get four empty tracks: **Drums**, **Slap Bass**, **Space Clav** and **Brass Stabs**.

### Make the chords

Fledgetone's **Chord progression** helper writes a chord part from a few choices. It follows the usual rules of harmony; you pick the key and the shape of the progression.

1. Right-click the **Space Clav** track's lane (the empty row to the right of its name), right at the start of bar 1.
2. Choose **Chord progression…**.
3. Set **Key** to **A** and **minor**.
4. Set **Progression** to **i – VI – III – VII (epic)**. The line near the bottom now reads **Am – F – C – G**.
5. Leave **Each chord lasts** on **1 bar**, **Times through** on **2× (8 bars)** and **Played as** on **Held chords**.
6. Click **Make clip at bar 1**.

{{shot:chords-progression}}

A purple clip called **Am F C G** appears, eight bars long. Press **Space** to hear it. These are the notes it wrote, one chord a bar, then the same four again:

| Bar | Chord | Notes (low to high) | Roman numeral in A minor |
|---|---|---|---|
| 1 | Am | A3, C4, E4 | i (home) |
| 2 | F | A3, C4, F4 | VI |
| 3 | C | G3, C4, E4 | III |
| 4 | G | G3, B3, D4 | VII |

The helper **voices** the chords so each one moves as little as it can from the last: C4 stays put for the first three chords, and the other notes only step up or down. That's why they sound smooth rather than jumping about.

> A new project loops bars 1 to 5, so for now you only hear the first four bars, over and over. That's fine while you work. You'll open it up at the end.

### See the key in the piano roll

1. Double-click the **Am F C G** clip. Its notes open in the **piano roll** under the timeline.
2. Find **SCALE** in the piano roll's header. Set the first menu to **A** and the second to **Minor**.

{{shot:chords-scale}}

The rows for notes outside A minor (the black keys) go dark, and every A is lit. While a scale is set, a click in the grid lands on the nearest note of the key, so you can't hit a wrong note by accident.

Next to SCALE is **CHORD**. Set it to **Triad in key** and a single click adds a whole chord built from the note you click: click a D and you get D minor (D, F, A). That's how to write your own chords by hand. Set it back to **Single notes** when you're done, and see the [piano roll guide](/guide/writing-notes-the-piano-roll/) for every option.

> With no notes selected, **Delete** does nothing in the piano roll. To delete the whole clip, close the piano roll (**Esc**), click the clip and press **Delete**; **Ctrl+Z** (Cmd+Z on a Mac) brings it back.

### Add an accompaniment

Held chords are a good start, but a part that moves gives the music a pulse.

1. Right-click the **Am F C G** clip on the timeline.
2. Choose **Accompaniment for these chords…**.
3. Pick **Alberti bass** (low, high, middle, high in 8th notes, the classic left-hand piano pattern). It suggests **Concert Grand (Real)** under **On**: keep it.
4. Click **Make the track**.

{{shot:chords-accompaniment}}

A new **Alberti bass** track appears under the chords, following each chord change. The first time, the piano downloads its recorded sounds, so give it a moment. The **Track Inspector** also opens on the right for the new track; close it with the **X** at its top right when you want the room back.

> Two keyboard parts can crowd each other. If it sounds busy, click **M** on the **Space Clav** track to mute the held chords and let the piano carry them.

### Write a melody on the chord notes

Here's the one rule that makes a tune fit its chords: **on the strong beats (1 and 3), play a note of the chord**. In between, any note of the key will do; those in-between notes lead the ear from one chord note to the next.

1. Click **+ Add Track** under the last track, type *pluck* and press **Enter**. A **Pluck** track appears.
2. Right-click the **Pluck** lane at bar 1 and choose **New empty clip (4 bars)**. It opens in the piano roll.
3. Set **SCALE** to **A** and **Minor**, as before.
4. Set **NEW NOTE** to **1/4**, so each click makes a note one beat long.
5. Click in these notes, one per beat. The keyboard on the left labels each C (C5 is the C above middle C); scroll it up or down to find the rest.

| Bar (chord) | Beat 1 | Beat 2 | Beat 3 | Beat 4 |
|---|---|---|---|---|
| 1 (Am: A C E) | **E5** | D5 | **C5** | D5 |
| 2 (F: F A C) | **A4** | C5 | **F5** | E5 |
| 3 (C: C E G) | **E5** | D5 | **C5** | G4 |
| 4 (G: G B D) | **B4** | C5 | **D5** | rest |

The bold notes are chord notes, right on beats 1 and 3. The others step between them. The last bar ends on D, which isn't home, so the tune sounds as if it's asking a question.

{{shot:chords-melody}}

Press **Space** to hear it over the chords. **GHOSTS** (ticked) shows the other tracks' notes as faint outlines; scroll the piano roll down and you'll see the chord notes sitting under your tune.

> Clicked on an existing note by mistake? A click on a note selects it instead of adding one. Right-click a note to delete it, or drag it up or down to change its pitch.

### Let the melody helper answer it

A question wants an answer. The **Melody variations** helper rewrites a tune by fixed rules: the same rhythm, mirrored, simplified, a harmony above it and so on. Every note moves by the scale's own steps, so the result stays in key.

1. Right-click the **Pluck 1** clip on the timeline and choose **Melody variations…**.
2. The **Key** shows what the app guessed from the notes, probably **C major**. A minor and C major share the same notes, so set it to **A** and **minor**: the tune feels like A minor.
3. Choose **Answer phrase**.
4. Leave **Put it** on **after it, on its track**, and click **Make it**.

{{shot:chords-variations}}

A clip called **Pluck 1 (answer phrase)** appears in bars 5 to 8: the same rhythm going the other way, and it comes home to A at the end. Try the others too (**Harmony a third above** with **on a new track under it** is a quick way to thicken a tune). Each one is a single **Ctrl+Z** to undo.

### Listen to all eight bars

1. Press **L** to turn the loop off (or click the Loop button in the toolbar).
2. Press **Home** to go back to the start, then **Space**.

{{shot:chords-timeline}}

You should hear the chords and the piano throughout, your tune in bars 1 to 4, and the answer in bars 5 to 8, landing home on A.

> Want it to sound different? Right-click an empty spot on a lane, choose **Chord progression…** again and try **vi – IV – I – V (ballad)** in C major, or tick **7th chords (jazzier)**. Every helper is described in the guide under [Smart tools](/guide/writing-notes-the-piano-roll/#smart-tools-chords-bass-lines-a-drummer-and-fills).

### What's next

You've picked a key, laid down chords, added an accompaniment and written a tune with an answer. Next, give it a low end: [Bass lines and 808s](/learn/bass-and-808s/).

{{example:chords-and-melody}}
