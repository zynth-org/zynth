#import <Foundation/Foundation.h>

#if __has_include(<RuneScreens/RuneScreens-Swift.h>)
#import <RuneScreens/RuneScreens-Swift.h>
#else
#import "RuneScreens-Swift.h"
#endif

#if __has_include(<RuneKit/RuneKit.h>)
#import <RuneKit/RuneKit.h>
#else
#import "RuneKit.h"
#endif

#import <Yoga/Yoga.h>

#import "RuneComponentRegistry.h"
#import "RuneUIManager+Layout.h"
#import "SNNode.h"

static NSString *RuneScreensNormalizeJSONString(NSString *value) {
  if ([value rangeOfString:@"\\\""].location == NSNotFound) {
    return value;
  }
  NSMutableString *normalized = [value mutableCopy];
  [normalized replaceOccurrencesOfString:@"\\\"" withString:@"\"" options:0 range:NSMakeRange(0, normalized.length)];
  return normalized;
}

static NSString *RuneScreensParseString(NSString *rawJSON) {
  if (rawJSON.length == 0) return nil;
  NSString *value = [rawJSON stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if (value.length == 0 || [value isEqualToString:@"null"]) return nil;
  NSString *normalized = RuneScreensNormalizeJSONString(value);
  if ([normalized hasPrefix:@"\""] && [normalized hasSuffix:@"\""] && normalized.length >= 2) {
    normalized = [normalized substringWithRange:NSMakeRange(1, normalized.length - 2)];
    normalized = RuneScreensNormalizeJSONString(normalized);
  }
  return normalized;
}

static BOOL RuneScreensParseBoolean(NSString *rawJSON, BOOL fallback) {
  if (rawJSON.length == 0) return fallback;
  NSString *value = [rawJSON stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if (value.length == 0 || [value isEqualToString:@"null"]) return fallback;
  NSString *lower = value.lowercaseString;
  if ([lower isEqualToString:@"true"]) return YES;
  if ([lower isEqualToString:@"false"]) return NO;
  return fallback;
}

static NSInteger RuneScreensParseInteger(NSString *rawJSON, NSInteger fallback) {
  if (rawJSON.length == 0) return fallback;
  NSString *value = [rawJSON stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if (value.length == 0 || [value isEqualToString:@"null"]) return fallback;
  return value.integerValue;
}

@implementation SNUIManager (RuneScreens)

+ (void)load {
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    RuneComponentDescriptor *containerDescriptor = [[RuneComponentDescriptor alloc] initWithType:@"rune-screen-container"];
    containerDescriptor.createView = ^UIView *(SNUIManager *manager, NSString *type) {
      return [[RuneScreenContainerView alloc] init];
    };
    containerDescriptor.handleRemoveChild = ^BOOL(SNUIManager *manager,
                                                  SNNode *parent,
                                                  SNNode *child,
                                                  NSNumber *childId) {
      if (![parent.view isKindOfClass:[RuneScreenContainerView class]]) {
        return NO;
      }
      if (![child.view isKindOfClass:[RuneScreenView class]]) {
        return NO;
      }
      RuneScreenContainerView *container = (RuneScreenContainerView *)parent.view;
      RuneScreenView *screen = (RuneScreenView *)child.view;
      BOOL handled = [container beginRemovalForScreen:screen];
      if (!handled) {
        return NO;
      }

      NSUInteger index = [parent.children indexOfObject:childId];
      if (index != NSNotFound) {
        [parent.children removeObjectAtIndex:index];
      }
      if (parent.yoga && child.yoga) {
        YGNodeRemoveChild(parent.yoga, child.yoga);
      }
      [manager rune_markNeedsFlush];
      return YES;
    };
    RuneRegisterComponentDescriptor(containerDescriptor);

    RuneComponentDescriptor *screenDescriptor = [[RuneComponentDescriptor alloc] initWithType:@"rune-screen"];
    screenDescriptor.createView = ^UIView *(SNUIManager *manager, NSString *type) {
      return [[RuneScreenView alloc] init];
    };
    screenDescriptor.attach = ^(SNUIManager *manager, SNNode *node) {
      if (![node.view isKindOfClass:[RuneScreenView class]]) return;
      RuneScreenView *view = (RuneScreenView *)node.view;
      [view bindWithManager:manager node:node];
    };
    screenDescriptor.cleanup = ^(SNUIManager *manager, SNNode *node) {
      if (![node.view isKindOfClass:[RuneScreenView class]]) return;
      RuneScreenView *view = (RuneScreenView *)node.view;
      [view prepareForReuse];
    };
    screenDescriptor.handleSetProp = ^BOOL(SNUIManager *manager,
                                           SNNode *node,
                                           NSString *name,
                                           id value,
                                           NSString *rawJSON) {
      if (![node.view isKindOfClass:[RuneScreenView class]]) return NO;
      RuneScreenView *view = (RuneScreenView *)node.view;

      if ([name isEqualToString:@"screenKey"]) {
        NSString *key = RuneScreensParseString(rawJSON) ?: @"";
        [view setScreenKeyValue:key];
        return YES;
      }

      if ([name isEqualToString:@"active"]) {
        BOOL active = RuneScreensParseBoolean(rawJSON, NO);
        [view setActiveStateValue:@(active)];
        return YES;
      }

      if ([name isEqualToString:@"animation"]) {
        NSString *anim = RuneScreensParseString(rawJSON);
        [view setAnimationTypeString:anim];
        return YES;
      }

      if ([name isEqualToString:@"gestureEnabled"]) {
        BOOL enabled = RuneScreensParseBoolean(rawJSON, YES);
        [view setGestureEnabledValue:@(enabled)];
        return YES;
      }

      return NO;
    };
    screenDescriptor.handleSetHandler = ^BOOL(SNUIManager *manager, SNNode *node, NSString *name) {
      if (![node.view isKindOfClass:[RuneScreenView class]]) return NO;
      return [name isEqualToString:@"onWillAppear"] ||
             [name isEqualToString:@"onDidAppear"] ||
             [name isEqualToString:@"onWillDisappear"] ||
             [name isEqualToString:@"onDidDisappear"];
    };
    RuneRegisterComponentDescriptor(screenDescriptor);

    RuneComponentDescriptor *tabsDescriptor = [[RuneComponentDescriptor alloc] initWithType:@"rune-screen-tabs-container"];
    tabsDescriptor.createView = ^UIView *(SNUIManager *manager, NSString *type) {
      return [[RuneScreenTabsContainerView alloc] init];
    };
    tabsDescriptor.handleSetProp = ^BOOL(SNUIManager *manager,
                                         SNNode *node,
                                         NSString *name,
                                         id value,
                                         NSString *rawJSON) {
      if (![node.view isKindOfClass:[RuneScreenTabsContainerView class]]) return NO;
      RuneScreenTabsContainerView *view = (RuneScreenTabsContainerView *)node.view;

      if ([name isEqualToString:@"selectedIndex"]) {
        NSInteger index = RuneScreensParseInteger(rawJSON, 0);
        [view setSelectedIndexValue:@(index)];
        return YES;
      }

      if ([name isEqualToString:@"tabAnimation"]) {
        NSString *anim = RuneScreensParseString(rawJSON);
        [view setTabAnimationType:anim];
        return YES;
      }

      return NO;
    };
    RuneRegisterComponentDescriptor(tabsDescriptor);
  });
}

@end
