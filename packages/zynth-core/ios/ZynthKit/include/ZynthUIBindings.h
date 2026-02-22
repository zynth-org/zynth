#import <Foundation/Foundation.h>
#import <dispatch/dispatch.h>

#ifdef __cplusplus
#include <jsi/jsi.h>
#endif

@class ZynthUIManager;

NS_ASSUME_NONNULL_BEGIN

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
void ZynthUIInvokePressEventWithRuntime(void *runtimePtr,
                                        int nodeId,
                                        const char *name,
                                        double x,
                                        double y,
                                        double screenX,
                                        double screenY,
                                        double durationMs,
                                        double timestampMs,
                                        bool cancelled);
void ZynthUIInvokeEventWithRuntime(void *runtimePtr,
                                   int nodeId,
                                   const char *name,
                                   NSDictionary *payload);
void ZynthUIInvokeLayoutEventWithRuntime(void *runtimePtr,
                                         int nodeId,
                                         double x,
                                         double y,
                                         double width,
                                         double height);
void ZynthUISetJSQueue(dispatch_queue_t _Nullable queue);
void ZynthUIRegisterRuntimeForManager(ZynthUIManager *manager, void * _Nullable runtimePtr);
void * _Nullable ZynthUIRuntimeForManager(ZynthUIManager *manager);
#ifdef __cplusplus
}

void ZynthInstallUIBindings(facebook::jsi::Runtime &rt, ZynthUIManager *manager);
#endif

NS_ASSUME_NONNULL_END
