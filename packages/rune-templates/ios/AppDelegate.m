#import "AppDelegate.h"
#import <UIKit/UIKit.h>
#import "RuneKit.h"
#import "RuneKit-Swift.h"
#import "dev-helper.h"
{{MODULE_IMPORTS}}

{{EXTRA_APP_DELEGATE_HEADER}}

@interface AppDelegate ()
@property(nonatomic, strong) RuneRuntime *runtime;
@property(nonatomic, strong) UIView *surface;
@end

@implementation AppDelegate

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions {
  NSLog(@"[Rune] App start");

  self.window = [[UIWindow alloc] initWithFrame:[UIScreen mainScreen].bounds];
  self.surface = [[UIView alloc] initWithFrame:self.window.bounds];
  self.surface.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
  
  // Default background while initializing (will be overridden by Splash if enabled)
  self.surface.backgroundColor = [UIColor colorWithRed:0.06 green:0.07 blue:0.09 alpha:1.0];

  self.runtime = [[RuneRuntime alloc] initWithRootView:self.surface];

{{MODULE_INITIALIZERS}}

  // Initialize extra modules (like Splash Screen) as early as possible
{{EXTRA_APP_DELEGATE_INIT}}

#if DEBUG
  NSString *devServer = [[NSProcessInfo processInfo] environment][@"RUNE_DEV_SERVER_URL"];
  if (devServer.length == 0) {
    devServer = @"http://localhost:8081";
  }
  BOOL ready = rune_wait_for_dev_server(devServer, 15.0);
  if (!ready) {
    NSLog(@"[Rune] ⚠️ Dev server at %@ not reachable; startup may fail", devServer);
  }
#endif

  NSURL *fallbackBundleURL = [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"js"];

  NSError *loadError = nil;
  if (![self.runtime loadInitialBundleWithJsBundleURL:fallbackBundleURL error:&loadError]) {
    NSLog(@"[Rune] Failed to load bundle: %@", loadError);
    if (loadError) {
      [DevRedBox showWithTitle:@"Bundle Load Failed"
                       message:loadError.localizedDescription
                         stack:nil];
    }
    return NO;
  }

  RuneStatusBarHostController *vc = [RuneStatusBarHostController new];
  vc.view = self.surface;
  self.window.rootViewController = vc;
  
  [self.window makeKeyAndVisible];

  NSLog(@"[Rune] Starting runtime with rootId 0");
  [self.runtime startWithRootId:0];

  return YES;
}

@end
