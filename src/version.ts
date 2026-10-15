/**
 * Which build of the app this is: its version (package.json, the top of CHANGELOG.md), the commit
 * it was built from and when. Vite fills them in (vite.config.ts); outside a build (tests) they
 * read "dev".
 */
declare const __APP_VERSION__: string | undefined;
declare const __APP_COMMIT__: string | undefined;
declare const __APP_BUILT__: string | undefined;

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
export const APP_COMMIT = typeof __APP_COMMIT__ === 'string' ? __APP_COMMIT__ : 'dev';
export const APP_BUILT = typeof __APP_BUILT__ === 'string' ? __APP_BUILT__ : '';

/** "2026.10.15 (ffc61e0)": the version and the build it came from. */
export const versionLabel = () => `${APP_VERSION} (${APP_COMMIT})`;
