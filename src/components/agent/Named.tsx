/**
 * Names in the app's words shown apart from them: a sentence whose names are marked (names.ts)
 * with each name as a chip of its own (NamedText), and an agent's name the same way (NameChip),
 * so a name an agent wrote, whatever it says (quotes, brackets, whole sentences), reads as a name,
 * never as more of the app's words. The chip holds the name as it is, in a box with its own
 * border and colour; screen readers hear it in plain quotes, its own quotes and brackets taken out.
 */
import React from 'react';
import { nameParts, textName } from '../../agent/names';

/**
 * One name as a chip. Screen readers hear it as the plain words do (textName: in quotes, its own
 * quote and bracket characters taken out, so it can't close them); the chip itself, the name as
 * it is, is only for the eye.
 */
export const NameChip: React.FC<{ name: string }> = ({ name }) => (
  <>
    <span data-name-chip="" aria-hidden="true" className="inline-block max-w-full align-baseline mx-0.5 px-1 rounded border border-cyan-500/40 bg-cyan-500/10 text-cyan-100 font-mono text-[0.95em] break-words normal-case tracking-normal">
      {name}
    </span>
    <span className="sr-only" data-name-said="">{`“${textName(name)}”`}</span>
  </>
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
