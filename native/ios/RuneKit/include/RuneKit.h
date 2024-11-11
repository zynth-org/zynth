#import <Foundation/Foundation.h>
#import <JavaScriptCore/JavaScriptCore.h>
#import "SNUIManager.h"
#import "HermesRuntimeHost.h"
#import "RuneJSInvoker.h"

#ifdef __cplusplus
extern "C" {
#endif
void SNInstallBindings(JSContext *ctx, SNUIManager *mgr);
void RuneInstallBindings(JSContext *ctx, SNUIManager *mgr);
#ifdef __cplusplus
}
#endif
