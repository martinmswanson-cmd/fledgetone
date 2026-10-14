/*
 * The few classes Faust-generated code needs (written for Fledgetone, MIT): a DSP base class,
 * the UI interface its controls are listed through, and Meta for its declarations.
 */
#pragma once
#include <math.h>
#include <string.h>
#include <algorithm>
#include <cmath>
#include <cstdint>

#ifndef FAUSTFLOAT
#define FAUSTFLOAT float
#endif

struct Soundfile;
struct Meta
{
    virtual ~Meta() {}
    virtual void declare(const char *, const char *) {}
};

struct UI
{
    virtual ~UI() {}
    virtual void openTabBox(const char *) {}
    virtual void openHorizontalBox(const char *) {}
    virtual void openVerticalBox(const char *) {}
    virtual void closeBox() {}
    virtual void addButton(const char *label, FAUSTFLOAT *zone) = 0;
    virtual void addCheckButton(const char *label, FAUSTFLOAT *zone) = 0;
    virtual void addVerticalSlider(const char *label, FAUSTFLOAT *zone, FAUSTFLOAT init, FAUSTFLOAT min, FAUSTFLOAT max, FAUSTFLOAT step) = 0;
    virtual void addHorizontalSlider(const char *label, FAUSTFLOAT *zone, FAUSTFLOAT init, FAUSTFLOAT min, FAUSTFLOAT max, FAUSTFLOAT step) = 0;
    virtual void addNumEntry(const char *label, FAUSTFLOAT *zone, FAUSTFLOAT init, FAUSTFLOAT min, FAUSTFLOAT max, FAUSTFLOAT step) = 0;
    virtual void addHorizontalBargraph(const char *, FAUSTFLOAT *, FAUSTFLOAT, FAUSTFLOAT) {}
    virtual void addVerticalBargraph(const char *, FAUSTFLOAT *, FAUSTFLOAT, FAUSTFLOAT) {}
    virtual void addSoundfile(const char *, const char *, Soundfile **) {}
    virtual void declare(FAUSTFLOAT *, const char *, const char *) {}
};

struct FaustDSP
{
    virtual ~FaustDSP() {}
    virtual int getNumInputs() = 0;
    virtual int getNumOutputs() = 0;
    virtual void buildUserInterface(UI *ui) = 0;
    virtual int getSampleRate() = 0;
    virtual void init(int sample_rate) = 0;
    virtual void instanceInit(int sample_rate) = 0;
    virtual void instanceConstants(int sample_rate) = 0;
    virtual void instanceResetUserInterface() = 0;
    virtual void instanceClear() = 0;
    virtual FaustDSP *clone() = 0;
    virtual void metadata(Meta *m) = 0;
    virtual void compute(int count, FAUSTFLOAT **inputs, FAUSTFLOAT **outputs) = 0;
};
typedef FaustDSP dsp;
