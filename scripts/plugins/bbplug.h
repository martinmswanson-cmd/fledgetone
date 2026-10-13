/*
 * The interface every compiled plugin family exports to Bo's Beatbox (see
 * src/audio/plugins/processor.js). A family is one WebAssembly module holding many plugins:
 * the worklet makes an instance of a plugin by index, sets its parameters (0 to 1), fills its
 * input buffers, processes a block and reads its outputs. Instruments also take MIDI.
 */
#pragma once
#include <stdint.h>

#define BB_EXPORT extern "C" __attribute__((used, visibility("default")))
/** The most frames processed at once (a render quantum). */
#define BB_BLOCK 128

/* Every family implements these: */
BB_EXPORT int bb_count();
/** JSON describing plugin `index`: {"name","category","about","instrument","params","tags"} */
BB_EXPORT const char *bb_info(int index);
BB_EXPORT int bb_create(int index, float sampleRate);
BB_EXPORT void bb_destroy(int h);
BB_EXPORT int bb_params(int h);
BB_EXPORT float bb_get(int h, int i);
BB_EXPORT void bb_set(int h, int i, float v);
BB_EXPORT const char *bb_param_name(int h, int i);
/** The value of parameter i as the plugin shows it ("-3.0 dB") */
BB_EXPORT const char *bb_param_display(int h, int i);
/** Buffers of BB_BLOCK floats: 0, 1 the input (left, right); 2, 3 the output */
BB_EXPORT float *bb_buffer(int h, int which);
BB_EXPORT void bb_process(int h, int frames);
/** A MIDI message (instruments; effects ignore it) */
BB_EXPORT void bb_midi(int h, int status, int data1, int data2);
/** Presets ("programs") the plugin comes with: how many, each one's name, choose one (which sets
 * its parameters), and which is chosen. A plugin without any says 0. */
BB_EXPORT int bb_programs(int h);
BB_EXPORT const char *bb_program_name(int h, int i);
BB_EXPORT void bb_set_program(int h, int i);
BB_EXPORT int bb_get_program(int h);
