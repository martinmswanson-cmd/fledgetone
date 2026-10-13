/* The Dragonfly reverbs (Michael Willis, Rob van den Berg; GPL-3.0) as one plugin family. */
#include "../bbplug_impl.h"
BBPlugin *makeHall(float sr);
BBPlugin *makeRoom(float sr);
BBPlugin *makePlate(float sr);
BBPlugin *makeEarly(float sr);
static const BBDef defs[] = {
    {"Hall Reverb", "Reverb", "Lush, natural concert-hall reverb with early reflections and 25 rooms and halls as presets.", 0, makeHall},
    {"Room Reverb", "Reverb", "Natural room reverb, from small rooms to studios and chambers, with presets.", 0, makeRoom},
    {"Plate Reverb XL", "Reverb", "Plate and tank reverbs: bright, dense, shimmering. Eight presets.", 0, makePlate},
    {"Early Reflections", "Ambience", "Just the first reflections of a room: places a sound in a space without a tail.", 0, makeEarly},
};
BB_FAMILY(defs)
