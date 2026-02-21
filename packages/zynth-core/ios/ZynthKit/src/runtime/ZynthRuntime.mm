#import "ZynthRuntime.h"
#import "ZynthHermesRuntimeHost.h"
#import "ZynthUIManager.h"
#import "ZynthUIManager+Components.h"
#import "ZynthUIManager+Surface.h"
#import "ZynthNativeErrorOverlayManager.h"
#if __has_include("ZynthKit-Swift.h")
#import "ZynthKit-Swift.h"
#endif
#if DEBUG
#import <objc/message.h>
#endif

@interface ZynthRuntime (Modules)
- (void)installDefaultModules;
@end

@protocol ZynthDevSupportProtocol <NSObject>
+ (void)configureWithRuntime:(id)runtime;
@end

@interface ZynthRuntime ()
@property(nonatomic, weak) UIView *rootView;
@property(nonatomic, strong) ZynthUIManager *uiManager;
@property(nonatomic, strong) ZynthHermesRuntimeHost *runtime;
@end

@implementation ZynthRuntime

- (instancetype)initWithRootView:(UIView *)rootView {
  self = [super init];
  if (self) {
    _rootView = rootView;
    _bridgeSessionId = [[NSUUID UUID] UUIDString];
    _uiManager = [[ZynthUIManager alloc] initWithRootView:rootView];
    _uiManager.zynthRuntime = self;
    _runtime = [[ZynthHermesRuntimeHost alloc] initWithUIManager:_uiManager];
    [[ZynthNativeErrorOverlayManager shared] attachRuntime:self];
#if __has_include("ZynthKit-Swift.h")
    [[ZynthRuntimeManagerRegistry shared] setRuntime:self for:_uiManager];
#endif
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
    [_uiManager setFrameProfiler:^(NSTimeInterval frameMs,
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
  return [self.uiManager rootSurfaceId];
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
  return [self.uiManager registerSurfaceWithRootView:rootView].intValue;
}

- (void)unregisterSurfaceWithId:(int)surfaceId {
  [self.uiManager unregisterSurface:surfaceId];
}

- (void)setActiveSurface:(int)surfaceId {
  [self.uiManager setSurface:@(surfaceId)];
}

- (void)addSurfaceFirstFrameListener:(int)surfaceId listener:(dispatch_block_t)listener {
  [self.uiManager addSurfaceFirstFrameListener:surfaceId listener:listener];
}

- (void)removeSurfaceFirstFrameListener:(int)surfaceId listener:(dispatch_block_t)listener {
  [self.uiManager removeSurfaceFirstFrameListener:surfaceId listener:listener];
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
  [self.uiManager flush];
}

- (void)installModuleBridge:(id<ZynthModuleBridge>)bridge constants:(NSDictionary<NSString *,id> *)constants {
  [self.runtime installModuleBridge:bridge constants:constants];
}

- (void)destroy {
  [[ZynthNativeErrorOverlayManager shared] detach];
}

@end
