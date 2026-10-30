/*
 * The mda plug-ins (Paul Kellett, MIT) as a Fledgetone plugin family: effects and four
 * instruments (DX10, EPiano, JX10, Piano), each with its own presets. Built against the
 * stand-in base class in audioeffectx.h.
 */
#include "../bbplug.h"
#include "audioeffectx.h"
#include <stdlib.h>
#include <new>
#include <string>
#include <vector>

// The plug-ins leave some of their state for the host's memory to have zeroed (it usually was):
// every allocation here starts zeroed, so they start the same every time.
void *operator new(size_t n) { return calloc(1, n ? n : 1); }
void *operator new[](size_t n) { return calloc(1, n ? n : 1); }
void operator delete(void *p) noexcept { free(p); }
void operator delete[](void *p) noexcept { free(p); }
void operator delete(void *p, size_t) noexcept { free(p); }
void operator delete[](void *p, size_t) noexcept { free(p); }

/** Their texts are Latin-1 ("µs"), padded with spaces, and some presets carry their makers'
 * initials ("Echo Pad [SA]"): tidied to trimmed UTF-8 without those. */
static void tidy(const char *in, char *out, size_t size)
{
    std::string s;
    for (const unsigned char *p = (const unsigned char *)in; *p; p++)
    {
        // A "µ" that was lost to a replacement character in the source
        if (p[0] == 0xef && p[1] == 0xbf && p[2] == 0xbd)
        {
            s += "\xc2\xb5";
            p += 2;
            continue;
        }
        if (*p < 0x80) s += (char)*p;
        else
        {
            s += (char)(0xc0 | (*p >> 6));
            s += (char)(0x80 | (*p & 0x3f));
        }
    }
    auto open = s.find(" [");
    if (open != std::string::npos && s.find(']', open) != std::string::npos) s.erase(open, s.find(']', open) - open + 1);
    if (s.rfind("mda ", 0) == 0) s.erase(0, 4);
    size_t a = s.find_first_not_of(' '), b = s.find_last_not_of(' ');
    s = a == std::string::npos ? "" : s.substr(a, b - a + 1);
    strncpy(out, s.c_str(), size - 1);
    out[size - 1] = 0;
}

#define PLUGINS(X)                                                                                                       \
    X(Ambience, "Ambience", "Reverb", "A small, natural room around the sound.", 0)                                      \
    X(Bandisto, "Bandisto", "Distortion", "Three-band distortion: drive the lows, mids and highs separately.", 0)         \
    X(BeatBox, "BeatBox", "Drums", "Drum replacer: plays kick, snare and hat sounds on the hits of a drum loop.", 0)     \
    X(Combo, "Combo", "Amp Sims", "Amp and speaker simulator, from small radio to big stack.", 0)                         \
    X(DX10, "DX10", "Instrument", "FM synth: bells, glassy keys, plucks and basses, with 32 presets.", 2.0f)                 \
    X(Deess, "De-ess", "Dynamics", "Tames harsh S and T sounds in a vocal.", 0)                                           \
    X(Degrade, "Degrade", "Lo-Fi", "Cheap digital: fewer bits, a lower sample rate and aliasing.", 0)                     \
    X(Delay, "Delay", "Ambience", "Simple stereo delay with a tone control on its echoes.", 0)                            \
    X(Detune, "Detune", "Stereo", "Doubles the sound with a slightly detuned copy, for width and shimmer.", 0)            \
    X(Dither, "Dither", "Utility", "Dither and noise shaping for the final bit depth.", 0)                                \
    X(DubDelay, "DubDelay", "Ambience", "Dub echo: the feedback saturates and darkens as it repeats.", 0)                 \
    X(Dynamics, "Dynamics", "Dynamics", "Compressor, limiter and gate in one.", 0)                                        \
    X(EPiano, "EPiano", "Instrument", "Sampled electric piano with tremolo and stereo, the classic stage piano.", 1.41f)       \
    X(Envelope, "Envelope", "Utility", "Envelope follower and VCA: shape one level with another.", 0)                    \
    X(Image, "Image", "Stereo", "Stereo image: mid/side width, balance and rotation.", 0)                                 \
    X(JX10, "JX10", "Instrument", "Two-oscillator analog-style poly synth: pads, leads and basses, 64 presets.", 0.8f)       \
    X(Leslie, "Leslie", "Effects", "Rotating speaker cabinet, for organs and guitars.", 0)                                \
    X(Limiter, "Limiter", "Dynamics", "Fast, transparent peak limiter.", 0)                                               \
    X(Loudness, "Loudness", "Tone Color", "Equal-loudness contour: full bass and treble at low levels.", 0)               \
    X(MultiBand, "MultiBand", "Dynamics", "Three-band compressor with stereo width per band.", 0)                         \
    X(Overdrive, "Overdrive", "Distortion", "Soft, warm overdrive.", 0)                                                   \
    X(Piano, "Piano", "Instrument", "Sampled acoustic piano: light, bright and quick to play.", 0.8f)                        \
    X(RePsycho, "RePsycho!", "Effects", "Slices each drum hit and drops its pitch, for beat-mangling.", 0)                 \
    X(RezFilter, "RezFilter", "Filter", "Resonant filter with envelope follower and LFO.", 0)                             \
    X(RingMod, "RingMod", "Effects", "Ring modulator with a feedback control.", 0)                                        \
    X(RoundPan, "RoundPan", "Stereo", "Moves the sound in a circle around the stereo field.", 0)                          \
    X(Shepard, "Shepard", "Effects", "Endlessly rising or falling tone, mixed with the input.", 0)                         \
    X(Splitter, "Splitter", "Utility", "Splits the sound by frequency or by level.", 0)                                   \
    X(Stereo, "Stereo", "Stereo", "Turns mono into stereo with short delays (Haas and comb).", 0)                         \
    X(SubSynth, "SubSynth", "Bass", "Adds synthesized sub bass under the input.", 0)                                      \
    X(TalkBox, "TalkBox", "Effects", "Talk box: the left channel speaks through the right (a synth).", 0)                 \
    X(TestTone, "TestTone", "Utility", "Test tones and noise, for checking levels.", 0)                                    \
    X(ThruZero, "ThruZero", "Effects", "Through-zero flanger, the tape kind.", 0)                                         \
    X(Tracker, "Tracker", "Effects", "Follows the input's pitch with an oscillator or a ring modulator.", 0)               \
    X(Transient, "Transient", "Dynamics", "Transient shaper: more or less attack and sustain.", 0)                       \
    X(VocInput, "VocInput", "Effects", "Makes a carrier for the vocoder that follows the voice's pitch.", 0)              \
    X(Vocoder, "Vocoder", "Effects", "16-band vocoder: the left channel shapes the right.", 0)

#define DECLARE(id, name, cat, about, inst) AudioEffect *createEffectInstance_##id(audioMasterCallback);
PLUGINS(DECLARE)

struct Def
{
    const char *name, *category, *about;
    /** 0: an effect. An instrument: its output gain, to play about as loud as the app's instruments */
    float instrument;
    AudioEffect *(*make)(audioMasterCallback);
};
#define ENTRY(id, name, cat, about, inst) {name, cat, about, inst, createEffectInstance_##id},
static const Def defs[] = {PLUGINS(ENTRY)};
static const int count = sizeof(defs) / sizeof(defs[0]);

/** Past this many messages waiting, a further controller of a kind already waiting replaces it (only the last counts) */
#define QUEUE 256
/** Past this many, only note-offs and resets are kept (a runaway stream) */
#define QUEUE_MAX 4096
/** The most messages handed over in one call */
#define CALL_MAX 512
/** The instruments keep 40 notes (and pedal changes) a block and drop the rest: more wait for the next block */
#define NOTES_MAX 40

struct Queued
{
    VstMidiEvent ev;
    /** The block it arrived for */
    int block;
};
struct Call
{
    VstInt32 numEvents;
    VstIntPtr reserved;
    VstEvent *events[CALL_MAX + 1];
};

static int kindOf(const VstMidiEvent &e) { return (unsigned char)e.midiData[0] & 0xf0; }
static int d1Of(const VstMidiEvent &e) { return (unsigned char)e.midiData[1]; }
static int d2Of(const VstMidiEvent &e) { return (unsigned char)e.midiData[2]; }
/** An all-notes-off (CC 123 to 127) or all-sound-off (120) */
static bool resets(const VstMidiEvent &e) { return kindOf(e) == 0xb0 && (d1Of(e) == 120 || d1Of(e) > 0x7a); }
static bool startsNote(const VstMidiEvent &e) { return kindOf(e) == 0x90 && d2Of(e); }
static bool endsNote(const VstMidiEvent &e) { return kindOf(e) == 0x80 || (kindOf(e) == 0x90 && !d2Of(e)); }
/** Takes a place in the instrument's list of the block's notes: a note, a pedal, Reset All Controllers (it lets the pedal up) */
static bool takesNote(const VstMidiEvent &e)
{
    int d1 = d1Of(e);
    return kindOf(e) == 0x80 || kindOf(e) == 0x90 || (kindOf(e) == 0xb0 && (d1 == 64 || d1 == 66 || d1 == 121));
}
/** Only sets a value (a controller, the bend, pressure): of two of a kind waiting, the last is all that counts */
static bool setsValue(const VstMidiEvent &e)
{
    int k = kindOf(e), d1 = d1Of(e);
    return k == 0xe0 || k == 0xd0 || (k == 0xb0 && d1 < 120 && d1 != 64 && d1 != 66);
}

struct Inst
{
    AudioEffect *fx;
    float instrument;
    float buf[4][BB_BLOCK];
    char text[128];
    /** MIDI waiting to go in, in order. The instruments start their list of the block's notes
     * afresh on every processEvents call, so all of a block's messages go to them in one call
     * (at most 40 notes: the rest wait a block). Nothing that ends a note is ever dropped. */
    std::vector<Queued> *queue;
    Call call;
    /** Blocks processed */
    int block;
    /** An all-notes-off (CC 123 to 127) or all-sound-off (120) would cut the instruments' voices
     * dead (a click): the output fades out over `fadeLength` frames first, then the message goes
     * in while silent, and the output stays silent for `muteLength` more while what's left of the
     * voices (the DX10's, the pianos') dies away. A new note waits for the quiet to end (40 ms at
     * most) and plays from there, so it never starts over the old voices' tails. */
    VstMidiEvent reset;
    int fading, fadeLength, muted, muteLength;
};

static std::string json;
static std::string esc(const char *s)
{
    std::string o;
    for (; *s; s++)
    {
        if (*s == '"' || *s == '\\') o += '\\';
        o += *s;
    }
    return o;
}

BB_EXPORT int bb_count() { return count; }

BB_EXPORT const char *bb_info(int i)
{
    if (i < 0 || i >= count) return "";
    json = std::string("{\"name\":\"") + esc(defs[i].name) + "\",\"category\":\"" + esc(defs[i].category) + "\",\"about\":\"" +
           esc(defs[i].about) + "\",\"instrument\":" + std::to_string(defs[i].instrument > 0 ? 1 : 0) + "}";
    return json.c_str();
}

BB_EXPORT int bb_create(int i, float sampleRate)
{
    if (i < 0 || i >= count) return 0;
    auto *in = new Inst();
    memset(in->buf, 0, sizeof(in->buf));
    in->instrument = defs[i].instrument;
    in->fadeLength = (int)(sampleRate * 0.01f) + 1;
    in->muteLength = (int)(sampleRate * 0.03f) + 1;
    in->fx = defs[i].make(nullptr);
    in->fx->setSampleRate(sampleRate);
    in->fx->setBlockSize(BB_BLOCK);
    // As a host switches a plug-in on: suspend, then resume (which clears its buffers)
    in->fx->suspend();
    in->fx->resume();
    // Every parameter set once, as the host sets them when it gives a plugin its settings back
    // (a few work out their starting state otherwise: Ambience, Detune, Limiter), so a fresh
    // plugin sounds the same as one given its own settings
    for (int p = 0; p < in->fx->numParams; p++) in->fx->setParameter(p, in->fx->getParameter(p));
    in->queue = new std::vector<Queued>();
    in->queue->reserve(QUEUE);
    return (int)(intptr_t)in;
}

#define IN ((Inst *)(intptr_t)h)
BB_EXPORT void bb_destroy(int h)
{
    delete IN->fx;
    delete IN->queue;
    delete IN;
}
BB_EXPORT int bb_params(int h) { return IN->fx->numParams; }
BB_EXPORT float bb_get(int h, int i) { return IN->fx->getParameter(i); }
BB_EXPORT void bb_set(int h, int i, float v) { IN->fx->setParameter(i, v); }
BB_EXPORT const char *bb_param_name(int h, int i)
{
    char raw[128] = {0};
    IN->fx->getParameterName(i, raw);
    tidy(raw, IN->text, sizeof(IN->text));
    return IN->text;
}
BB_EXPORT const char *bb_param_display(int h, int i)
{
    char value[64] = {0}, label[64] = {0}, v[64], l[64], both[130];
    IN->fx->getParameterDisplay(i, value);
    IN->fx->getParameterLabel(i, label);
    tidy(value, v, sizeof(v));
    tidy(label, l, sizeof(l));
    snprintf(both, sizeof(both), l[0] ? "%s %s" : "%s", v, l);
    strncpy(IN->text, both, sizeof(IN->text) - 1);
    return IN->text;
}
BB_EXPORT float *bb_buffer(int h, int w) { return IN->buf[w & 3]; }
/**
 * Hand the plug-in the messages that can go in now, in one call (they all fall on its next frame):
 * up to a note that must wait for the quiet after a reset, or past the 40 notes it keeps. A reset
 * starts the fade instead (see Inst). A note-off for a note that waited and goes in in the same
 * call waits a block, so the note sounds.
 */
static void sendQueued(Inst *in)
{
    std::vector<Queued> &q = *in->queue;
    if (q.empty()) return;
    in->call.numEvents = 0;
    int notes = 0, done = 0;
    bool started[128] = {};
    for (; done < (int)q.size() && in->call.numEvents < CALL_MAX; done++)
    {
        VstMidiEvent *ev = &q[done].ev;
        bool waited = q[done].block < in->block;
        if (resets(*ev))
        {
            // Fade out first (a second reset during the fade joins it)
            if (!in->fading && !in->muted) in->fading = in->fadeLength;
            in->reset = *ev;
            continue;
        }
        if (startsNote(*ev) && (in->fading || in->muted)) break;
        if (takesNote(*ev))
        {
            if (notes >= NOTES_MAX || (waited && endsNote(*ev) && started[d1Of(*ev) & 127])) break;
            notes++;
        }
        if (startsNote(*ev)) started[d1Of(*ev) & 127] = true;
        in->call.events[in->call.numEvents++] = (VstEvent *)ev;
    }
    if (in->call.numEvents) in->fx->processEvents((VstEvents *)&in->call);
    q.erase(q.begin(), q.begin() + done);
}

/** Play `frames` frames from `at` in the block, with the fade and the quiet after a reset. */
static void render(Inst *in, int at, int frames)
{
    float *ins[2] = {in->buf[0] + at, in->buf[1] + at};
    float *outs[2] = {in->buf[2] + at, in->buf[3] + at};
    in->fx->processReplacing(ins, outs, frames);
    if (in->instrument > 0 && in->instrument != 1)
        for (int i = 0; i < frames; i++) outs[0][i] *= in->instrument, outs[1][i] *= in->instrument;
    if (in->fading || in->muted)
    {
        int i = 0;
        for (; i < frames && in->fading; i++, in->fading--)
        {
            float g = (float)in->fading / (float)in->fadeLength;
            outs[0][i] *= g, outs[1][i] *= g;
        }
        if (!in->fading && !in->muted)
        {
            // Faded out: now the reset, unheard
            struct
            {
                VstInt32 numEvents;
                VstIntPtr reserved;
                VstEvent *events[2];
            } evs = {1, 0, {(VstEvent *)&in->reset, nullptr}};
            in->fx->processEvents((VstEvents *)&evs);
            in->muted = in->muteLength;
        }
        for (; i < frames && in->muted; i++, in->muted--) outs[0][i] = outs[1][i] = 0;
    }
}

BB_EXPORT void bb_process(int h, int frames)
{
    Inst *in = IN;
    sendQueued(in);
    int at = 0;
    while (at < frames)
    {
        int n = frames - at;
        // (A note waiting for the quiet goes in where the quiet ends, in this block)
        bool waiting = !in->queue->empty() && !in->fading && in->muted;
        if (waiting && in->muted < n) n = in->muted;
        render(in, at, n);
        at += n;
        if (waiting && at < frames) sendQueued(in);
    }
    in->block++;
}

BB_EXPORT void bb_midi(int h, int status, int d1, int d2)
{
    Inst *in = IN;
    if (!in->instrument) return;
    VstMidiEvent ev = {};
    ev.type = kVstMidiType;
    ev.byteSize = sizeof(VstMidiEvent);
    ev.deltaFrames = 0;
    ev.midiData[0] = (char)status;
    ev.midiData[1] = (char)d1;
    ev.midiData[2] = (char)d2;
    std::vector<Queued> &q = *in->queue;
    // A burst (a lane's values all at once): a controller already waiting, with only values
    // after it, just takes the new value
    if (q.size() >= QUEUE && setsValue(ev))
        for (int j = (int)q.size() - 1; j >= 0 && setsValue(q[j].ev); j--)
            if (kindOf(q[j].ev) == kindOf(ev) && (kindOf(ev) != 0xb0 || d1Of(q[j].ev) == d1))
            {
                q[j].ev = ev;
                return;
            }
    // (Past that, a note-off, a pedal or a reset still goes in: nothing is left hanging)
    if (q.size() >= QUEUE_MAX && !endsNote(ev) && !resets(ev) && !(kindOf(ev) == 0xb0 && (d1 == 64 || d1 == 66 || d1 == 121))) return;
    q.push_back({ev, in->block});
}

BB_EXPORT int bb_programs(int h) { return IN->fx->numPrograms > 1 ? IN->fx->numPrograms : 0; }
BB_EXPORT const char *bb_program_name(int h, int i)
{
    char raw[128] = {0};
    if (!IN->fx->getProgramNameIndexed(0, i, raw) && IN->fx->getProgram() == i) IN->fx->getProgramName(raw);
    tidy(raw, IN->text, sizeof(IN->text));
    return IN->text;
}
BB_EXPORT void bb_set_program(int h, int i)
{
    if (i >= 0 && i < IN->fx->numPrograms) IN->fx->setProgram(i);
}
BB_EXPORT int bb_get_program(int h) { return IN->fx->getProgram(); }
