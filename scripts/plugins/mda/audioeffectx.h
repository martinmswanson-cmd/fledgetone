/*
 * A minimal stand-in for the plug-in base class the mda plug-ins were written against, written
 * for Fledgetone (MIT, like the plug-ins). It provides only what the mda sources use: the
 * plug-in's own processing, parameters, programs and MIDI events, with a host that is
 * bb_mda.cpp. No host callbacks: the "audioMaster" is ignored.
 */
#pragma once
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <math.h>

typedef int32_t VstInt32;
typedef intptr_t VstIntPtr;
typedef void *audioMasterCallback;

enum
{
    kVstMaxProgNameLen = 24,
    kVstMaxParamStrLen = 8,
    kVstMaxVendorStrLen = 64,
    kVstMaxProductStrLen = 64,
    kVstMaxEffectNameLen = 32,
    kVstMaxLabelLen = 64,
    kVstMaxShortLabelLen = 8,
};

enum
{
    kVstMidiType = 1
};

struct VstEvent
{
    VstInt32 type, byteSize, deltaFrames, flags;
    char data[16];
};

struct VstMidiEvent
{
    VstInt32 type, byteSize, deltaFrames, flags, noteLength, noteOffset;
    char midiData[4];
    char detune, noteOffVelocity, reserved1, reserved2;
};

struct VstEvents
{
    VstInt32 numEvents;
    VstIntPtr reserved;
    VstEvent *events[2];
};

enum
{
    kVstPinIsActive = 1,
    kVstPinIsStereo = 2,
    kVstPinUseSpeaker = 4
};

struct VstPinProperties
{
    char label[kVstMaxLabelLen];
    VstInt32 flags;
    VstInt32 arrangementType;
    char shortLabel[kVstMaxShortLabelLen];
    char future[48];
};

enum VstPlugCategory
{
    kPlugCategUnknown = 0,
    kPlugCategEffect,
    kPlugCategSynth,
    kPlugCategAnalysis,
    kPlugCategMastering,
    kPlugCategSpacializer,
    kPlugCategRoomFx,
    kPlugSurroundFx,
    kPlugCategRestoration,
    kPlugCategOfflineProcess,
    kPlugCategShell,
    kPlugCategGenerator
};

#define DECLARE_VST_DEPRECATED(x) x

class AudioEffect
{
  public:
    AudioEffect(audioMasterCallback, VstInt32 progs, VstInt32 params) : numPrograms(progs), numParams(params) {}
    virtual ~AudioEffect() {}

    float sampleRate = 44100.f;
    VstInt32 blockSize = 128;
    VstInt32 numPrograms, numParams, curProgram = 0;
    VstInt32 numInputs = 2, numOutputs = 2;
    bool synth = false;

    virtual void setNumInputs(VstInt32 n) { numInputs = n; }
    virtual void setNumOutputs(VstInt32 n) { numOutputs = n; }
    virtual void setUniqueID(VstInt32) {}
    virtual void canProcessReplacing(bool = true) {}
    virtual void canDoubleReplacing(bool = true) {}
    virtual void programsAreChunks(bool = true) {}
    virtual void setInitialDelay(VstInt32) {}
    virtual void isSynth(bool s = true) { synth = s; }
    virtual void canMono(bool = true) {}
    virtual void noTail(bool = true) {}
    virtual void wantEvents(VstInt32 = 1) {}
    virtual void hasVu(bool = true) {}
    virtual void hasClip(bool = true) {}
    virtual void needIdle() {}
    virtual void updateDisplay() {}
    virtual bool ioChanged() { return false; }
    virtual float getSampleRate() { return sampleRate; }
    virtual VstInt32 getBlockSize() { return blockSize; }
    virtual void setSampleRate(float sr) { sampleRate = sr; }
    virtual void setBlockSize(VstInt32 b) { blockSize = b; }
    virtual void suspend() {}
    virtual void resume() {}

    virtual void process(float **, float **, VstInt32) {}
    virtual void processReplacing(float **, float **, VstInt32) = 0;
    virtual VstInt32 processEvents(VstEvents *) { return 0; }

    virtual void setProgram(VstInt32 p) { curProgram = p; }
    virtual VstInt32 getProgram() { return curProgram; }
    virtual void setProgramName(char *) {}
    virtual void getProgramName(char *name) { name[0] = 0; }
    virtual bool getProgramNameIndexed(VstInt32, VstInt32, char *) { return false; }
    virtual bool copyProgram(VstInt32) { return false; }

    virtual void setParameter(VstInt32, float) {}
    virtual float getParameter(VstInt32) { return 0; }
    virtual void getParameterLabel(VstInt32, char *label) { label[0] = 0; }
    virtual void getParameterDisplay(VstInt32, char *text) { text[0] = 0; }
    virtual void getParameterName(VstInt32, char *text) { text[0] = 0; }

    virtual bool getInputProperties(VstInt32, VstPinProperties *) { return false; }
    virtual bool getOutputProperties(VstInt32, VstPinProperties *) { return false; }
    virtual bool getEffectName(char *) { return false; }
    virtual bool getVendorString(char *) { return false; }
    virtual bool getProductString(char *) { return false; }
    virtual VstInt32 getVendorVersion() { return 1; }
    virtual VstInt32 canDo(char *) { return 0; }
    virtual VstPlugCategory getPlugCategory() { return kPlugCategEffect; }
    virtual VstInt32 getNumMidiInputChannels() { return 0; }
    virtual VstInt32 getNumMidiOutputChannels() { return 0; }
    virtual VstInt32 getTailSize() { return 0; }
};

typedef AudioEffect AudioEffectX;

inline void vst_strncpy(char *dst, const char *src, size_t n)
{
    strncpy(dst, src, n);
    dst[n] = 0;
}
inline void float2string(float f, char *t, VstInt32 n) { snprintf(t, n + 1, "%.3g", f); }
inline void int2string(VstInt32 i, char *t, VstInt32 n) { snprintf(t, n + 1, "%d", (int)i); }
inline void dB2string(float v, char *t, VstInt32 n)
{
    if (v <= 0) snprintf(t, n + 1, "-inf");
    else snprintf(t, n + 1, "%.1f", 20.f * log10f(v));
}
inline void Hz2string(float samples, char *t, VstInt32 n, float sr = 44100.f)
{
    if (!samples) snprintf(t, n + 1, "0");
    else snprintf(t, n + 1, "%.0f", sr / samples);
}
inline void ms2string(float samples, char *t, VstInt32 n, float sr = 44100.f) { snprintf(t, n + 1, "%.1f", samples * 1000.f / sr); }

AudioEffect *createEffectInstance(audioMasterCallback audioMaster);
