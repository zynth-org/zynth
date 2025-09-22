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

static NSDictionary *RuneScreensParseObject(NSString *rawJSON) {
  if (rawJSON.length == 0) return nil;
  NSString *value = [rawJSON stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if (value.length == 0 || [value isEqualToString:@"null"]) return nil;

  NSString *normalized = RuneScreensNormalizeJSONString(value);
  if ([normalized hasPrefix:@"\""] && [normalized hasSuffix:@"\""] && normalized.length >= 2) {
    normalized = [normalized substringWithRange:NSMakeRange(1, normalized.length - 2)];
    normalized = RuneScreensNormalizeJSONString(normalized);
  }

  NSData *data = [normalized dataUsingEncoding:NSUTF8StringEncoding];
  if (!data) return nil;

  NSError *error = nil;
  id parsed = [NSJSONSerialization JSONObjectWithData:data options:NSJSONReadingAllowFragments error:&error];
  if (error) {
    NSLog(@"[RuneScreens] Failed to parse JSON '%@' error=%@", rawJSON, error);
    return nil;
  }

  if ([parsed isKindOfClass:[NSDictionary class]]) {
    return (NSDictionary *)parsed;
  }
  return nil;
}

static NSArray *RuneScreensParseArray(NSString *rawJSON) {
  if (rawJSON.length == 0) return nil;
  NSString *value = [rawJSON stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if (value.length == 0 || [value isEqualToString:@"null"]) return nil;

  NSString *normalized = RuneScreensNormalizeJSONString(value);
  if ([normalized hasPrefix:@"\""] && [normalized hasSuffix:@"\""] && normalized.length >= 2) {
    normalized = [normalized substringWithRange:NSMakeRange(1, normalized.length - 2)];
    normalized = RuneScreensNormalizeJSONString(normalized);
  }

  NSData *data = [normalized dataUsingEncoding:NSUTF8StringEncoding];
  if (!data) return nil;

  NSError *error = nil;
  id parsed = [NSJSONSerialization JSONObjectWithData:data options:NSJSONReadingAllowFragments error:&error];
  if (error) {
    NSLog(@"[RuneScreens] Failed to parse JSON array '%@' error=%@", rawJSON, error);
    return nil;
  }

  if ([parsed isKindOfClass:[NSArray class]]) {
    return (NSArray *)parsed;
  }
  return nil;
}

@implementation SNUIManager (RuneScreens)

+ (void)load {
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    RuneComponentDescriptor *containerDescriptor = [[RuneComponentDescriptor alloc] initWithType:@"rune-screen-container"];
    containerDescriptor.createView = ^UIView *(SNUIManager *manager, NSString *type) {
      return [[RuneScreenContainerView alloc] init];
    };
    containerDescriptor.handleInsertChild = ^BOOL(SNUIManager *manager,
                                                  SNNode *parent,
                                                  SNNode *child,
                                                  NSNumber *childId,
                                                  NSUInteger index) {
      if (![parent.view isKindOfClass:[RuneScreenContainerView class]]) {
        return NO;
      }
      if (![child.view isKindOfClass:[RuneScreenView class]]) {
        return NO;
      }

      RuneScreenContainerView *container = (RuneScreenContainerView *)parent.view;
      RuneScreenView *screen = (RuneScreenView *)child.view;

      child.parentId = parent.nid;
      child.surfaceId = parent.surfaceId;

      NSUInteger clamped = MIN(index, parent.children.count);
      [parent.children insertObject:childId atIndex:clamped];

      if (child.yoga) {
        YGNodeRef owner = YGNodeGetOwner(child.yoga);
        if (owner) {
          YGNodeRemoveChild(owner, child.yoga);
        }
        YGNodeInsertChild(parent.yoga, child.yoga, (uint32_t)clamped);
      }

      [container insertScreen:screen at:(int)clamped];
      [manager rune_markNeedsFlush];
      return YES;
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

      NSUInteger index = [parent.children indexOfObject:childId];
      if (index != NSNotFound) {
        [parent.children removeObjectAtIndex:index];
      }
      if (child.yoga) {
        YGNodeRef owner = YGNodeGetOwner(child.yoga);
        if (owner) {
          YGNodeRemoveChild(owner, child.yoga);
        }
      }
      child.parentId = -1;
      child.surfaceId = -1;

      [container removeScreen:screen];
      [manager rune_markNeedsFlush];
      return YES;
    };
    RuneRegisterComponentDescriptor(containerDescriptor);

    RuneComponentDescriptor *sheetContainerDescriptor = [[RuneComponentDescriptor alloc] initWithType:@"rune-screen-sheet-container"];
    sheetContainerDescriptor.createView = ^UIView *(SNUIManager *manager, NSString *type) {
      return [[RuneScreenSheetContainerView alloc] init];
    };
    sheetContainerDescriptor.handleInsertChild = ^BOOL(SNUIManager *manager,
                                                       SNNode *parent,
                                                       SNNode *child,
                                                       NSNumber *childId,
                                                       NSUInteger index) {
      if (![parent.view isKindOfClass:[RuneScreenSheetContainerView class]]) {
        return NO;
      }
      if (![child.view isKindOfClass:[RuneScreenView class]]) {
        return NO;
      }

      RuneScreenSheetContainerView *container = (RuneScreenSheetContainerView *)parent.view;
      RuneScreenView *screen = (RuneScreenView *)child.view;

      child.parentId = parent.nid;
      child.surfaceId = parent.surfaceId;

      NSUInteger clamped = MIN(index, parent.children.count);
      [parent.children insertObject:childId atIndex:clamped];

      if (child.yoga) {
        YGNodeRef owner = YGNodeGetOwner(child.yoga);
        if (owner) {
          YGNodeRemoveChild(owner, child.yoga);
        }
        YGNodeInsertChild(parent.yoga, child.yoga, (uint32_t)clamped);
      }

      [container insertScreen:screen at:(int)clamped];
      [manager rune_markNeedsFlush];
      return YES;
    };

    sheetContainerDescriptor.handleRemoveChild = ^BOOL(SNUIManager *manager,
                                                       SNNode *parent,
                                                       SNNode *child,
                                                       NSNumber *childId) {
      if (![parent.view isKindOfClass:[RuneScreenSheetContainerView class]]) {
        return NO;
      }
      if (![child.view isKindOfClass:[RuneScreenView class]]) {
        return NO;
      }

      RuneScreenSheetContainerView *container = (RuneScreenSheetContainerView *)parent.view;
      RuneScreenView *screen = (RuneScreenView *)child.view;

      NSUInteger index = [parent.children indexOfObject:childId];
      if (index != NSNotFound) {
        [parent.children removeObjectAtIndex:index];
      }
      if (child.yoga) {
        YGNodeRef owner = YGNodeGetOwner(child.yoga);
        if (owner) {
          YGNodeRemoveChild(owner, child.yoga);
        }
      }
      child.parentId = -1;
      child.surfaceId = -1;

      [container removeScreen:screen];
      [manager rune_markNeedsFlush];
      return YES;
    };
    RuneRegisterComponentDescriptor(sheetContainerDescriptor);

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

      if ([name isEqualToString:@"headerOptions"]) {
        NSDictionary *options = RuneScreensParseObject(rawJSON);
        [view setHeaderOptionsFromDictionary:options];
        return YES;
      }

      return NO;
    };
    screenDescriptor.handleSetHandler = ^BOOL(SNUIManager *manager, SNNode *node, NSString *name) {
      if (![node.view isKindOfClass:[RuneScreenView class]]) return NO;
      return [name isEqualToString:@"onWillAppear"] ||
             [name isEqualToString:@"onDidAppear"] ||
             [name isEqualToString:@"onWillDisappear"] ||
             [name isEqualToString:@"onDidDisappear"] ||
             [name isEqualToString:@"onNativeBack"] ||
             [name isEqualToString:@"onNativeHeaderRightPress"];
    };
    RuneRegisterComponentDescriptor(screenDescriptor);

    RuneComponentDescriptor *tabsDescriptor = [[RuneComponentDescriptor alloc] initWithType:@"rune-screen-tabs-container"];
    tabsDescriptor.createView = ^UIView *(SNUIManager *manager, NSString *type) {
      return [[RuneScreenTabsContainerView alloc] init];
    };
    tabsDescriptor.handleInsertChild = ^BOOL(SNUIManager *manager,
                                             SNNode *parent,
                                             SNNode *child,
                                             NSNumber *childId,
                                             NSUInteger index) {
      if (![parent.view isKindOfClass:[RuneScreenTabsContainerView class]]) {
        return NO;
      }
      RuneScreenTabsContainerView *container = (RuneScreenTabsContainerView *)parent.view;
      UIView *childView = child.view;
      if (!childView) {
        return NO;
      }

      child.parentId = parent.nid;
      child.surfaceId = parent.surfaceId;

      NSUInteger clamped = MIN(index, parent.children.count);
      [parent.children insertObject:childId atIndex:clamped];

      if (child.yoga) {
        YGNodeRef owner = YGNodeGetOwner(child.yoga);
        if (owner) {
          YGNodeRemoveChild(owner, child.yoga);
        }
        YGNodeInsertChild(parent.yoga, child.yoga, (uint32_t)clamped);
      }

      [container insertTabContentView:childView atIndex:(int)clamped];
      [manager rune_markNeedsFlush];
      return YES;
    };
    tabsDescriptor.handleRemoveChild = ^BOOL(SNUIManager *manager,
                                             SNNode *parent,
                                             SNNode *child,
                                             NSNumber *childId) {
      if (![parent.view isKindOfClass:[RuneScreenTabsContainerView class]]) {
        return NO;
      }
      RuneScreenTabsContainerView *container = (RuneScreenTabsContainerView *)parent.view;
      UIView *childView = child.view;

      NSUInteger existingIndex = [parent.children indexOfObject:childId];
      if (existingIndex != NSNotFound) {
        [parent.children removeObjectAtIndex:existingIndex];
      }
      if (child.yoga) {
        YGNodeRef owner = YGNodeGetOwner(child.yoga);
        if (owner) {
          YGNodeRemoveChild(owner, child.yoga);
        }
      }
      child.parentId = -1;
      child.surfaceId = -1;

      if (childView) {
        [container removeTabContentView:childView];
      }
      [manager rune_markNeedsFlush];
      return YES;
    };
    tabsDescriptor.attach = ^(SNUIManager *manager, SNNode *node) {
      if (![node.view isKindOfClass:[RuneScreenTabsContainerView class]]) return;
      RuneScreenTabsContainerView *view = (RuneScreenTabsContainerView *)node.view;
      [view bindWithManager:manager node:node];
    };
    tabsDescriptor.cleanup = ^(SNUIManager *manager, SNNode *node) {
      if (![node.view isKindOfClass:[RuneScreenTabsContainerView class]]) return;
      RuneScreenTabsContainerView *view = (RuneScreenTabsContainerView *)node.view;
      [view prepareForReuse];
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

      if ([name isEqualToString:@"tabBarOptions"]) {
        NSDictionary *options = RuneScreensParseObject(rawJSON);
        [view setTabBarOptionsFromDictionary:options];
        return YES;
      }

      if ([name isEqualToString:@"tabBarItems"]) {
        NSArray *items = RuneScreensParseArray(rawJSON);
        [view setTabItemsFromArray:items];
        return YES;
      }

      if ([name isEqualToString:@"nativeTabBarEnabled"]) {
        BOOL enabled = RuneScreensParseBoolean(rawJSON, NO);
        [view setNativeTabBarEnabledValue:@(enabled)];
        return YES;
      }

      return NO;
    };
    tabsDescriptor.handleSetHandler = ^BOOL(SNUIManager *manager, SNNode *node, NSString *name) {
      if (![node.view isKindOfClass:[RuneScreenTabsContainerView class]]) return NO;
      return [name isEqualToString:@"onNativeTabSelect"];
    };
    RuneRegisterComponentDescriptor(tabsDescriptor);
  });
}

@end
