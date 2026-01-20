#import "AppDelegate.h"
#import <UIKit/UIKit.h>
#import "ZynthKit.h"
#import "dev-helper.h"
{{RUNTIME_IMPORTS}}
{{MODULE_IMPORTS}}

{{EXTRA_APP_DELEGATE_HEADER}}

@interface AppDelegate ()
@property(nonatomic, strong) ZynthRuntime *runtime;
@property(nonatomic, strong) UIView *surface;
@end

@implementation AppDelegate

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions {
  NSLog(@"[Zynth] App start");

  self.window = [[UIWindow alloc] initWithFrame:[UIScreen mainScreen].bounds];
  self.surface = [[UIView alloc] initWithFrame:self.window.bounds];
  self.surface.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
  
  // Default background while initializing (will be overridden by Splash if enabled)
  self.surface.backgroundColor = [UIColor colorWithRed:0.06 green:0.07 blue:0.09 alpha:1.0];

  self.runtime = [[ZynthRuntime alloc] initWithRootView:self.surface];

{{MODULE_INITIALIZERS}}

  // Initialize extra modules (like Splash Screen) as early as possible
{{EXTRA_APP_DELEGATE_INIT}}

#if DEBUG
  NSString *devServer = [[NSProcessInfo processInfo] environment][@"ZYNTH_DEV_SERVER_URL"];
  if (devServer.length == 0) {
    devServer = @"http://localhost:8081";
  }
  BOOL ready = zynth_wait_for_dev_server(devServer, 15.0);
  if (!ready) {
    NSLog(@"[Zynth] ⚠️ Dev server at %@ not reachable; startup may fail", devServer);
  }
#endif

  NSURL *fallbackBundleURL = [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"js"];

  NSError *loadError = nil;
  if (![self.runtime loadInitialBundleWithJsBundleURL:fallbackBundleURL error:&loadError]) {
    NSLog(@"[Zynth] Failed to load bundle: %@", loadError);
{{RUNTIME_LOAD_FAILURE}}
    return NO;
  }

{{RUNTIME_ROOT_CONTROLLER}}
  
  [self.window makeKeyAndVisible];

  NSLog(@"[Zynth] Starting runtime with rootId 0");
  [self.runtime startWithRootId:0];

  return YES;
}

@end
