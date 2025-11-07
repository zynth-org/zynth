#if __has_include(<RuneKit/RuneKit.h>)
#import <RuneKit/RuneKit.h>
#import <RuneKit/SNHexColor.h>
#else
#import "RuneKit.h"
#import "RuneComponentRegistry.h"
#import "RuneComponentAPI.h"
#import "SNUIManager.h"
#import "SNNode.h"
#import "SNHexColor.h"
#endif

#import "RuneHitTestingView.h"

@implementation SNUIManager (ViewComponent)

+ (void)load {
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    RuneComponentDescriptor *descriptor = [[RuneComponentDescriptor alloc] initWithType:@"view"];
    
    descriptor.createView = ^UIView *(SNUIManager *manager, NSString *type) {
      RuneHitTestingView *view = [[RuneHitTestingView alloc] init];
      view.pointerMode = RunePointerEventsAuto;
      return view;
    };
    
    descriptor.attach = ^(SNUIManager *manager, SNNode *node) {
      if (![node.view isKindOfClass:[RuneHitTestingView class]]) return;
      
      // Initialize pointer events
      if (!node.pointerEvents) {
        node.pointerEvents = @"auto";
      }
      
      RuneHitTestingView *view = (RuneHitTestingView *)node.view;
      view.pointerMode = RunePointerEventsFromString(node.pointerEvents);
      
      if ([node.pointerEvents isEqualToString:@"none"]) {
        node.view.userInteractionEnabled = NO;
      } else {
        node.view.userInteractionEnabled = ![node.view isKindOfClass:[UILabel class]];
      }
    };
    
    descriptor.handleSetProp = ^BOOL(SNUIManager *manager, SNNode *node, NSString *name, id value, NSString *rawJSON) {
      if (![node.view isKindOfClass:[RuneHitTestingView class]]) return NO;
      
      if ([name isEqualToString:@"pointerEvents"]) {
        NSString *mode = [value isKindOfClass:[NSString class]] ? (NSString *)value : @"auto";
        node.pointerEvents = mode;
        
        RuneHitTestingView *view = (RuneHitTestingView *)node.view;
        view.pointerMode = RunePointerEventsFromString(mode);
        
        // Update interaction state
        RunePointerEventsMode pointerMode = RunePointerEventsFromString(node.pointerEvents);
        BOOL hasTap = node.hasOnPressHandler;
        
        switch (pointerMode) {
          case RunePointerEventsNone:
            node.view.userInteractionEnabled = NO;
            break;
          case RunePointerEventsBoxNone:
            node.view.userInteractionEnabled = YES;
            break;
          case RunePointerEventsBoxOnly:
          case RunePointerEventsAuto:
            node.view.userInteractionEnabled = YES;
            break;
        }
        
        // Update gesture recognizers
        for (UIGestureRecognizer *recognizer in node.view.gestureRecognizers) {
          if (![recognizer isKindOfClass:[UITapGestureRecognizer class]]) continue;
          NSString *recognizerName = recognizer.name;
          if (!(recognizerName && [recognizerName hasPrefix:@"node:"])) continue;
          
          switch (pointerMode) {
            case RunePointerEventsNone:
            case RunePointerEventsBoxNone:
              recognizer.enabled = NO;
              break;
            case RunePointerEventsBoxOnly:
            case RunePointerEventsAuto:
              recognizer.enabled = hasTap;
              break;
          }
        }
        
        return YES;
      }

      if ([name isEqualToString:@"enableGlassIOS"]) {
        BOOL enabled = value && value != (id)[NSNull null] ? [value boolValue] : NO;
        RuneHitTestingView *view = (RuneHitTestingView *)node.view;
        [view rune_setEnableGlassIOS:enabled];
        return YES;
      }

      if ([name isEqualToString:@"tintColor"]) {
        UIColor *color = nil;
        if ([value isKindOfClass:[NSString class]]) {
          color = SNColorFromHex((NSString *)value);
        }
        RuneHitTestingView *view = (RuneHitTestingView *)node.view;
        [view rune_setGlassTintColor:color];
        return YES;
      }
      
      return NO;
    };
    
    RuneRegisterComponentDescriptor(descriptor);
  });
}

@end
