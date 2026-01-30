#import "ZynthRuntime.h"
#import "ZynthHermesRuntimeHost.h"
#import "ZynthUIManager.h"
#import "ZynthUIManager+Surface.h"
#if DEBUG
#import <objc/message.h>
#endif

@interface ZynthRuntime (Modules)
- (void)installDefaultModules;
@end

@interface ZynthRuntime ()
@property(nonatomic, weak) UIView *rootView;
@property(nonatomic, strong) ZynthUIManager *manager;
@property(nonatomic, strong) ZynthHermesRuntimeHost *runtime;
@end

@implementation ZynthRuntime

- (instancetype)initWithRootView:(UIView *)rootView {
  self = [super init];
  if (self) {
    _rootView = rootView;
    _manager = [[ZynthUIManager alloc] initWithRootView:rootView];
    _runtime = [[ZynthHermesRuntimeHost alloc] initWithUIManager:_manager];
    [self installDefaultModules];
#if DEBUG
    NSLog(@"[ZynthRuntime] DEBUG init: attempting ZynthDevSupport hook");
    Class devSupport = NSClassFromString(@"ZynthDevSupport");
    SEL selector = @selector(configureWithRuntime:);
    if (devSupport && [devSupport respondsToSelector:selector]) {
      ((void (*)(id, SEL, id))objc_msgSend)(devSupport, selector, self);
      NSLog(@"[ZynthRuntime] ZynthDevSupport configured");
    } else {
      NSLog(@"[ZynthRuntime] ZynthDevSupport not found in runtime");
    }
#endif
    __weak ZynthHermesRuntimeHost *weakRuntime = _runtime;
    [_manager setFrameProfiler:^(NSTimeInterval frameMs,
                                 NSTimeInterval layoutMs,
                                 BOOL overBudget,
                                 NSUInteger nodeCount) {
      ZynthHermesRuntimeHost *strongRuntime = weakRuntime;
      if (!strongRuntime) return;
      [strongRuntime callGlobal:@"__zynth_reportFrame"
                           args:@[
                             @(frameMs),
                             @(layoutMs),
                             @(overBudget),
                             @(nodeCount),
                           ]];
    }];
  }
  return self;
}

- (int)rootSurfaceId {
  return [self.manager rootSurfaceId];
}

- (BOOL)loadInitialBundleWithJsBundleURL:(NSURL *_Nullable)url
                                   error:(NSError *_Nullable *_Nullable)error {
  if (!url) {
    if (error) {
      NSDictionary *info = @{ NSLocalizedDescriptionKey : @"Missing JS bundle URL" };
      *error = [NSError errorWithDomain:@"ZynthRuntime" code:1 userInfo:info];
    }
    return NO;
  }
  NSError *readError = nil;
  NSString *code = [NSString stringWithContentsOfURL:url
                                            encoding:NSUTF8StringEncoding
                                               error:&readError];
  if (!code) {
    if (error) {
      *error = readError ?: [NSError errorWithDomain:@"ZynthRuntime" code:2 userInfo:nil];
    }
    return NO;
  }
  return [self.runtime evaluateString:code sourceURL:url.absoluteString error:error];
}

- (void)startWithRootId:(int)rootId {
  [self.runtime callGlobal:@"__startApp" args:@[ @(rootId) ]];
}

- (void)emitEventWithName:(NSString *)name payload:(id)payload {
  NSString *trimmed = [name stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if (trimmed.length == 0) return;
  id body = payload ?: [NSNull null];
  [self.runtime callGlobalObjectMethod:@"ZynthNativeEmitter" method:@"emit" args:@[ trimmed, body ]];
}

- (int)registerSurfaceWithRootView:(UIView *)rootView {
  return [self.manager registerSurfaceWithRootView:rootView].intValue;
}

- (void)unregisterSurfaceWithId:(int)surfaceId {
  [self.manager unregisterSurface:surfaceId];
}

- (void)setActiveSurface:(int)surfaceId {
  [self.manager setSurface:@(surfaceId)];
}

- (void)callGlobal:(NSString *)name args:(NSArray *)args {
  NSArray *payload = args ?: @[];
  [self.runtime callGlobal:name args:payload];
}

- (BOOL)evaluateScript:(NSString *)code
             sourceURL:(NSString *_Nullable)sourceURL
                 error:(NSError *_Nullable *_Nullable)error {
  return [self.runtime evaluateString:code sourceURL:sourceURL error:error];
}

- (void)flush {
  [self.manager flush];
}

- (void)installModuleBridge:(id<ZynthModuleBridge>)bridge constants:(NSDictionary<NSString *,id> *)constants {
  [self.runtime installModuleBridge:bridge constants:constants];
}

- (void)destroy {
  // Phase 1 scaffold.
}

@end
