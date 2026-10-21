/**
 * The Android app's version, from Fledgetone's (package.json, "2026.10.21" or "2026.10.21-3"):
 * versionName is the same text; versionCode, which Google Play needs to go up with every upload,
 * is the date and the release of that day: 2026.10.21-3 is 2026102103 (YYYYMMDD × 100 + n, n up
 * to 99; under Play's limit of 2100000000 until the year 2100). android/app/build.gradle works it
 * out the same way when it's built without these (Android Studio).
 */
export function androidVersion(version) {
  const m = /^(\d{4})\.(\d{1,2})\.(\d{1,2})(?:-(\d{1,2}))?$/.exec(String(version).trim());
  if (!m) throw new Error(`"${version}" isn't a version like 2026.10.21 or 2026.10.21-3`);
  const [, y, mo, d, n = '0'] = m;
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) throw new Error(`"${version}" has no such date`);
  return { versionName: String(version).trim(), versionCode: (Number(y) * 10000 + month * 100 + day) * 100 + Number(n) };
}
