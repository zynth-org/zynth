#import <Foundation/Foundation.h>

#ifdef __cplusplus
#include <jsi/jsi.h>
#endif

@class ZynthUIManager;

#ifdef __cplusplus
extern "C" {
#endif
void ZynthUIInvokePressEvent(int nodeId,
                             const char *name,
                             double x,
                             double y,
                             double screenX,
                             double screenY,
                             double durationMs,
                             double timestampMs,
                             bool cancelled);
void ZynthUIInvokeLayoutEvent(int nodeId, double x, double y, double width, double height);
#ifdef __cplusplus
}

void ZynthInstallUIBindings(facebook::jsi::Runtime &rt, ZynthUIManager *manager);
#endif
