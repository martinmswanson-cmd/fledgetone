// The two helpers Dragonfly's DSP uses from its plugin framework (DPF), and nothing else.
#pragma once
#include <cmath>
template <typename T> static inline bool d_isEqual(const T &a, const T &b) { return std::abs(a - b) < 1e-7; }
template <typename T> static inline bool d_isNotEqual(const T &a, const T &b) { return std::abs(a - b) >= 1e-7; }
