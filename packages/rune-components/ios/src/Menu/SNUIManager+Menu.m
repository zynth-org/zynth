#if __has_include(<RuneKit/RuneKit.h>)
#import <RuneKit/RuneKit.h>
#import <RuneKit/SNHexColor.h>
#else
#import "RuneKit.h"
#import "RuneComponentAPI.h"
#import "SNUIManager.h"
#import "SNNode.h"
#import "SNHexColor.h"
#import "RuneViewHost.h"
#endif

#import "RuneMenuView.h"
#import "RuneMenuItemView.h"
#import <yoga/Yoga.h>

#pragma mark - Menu View

static BOOL RuneMenuHandleSetProp(SNUIManager *manager,
                                  SNNode *node,
                                  NSString *name,
                                  id value,
                                  NSString *rawJSON) {
  if (!node || ![node.view isKindOfClass:[RuneMenuView class]]) return NO;
  // RuneMenuView *menuView = (RuneMenuView *)node.view;

  // onOpen/onClose are handled via events usually, but we haven't implemented sending them back yet.
  
  return NO;
}

static BOOL RuneMenuHandleSetHandler(SNUIManager *manager,
                                     SNNode *node,
                                     NSString *name) {
   // Implementation for events if needed
   return NO;
}

#pragma mark - Menu Item View

static BOOL RuneMenuItemHandleSetProp(SNUIManager *manager,
                                      SNNode *node,
                                      NSString *name,
                                      id value,
                                      NSString *rawJSON) {
  if (!node || ![node.view isKindOfClass:[RuneMenuItemView class]]) return NO;
  RuneMenuItemView *itemView = (RuneMenuItemView *)node.view;

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

static BOOL RuneMenuItemHandleSetHandler(SNUIManager *manager,
                                         SNNode *node,
                                         NSString *name) {
  if (!node || ![node.view isKindOfClass:[RuneMenuItemView class]]) return NO;
  RuneMenuItemView *itemView = (RuneMenuItemView *)node.view;

  if ([name isEqualToString:@"onPress"]) {
    __weak SNUIManager *weakManager = manager;
    __weak SNNode *weakNode = node;
    itemView.onPress = ^{
      SNUIManager *strongManager = weakManager;
      SNNode *strongNode = weakNode;
      if (strongManager && strongNode) {
        [strongManager rune_dispatchEvent:@"onPress" payload:@{} toNode:strongNode];
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
    RuneComponentDescriptor *menuDesc = [[RuneComponentDescriptor alloc] initWithType:@"menu-view"];
    menuDesc.createView = ^UIView *(SNUIManager *manager, NSString *type) {
      return [RuneMenuView new];
    };
    menuDesc.handleSetProp = ^BOOL(SNUIManager *manager, SNNode *node, NSString *name, id value, NSString *rawJSON) {
      return RuneMenuHandleSetProp(manager, node, name, value, rawJSON);
    };
    // Standard attach logic
    RuneRegisterComponentDescriptor(menuDesc);

    // 2. menu-item-view
    RuneComponentDescriptor *itemDesc = [[RuneComponentDescriptor alloc] initWithType:@"menu-item-view"];
    itemDesc.createView = ^UIView *(SNUIManager *manager, NSString *type) {
      return [RuneMenuItemView new];
    };
    itemDesc.handleSetProp = ^BOOL(SNUIManager *manager, SNNode *node, NSString *name, id value, NSString *rawJSON) {
      return RuneMenuItemHandleSetProp(manager, node, name, value, rawJSON);
    };
    itemDesc.handleSetHandler = ^BOOL(SNUIManager *manager, SNNode *node, NSString *name) {
      return RuneMenuItemHandleSetHandler(manager, node, name);
    };
    // Ensure items don't affect layout
    itemDesc.attach = ^(SNUIManager *manager, SNNode *node) {
        if (node.yoga) {
            YGNodeStyleSetDisplay(node.yoga, YGDisplayNone);
        }
    };
    RuneRegisterComponentDescriptor(itemDesc);
    
    // 3. menu-trigger-view
    // Acts as a simple container
    RuneComponentDescriptor *triggerDesc = [[RuneComponentDescriptor alloc] initWithType:@"menu-trigger-view"];
    triggerDesc.createView = ^UIView *(SNUIManager *manager, NSString *type) {
      return [UIView new];
    };
    RuneRegisterComponentDescriptor(triggerDesc);
  });
}

@end
