/*
 * setBfree (Fredrik Kilander, Robin Gareus, Will Panther; GPL-2.0-or-later) as a plugin family: the
 * tonewheel organ with percussion, scanner vibrato, overdrive, spring reverb and rotary speaker,
 * playing the upper manual. Settings go through setBfree's own named controls (0 to 127), the
 * way its LV2 plugin (b_synth/lv2.c) does; this file stands in for that one.
 */
#include "../bbplug_impl.h"
#include <math.h>
#include <stdlib.h>
extern "C" {
#include "cfgParser.h"
#include "global_inst.h"
#include "midi.h"
#include "program.h"
#include "state.h"
#include "vibrato.h"
}

/* What lv2.c defines for the rest of setBfree */
extern "C" {
double SampleRateD = 48000.0;
const ConfigDoc *mainDoc() { return NULL; }
int mainConfig(ConfigContext *) { return 0; }
}

namespace {
enum { BARS = 9, PERC = 9, PERC_VOL, PERC_DECAY, PERC_HARM, VIB, VIB_TYPE, ROTARY, DRIVE_ON, DRIVE, CHARACTER, REVERB, VOLUME, COUNT };
const char *names[COUNT] = {"16'",          "5 1/3'",       "8'",         "4'",          "2 2/3'",    "2'",    "1 3/5'",
                            "1 1/3'",       "1'",           "Percussion", "Perc volume", "Perc decay", "Perc harmonic",
                            "Vibrato",      "Vibrato type", "Rotary speed", "Overdrive", "Drive",     "Character",
                            "Reverb",       "Volume"};
const char *vibTypes[] = {"V1", "C1", "V2", "C2", "V3", "C3"};
const char *speeds[] = {"Stop", "Slow", "Fast"};
const char *barCtl[] = {"upper.drawbar16", "upper.drawbar513", "upper.drawbar8", "upper.drawbar4", "upper.drawbar223",
                        "upper.drawbar2",  "upper.drawbar135", "upper.drawbar113", "upper.drawbar1"};
inline float bars(int b) { return b / 8.f; }
inline float pick(int i, int n) { return n > 1 ? (i + 0.5f) / n : 0; }

struct Preset { const char *name; const char *bars; int perc, percNormal, percFast, percThird, vib, vibType, speed, drive; float driveAmt, reverb, volume = 0.5f; };
const Preset presets[] = {
    {"Classic Three", "888000000", 0, 0, 0, 0, 0, 5, 1, 0, 0.3f, 0.15f},
    {"Jazz Percussion", "888000000", 1, 0, 1, 1, 0, 5, 1, 0, 0.3f, 0.15f},
    {"Full Organ", "888888888", 0, 0, 0, 0, 0, 5, 2, 1, 0.35f, 0.2f},
    {"Gospel Swell", "888800000", 0, 0, 0, 0, 1, 5, 2, 1, 0.3f, 0.2f},
    {"Mellow Ballad", "008500000", 0, 0, 0, 0, 1, 5, 1, 0, 0.3f, 0.25f, 0.69f},
    {"Rock Drive", "888000000", 0, 0, 0, 0, 0, 5, 2, 1, 0.75f, 0.12f},
    {"Funk Stabs", "888800000", 1, 1, 1, 1, 0, 5, 0, 1, 0.45f, 0.1f},
    {"Bright Whistle", "888000888", 0, 0, 0, 0, 1, 5, 2, 0, 0.3f, 0.2f, 0.42f},
    {"Soft Flutes", "008000000", 0, 0, 0, 0, 1, 1, 1, 0, 0.3f, 0.3f, 0.82f},
    {"Hollow Chapel", "806000000", 0, 0, 0, 0, 1, 3, 0, 0, 0.3f, 0.35f, 0.66f},
    {"Click Bass", "800000000", 1, 1, 1, 0, 0, 5, 0, 0, 0.3f, 0.1f, 0.94f},
    {"Big Pipe", "876543210", 0, 0, 0, 0, 0, 5, 1, 0, 0.3f, 0.3f},
    {"Screaming Lead", "888888888", 1, 1, 1, 1, 0, 5, 2, 1, 1.0f, 0.1f},
};
const int presetCount = sizeof(presets) / sizeof(presets[0]);

/* Brings a three-note chord on 888000000 to about -21 dB RMS; the overdrive saturates to a level of
   its own about 11 dB below, so it gets its own make-up gain */
const float TRIM = 0.65f, DRIVE_TRIM = 3.6f;
/* Drive 0 to 1 is overdrive input gain 1 to 10 (setBfree's own lowest settings are near silent) */
inline int driveCC(float v) { return 13 + (int)lrintf(v * 114); }

struct Organ : BBPlugin
{
    b_instance inst = {};
    int offset = BUFFER_SIZE_SAMPLES;
    float gain = TRIM, level = 1;
    float bufA[BUFFER_SIZE_SAMPLES], bufB[BUFFER_SIZE_SAMPLES], bufC[BUFFER_SIZE_SAMPLES];
    float bufD[2][BUFFER_SIZE_SAMPLES], bufL[2][BUFFER_SIZE_SAMPLES];
    Organ(float sr)
    {
        SampleRateD = sr;
        inst.state = allocRunningConfig();
        inst.progs = allocProgs();
        inst.reverb = allocReverb();
        inst.whirl = allocWhirl();
        inst.midicfg = allocMidiCfg(inst.state);
        inst.synth = allocTonegen();
        inst.preamp = allocPreamp();
        initControllerTable(inst.midicfg);
        midiPrimeControllerMapping(inst.midicfg);
        initToneGenerator(inst.synth, inst.midicfg);
        initVibrato(inst.synth, inst.midicfg);
        initPreamp(inst.preamp, inst.midicfg);
        initReverb(inst.reverb, inst.midicfg, sr);
        initWhirl(inst.whirl, inst.midicfg, sr);
        initRunningConfig(inst.state, inst.midicfg);
        initMidiTables(inst.midicfg);
        ctl("swellpedal1", 127);
        setProgram(0);
    }
    ~Organ()
    {
        freeReverb(inst.reverb);
        freeWhirl(inst.whirl);
        freeToneGenerator(inst.synth);
        freeMidiCfg(inst.midicfg);
        freePreamp(inst.preamp);
        freeProgs(inst.progs);
        freeRunningConfig(inst.state);
    }
    void ctl(const char *name, int v) { callMIDIControlFunction(inst.midicfg, name, (unsigned char)(v < 0 ? 0 : v > 127 ? 127 : v)); }
    int params() override { return COUNT; }
    const char *paramName(int i) override { return names[i]; }
    void apply(int i, float v) override
    {
        bool on = v > 0.5f;
        if (i < BARS) { ctl(barCtl[i], 127 - (int)lrintf(rintf(v * 8) * 127.f / 8.f)); return; }
        switch (i)
        {
        case PERC: ctl("percussion.enable", on ? 127 : 0); break;
        case PERC_VOL: ctl("percussion.volume", on ? 0 : 127); break; // 127 is soft
        case PERC_DECAY: ctl("percussion.decay", on ? 127 : 0); break;
        case PERC_HARM: ctl("percussion.harmonic", on ? 0 : 127); break; // 127 is the second harmonic
        case VIB: ctl("vibrato.upper", on ? 127 : 0); break;
        case VIB_TYPE: ctl("vibrato.knob", bbIndex(v, 6) * 23); break;
        case ROTARY: ctl("rotary.speed-select", bbIndex(v, 3) * 4 * 15); break; // horn and drum both stop, slow or fast
        case DRIVE_ON: ctl("overdrive.enable", on ? 127 : 0); gain = TRIM * (on ? DRIVE_TRIM : 1); break;
        case DRIVE: ctl("overdrive.inputgain", driveCC(v)); break;
        case CHARACTER: ctl("overdrive.character", (int)lrintf(v * 127)); break;
        case REVERB: ctl("reverb.mix", (int)lrintf(v * 127)); break;
        case VOLUME: level = 4 * v * v; break; // 0.5 is as it comes, 1 is +12 dB
        }
    }
    void display(int i, char *out, int n) override
    {
        float v = values[i];
        if (i < BARS) { snprintf(out, n, "%d", (int)rintf(v * 8)); return; }
        bool on = v > 0.5f;
        switch (i)
        {
        case PERC: case VIB: case DRIVE_ON: snprintf(out, n, "%s", on ? "On" : "Off"); break;
        case PERC_VOL: snprintf(out, n, "%s", on ? "Normal" : "Soft"); break;
        case PERC_DECAY: snprintf(out, n, "%s", on ? "Fast" : "Slow"); break;
        case PERC_HARM: snprintf(out, n, "%s", on ? "Third" : "Second"); break;
        case VIB_TYPE: snprintf(out, n, "%s", vibTypes[bbIndex(v, 6)]); break;
        case ROTARY: snprintf(out, n, "%s", speeds[bbIndex(v, 3)]); break;
        case VOLUME: if (v <= 0) snprintf(out, n, "Off"); else snprintf(out, n, "%+.1f dB", 20 * log10f(4 * v * v)); break;
        default: snprintf(out, n, "%.0f%%", v * 100);
        }
    }
    void process(const float *, const float *, float *outL, float *outR, int frames) override
    {
        int done = 0;
        while (done < frames)
        {
            if (offset >= BUFFER_SIZE_SAMPLES)
            {
                offset = 0;
                oscGenerateFragment(inst.synth, bufA, BUFFER_SIZE_SAMPLES);
                preamp(inst.preamp, bufA, bufB, BUFFER_SIZE_SAMPLES);
                reverb(inst.reverb, bufB, bufC, BUFFER_SIZE_SAMPLES);
                whirlProc3(inst.whirl, bufC, bufL[0], bufL[1], bufD[0], bufD[1], BUFFER_SIZE_SAMPLES);
            }
            int n = frames - done;
            if (n > BUFFER_SIZE_SAMPLES - offset) n = BUFFER_SIZE_SAMPLES - offset;
            for (int s = 0; s < n; s++)
            {
                outL[done + s] = bufL[0][offset + s] * gain * level;
                outR[done + s] = bufL[1][offset + s] * gain * level;
            }
            done += n;
            offset += n;
        }
    }
    void midi(int status, int d1, int d2) override
    {
        int kind = status & 0xf0;
        if (kind == 0xe0) return; // a tonewheel organ doesn't bend
        uint8_t msg[3] = {(uint8_t)(kind == 0xb0 || kind == 0x80 || kind == 0x90 ? kind : status), (uint8_t)d1, (uint8_t)d2};
        if (kind == 0xb0 && (d1 == 120 || d1 == 123)) { midi_panic(&inst); return; }
        // Notes and controllers go to the upper manual (channel 1); a few CCs work as on the organ
        // (The wheel and the pedal move the speaker, not its setting: Reset All Controllers puts back the setting's speed)
        if (kind == 0xb0 && d1 == 1) { apply(ROTARY, d2 >= 64 ? pick(2, 3) : pick(1, 3)); return; } // mod wheel: rotary fast
        if (kind == 0xb0 && d1 == 64) { apply(ROTARY, d2 >= 64 ? pick(2, 3) : pick(1, 3)); return; } // sustain pedal: same, as a half-moon switch
        if (kind == 0xb0 && d1 == 11) { ctl("swellpedal1", d2); return; } // expression: the swell pedal
        if (kind == 0xb0 && d1 == 121)
        {
            // Reset All Controllers: as a fresh organ of this preset and settings is, the speaker at
            // its Rotary speed setting and the swell pedal open
            apply(ROTARY, values[ROTARY]);
            ctl("swellpedal1", 127);
            return;
        }
        if (kind == 0xb0) return;
        parse_raw_midi_data(&inst, msg, 3);
    }
    int programs() override { return presetCount; }
    const char *programName(int i) override { return i >= 0 && i < presetCount ? presets[i].name : ""; }
    void setProgram(int i) override
    {
        if (i < 0 || i >= presetCount) return;
        program = i;
        const Preset &p = presets[i];
        float v[COUNT];
        for (int b = 0; b < BARS; b++) v[b] = bars(p.bars[b] - '0');
        v[PERC] = p.perc;
        v[PERC_VOL] = p.percNormal;
        v[PERC_DECAY] = p.percFast;
        v[PERC_HARM] = p.percThird;
        v[VIB] = p.vib;
        v[VIB_TYPE] = pick(p.vibType, 6);
        v[ROTARY] = pick(p.speed, 3);
        v[DRIVE_ON] = p.drive;
        v[DRIVE] = p.driveAmt;
        v[CHARACTER] = 0.5f;
        v[REVERB] = p.reverb;
        v[VOLUME] = p.volume;
        setAll(v);
    }
};

BBPlugin *make(float sr) { return new Organ(sr); }
const BBDef defs[] = {
    {"Tonewheel Organ", "Organ", "Drawbar tonewheel organ with key click, percussion, scanner vibrato and chorus, overdrive, spring reverb and a rotary speaker (mod wheel or sustain pedal switches it to fast).", 1, make},
};
} // namespace
BB_FAMILY(defs)
