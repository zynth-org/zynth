#import "ZynthRuntimeHostRegistry.h"
#import "ZynthHermesRuntimeHost.h"

static ZynthHermesRuntimeHost *gCurrentHost = nullptr;

void ZynthSetCurrentRuntimeHost(ZynthHermesRuntimeHost *host) {
  gCurrentHost = host;
}

ZynthHermesRuntimeHost *ZynthGetCurrentRuntimeHost(void) {
  return gCurrentHost;
}

