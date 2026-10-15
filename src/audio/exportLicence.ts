/**
 * The permission that travels with the files Fledgetone writes into exports (the game kit's players
 * and example scenes, the FMOD and Wwise scripts, manifests): anyone may use them in any project,
 * under any licence, closed-source and paid games included. Fledgetone's own code is GPL, but these
 * files end up inside people's games, which must not be pulled under the GPL by them (see TERMS.md,
 * section 3). Each export that carries such files includes this text as LICENSE-exported-files.txt.
 */
export const EXPORTED_FILES_LICENCE_NAME = 'LICENSE-exported-files.txt';

export const EXPORTED_FILES_LICENCE = `Files written by Fledgetone

The scripts, players, example scenes, manifests and other files Fledgetone wrote into this export
(not your music, which is yours) may be used, copied, changed and distributed by anyone, in any
project, including closed-source and paid games and apps, under any licence, with no obligation to
share your own code and no need to credit Fledgetone. This permission comes from Two Birds Workshop,
which makes Fledgetone, and applies to these exported files in addition to the GNU General Public
License that covers Fledgetone's own code.

The files are provided "as is", without warranty of any kind. In no event shall the authors be
liable for any claim, damages or other liability arising from the files or their use.

Open-source libraries bundled inside a file (such as the web player) keep their own licences, whose
notices are included in that file.
`;
