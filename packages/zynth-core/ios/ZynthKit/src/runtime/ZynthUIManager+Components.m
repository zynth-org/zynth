#import "ZynthUIManager+Components.h"
#import <objc/runtime.h>

static const void *kZynthJSInvokerKey = &kZynthJSInvokerKey;
static const void *kZynthRuntimeKey = &kZynthRuntimeKey;

@implementation ZynthUIManager (Components)

- (id<ZynthJSInvoker>)jsInvoker {
  return objc_getAssociatedObject(self, kZynthJSInvokerKey);
}

- (void)setJsInvoker:(id<ZynthJSInvoker>)jsInvoker {
  objc_setAssociatedObject(self, kZynthJSInvokerKey, jsInvoker, OBJC_ASSOCIATION_ASSIGN);
}

- (ZynthRuntime *)zynthRuntime {
  return objc_getAssociatedObject(self, kZynthRuntimeKey);
}

- (void)setZynthRuntime:(ZynthRuntime *)zynthRuntime {
  objc_setAssociatedObject(self, kZynthRuntimeKey, zynthRuntime, OBJC_ASSOCIATION_ASSIGN);
}

@end
