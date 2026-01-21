#if __has_include(<ZynthComponents/ZynthComponents-Swift.h>)
#import <ZynthComponents/ZynthComponents-Swift.h>
#else
#import "ZynthComponents-Swift.h"
#endif

#if __has_include(<ZynthKit/ZynthKit.h>)
#import <ZynthKit/ZynthKit.h>
#else
#import "ZynthKit.h"
#endif

#import "ZynthComponentRegistry.h"
#import "ZynthNode.h"

@implementation ZynthUIManager (ZynthStatusBar)

+ (void)load {
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    ZynthComponentDescriptor *descriptor = [[ZynthComponentDescriptor alloc] initWithType:@"zynth-status-bar"];

    descriptor.createView = ^UIView *(ZynthUIManager *manager, NSString *type) {
      return [[ZynthStatusBarView alloc] init];
    };

    descriptor.cleanup = ^(ZynthUIManager *manager, ZynthNode *node) {
      if (![node.view isKindOfClass:[ZynthStatusBarView class]]) return;
      ZynthStatusBarView *view = (ZynthStatusBarView *)node.view;
      [view reset];
    };

    descriptor.handleSetProp = ^BOOL(ZynthUIManager *manager,
                                     ZynthNode *node,
                                     NSString *name,
                                     id value,
                                     NSString *rawJSON) {
      if (![node.view isKindOfClass:[ZynthStatusBarView class]]) return NO;
      ZynthStatusBarView *view = (ZynthStatusBarView *)node.view;

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

    ZynthRegisterComponentDescriptor(descriptor);
  });
}

@end
