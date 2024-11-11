#import "AppDelegate.h"
#import <JavaScriptCore/JavaScriptCore.h>
#import <RuneKit/RuneKit.h>
#import <RuneKit/RuneKit-Swift.h>

@interface AppDelegate ()
@property(nonatomic, strong) JSContext *js;
@property(nonatomic, strong) SNUIManager *uiMgr;
@property(nonatomic, strong) UIView *surface;
@end

@implementation AppDelegate

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions {
  NSLog(@"[Rune] App start");

  self.window = [[UIWindow alloc] initWithFrame:[UIScreen mainScreen].bounds];
  UIViewController *vc = [UIViewController new];
  self.surface = [[UIView alloc] initWithFrame:self.window.bounds];
  self.surface.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
  self.surface.backgroundColor = [UIColor colorWithRed:0.06 green:0.07 blue:0.09 alpha:1.0];
  vc.view = self.surface;
  self.window.rootViewController = vc;
  [self.window makeKeyAndVisible];

  self.uiMgr = [[SNUIManager alloc] initWithRootView:self.surface];

  self.js = [JSContext new];
  __weak typeof(self) weakSelf = self;
  self.js.exceptionHandler = ^(JSContext *ctx, JSValue *ex) {
    NSString *message = [[ex toString] copy] ?: @"Unknown Error";
    JSValue *stackValue = [ex valueForProperty:@"stack"];
    NSString *stack = [stackValue isUndefined] ? nil : [stackValue toString];
    NSLog(@"JS Error: %@", message);
    dispatch_async(dispatch_get_main_queue(), ^{
      [DevRedBox showWithTitle:@"JavaScript Error" message:message stack:stack.length ? stack : nil];
    });
    // Stop UI updates while an error is visible.
    [weakSelf.uiMgr flush];
  };

  NSLog(@"[Rune] Setting platform flag");
  [self.js evaluateScript:@"globalThis.__RUNE_PLATFORM = 'ios';"];

  // Install __ui bridge
  NSLog(@"[Rune] Installing JS bridge");
  SNInstallBindings(self.js, self.uiMgr);

  // setTimeout / clearTimeout
  __block NSMutableDictionary<NSNumber *, dispatch_source_t> *timers = [NSMutableDictionary new];
  __block NSInteger nextTimerId = 1;
  self.js[@"setTimeout"] = ^NSNumber *(JSValue *callback, NSNumber *delayMs) {
    if (!callback || ![callback isObject]) {
      return @0;
    }
    NSTimeInterval ms = delayMs ? delayMs.doubleValue : 0;
    NSInteger identifier = nextTimerId++;
    dispatch_queue_t queue = dispatch_get_main_queue();
    dispatch_source_t source = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, queue);
    timers[@(identifier)] = source;
    uint64_t delay = (uint64_t)(ms * NSEC_PER_MSEC);
    dispatch_time_t start = dispatch_time(DISPATCH_TIME_NOW, (int64_t)delay);
    dispatch_source_set_timer(source, start, DISPATCH_TIME_FOREVER, 0);
    dispatch_source_set_event_handler(source, ^{
      @try {
        [callback callWithArguments:@[]];
      } @catch (NSException *exception) {
        NSLog(@"[Rune] Timer exception: %@", exception);
      }
      dispatch_source_cancel(source);
      [timers removeObjectForKey:@(identifier)];
    });
    dispatch_resume(source);
    return @(identifier);
  };

  self.js[@"clearTimeout"] = ^(NSNumber *timerId) {
    dispatch_source_t source = timerId ? timers[timerId] : nil;
    if (source) {
      dispatch_source_cancel(source);
      [timers removeObjectForKey:timerId];
    }
  };

  // Device module bridge
  JSValue *modules = [JSValue valueWithNewObjectInContext:self.js];
  self.js[@"__modules"] = modules;
  modules[@"call"] = ^JSValue *(NSString *moduleName, NSString *methodName, JSValue *argsValue) {
    JSContext *context = [JSContext currentContext];
    JSValue *promiseCtor = context[@"Promise"];

    if ([moduleName isEqualToString:@"Device"] && [methodName isEqualToString:@"info"]) {
      UIDevice *device = UIDevice.currentDevice;
      NSDictionary *payload = @{
        @"result": @{
          @"name": device.name ?: @"",
          @"model": device.model ?: @"",
          @"systemName": device.systemName ?: @"",
          @"systemVersion": device.systemVersion ?: @"",
        }
      };
      JSValue *value = [JSValue valueWithObject:payload inContext:context];
      return [promiseCtor invokeMethod:@"resolve" withArguments:@[value]];
    }

    NSDictionary *error = @{ @"error": @"unsupported_module" };
    JSValue *errorValue = [JSValue valueWithObject:error inContext:context];
    return [promiseCtor invokeMethod:@"reject" withArguments:@[errorValue]];
  };

  // Load bundled main.js
  NSString *path = [[NSBundle mainBundle] pathForResource:@"main" ofType:@"js"];
  NSAssert(path != nil, @"main.js not found (build the JS bundle)");
  NSString *code = [NSString stringWithContentsOfFile:path encoding:NSUTF8StringEncoding error:nil];
  NSLog(@"[Rune] Loaded main.js len=%lu", (unsigned long)code.length);
  [self.js evaluateScript:code];
  // Sanity: ensure console works
  [self.js evaluateScript:@"console.log('JS bootstrap')"];

  JSValue *startApp = self.js[@"__startApp"];
  if (startApp && ![startApp isUndefined] && ![startApp isNull]) {
    NSLog(@"[Rune] Invoking __startApp with rootId 0");
    [startApp callWithArguments:@[@0]];
  } else {
    NSLog(@"[Rune] __startApp not defined");
  }

  // Ensure initial layout pass after JS loads
  NSLog(@"[Rune] Forcing initial flush");
  [self.uiMgr flush];
  NSLog(@"[Rune] Initial flush requested");

  return YES;
}

@end
