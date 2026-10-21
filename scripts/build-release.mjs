/**
 * The Android app for Google Play (npm run app:release): the web files built and copied in (npm
 * run app:sync), then a signed app bundle (gradlew bundleRelease), versioned from package.json
 * (androidVersion.mjs). The signing key is never in the repository: its place and passwords come
 * from environment variables or from android/keystore.properties (ignored by git), see
 * docs/APP.md, "Publishing on Google Play".
 *
 *   FLEDGETONE_KEYSTORE           the .jks file (or storeFile= in keystore.properties)
 *   FLEDGETONE_KEYSTORE_PASSWORD  its password (storePassword=)
 *   FLEDGETONE_KEY_ALIAS          the key's name in it (keyAlias=)
 *   FLEDGETONE_KEY_PASSWORD       the key's password (keyPassword=)
 *
 * --skip-sync builds the bundle from what's already in android/ (after an app:sync of your own).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { androidVersion } from './androidVersion.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ANDROID = join(ROOT, 'android');

/** keystore.properties as an object (Java properties: key=value lines, # comments). */
function readProperties(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([^#!=:\s][^=:]*?)\s*[=:]\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const props = readProperties(join(ANDROID, 'keystore.properties'));
const signing = {
  storeFile: process.env.FLEDGETONE_KEYSTORE || props.storeFile,
  storePassword: process.env.FLEDGETONE_KEYSTORE_PASSWORD || props.storePassword,
  keyAlias: process.env.FLEDGETONE_KEY_ALIAS || props.keyAlias,
  keyPassword: process.env.FLEDGETONE_KEY_PASSWORD || props.keyPassword,
};
const missing = Object.entries(signing)
  .filter(([, v]) => !v)
  .map(([k]) => k);
if (missing.length) {
  console.error(`No signing key: ${missing.join(', ')} missing. Set the FLEDGETONE_KEYSTORE... variables or write android/keystore.properties (docs/APP.md, "Publishing on Google Play").`);
  process.exit(1);
}
const store = isAbsolute(signing.storeFile) ? signing.storeFile : resolve(ANDROID, signing.storeFile);
if (!existsSync(store)) {
  console.error(`The keystore ${store} isn't there.`);
  process.exit(1);
}

const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const { versionName, versionCode } = androidVersion(version);
console.log(`Fledgetone ${versionName} for Android (versionCode ${versionCode})`);

if (!process.argv.includes('--skip-sync')) execFileSync('npm', ['run', 'app:sync'], { cwd: ROOT, stdio: 'inherit' });

const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
execFileSync(gradlew, ['bundleRelease', `-PfledgetoneVersionCode=${versionCode}`, `-PfledgetoneVersionName=${versionName}`], {
  cwd: ANDROID,
  stdio: 'inherit',
  // (The passwords reach Gradle through its environment, never its command line)
  env: {
    ...process.env,
    FLEDGETONE_KEYSTORE: store,
    FLEDGETONE_KEYSTORE_PASSWORD: signing.storePassword,
    FLEDGETONE_KEY_ALIAS: signing.keyAlias,
    FLEDGETONE_KEY_PASSWORD: signing.keyPassword,
  },
});

const aab = join(ANDROID, 'app/build/outputs/bundle/release/app-release.aab');
if (!existsSync(aab)) {
  console.error('Gradle finished but the bundle is missing.');
  process.exit(1);
}
console.log(`\nThe bundle for Google Play: ${aab} (${(statSync(aab).size / 1e6).toFixed(1)} MB)`);
