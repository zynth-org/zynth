#import "AppDelegate.h"
#import <UIKit/UIKit.h>
#import "RuneKit.h"
#import "RuneKit-Swift.h"

@interface AppDelegate ()
@property(nonatomic, strong) RuneRuntime *runtime;
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

  self.runtime = [[RuneRuntime alloc] initWithRootView:self.surface];

  NSURL *bundleURL = [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"js"];
  NSAssert(bundleURL != nil, @"main.js not found (build the JS bundle)");

  NSError *loadError = nil;
  if (![self.runtime loadInitialBundleWithJsBundleURL:bundleURL error:&loadError]) {
    NSLog(@"[Rune] Failed to load bundle: %@", loadError);
    if (loadError) {
      [DevRedBox showWithTitle:@"Bundle Load Failed"
                       message:loadError.localizedDescription
                         stack:nil];
    }
    return NO;
  }

  NSLog(@"[Rune] Starting runtime with rootId 0");
  [self.runtime startWithRootId:0];

  return YES;
}

@end
