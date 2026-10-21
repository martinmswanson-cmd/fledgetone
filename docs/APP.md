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

Or `npx cap open android` for Android Studio. A store build needs a signing key
(`./gradlew bundleRelease`, signed).

## What the native side does

| What | Where | Why |
|---|---|---|
| Audio session `.playback` | `ios/App/App/AppDelegate.swift` | Sound with the silent switch on |
| Background audio | `ios/App/App/Info.plist` (`UIBackgroundModes: audio`) | A song keeps playing when the phone locks or another app opens |
| Microphone | `Info.plist` (`NSMicrophoneUsageDescription`), `AndroidManifest.xml` (`RECORD_AUDIO`) | Recording vocals |
| Files | `Info.plist` (`UIFileSharingEnabled`, `LSSupportsOpeningDocumentsInPlace`) | The app's folder shows in the Files app |
| Haptics, keeping the screen on, sharing files and links, the status bar | [src/native/nativeApp.ts](../src/native/nativeApp.ts) | What a web page can't do on a phone; each function does nothing on the web |

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
  the screen; playing on needs a foreground service (a native piece, later).

## To test on a real iPhone

- Sound with the silent switch on; sound on after locking the phone mid-song.
- A pad tap gives a light tap back; the screen stays on while playing.
- Recording a vocal: the microphone question, then the take in time. (The audio session is
  `.playback`; if recording is silent, it needs `.playAndRecord` while recording.)
- Export an MP3 and save it to Files; save a project and open it again from Files.
- Share a song link; it opens the studio on fledgetone.com.
- A recorded instrument plays (downloaded the first time), and again with the phone offline.
