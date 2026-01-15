#if __has_include(<ZynthKit/ZynthKit.h>)
#import <ZynthKit/ZynthKit.h>
#import <ZynthKit/SNHexColor.h>
#else
#import "ZynthKit.h"
#import "ZynthComponentAPI.h"
#import "SNUIManager.h"
#import "SNNode.h"
#import "SNHexColor.h"
#import "ZynthViewHost.h"
#endif

#import "ZynthMenuView.h"
#import "ZynthMenuItemView.h"
#import <yoga/Yoga.h>

#pragma mark - Menu View

static BOOL ZynthMenuHandleSetProp(SNUIManager *manager,
                                  SNNode *node,
                                  NSString *name,
                                  id value,
                                  NSString *rawJSON) {
  if (!node || ![node.view isKindOfClass:[ZynthMenuView class]]) return NO;
  // ZynthMenuView *menuView = (ZynthMenuView *)node.view;

  // onOpen/onClose are handled via events usually, but we haven't implemented sending them back yet.
  
  return NO;
}

static BOOL ZynthMenuHandleSetHandler(SNUIManager *manager,
                                     SNNode *node,
                                     NSString *name) {
   // Implementation for events if needed
   return NO;
}

#pragma mark - Menu Item View

static BOOL ZynthMenuItemHandleSetProp(SNUIManager *manager,
                                      SNNode *node,
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

static BOOL ZynthMenuItemHandleSetHandler(SNUIManager *manager,
                                         SNNode *node,
                                         NSString *name) {
  if (!node || ![node.view isKindOfClass:[ZynthMenuItemView class]]) return NO;
  ZynthMenuItemView *itemView = (ZynthMenuItemView *)node.view;

  if ([name isEqualToString:@"onPress"]) {
    __weak SNUIManager *weakManager = manager;
    __weak SNNode *weakNode = node;
    itemView.onPress = ^{
      SNUIManager *strongManager = weakManager;
      SNNode *strongNode = weakNode;
      if (strongManager && strongNode) {
        [strongManager zynth_dispatchEvent:@"onPress" payload:@{} toNode:strongNode];
      }
    };
    return YES;
  }
  return NO;
}

@implementation SNUIManager (MenuComponent)

+ (void)load {
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    
    // 1. menu-view
    ZynthComponentDescriptor *menuDesc = [[ZynthComponentDescriptor alloc] initWithType:@"menu-view"];
    menuDesc.createView = ^UIView *(SNUIManager *manager, NSString *type) {
      return [ZynthMenuView new];
    };
    menuDesc.handleSetProp = ^BOOL(SNUIManager *manager, SNNode *node, NSString *name, id value, NSString *rawJSON) {
      return ZynthMenuHandleSetProp(manager, node, name, value, rawJSON);
    };
    // Standard attach logic
    ZynthRegisterComponentDescriptor(menuDesc);

    // 2. menu-item-view
    ZynthComponentDescriptor *itemDesc = [[ZynthComponentDescriptor alloc] initWithType:@"menu-item-view"];
    itemDesc.createView = ^UIView *(SNUIManager *manager, NSString *type) {
      return [ZynthMenuItemView new];
    };
    itemDesc.handleSetProp = ^BOOL(SNUIManager *manager, SNNode *node, NSString *name, id value, NSString *rawJSON) {
      return ZynthMenuItemHandleSetProp(manager, node, name, value, rawJSON);
    };
    itemDesc.handleSetHandler = ^BOOL(SNUIManager *manager, SNNode *node, NSString *name) {
      return ZynthMenuItemHandleSetHandler(manager, node, name);
    };
    // Ensure items don't affect layout
    itemDesc.attach = ^(SNUIManager *manager, SNNode *node) {
        if (node.yoga) {
            YGNodeStyleSetDisplay(node.yoga, YGDisplayNone);
        }
    };
    ZynthRegisterComponentDescriptor(itemDesc);
    
    // 3. menu-trigger-view
    // Acts as a simple container
    ZynthComponentDescriptor *triggerDesc = [[ZynthComponentDescriptor alloc] initWithType:@"menu-trigger-view"];
    triggerDesc.createView = ^UIView *(SNUIManager *manager, NSString *type) {
      return [UIView new];
    };
    ZynthRegisterComponentDescriptor(triggerDesc);
  });
}

@end
