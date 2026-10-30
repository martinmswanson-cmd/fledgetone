/**
 * Names in the app's words shown apart from them: a sentence whose names are marked (names.ts)
 * with each name as a chip of its own (NamedText), and an agent's name the same way (NameChip),
 * so a name an agent wrote, whatever it says (quotes, brackets, whole sentences), reads as a name,
 * never as more of the app's words. The chip holds the name as it is, in a box with its own
 * border and colour; screen readers hear it in quotes.
 */
import React from 'react';
import { nameParts } from '../../agent/names';

/** One name as a chip. */
export const NameChip: React.FC<{ name: string }> = ({ name }) => (
  <span data-name-chip="" className="inline-block max-w-full align-baseline mx-0.5 px-1 rounded border border-cyan-500/40 bg-cyan-500/10 text-cyan-100 font-mono text-[0.95em] break-words normal-case tracking-normal">
    <span className="sr-only">“</span>
    {name}
    <span className="sr-only">”</span>
  </span>
);

/** A sentence with its marked names as chips. */
export const NamedText: React.FC<{ text: string }> = ({ text }) => (
  <>
    {nameParts(text).map((p, i) => (typeof p === 'string' ? <React.Fragment key={i}>{p}</React.Fragment> : <NameChip key={i} name={p.name} />))}
  </>
);

/** "From your agent" with the agent's name as a chip after it, if it gave one. */
export const FromYourAgent: React.FC<{ name?: string }> = ({ name }) => (
  <>
    From your agent{name ? <NameChip name={name} /> : null}
  </>
);
