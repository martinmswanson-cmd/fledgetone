/*
 * A simple way to write a plugin family (see bbplug.h): subclass BBPlugin for each plugin, list
 * them in a BBDef array and name it with BB_FAMILY, and compile bbplug_impl.cpp with the family. Parameters are 0 to 1 here; each
 * plugin maps them to its own ranges in apply() and shows them in display().
 */
#pragma once
#include "bbplug.h"
#include <stdio.h>
#include <string.h>

#define BB_MAX_PARAMS 64

struct BBPlugin
{
    virtual ~BBPlugin() {}
    /** Parameter names (a fixed list) */
    virtual int params() = 0;
    virtual const char *paramName(int i) = 0;
    /** Parameter i's value as shown ("440 Hz") into out */
    virtual void display(int i, char *out, int size) = 0;
    /** Parameter i was set to v (0 to 1, already stored in values[i]) */
    virtual void apply(int i, float v) = 0;
    virtual void process(const float *inL, const float *inR, float *outL, float *outR, int frames) = 0;
    virtual void midi(int status, int data1, int data2) {}
    virtual int programs() { return 0; }
    virtual const char *programName(int) { return ""; }
    /** Choose preset i: set every parameter through set() */
    virtual void setProgram(int i) {}
    float values[BB_MAX_PARAMS] = {};
    int program = 0;
    void set(int i, float v)
    {
        if (i < 0 || i >= params() || i >= BB_MAX_PARAMS) return;
        values[i] = v < 0 ? 0 : v > 1 ? 1 : v;
        apply(i, values[i]);
    }
    /** Set every parameter from a list (presets and defaults) */
    void setAll(const float *v)
    {
        for (int i = 0; i < params(); i++) set(i, v[i]);
    }
};

struct BBDef
{
    const char *name, *category, *about;
    int instrument;
    BBPlugin *(*make)(float sampleRate);
};

/** A family's plugins: defined by BB_FAMILY(list) for one list, or by hand to combine several */
int bbFamilyCount();
const BBDef &bbFamilyDef(int i);
#define BB_FAMILY(list)                                                    \
    int bbFamilyCount() { return (int)(sizeof(list) / sizeof(list[0])); } \
    const BBDef &bbFamilyDef(int i) { return list[i]; }

/* Shared helpers for displays and mappings */
inline float bbLin(float v, float lo, float hi) { return lo + (hi - lo) * v; }
inline float bbExp(float v, float lo, float hi) { return lo * __builtin_powf(hi / lo, v); }
inline int bbIndex(float v, int n)
{
    int i = (int)(v * n);
    return i < 0 ? 0 : i >= n ? n - 1 : i;
}
/** MIDI note number to Hz */
inline float bbHz(float note) { return 440.f * __builtin_powf(2.f, (note - 69.f) / 12.f); }
