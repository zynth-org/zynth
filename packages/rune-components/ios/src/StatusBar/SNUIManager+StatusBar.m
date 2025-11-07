#if __has_include(<RuneComponents/RuneComponents-Swift.h>)
#import <RuneComponents/RuneComponents-Swift.h>
#else
#import "RuneComponents-Swift.h"
#endif

#if __has_include(<RuneKit/RuneKit.h>)
#import <RuneKit/RuneKit.h>
#else
#import "RuneKit.h"
#endif

#import "RuneComponentRegistry.h"
#import "SNNode.h"

@implementation SNUIManager (RuneStatusBar)

+ (void)load {
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    RuneComponentDescriptor *descriptor = [[RuneComponentDescriptor alloc] initWithType:@"rune-status-bar"];

    descriptor.createView = ^UIView *(SNUIManager *manager, NSString *type) {
      return [[RuneStatusBarView alloc] init];
    };

    descriptor.cleanup = ^(SNUIManager *manager, SNNode *node) {
      if (![node.view isKindOfClass:[RuneStatusBarView class]]) return;
      RuneStatusBarView *view = (RuneStatusBarView *)node.view;
      [view reset];
    };

    descriptor.handleSetProp = ^BOOL(SNUIManager *manager,
                                     SNNode *node,
                                     NSString *name,
                                     id value,
                                     NSString *rawJSON) {
      if (![node.view isKindOfClass:[RuneStatusBarView class]]) return NO;
      RuneStatusBarView *view = (RuneStatusBarView *)node.view;

      if ([name isEqualToString:@"animated"]) {
        BOOL animated = [value respondsToSelector:@selector(boolValue)] ? [value boolValue] : NO;
        [view setAnimated:animated];
        return YES;
      }

      if ([name isEqualToString:@"hidden"]) {
        BOOL hidden = [value respondsToSelector:@selector(boolValue)] ? [value boolValue] : NO;
        [view setStatusBarHidden:hidden];
        return YES;
      }

      if ([name isEqualToString:@"barStyle"]) {
        NSString *style = [value isKindOfClass:[NSString class]] ? value : nil;
        [view setBarStyle:style];
        return YES;
      }

      if ([name isEqualToString:@"showHideTransition"]) {
        NSString *transition = [value isKindOfClass:[NSString class]] ? value : nil;
        [view setShowHideTransition:transition];
        return YES;
      }

      if ([name isEqualToString:@"backgroundColor"]) {
        NSString *color = [value isKindOfClass:[NSString class]] ? value : nil;
        [view setBackgroundColorHex:color];
        return YES;
      }

      return NO;
    };

    RuneRegisterComponentDescriptor(descriptor);
  });
}

@end
