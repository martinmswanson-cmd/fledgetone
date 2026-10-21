# Fledgetone as a phone app

Pocket goes in the App Store and Google Play as an app built from the same web code as the
studio ([POCKET-PLAN.md](POCKET-PLAN.md), "An app, from the same code"). The wrapper is
[Capacitor](https://capacitorjs.com) (MIT): the app is a native shell with a web view, and the
web view runs `dist-app/`, the plain build. There is one engine and one project format, so a song
made in the app opens in the studio, and fixes reach both.

## Building

```sh
npm run app:sync        # build dist-app/ and copy it into ios/ and android/
```

`npm run build:app` makes `dist-app/` (about 33 MB): the plain build (no `VITE_GPL_PLUGINS`)
without the recordings and the GPL plugins' folder ([scripts/build-app.mjs](../scripts/build-app.mjs)).
`npx cap sync` copies it into the native projects and updates their plugins. Run it after every
change to the web code.

**iPhone** (needs a Mac with Xcode, and an Apple developer account for a real phone):

```sh
npx cap open ios        # opens ios/App/App.xcodeproj
```

In Xcode: choose the team under Signing & Capabilities, plug in the iPhone, press Run. For
testers, Product > Archive, then send it to TestFlight.

**Android** (needs the Android SDK, from Android Studio or the command-line tools, and Java 21):

```sh
cd android && ./gradlew assembleDebug
# the test build: android/app/build/outputs/apk/debug/app-debug.apk
```

Or `npx cap open android` for Android Studio. A store build is a signed app bundle:
`npm run app:release` (see "Publishing on Google Play" below).

The version comes from `package.json`: versionName is the same text (`2026.10.21-3`), and
versionCode, which Google Play needs to rise with every upload, is the date and that day's release
(`2026102103`; [scripts/androidVersion.mjs](../scripts/androidVersion.mjs), and
`android/app/build.gradle` works it out the same way for Android Studio builds).

## What the native side does

| What | Where | Why |
|---|---|---|
| Audio session `.playback` | `ios/App/App/AppDelegate.swift` | Sound with the silent switch on |
| Background audio | `ios/App/App/Info.plist` (`UIBackgroundModes: audio`) | A song keeps playing when the phone locks or another app opens |
| Microphone | `Info.plist` (`NSMicrophoneUsageDescription`), `AndroidManifest.xml` (`RECORD_AUDIO`) | Recording vocals |
| Files | `Info.plist` (`UIFileSharingEnabled`, `LSSupportsOpeningDocumentsInPlace`) | The app's folder shows in the Files app |
| Haptics, keeping the screen on, sharing files and links, the status bar | [src/native/nativeApp.ts](../src/native/nativeApp.ts) | What a web page can't do on a phone; each function does nothing on the web |
| Background and Back | [src/native/appLifecycle.ts](../src/native/appLifecycle.ts), [backButton.ts](../src/native/backButton.ts) | Going away: the autosave is written at once, a mic take is stopped and kept, and on Android the song pauses and the audio is let go. Coming back: a suspended or interrupted context is started again (silent; nothing plays by itself). Back closes the open sheet or dialog, then goes back a step, else puts the app away (`App.minimizeApp`) |
| Opening project files from other apps | `AndroidManifest.xml` (VIEW and SEND intent filters for `application/json`), `FledgetonePlugin.java` | "Open with" in a file manager, or Share to Fledgetone: the plugin reads the `content://` file through the content resolver (the App plugin's `appUrlOpen` only sees VIEW, not SEND) and the web side opens it as any project file |
| The app's settings page | `FledgetonePlugin.java` (`openSettings`) | A microphone refused for good ("don't ask again") can only be allowed there; Pocket's mic sheet has the button |
| Keeping storage | [src/pwa/pwa.ts](../src/pwa/pwa.ts) | `navigator.storage.persist()` is asked quietly at start; Pocket's Song sheet says what the web view answered |

The app's own plugin is a plain Java class in `android/app/src/main/java/com/fledgetone/pocket/`,
registered in `MainActivity` before the bridge starts; `cap sync` leaves both alone. There's no
iPhone side to it yet: on iOS those calls do nothing.

**The microphone.** Capacitor's web view turns the page's `getUserMedia` into Android's
`RECORD_AUDIO` question. Before the first take, Pocket says in a sheet why it needs the microphone
(it stays on the phone), then the phone asks; if it's refused, the sheet says how to allow it and
opens the app's settings. Recording is lined up per phone (Pocket's vocal tool, or the studio's
recording settings: [lineUp.ts](../src/audio/lineUp.ts), [lineUpRun.ts](../src/audio/lineUpRun.ts)):
six soft clicks through the speaker, recorded, give the real round trip, kept per microphone and
output in `localStorage`, and used for takes in place of the web view's latency estimate. A slow
output (over 100 ms, most likely Bluetooth) brings a notice while recording.

In the app, exports and project files go to the phone's share sheet (save to Files or iCloud
Drive, or send them on), shared song links point at fledgetone.com, Pocket opens first, and the
service worker isn't used (the app's files are already on the phone).

## Recordings and plugins

The recorded instruments (about 300 MB) aren't in the app: each loads from
`https://fledgetone.com/app/fledgetone-samples/` the first time it's played, and is kept on the
phone from then on, as on the web. The free plugins are in the app; the GPL ones aren't (below).
So the app needs a connection the first time each instrument is played.

## Settled

- **The GPL plugins stay out** (Surge XT, Dragonfly and the others): the GPL and the App Store's
  terms don't fit together. Fledgetone's own code can go to the store under its owner's terms.
  Have this checked by someone who knows open-source licensing before launch.
- **Capacitor 8** and its plugins (all MIT), at exact versions in `package.json`.

## To decide

- **The app's name and ID.** Now `Fledgetone` and `com.fledgetone.pocket`
  (`capacitor.config.json`, and the native projects). The ID can't change once the app is in a
  store.
- **Recordings on the phone.** Apple turns down apps that are only a website in a wrapper
  (guideline 4.2), and an app that needs a connection for its sounds is weaker there. A starter
  set of recordings could go in the app, with the rest downloaded.
- **Android in the background.** Android stops a web view's sound a while after the app leaves
  the screen, so the app pauses the song itself when it goes away (appLifecycle.ts); playing on
  in the background would need a foreground service (a native piece, later).

## To test on a real iPhone

- Sound with the silent switch on; sound on after locking the phone mid-song.
- A pad tap gives a light tap back; the screen stays on while playing.
- Recording a vocal: the microphone question, then the take in time. (The audio session is
  `.playback`; if recording is silent, it needs `.playAndRecord` while recording.)
- Export an MP3 and save it to Files; save a project and open it again from Files.
- Share a song link; it opens the studio on fledgetone.com.
- A recorded instrument plays (downloaded the first time), and again with the phone offline.

## To test on a real Android phone

- Install the test build (`adb install -r android/app/build/outputs/apk/debug/app-debug.apk`).
- Record a vocal: the sheet about the microphone, then Android's question. Refuse it twice ("don't
  ask again"), record again: the sheet's **Open Fledgetone's settings** opens the app's page.
- **Line up recording** in the vocal tool with the speaker, then record a take clapping on the
  beat: the claps sit on the beat. With Bluetooth headphones on, the notice shows while recording.
- Play, then press Home: the song pauses; come back, Play plays. Record, press Home: the take is
  kept. Swipe the app away from the recent apps right after an edit, open it again: the edit is there.
- Back: closes a sheet, then the starters screen, the full piano roll; on the main screen it puts
  the app away, and opening it again shows the song as it was.
- Save the project file (to Drive or Files), close the share sheet once without choosing: "Not
  saved". Open file: the saved file can be picked. Open it from the Files app (**Open with**
  Fledgetone) and share it to Fledgetone from Drive: it opens as the song.
- The Song sheet says whether the phone keeps the storage.

## Publishing on Google Play

A personal developer account has to run a **closed test** first: at least 12 testers opted in for
14 days in a row before Production can be applied for. Plan for about three weeks.

### 1. The signing key (once)

The upload key signs every bundle sent to Google Play (Play then signs the app for phones with its
own key: Play App Signing). Make it once, and keep it and its passwords safe and backed up outside
the repository: a lost upload key has to be reset through Play's support.

```sh
keytool -genkeypair -v -keystore ~/fledgetone-upload.jks -alias fledgetone \
  -keyalg RSA -keysize 2048 -validity 10000
```

Then either set the environment variables

```sh
export FLEDGETONE_KEYSTORE=~/fledgetone-upload.jks
export FLEDGETONE_KEYSTORE_PASSWORD=...   # the store's password
export FLEDGETONE_KEY_ALIAS=fledgetone
export FLEDGETONE_KEY_PASSWORD=...        # the key's password (often the same)
```

or write `android/keystore.properties` (it's in `.gitignore`, as are `*.jks` and `*.keystore`
files, so it's never committed):

```properties
storeFile=/home/you/fledgetone-upload.jks
storePassword=...
keyAlias=fledgetone
keyPassword=...
```

### 2. The bundle

```sh
npm run app:release
# the bundle: android/app/build/outputs/bundle/release/app-release.aab
```

It builds the web files and syncs them (`npm run app:sync`; `npm run app:release -- --skip-sync`
uses what's already in `android/`), then runs `./gradlew bundleRelease` with the version from
`package.json` ([scripts/build-release.mjs](../scripts/build-release.mjs)). Without a signing key
it stops before building. Raise the version in `package.json` before each upload: Play refuses a
versionCode it has seen.

### 3. The app in Play Console

1. [play.google.com/console](https://play.google.com/console): **Create app**. Name *Fledgetone*,
   default language, **App**, **Free**, accept the declarations.
2. **App content** (the dashboard lists each):
   - **Privacy policy**: a page on fledgetone.com saying what the Data safety answers say.
   - **App access**: everything is available without signing in.
   - **Ads**: no ads.
   - **Content rating**: the questionnaire, category *Utility, Productivity, Communication or
     Other* (a music-making tool): no violence, sexual content, bad language, drugs or gambling;
     no sharing between users inside the app, no purchases. The result is usually *Everyone* /
     PEGI 3.
   - **Target audience**: 13 and over (it isn't made for children, which keeps it out of the
     Families policy).
   - **Data safety**: see below.
   - **Government apps**, **Financial features**, **Health**: no.
3. **Store listing**: short and full description, the icon (512 × 512), a feature graphic
   (1024 × 500) and at least two phone screenshots (Pocket's grid, the drawer, the vocal tool).
4. **Play App Signing**: keep it on (the default), and upload the first bundle signed with the
   upload key above.

### 4. Data safety

Checked against the code (`fetch`, links and network use in `src/`, and `index.html`):

- **Does the app collect or share user data? No.** There's no account, no analytics, no ads and no
  crash reporting service. Songs, recordings, settings and the microphone's audio stay on the
  phone (the web view's storage and IndexedDB); a take is recorded into the song, never uploaded.
- What does go over the network, none of it about the person:
  - the recorded instruments, sound effects and plugin files, downloaded from `fledgetone.com`
    the first time each is used, and some free instrument libraries from their own hosts
    (`tonejs.github.io`, `gleitz.github.io`, `raw.githubusercontent.com`: see Credits);
  - the fonts, from Google Fonts (`fonts.googleapis.com`, `fonts.gstatic.com`).

  Those servers see the phone's address, as any download does; nothing is sent to them.
- What the person sends themselves: a **shared song link** carries the song in the link itself
  (after the `#`, which a browser doesn't send to the server when the link is opened); exports and
  project files go where the person picks in the share sheet; **Report a problem** opens their
  email app with the report written out, for them to send or not.
- **Is data encrypted in transit?** The downloads are all HTTPS. **Can people ask for their data
  to be deleted?** None is held: uninstalling the app removes everything it kept.
- The microphone permission (`RECORD_AUDIO`) is used only while recording or lining up recording.
  Audio is processed on the phone only, so it isn't "collected" in Play's sense.

Check this again before each release if anything that talks to a server has been added.

### 5. The closed test

1. **Test and release › Testing › Closed testing**: create a track, upload the bundle, write the
   release notes, send it for review.
2. **Testers**: a Google Group (make one at groups.google.com, for example fledgetone-testers,
   that anyone with the link can join) or a list of email addresses. The group is easier: people
   join it themselves.
3. Recruit **15 to 20** testers, not just 12: some never opt in, some uninstall. Each one joins the
   group, then opens the **opt-in link** shown on the closed test track (*Join on the web*), accepts,
   and installs the app from Play with the Google account they joined with.
4. Keep at least 12 of them opted in for **14 days in a row**; Play counts from when the twelfth
   opts in. Ask them to use it and say what they find (Report a problem, or Play's private
   feedback), and upload fixed bundles to the same track meanwhile (testers get the updates, and
   the count goes on).
5. After the 14 days: **Apply for production** on the dashboard, answering Play's questions about
   the test (how testers were found, what changed from their feedback, why it's ready).

### 6. Production

Once Play approves: **Production › Create new release**, the bundle (or promote the tested
release), the countries, then send it for review (a few days the first time). Later releases:
raise the version, `npm run app:release`, upload to the closed test or straight to Production.
