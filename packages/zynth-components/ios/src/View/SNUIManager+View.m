#if __has_include(<ZynthKit/ZynthKit.h>)
#import <ZynthKit/ZynthKit.h>
#import <ZynthKit/ZynthHexColor.h>
#else
#import "ZynthKit.h"
#import "ZynthComponentRegistry.h"
#import "ZynthComponentAPI.h"
#import "ZynthUIManager.h"
#import "ZynthNode.h"
#import "ZynthHexColor.h"
#endif

#import "ZynthHitTestingView.h"

@implementation ZynthUIManager (ViewComponent)

+ (void)load {
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    ZynthComponentDescriptor *descriptor = [[ZynthComponentDescriptor alloc] initWithType:@"view"];
    
    descriptor.createView = ^UIView *(ZynthUIManager *manager, NSString *type) {
      ZynthHitTestingView *view = [[ZynthHitTestingView alloc] init];
      view.pointerMode = ZynthPointerEventsAuto;
      return view;
    };
    
    descriptor.attach = ^(ZynthUIManager *manager, ZynthNode *node) {
      if (![node.view isKindOfClass:[ZynthHitTestingView class]]) return;
      
      // Initialize pointer events
      if (!node.pointerEvents) {
        node.pointerEvents = @"auto";
      }
      
      ZynthHitTestingView *view = (ZynthHitTestingView *)node.view;
      view.pointerMode = ZynthPointerEventsFromString(node.pointerEvents);
      
      if ([node.pointerEvents isEqualToString:@"none"]) {
        node.view.userInteractionEnabled = NO;
      } else {
        node.view.userInteractionEnabled = ![node.view isKindOfClass:[UILabel class]];
      }
    };
    
    descriptor.handleSetProp = ^BOOL(ZynthUIManager *manager, ZynthNode *node, NSString *name, id value, NSString *rawJSON) {
      if (![node.view isKindOfClass:[ZynthHitTestingView class]]) return NO;
      
      if ([name isEqualToString:@"pointerEvents"]) {
        NSString *mode = [value isKindOfClass:[NSString class]] ? (NSString *)value : @"auto";
        node.pointerEvents = mode;
        
        ZynthHitTestingView *view = (ZynthHitTestingView *)node.view;
        view.pointerMode = ZynthPointerEventsFromString(mode);
        
        // Update interaction state
        ZynthPointerEventsMode pointerMode = ZynthPointerEventsFromString(node.pointerEvents);
        BOOL hasTap = node.hasOnPressHandler;
        
        switch (pointerMode) {
          case ZynthPointerEventsNone:
            node.view.userInteractionEnabled = NO;
            break;
          case ZynthPointerEventsBoxNone:
            node.view.userInteractionEnabled = YES;
            break;
          case ZynthPointerEventsBoxOnly:
          case ZynthPointerEventsAuto:
            node.view.userInteractionEnabled = YES;
            break;
        }
        
        // Update gesture recognizers
        for (UIGestureRecognizer *recognizer in node.view.gestureRecognizers) {
          if (![recognizer isKindOfClass:[UITapGestureRecognizer class]]) continue;
          NSString *recognizerName = recognizer.name;
          if (!(recognizerName && [recognizerName hasPrefix:@"node:"])) continue;
          
          switch (pointerMode) {
            case ZynthPointerEventsNone:
            case ZynthPointerEventsBoxNone:
              recognizer.enabled = NO;
              break;
            case ZynthPointerEventsBoxOnly:
            case ZynthPointerEventsAuto:
              recognizer.enabled = hasTap;
              break;
          }
        }
        
        return YES;
      }

      if ([name isEqualToString:@"enableGlassIOS"]) {
        BOOL enabled = value && value != (id)[NSNull null] ? [value boolValue] : NO;
        ZynthHitTestingView *view = (ZynthHitTestingView *)node.view;
        [view zynth_setEnableGlassIOS:enabled];
        return YES;
      }

      if ([name isEqualToString:@"tintColor"]) {
        UIColor *color = nil;
        if ([value isKindOfClass:[NSString class]]) {
          color = ZynthColorFromHex((NSString *)value);
        }
        ZynthHitTestingView *view = (ZynthHitTestingView *)node.view;
        [view zynth_setGlassTintColor:color];
        return YES;
      }
      
      return NO;
    };
    
    ZynthRegisterComponentDescriptor(descriptor);
  });
}

@end
