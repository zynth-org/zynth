#import "ZynthUIManager+Components.h"
#import <objc/runtime.h>

static const void *kZynthJSInvokerKey = &kZynthJSInvokerKey;

@implementation ZynthUIManager (Components)

- (id<ZynthJSInvoker>)jsInvoker {
  return objc_getAssociatedObject(self, kZynthJSInvokerKey);
}

- (void)setJsInvoker:(id<ZynthJSInvoker>)jsInvoker {
  objc_setAssociatedObject(self, kZynthJSInvokerKey, jsInvoker, OBJC_ASSOCIATION_ASSIGN);
}

@end
