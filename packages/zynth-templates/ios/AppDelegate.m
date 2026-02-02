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

  NSURL *bundleURL = [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"js"];
#if DEBUG
  NSString *devServer = [[NSProcessInfo processInfo] environment][@"ZYNTH_DEV_SERVER_URL"];
  BOOL usesEnv = devServer.length > 0;
  if (devServer.length == 0) {
    id plistValue = [[NSBundle mainBundle] objectForInfoDictionaryKey:@"ZynthDevServerURL"];
    if ([plistValue isKindOfClass:[NSString class]]) {
      devServer = (NSString *)plistValue;
    }
  }
  if (devServer.length == 0) {
    devServer = @"http://localhost:8081";
  }
  if (usesEnv) {
    BOOL ready = zynth_wait_for_dev_server(devServer, 15.0);
    if (!ready) {
      NSLog(@"[Zynth] ⚠️ Dev server at %@ not reachable; startup may fail", devServer);
    }
  }
  NSString *devBundle = [NSString stringWithFormat:@"%@/main.js", devServer];
  bundleURL = [NSURL URLWithString:devBundle];
#endif

{{RUNTIME_ROOT_CONTROLLER}}
  
  [self.window makeKeyAndVisible];

  if (bundleURL && bundleURL.scheme && ![bundleURL isFileURL]) {
    NSURLSession *session = [NSURLSession sharedSession];
    NSURLSessionDataTask *task =
      [session dataTaskWithURL:bundleURL
             completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
               dispatch_async(dispatch_get_main_queue(), ^{
                 NSError *loadError = error;
                 if (!loadError && data.length > 0) {
                   NSString *code = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
                   if (!code) {
                     loadError = [NSError errorWithDomain:@"ZynthRuntime" code:3 userInfo:nil];
                   } else {
                     [self.runtime evaluateScript:code sourceURL:bundleURL.absoluteString error:&loadError];
                   }
                 }
                 if (loadError) {
                   NSLog(@"[Zynth] Failed to load bundle: %@", loadError);
{{RUNTIME_LOAD_FAILURE}}
                   return;
                 }
                 NSLog(@"[Zynth] Starting runtime with rootId 0");
                 [self.runtime startWithRootId:0];
               });
             }];
    [task resume];
  } else {
    NSError *loadError = nil;
    if (![self.runtime loadInitialBundleWithJsBundleURL:bundleURL error:&loadError]) {
      NSLog(@"[Zynth] Failed to load bundle: %@", loadError);
{{RUNTIME_LOAD_FAILURE}}
      return NO;
    }
    NSLog(@"[Zynth] Starting runtime with rootId 0");
    [self.runtime startWithRootId:0];
  }

  return YES;
}

@end
