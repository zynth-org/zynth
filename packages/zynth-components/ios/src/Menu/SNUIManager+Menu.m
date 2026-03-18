#if __has_include(<ZynthKit/ZynthKit.h>)
#import <ZynthKit/ZynthKit.h>
#import <ZynthKit/ZynthHexColor.h>
#else
#import "ZynthKit.h"
#import "ZynthComponentAPI.h"
#import "ZynthUIManager.h"
#import "ZynthNode.h"
#import "ZynthHexColor.h"
#import "ZynthViewHost.h"
#endif

#import "ZynthMenuView.h"
#import "ZynthMenuItemView.h"
#import <objc/runtime.h>
#import <yoga/Yoga.h>

#pragma mark - Menu View

static NSString *const kZynthMenuOpenOnPress = @"press";
static NSString *const kZynthMenuOpenOnLongPress = @"longPress";
static void *kZynthMenuTriggerOpenOnKey = &kZynthMenuTriggerOpenOnKey;

static NSString *ZynthMenuNormalizeJSONString(NSString *value) {
  if ([value rangeOfString:@"\\\""].location == NSNotFound) {
    return value;
  }
  NSMutableString *normalized = [value mutableCopy];
  [normalized replaceOccurrencesOfString:@"\\\"" withString:@"\"" options:0 range:NSMakeRange(0, normalized.length)];
  return normalized;
}

static id ZynthMenuParseJSON(NSString *rawJSON) {
  if (rawJSON.length == 0) return nil;
  NSString *value = [rawJSON stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  if (value.length == 0 || [value isEqualToString:@"null"]) return nil;
  NSString *normalized = ZynthMenuNormalizeJSONString(value);
  if ([normalized hasPrefix:@"\""] && [normalized hasSuffix:@"\""] && normalized.length >= 2) {
    normalized = [normalized substringWithRange:NSMakeRange(1, normalized.length - 2)];
    normalized = ZynthMenuNormalizeJSONString(normalized);
  }
  NSData *data = [normalized dataUsingEncoding:NSUTF8StringEncoding];
  if (!data) return nil;
  NSError *error = nil;
  id parsed = [NSJSONSerialization JSONObjectWithData:data options:NSJSONReadingAllowFragments error:&error];
  if (error) {
    return nil;
  }
  return parsed;
}

static NSString *ZynthMenuParseString(NSString *rawJSON, id value, NSString *propName) {
  if ([value isKindOfClass:[NSString class]]) {
    return (NSString *)value;
  }

  id parsed = ZynthMenuParseJSON(rawJSON);
  if ([parsed isKindOfClass:[NSString class]]) {
    return (NSString *)parsed;
  }

  if ([parsed isKindOfClass:[NSDictionary class]] && propName.length > 0) {
    id nestedValue = ((NSDictionary *)parsed)[propName];
    if ([nestedValue isKindOfClass:[NSString class]]) {
      return (NSString *)nestedValue;
    }
  }

  return nil;
}

static NSString *ZynthMenuNormalizeTriggerOpenOn(NSString *value) {
  if (![value isKindOfClass:[NSString class]]) {
    return kZynthMenuOpenOnPress;
  }

  NSString *candidate = [[value stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]] copy];
  if ([candidate hasPrefix:@"\""] && [candidate hasSuffix:@"\""] && candidate.length >= 2) {
    candidate = [candidate substringWithRange:NSMakeRange(1, candidate.length - 2)];
  }
  NSString *lower = [candidate lowercaseString];
  if ([lower isEqualToString:@"longpress"] || [lower isEqualToString:@"onlongpress"]) {
    return kZynthMenuOpenOnLongPress;
  }
  return kZynthMenuOpenOnPress;
}

static void ZynthMenuApplyTriggerOpenOnToParent(UIView *triggerView, NSString *openOn) {
  if (!triggerView) return;
  UIView *parent = triggerView.superview;
  while (parent != nil) {
    if ([parent isKindOfClass:[ZynthMenuView class]]) {
      [(ZynthMenuView *)parent setTriggerOpenBehavior:openOn];
      return;
    }
    parent = parent.superview;
  }
}

static BOOL ZynthMenuHandleSetProp(ZynthUIManager *manager,
                                  ZynthNode *node,
                                  NSString *name,
                                  id value,
                                  NSString *rawJSON) {
  if (!node || ![node.view isKindOfClass:[ZynthMenuView class]]) return NO;
  // ZynthMenuView *menuView = (ZynthMenuView *)node.view;

  // onOpen/onClose are handled via events usually, but we haven't implemented sending them back yet.
  
  return NO;
}

static BOOL ZynthMenuHandleSetHandler(ZynthUIManager *manager,
                                     ZynthNode *node,
                                     NSString *name) {
   // Implementation for events if needed
   return NO;
}

#pragma mark - Trigger View

@interface ZynthMenuTriggerView : UIView
@end

@implementation ZynthMenuTriggerView

- (void)didMoveToSuperview {
  [super didMoveToSuperview];
  if (self.superview) {
    NSString *openOn = objc_getAssociatedObject(self, kZynthMenuTriggerOpenOnKey);
    NSString *resolved = ZynthMenuNormalizeTriggerOpenOn(openOn);
    ZynthMenuApplyTriggerOpenOnToParent(self, resolved);
  }
}

- (void)didMoveToWindow {
  [super didMoveToWindow];
  if (self.window) {
    NSString *openOn = objc_getAssociatedObject(self, kZynthMenuTriggerOpenOnKey);
    NSString *resolved = ZynthMenuNormalizeTriggerOpenOn(openOn);
    ZynthMenuApplyTriggerOpenOnToParent(self, resolved);
  }
}

@end

static BOOL ZynthMenuTriggerHandleSetProp(ZynthUIManager *manager,
                                          ZynthNode *node,
                                          NSString *name,
                                          id value,
                                          NSString *rawJSON) {
  if (!node || ![name isEqualToString:@"openOn"]) return NO;
  UIView *triggerView = node.view;
  if (![triggerView isKindOfClass:[ZynthMenuTriggerView class]]) return NO;

  NSString *parsed = ZynthMenuParseString(rawJSON, value, name);
  NSString *resolved = ZynthMenuNormalizeTriggerOpenOn(parsed);
  objc_setAssociatedObject(triggerView, kZynthMenuTriggerOpenOnKey, resolved, OBJC_ASSOCIATION_COPY_NONATOMIC);
  ZynthMenuApplyTriggerOpenOnToParent(triggerView, resolved);
  return YES;
}

#pragma mark - Menu Item View

static BOOL ZynthMenuItemHandleSetProp(ZynthUIManager *manager,
                                      ZynthNode *node,
                                      NSString *name,
                                      id value,
                                      NSString *rawJSON) {
  if (!node || ![node.view isKindOfClass:[ZynthMenuItemView class]]) return NO;
  ZynthMenuItemView *itemView = (ZynthMenuItemView *)node.view;

  if ([name isEqualToString:@"label"]) {
    itemView.label = [value isKindOfClass:[NSString class]] ? value : nil;
    return YES;
  }
  
  if ([name isEqualToString:@"destructive"]) {
    itemView.destructive = [value respondsToSelector:@selector(boolValue)] ? [value boolValue] : NO;
    return YES;
  }
  
  if ([name isEqualToString:@"disabled"]) {
    itemView.disabled = [value respondsToSelector:@selector(boolValue)] ? [value boolValue] : NO;
    return YES;
  }

  return NO;
}

static BOOL ZynthMenuItemHandleSetHandler(ZynthUIManager *manager,
                                         ZynthNode *node,
                                         NSString *name) {
  if (!node || ![node.view isKindOfClass:[ZynthMenuItemView class]]) return NO;
  ZynthMenuItemView *itemView = (ZynthMenuItemView *)node.view;

  if ([name isEqualToString:@"onPress"]) {
    __weak ZynthUIManager *weakManager = manager;
    __weak ZynthNode *weakNode = node;
    itemView.onPress = ^{
      ZynthUIManager *strongManager = weakManager;
      ZynthNode *strongNode = weakNode;
      if (strongManager && strongNode) {
        [strongManager zynth_dispatchEvent:@"onPress" payload:@{} toNode:strongNode];
      }
    };
    return YES;
  }
  return NO;
}

@implementation ZynthUIManager (MenuComponent)

+ (void)load {
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    
    // 1. menu-view
    ZynthComponentDescriptor *menuDesc = [[ZynthComponentDescriptor alloc] initWithType:@"menu-view"];
    menuDesc.createView = ^UIView *(ZynthUIManager *manager, NSString *type) {
      return [ZynthMenuView new];
    };
    menuDesc.handleSetProp = ^BOOL(ZynthUIManager *manager, ZynthNode *node, NSString *name, id value, NSString *rawJSON) {
      return ZynthMenuHandleSetProp(manager, node, name, value, rawJSON);
    };
    // Standard attach logic
    ZynthRegisterComponentDescriptor(menuDesc);

    // 2. menu-item-view
    ZynthComponentDescriptor *itemDesc = [[ZynthComponentDescriptor alloc] initWithType:@"menu-item-view"];
    itemDesc.createView = ^UIView *(ZynthUIManager *manager, NSString *type) {
      return [ZynthMenuItemView new];
    };
    itemDesc.handleSetProp = ^BOOL(ZynthUIManager *manager, ZynthNode *node, NSString *name, id value, NSString *rawJSON) {
      return ZynthMenuItemHandleSetProp(manager, node, name, value, rawJSON);
    };
    itemDesc.handleSetHandler = ^BOOL(ZynthUIManager *manager, ZynthNode *node, NSString *name) {
      return ZynthMenuItemHandleSetHandler(manager, node, name);
    };
    // Ensure items don't affect layout
    itemDesc.attach = ^(ZynthUIManager *manager, ZynthNode *node) {
        if (node.yoga) {
            YGNodeStyleSetDisplay(node.yoga, YGDisplayNone);
        }
    };
    ZynthRegisterComponentDescriptor(itemDesc);
    
    // 3. menu-trigger-view
    // Acts as a simple container
    ZynthComponentDescriptor *triggerDesc = [[ZynthComponentDescriptor alloc] initWithType:@"menu-trigger-view"];
    triggerDesc.createView = ^UIView *(ZynthUIManager *manager, NSString *type) {
      return [ZynthMenuTriggerView new];
    };
    triggerDesc.attach = ^(ZynthUIManager *manager, ZynthNode *node) {
      if (!node || ![node.view isKindOfClass:[ZynthMenuTriggerView class]]) return;
      UIView *triggerView = (UIView *)node.view;
      NSString *openOn = objc_getAssociatedObject(triggerView, kZynthMenuTriggerOpenOnKey);
      NSString *resolved = ZynthMenuNormalizeTriggerOpenOn(openOn);
      ZynthMenuApplyTriggerOpenOnToParent(triggerView, resolved);
    };
    triggerDesc.cleanup = ^(ZynthUIManager *manager, ZynthNode *node) {
      if (!node || ![node.view isKindOfClass:[ZynthMenuTriggerView class]]) return;
      UIView *triggerView = (UIView *)node.view;
      objc_setAssociatedObject(triggerView, kZynthMenuTriggerOpenOnKey, nil, OBJC_ASSOCIATION_ASSIGN);
      ZynthMenuApplyTriggerOpenOnToParent(triggerView, kZynthMenuOpenOnPress);
    };
    triggerDesc.handleSetProp = ^BOOL(ZynthUIManager *manager, ZynthNode *node, NSString *name, id value, NSString *rawJSON) {
      return ZynthMenuTriggerHandleSetProp(manager, node, name, value, rawJSON);
    };
    ZynthRegisterComponentDescriptor(triggerDesc);
  });
}

@end
