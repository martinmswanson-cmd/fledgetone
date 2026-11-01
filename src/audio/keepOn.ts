/**
 * Kept switched on in an export: `keepOn(node)` gives a node of an OfflineAudioContext a second
 * input that never goes away (a gain with nothing going into it: silence), so the browser never
 * switches it off, nor anything after it, when the sounds playing into it stop.
 *
 * Why: once every connection into a node has stopped sounding, Chromium switches the node's
 * outputs off, and the nodes after it in turn. A node with a tail (a delay line, a filter, a
 * convolver) goes off only once its tail is over, and that last step runs on the page's main
 * thread whenever it gets round to it, not at a set point in the render. A node that's off isn't
 * run at all, nor is an oscillator that only drives its parameters: a chorus's sweep stood still
 * between two notes for as long as its delay lines were off, a different length of time in each
 * export, so every note after that came out a little different (Space Clav, from about 45 seconds
 * into a song with gaps between its notes; a Lo-fi insert's wobble, the Wavetable's sweep). A
 * node kept on still skips its work while it hears only silence, as before, but its parameters
 * (and what drives them) run on, as they did whenever the switching off came late.
 *
 * Returns a function that takes the silent input away again (for the effect's dispose). Live
 * playback is left as it is: switching idle effects off saves the CPU there.
 */
export function keepOn(node: AudioNode): () => void {
  if (typeof OfflineAudioContext === 'undefined' || !(node.context instanceof OfflineAudioContext)) return () => {};
  const silence = node.context.createGain();
  silence.connect(node);
  return () => silence.disconnect();
}
