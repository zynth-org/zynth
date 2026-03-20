#import <Foundation/Foundation.h>

#if __has_include(<ZynthScreens/ZynthScreens-Swift.h>)
#import <ZynthScreens/ZynthScreens-Swift.h>
#else
#import "ZynthScreens-Swift.h"
#endif

#if __has_include(<ZynthKit/ZynthKit.h>)
#import <ZynthKit/ZynthKit.h>
#else
#import "ZynthKit.h"
#endif

#import <Yoga/Yoga.h>

#import "ZynthComponentRegistry.h"
#import "ZynthComponentAPI.h"

static NSString *ZynthScreensNormalizeJSONString(NSString *value) {
  if ([value rangeOfString:@"\\\""].location == NSNotFound) {
    return value;
  }
  NSMutableString *normalized = [value mutableCopy];
  [normalized replaceOccurrencesOfString:@"\\\"" withString:@"\"" options:0 range:NSMakeRange(0, normalized.length)];
  return normalized;
}

static NSString *ZynthScreensParseString(NSString *rawJSON) {
  if (rawJSON.length == 0) return nil;
  NSString *value = [rawJSON stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if (value.length == 0 || [value isEqualToString:@"null"]) return nil;
  NSString *normalized = ZynthScreensNormalizeJSONString(value);
  if ([normalized hasPrefix:@"\""] && [normalized hasSuffix:@"\""] && normalized.length >= 2) {
    normalized = [normalized substringWithRange:NSMakeRange(1, normalized.length - 2)];
    normalized = ZynthScreensNormalizeJSONString(normalized);
  }
  return normalized;
}

static NSString *ZynthScreensValueAsString(id value) {
  if ([value isKindOfClass:[NSString class]]) {
    return (NSString *)value;
  }
  if ([value isKindOfClass:[NSNumber class]]) {
    return [(NSNumber *)value stringValue];
  }
  return nil;
}

static NSString *ZynthScreensParseStringValue(id value, NSString *rawJSON) {
  if (rawJSON.length > 0) {
    return ZynthScreensParseString(rawJSON);
  }
  return ZynthScreensValueAsString(value);
}

static BOOL ZynthScreensParseBoolean(NSString *rawJSON, BOOL fallback) {
  if (rawJSON.length == 0) return fallback;
  NSString *value = [rawJSON stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if (value.length == 0 || [value isEqualToString:@"null"]) return fallback;
  NSString *lower = value.lowercaseString;
  if ([lower isEqualToString:@"true"]) return YES;
  if ([lower isEqualToString:@"false"]) return NO;
  return fallback;
}

static BOOL ZynthScreensParseBooleanValue(id value, NSString *rawJSON, BOOL fallback) {
  if (rawJSON.length > 0) {
    return ZynthScreensParseBoolean(rawJSON, fallback);
  }
  if ([value isKindOfClass:[NSNumber class]]) {
    return [(NSNumber *)value boolValue];
  }
  if ([value isKindOfClass:[NSString class]]) {
    return ZynthScreensParseBoolean((NSString *)value, fallback);
  }
  return fallback;
}

static NSInteger ZynthScreensParseInteger(NSString *rawJSON, NSInteger fallback) {
  if (rawJSON.length == 0) return fallback;
  NSString *value = [rawJSON stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if (value.length == 0 || [value isEqualToString:@"null"]) return fallback;
  return value.integerValue;
}

static NSInteger ZynthScreensParseIntegerValue(id value, NSString *rawJSON, NSInteger fallback) {
  if (rawJSON.length > 0) {
    return ZynthScreensParseInteger(rawJSON, fallback);
  }
  if ([value isKindOfClass:[NSNumber class]]) {
    return [(NSNumber *)value integerValue];
  }
  if ([value isKindOfClass:[NSString class]]) {
    return ZynthScreensParseInteger((NSString *)value, fallback);
  }
  return fallback;
}

static NSDictionary *ZynthScreensParseObject(NSString *rawJSON) {
  if (rawJSON.length == 0) return nil;
  NSString *value = [rawJSON stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if (value.length == 0 || [value isEqualToString:@"null"]) return nil;

  NSString *normalized = ZynthScreensNormalizeJSONString(value);
  if ([normalized hasPrefix:@"\""] && [normalized hasSuffix:@"\""] && normalized.length >= 2) {
    normalized = [normalized substringWithRange:NSMakeRange(1, normalized.length - 2)];
    normalized = ZynthScreensNormalizeJSONString(normalized);
  }

  NSData *data = [normalized dataUsingEncoding:NSUTF8StringEncoding];
  if (!data) return nil;

  NSError *error = nil;
  id parsed = [NSJSONSerialization JSONObjectWithData:data options:NSJSONReadingAllowFragments error:&error];
  if (error) {
    NSLog(@"[ZynthScreens] Failed to parse JSON '%@' error=%@", rawJSON, error);
    return nil;
  }

  if ([parsed isKindOfClass:[NSDictionary class]]) {
    return (NSDictionary *)parsed;
  }
  return nil;
}

static NSDictionary *ZynthScreensParseObjectValue(id value, NSString *rawJSON) {
  if (rawJSON.length > 0) {
    return ZynthScreensParseObject(rawJSON);
  }
  if ([value isKindOfClass:[NSDictionary class]]) {
    return (NSDictionary *)value;
  }
  if ([value isKindOfClass:[NSString class]]) {
    return ZynthScreensParseObject((NSString *)value);
  }
  return nil;
}

static NSArray *ZynthScreensParseArray(NSString *rawJSON) {
  if (rawJSON.length == 0) return nil;
  NSString *value = [rawJSON stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if (value.length == 0 || [value isEqualToString:@"null"]) return nil;

  NSString *normalized = ZynthScreensNormalizeJSONString(value);
  if ([normalized hasPrefix:@"\""] && [normalized hasSuffix:@"\""] && normalized.length >= 2) {
    normalized = [normalized substringWithRange:NSMakeRange(1, normalized.length - 2)];
    normalized = ZynthScreensNormalizeJSONString(normalized);
  }

  NSData *data = [normalized dataUsingEncoding:NSUTF8StringEncoding];
  if (!data) return nil;

  NSError *error = nil;
  id parsed = [NSJSONSerialization JSONObjectWithData:data options:NSJSONReadingAllowFragments error:&error];
  if (error) {
    NSLog(@"[ZynthScreens] Failed to parse JSON array '%@' error=%@", rawJSON, error);
    return nil;
  }

  if ([parsed isKindOfClass:[NSArray class]]) {
    return (NSArray *)parsed;
  }
  return nil;
}

static NSArray *ZynthScreensParseArrayValue(id value, NSString *rawJSON) {
  if (rawJSON.length > 0) {
    return ZynthScreensParseArray(rawJSON);
  }
  if ([value isKindOfClass:[NSArray class]]) {
    return (NSArray *)value;
  }
  if ([value isKindOfClass:[NSString class]]) {
    return ZynthScreensParseArray((NSString *)value);
  }
  return nil;
}

@implementation ZynthUIManager (ZynthScreens)

+ (void)load {
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    ZynthComponentDescriptor *containerDescriptor = [[ZynthComponentDescriptor alloc] initWithType:@"zynth-screen-container"];
    containerDescriptor.createView = ^UIView *(ZynthUIManager *manager, NSString *type) {
      return [[ZynthScreenContainerView alloc] init];
    };
    containerDescriptor.handleInsertChild = ^BOOL(ZynthUIManager *manager,
                                                  ZynthNode *parent,
                                                  ZynthNode *child,
                                                  NSNumber *childId,
                                                  NSUInteger index) {
      if (![parent.view isKindOfClass:[ZynthScreenContainerView class]]) {
        return NO;
      }
      if (![child.view isKindOfClass:[ZynthScreenView class]]) {
        return NO;
      }

      ZynthScreenContainerView *container = (ZynthScreenContainerView *)parent.view;
      ZynthScreenView *screen = (ZynthScreenView *)child.view;

      child.parentId = parent.nid;
      child.surfaceId = parent.surfaceId;
#if DEBUG
      NSLog(@"[ZynthScreens] insert screen parent=%d child=%d surface=%d",
            parent.nid,
            child.nid,
            parent.surfaceId);
#endif

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
      [manager zynth_markNeedsFlush];
      return YES;
    };

    containerDescriptor.handleRemoveChild = ^BOOL(ZynthUIManager *manager,
                                                  ZynthNode *parent,
                                                  ZynthNode *child,
                                                  NSNumber *childId) {
      if (![parent.view isKindOfClass:[ZynthScreenContainerView class]]) {
        return NO;
      }
      if (![child.view isKindOfClass:[ZynthScreenView class]]) {
        return NO;
      }

      ZynthScreenContainerView *container = (ZynthScreenContainerView *)parent.view;
      ZynthScreenView *screen = (ZynthScreenView *)child.view;

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
      [manager zynth_markNeedsFlush];
      return YES;
    };
    ZynthRegisterComponentDescriptor(containerDescriptor);

    ZynthComponentDescriptor *sheetContainerDescriptor = [[ZynthComponentDescriptor alloc] initWithType:@"zynth-screen-sheet-container"];
    sheetContainerDescriptor.createView = ^UIView *(ZynthUIManager *manager, NSString *type) {
      return [[ZynthScreenSheetContainerView alloc] init];
    };
    sheetContainerDescriptor.handleInsertChild = ^BOOL(ZynthUIManager *manager,
                                                       ZynthNode *parent,
                                                       ZynthNode *child,
                                                       NSNumber *childId,
                                                       NSUInteger index) {
      if (![parent.view isKindOfClass:[ZynthScreenSheetContainerView class]]) {
        return NO;
      }
      if (![child.view isKindOfClass:[ZynthScreenView class]]) {
        return NO;
      }

      ZynthScreenSheetContainerView *container = (ZynthScreenSheetContainerView *)parent.view;
      ZynthScreenView *screen = (ZynthScreenView *)child.view;

      child.parentId = parent.nid;
      child.surfaceId = parent.surfaceId;
#if DEBUG
      NSLog(@"[ZynthScreens] insert sheet screen parent=%d child=%d surface=%d",
            parent.nid,
            child.nid,
            parent.surfaceId);
#endif

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
      [manager zynth_markNeedsFlush];
      return YES;
    };

    sheetContainerDescriptor.handleRemoveChild = ^BOOL(ZynthUIManager *manager,
                                                       ZynthNode *parent,
                                                       ZynthNode *child,
                                                       NSNumber *childId) {
      if (![parent.view isKindOfClass:[ZynthScreenSheetContainerView class]]) {
        return NO;
      }
      if (![child.view isKindOfClass:[ZynthScreenView class]]) {
        return NO;
      }

      ZynthScreenSheetContainerView *container = (ZynthScreenSheetContainerView *)parent.view;
      ZynthScreenView *screen = (ZynthScreenView *)child.view;

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
      [manager zynth_markNeedsFlush];
      return YES;
    };
    ZynthRegisterComponentDescriptor(sheetContainerDescriptor);

    ZynthComponentDescriptor *screenDescriptor = [[ZynthComponentDescriptor alloc] initWithType:@"zynth-screen"];
    screenDescriptor.createView = ^UIView *(ZynthUIManager *manager, NSString *type) {
      return [[ZynthScreenView alloc] init];
    };
    screenDescriptor.attach = ^(ZynthUIManager *manager, ZynthNode *node) {
      if (![node.view isKindOfClass:[ZynthScreenView class]]) return;
      ZynthScreenView *view = (ZynthScreenView *)node.view;
      [view bindWithManager:manager node:node];
    };
    screenDescriptor.cleanup = ^(ZynthUIManager *manager, ZynthNode *node) {
      if (![node.view isKindOfClass:[ZynthScreenView class]]) return;
      ZynthScreenView *view = (ZynthScreenView *)node.view;
      [view prepareForReuse];
    };
    screenDescriptor.handleSetProp = ^BOOL(ZynthUIManager *manager,
                                           ZynthNode *node,
                                           NSString *name,
                                           id value,
                                           NSString *rawJSON) {
      if (![node.view isKindOfClass:[ZynthScreenView class]]) return NO;
      ZynthScreenView *view = (ZynthScreenView *)node.view;

      if ([name isEqualToString:@"screenKey"]) {
        NSString *key = ZynthScreensParseStringValue(value, rawJSON) ?: @"";
        [view setScreenKeyValue:key];
        return YES;
      }

      if ([name isEqualToString:@"active"]) {
        BOOL active = ZynthScreensParseBooleanValue(value, rawJSON, NO);
        [view setActiveStateValue:@(active)];
        return YES;
      }

      if ([name isEqualToString:@"animation"]) {
        NSString *anim = ZynthScreensParseStringValue(value, rawJSON);
        [view setAnimationTypeString:anim];
        return YES;
      }

      if ([name isEqualToString:@"gestureEnabled"]) {
        BOOL enabled = ZynthScreensParseBooleanValue(value, rawJSON, YES);
        [view setGestureEnabledValue:@(enabled)];
        return YES;
      }

      if ([name isEqualToString:@"headerOptions"]) {
        NSDictionary *options = ZynthScreensParseObjectValue(value, rawJSON);
        [view setHeaderOptionsFromDictionary:options];
        return YES;
      }

      return NO;
    };
    screenDescriptor.handleSetHandler = ^BOOL(ZynthUIManager *manager, ZynthNode *node, NSString *name) {
      if (![node.view isKindOfClass:[ZynthScreenView class]]) return NO;
      return [name isEqualToString:@"onWillAppear"] ||
             [name isEqualToString:@"onDidAppear"] ||
             [name isEqualToString:@"onWillDisappear"] ||
             [name isEqualToString:@"onDidDisappear"] ||
             [name isEqualToString:@"onNativeBack"] ||
             [name isEqualToString:@"onNativeHeaderRightPress"];
    };
    ZynthRegisterComponentDescriptor(screenDescriptor);

    ZynthComponentDescriptor *tabsDescriptor = [[ZynthComponentDescriptor alloc] initWithType:@"zynth-screen-tabs-container"];
    tabsDescriptor.createView = ^UIView *(ZynthUIManager *manager, NSString *type) {
      return [[ZynthScreenTabsContainerView alloc] init];
    };
    tabsDescriptor.handleInsertChild = ^BOOL(ZynthUIManager *manager,
                                             ZynthNode *parent,
                                             ZynthNode *child,
                                             NSNumber *childId,
                                             NSUInteger index) {
      if (![parent.view isKindOfClass:[ZynthScreenTabsContainerView class]]) {
        return NO;
      }
      ZynthScreenTabsContainerView *container = (ZynthScreenTabsContainerView *)parent.view;
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
      [manager zynth_markNeedsFlush];
      return YES;
    };
    tabsDescriptor.handleRemoveChild = ^BOOL(ZynthUIManager *manager,
                                             ZynthNode *parent,
                                             ZynthNode *child,
                                             NSNumber *childId) {
      if (![parent.view isKindOfClass:[ZynthScreenTabsContainerView class]]) {
        return NO;
      }
      ZynthScreenTabsContainerView *container = (ZynthScreenTabsContainerView *)parent.view;
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
      [manager zynth_markNeedsFlush];
      return YES;
    };
    tabsDescriptor.attach = ^(ZynthUIManager *manager, ZynthNode *node) {
      if (![node.view isKindOfClass:[ZynthScreenTabsContainerView class]]) return;
      ZynthScreenTabsContainerView *view = (ZynthScreenTabsContainerView *)node.view;
      [view bindWithManager:manager node:node];
    };
    tabsDescriptor.cleanup = ^(ZynthUIManager *manager, ZynthNode *node) {
      if (![node.view isKindOfClass:[ZynthScreenTabsContainerView class]]) return;
      ZynthScreenTabsContainerView *view = (ZynthScreenTabsContainerView *)node.view;
      [view prepareForReuse];
    };
    tabsDescriptor.handleSetProp = ^BOOL(ZynthUIManager *manager,
                                         ZynthNode *node,
                                         NSString *name,
                                         id value,
                                         NSString *rawJSON) {
      if (![node.view isKindOfClass:[ZynthScreenTabsContainerView class]]) return NO;
      ZynthScreenTabsContainerView *view = (ZynthScreenTabsContainerView *)node.view;

      if ([name isEqualToString:@"selectedIndex"]) {
        NSInteger index = ZynthScreensParseIntegerValue(value, rawJSON, 0);
        [view setSelectedIndexValue:@(index)];
        return YES;
      }

      if ([name isEqualToString:@"tabAnimation"]) {
        NSString *anim = ZynthScreensParseStringValue(value, rawJSON);
        [view setTabAnimationType:anim];
        return YES;
      }

      if ([name isEqualToString:@"tabBarOptions"]) {
        NSDictionary *options = ZynthScreensParseObjectValue(value, rawJSON);
        [view setTabBarOptionsFromDictionary:options];
        return YES;
      }

      if ([name isEqualToString:@"tabBarItems"]) {
        NSArray *items = ZynthScreensParseArrayValue(value, rawJSON);
        [view setTabItemsFromArray:items];
        return YES;
      }

      if ([name isEqualToString:@"nativeTabBarEnabled"]) {
        BOOL enabled = ZynthScreensParseBooleanValue(value, rawJSON, NO);
        [view setNativeTabBarEnabledValue:@(enabled)];
        return YES;
      }

      return NO;
    };
    tabsDescriptor.handleSetHandler = ^BOOL(ZynthUIManager *manager, ZynthNode *node, NSString *name) {
      if (![node.view isKindOfClass:[ZynthScreenTabsContainerView class]]) return NO;
      return [name isEqualToString:@"onNativeTabSelect"];
    };
    ZynthRegisterComponentDescriptor(tabsDescriptor);
  });
}

@end
