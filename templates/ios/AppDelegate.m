#import "AppDelegate.h"
#import <JavaScriptCore/JavaScriptCore.h>
#import <RuneKit/SNUIManager.h>

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
  self.js.exceptionHandler = ^(JSContext *ctx, JSValue *ex) {
    NSLog(@"JS Error: %@", [ex toString]);
  };

  // Install __ui bridge
  NSLog(@"[Rune] Installing JS bridge");
  SNInstallBindings(self.js, self.uiMgr);

  // Load bundled main.js
  NSString *path = [[NSBundle mainBundle] pathForResource:@"main" ofType:@"js"];
  NSAssert(path != nil, @"main.js not found (build the JS bundle)");
  NSString *code = [NSString stringWithContentsOfFile:path encoding:NSUTF8StringEncoding error:nil];
  NSLog(@"[Rune] Loaded main.js len=%lu", (unsigned long)code.length);
  [self.js evaluateScript:code];
  // Sanity: ensure console works
  [self.js evaluateScript:@"console.log('JS bootstrap')"];

  // Ensure initial layout pass after JS loads
  NSLog(@"[Rune] Forcing initial flush");
  [self.uiMgr flush];
  NSLog(@"[Rune] Initial flush requested");

  return YES;
}

@end
