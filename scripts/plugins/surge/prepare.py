#!/usr/bin/env python3
"""Small changes Surge XT's sources need to build for WebAssembly: prepare.py <surge checkout>

Each is keyed to __EMSCRIPTEN__, so the sources still build natively. Safe to run twice.
"""
import sys, os
S = sys.argv[1]

def patch(rel, old, new):
    p = os.path.join(S, rel)
    s = open(p).read()
    if new in s:
        return
    if old not in s:
        sys.exit(f'{rel}: expected text not found (has the source changed?)')
    open(p, 'w').write(s.replace(old, new, 1))

# The CPU feature checks are x86 (cpuid, the MXCSR register): WebAssembly has neither
patch('libs/sst/sst-plugininfra/src/cpufeatures.cpp',
      '#if defined(__SSE2__) || defined(_M_AMD64) || defined(_M_X64) ||',
      '#if !defined(__EMSCRIPTEN__) && (defined(__SSE2__) || defined(_M_AMD64) || defined(_M_X64)) ||')
# No stack traces in WebAssembly
patch('libs/sst/sst-plugininfra/src/misc_linux.cpp', '#include <execinfo.h>', '#ifndef __EMSCRIPTEN__\n#include <execinfo.h>\n#endif')
patch('libs/sst/sst-plugininfra/src/misc_linux.cpp', '    void *callstack[128];', '#ifdef __EMSCRIPTEN__\n    return "";\n#else\n    void *callstack[128];')
patch('libs/sst/sst-plugininfra/src/misc_linux.cpp', '    free(strs);\n    return oss.str();', '    free(strs);\n    return oss.str();\n#endif')
# No shared library to find the install folder from: a made-up one, with nothing in it
patch('libs/sst/sst-plugininfra/src/paths_linux.cpp',
      'fs::path sharedLibraryBinaryPath()\n{\n',
      'fs::path sharedLibraryBinaryPath()\n{\n#ifdef __EMSCRIPTEN__\n    return fs::path{"/surge/lib/surge.wasm"};\n#endif\n')
