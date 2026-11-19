// Start the folder selector without initializing Chromium or creating its default profile.
#include <mach-o/dyld.h>
#include <limits.h>
#include <stdlib.h>
#include <unistd.h>
#include <stdio.h>
#include <string.h>
int main(int argc, char **argv) {
  char executable[PATH_MAX], directory[PATH_MAX], runtime[PATH_MAX], script[PATH_MAX];
  uint32_t size = sizeof(executable);
  if (_NSGetExecutablePath(executable, &size) || !realpath(executable, directory)) return 1;
  char *slash = strrchr(directory, '/');
  if (!slash) return 1;
  *slash = 0;
  if (snprintf(runtime, sizeof(runtime), "%s/sesshuttle-runtime", directory) >= sizeof(runtime) ||
      snprintf(script, sizeof(script), "%s/../Resources/sesshuttle-start.cjs", directory) >= sizeof(script)) return 1;
  char **args = calloc(argc + 2, sizeof(*args));
  if (!args) return 1;
  args[0] = runtime;
  args[1] = script;
  for (int i = 1; i < argc; i++) args[i + 1] = argv[i];
  setenv("ELECTRON_RUN_AS_NODE", "1", 1);
  execv(runtime, args);
  perror("sesshuttle");
  return 1;
}
