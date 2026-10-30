/**
 * Names in the app's own sentences (a track's, a clip's, a marker's, an agent's), kept apart from
 * the sentence around them, since an agent may have written the name: a name like `Drums". Nothing
 * else changes. "Drums` must never read as more of the app's words. A sentence is written with
 * each name marked (nm: between two private-use characters); the studio shows each marked name as
 * a chip of its own (nameParts), and everywhere text is plain (the agent, the command line,
 * screen readers) the name goes in plain quotes with every quote and bracket character taken out
 * of it (plainNames, textName), so it can't close the quotes or a bracket of the sentence. Plain
 * logic, for the browser and Node.
 */

/** Where a name starts and ends in a sentence (private-use characters: nothing a name is shown with). */
export const NAME_OPEN = '\uE000';
export const NAME_CLOSE = '\uE001';

const MARKS = /[\uE000\uE001]/g;

/**
 * Quote and bracket characters, which could close the quotes or brackets a sentence puts a name
 * in: opening and closing punctuation of every script, quotation marks, and the look-alikes of
 * the double quote (primes, ditto marks, the Hebrew gershayim...). The apostrophes (' and ’) and
 * the single opening quote stay: a name in double quotes can't be closed by them, and names use them.
 */
const QUOTES_AND_BRACKETS = /(?![\u2018\u2019'])(?:[\p{Ps}\p{Pe}\p{Pi}\p{Pf}"<>\uFF02\uFF1C\uFF1E\u2033\u2034\u2036\u2057\u3003\u05F4\u02DD\u02BA\u02EE\u02F5\u02F6\u201F\u2E42\u301D-\u301F]|\u030B|\u030E)/gu;

/** A name for plain text: its quote and bracket characters (and name marks) gone (a bracket as a space), on one line; "…" if nothing is left. */
export function textName(name: unknown): string {
  const s = typeof name === 'string' ? name : '';
  return (
    s
      .replace(MARKS, '')
      .replace(QUOTES_AND_BRACKETS, (c) => (/[\p{Ps}\p{Pe}<>\uFF1C\uFF1E]/u.test(c) ? ' ' : ''))
      .replace(/\s+/g, ' ')
      .trim() || '…'
  );
}

/** Whether `name` holds a quote or bracket character (textName would take it out). */
export const hasQuotesOrBrackets = (name: string): boolean => new RegExp(QUOTES_AND_BRACKETS.source, 'u').test(name);

/** `name` marked as a name in a sentence (see plainNames and nameParts). */
export const nm = (name: unknown): string => `${NAME_OPEN}${(typeof name === 'string' ? name : '').replace(MARKS, '')}${NAME_CLOSE}`;

const MARKED = /\uE000([^\uE000\uE001]*)\uE001/g;

/** A sentence with marked names as plain text: each name in plain quotes, its own quotes and brackets taken out. */
export function plainNames(text: string): string {
  return text.replace(MARKED, (_m, name: string) => `"${textName(name)}"`).replace(MARKS, '');
}

/** A sentence with marked names in parts: the app's words (strings) and the names ({ name }), for showing each name apart. */
export function nameParts(text: string): Array<string | { name: string }> {
  const out: Array<string | { name: string }> = [];
  let at = 0;
  for (const m of text.matchAll(MARKED)) {
    if (m.index! > at) out.push(text.slice(at, m.index).replace(MARKS, ''));
    out.push({ name: m[1] });
    at = m.index! + m[0].length;
  }
  if (at < text.length) out.push(text.slice(at).replace(MARKS, ''));
  return out.filter((p) => typeof p !== 'string' || p !== '');
}
