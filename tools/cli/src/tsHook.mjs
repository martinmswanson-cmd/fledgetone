// Runs the command line from its TypeScript source (node --import ./src/tsHook.mjs src/fledgetone.ts):
// the app's modules import each other without the .ts extension (Vite resolves them), so this adds it.
// Node strips the types itself. The tests run the helper this way; people use the built dist/.
import { register } from 'node:module';

register(
  'data:text/javascript,' +
    encodeURIComponent(`export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    if (/^\\.\\.?\\//.test(specifier) && !/\\.[cm]?[jt]s$/.test(specifier)) return next(specifier + '.ts', context);
    throw err;
  }
}`)
);
