/**
 * Who made each GPL-licensed built-in plugin family and where to find them: their project page,
 * their source (the upstream repository Fledgetone builds from, as scripts/plugins/families.json
 * records it) and where to reach them (the project's issue tracker). For the GPL notice the web
 * runtime kit shows and writes (runtimeKit.ts), and the GPL tags. Plain data, so Node can test it.
 */

export interface GplCredit {
  /** What the app calls it */
  name: string;
  /** Who made it, as the upstream licence and readme say */
  by: string;
  licence: string;
  /** The project's own page */
  project: string;
  /** Its source code (the repository Fledgetone builds from) */
  source: string;
  /** Where to reach the people who make it */
  contact: string;
  /** The upstream commit Fledgetone's copy is built from (families.json) */
  commit: string;
}

/** By family (pluginCatalogGpl.ts). */
export const GPL_CREDITS: Record<string, GplCredit> = {
  surge: {
    name: 'Surge XT',
    by: 'the Surge Synth Team and contributors (originally Vember Audio’s Surge, by Claes Johanson)',
    licence: 'GPL-3.0',
    project: 'https://surge-synthesizer.github.io',
    source: 'https://github.com/surge-synthesizer/surge',
    contact: 'https://github.com/surge-synthesizer/surge/issues',
    commit: 'f398826e85672b5d8dd0ed844065fccd2e8cdfba',
  },
  dragonfly: {
    name: 'Dragonfly Reverb',
    by: 'Michael Willis, Rob van den Berg and contributors',
    licence: 'GPL-3.0',
    project: 'https://michaelwillis.github.io/dragonfly-reverb/',
    source: 'https://github.com/michaelwillis/dragonfly-reverb',
    contact: 'https://github.com/michaelwillis/dragonfly-reverb/issues',
    commit: '440ec7b3b3db2fec34b9f80cf4890102ca14d1c3',
  },
  plateau: {
    name: 'Plateau',
    by: 'Dale Johnson (Valley Audio Soft)',
    licence: 'GPL-3.0',
    project: 'https://github.com/ValleyAudio/ValleyRackFree',
    source: 'https://github.com/ValleyAudio/ValleyRackFree',
    contact: 'https://github.com/ValleyAudio/ValleyRackFree/issues',
    commit: '86f02e431136a7f5c96a872b99b7115b7e133e05',
  },
  setbfree: {
    name: 'setBfree (the Tonewheel Organ)',
    by: 'Fredrik Kilander, Robin Gareus and Will Panther',
    licence: 'GPL-2.0-or-later',
    project: 'https://setbfree.org/',
    source: 'https://github.com/pantherb/setBfree',
    contact: 'https://github.com/pantherb/setBfree/issues',
    commit: '2f41983b5b535bda9b1b1db38a06da29d50ff557',
  },
};

/** Where Fledgetone's own source is, with how it builds these plugins for the browser (scripts/plugins/). */
export const FLEDGETONE_SOURCE = 'https://github.com/martinmswanson-cmd/fledgetone';

/** What sharing a game with a GPL plugin in it asks, in plain words (the dialog and the notice say it). */
export const GPL_PLAIN =
  'GPL is a free-software licence. A game may include a GPL plugin, paid or free, but if you share the game, the plugin’s source code must be available to its players and its licence must come with it. The kit includes the licence and a notice with a link to the source, so keeping those files with the game covers it.';

/** What the GPL tag beside such a plugin's name says (GplTag.tsx). */
export const GPL_TAG_TIP = 'GPL-licensed: free to use in your songs and exports. If a web runtime kit carries it into a game, its licence and a link to its source go with it.';

/** The kit's GPL notice: each plugin, who made it, its licence, and where its source and its makers are. */
export function gplNotice(families: ReadonlyArray<{ family: string; label: string }>): string {
  const parts = families.map((f) => {
    const c = GPL_CREDITS[f.family];
    if (!c) return `${f.label}: GPL-licensed. Its source: ${FLEDGETONE_SOURCE}`;
    return [
      `${c.name} (${c.licence})`,
      `  Made by ${c.by}.`,
      `  Project: ${c.project}`,
      `  Source: ${c.source} (built from commit ${c.commit})`,
      `  Contact: ${c.contact}`,
    ].join('\n');
  });
  return `GPL-licensed plugins in this kit
================================

The song uses these plugins, which are in fledgetone-plugins/gpl/. ${GPL_PLAIN}

${parts.join('\n\n')}

How they are built for the browser, with the rest of Fledgetone's source: ${FLEDGETONE_SOURCE}
(scripts/plugins/). Their licences, with the full text of the GPL, are in GPL-PLUGINS-LICENSE.txt.
`;
}
