/**
 * What the command line knows about itself: Fledgetone's version and the agent guide
 * (docs/AGENT.md, served to agents as fledgetone://docs/ops). The build (vite.cli.config.ts)
 * writes both into the bundle; run from source, they're read from the repository.
 */
import { readFileSync } from 'node:fs';

declare const __FLEDGETONE_VERSION__: string | undefined;
declare const __AGENT_DOC__: string | undefined;

function fromRepo(path: string): string | null {
  try {
    return readFileSync(new URL(path, import.meta.url), 'utf8');
  } catch {
    return null;
  }
}

/** Fledgetone's version (the app's, from package.json). */
export const APP_VERSION: string =
  typeof __FLEDGETONE_VERSION__ === 'string' ? __FLEDGETONE_VERSION__ : (JSON.parse(fromRepo('../../../package.json') ?? '{"version":"dev"}') as { version: string }).version;

/** The agent guide, as Markdown. */
export const AGENT_DOC: string = typeof __AGENT_DOC__ === 'string' ? __AGENT_DOC__ : (fromRepo('../../../docs/AGENT.md') ?? 'The agent guide (docs/AGENT.md) is missing from this copy.');
