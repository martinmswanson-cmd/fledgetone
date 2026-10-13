/*
 * There are no files in the browser's audio thread. These answer Surge's file lookups with "not
 * found" (instead of the standalone runtime's "not implemented", which it treats as an error), so
 * it carries on with its built-in defaults. They replace the runtime's weak stand-ins.
 */
#include <errno.h>
#include <sys/stat.h>
#include <sys/types.h>
int __syscall_openat(int dirfd, const char *path, int flags, ...) { return -ENOENT; }
int __syscall_stat64(const char *path, struct stat *buf) { return -ENOENT; }
int __syscall_lstat64(const char *path, struct stat *buf) { return -ENOENT; }
int __syscall_newfstatat(int dirfd, const char *path, struct stat *buf, int flags) { return -ENOENT; }
int __syscall_mkdirat(int dirfd, const char *path, mode_t mode) { return -EACCES; }
