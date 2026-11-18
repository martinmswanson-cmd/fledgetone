/**
 * A plugin parameter's value text as its window shows it. The open-source plugins print four
 * places ("-3.0000 dB", "0.5000"): those are trimmed to as many as mean something ("-3 dB",
 * "0.50"). Text a plugin already wrote for reading is left as it is: a whole number ("16 voices",
 * "50 %"), one or two places ("9.0 dB", "0.25"), and anything that isn't a plain number with a
 * unit ("1/4", "1/8T", "4.0:1", "Off"). Plain, so Node can test it.
 */
export function tidyValue(text: string): string {
  const t = text.trim();
  const m = t.match(/^(-?\d+\.\d{3,})(.*)$/);
  // (A fraction or a ratio is not a number to round: "1.0000/4" isn't printed by anything, but "1/4" must stay)
  if (!m || /^[/:]/.test(m[2])) return t;
  const v = Number(m[1]);
  const places = Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2;
  return `${Number(v.toFixed(places)).toFixed(places).replace(/^-0(\.0+)?$/, '0$1')}${m[2]}`;
}
