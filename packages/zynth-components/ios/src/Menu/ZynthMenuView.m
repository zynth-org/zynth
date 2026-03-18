#import "ZynthMenuView.h"
#import "ZynthMenuItemView.h"

static NSString *const kZynthMenuOpenOnPress = @"press";
static NSString *const kZynthMenuOpenOnLongPress = @"longPress";

@interface ZynthMenuView () <UIContextMenuInteractionDelegate>
@end

@implementation ZynthMenuView {
  UIButton *_overlayButton;
  UIContextMenuInteraction *_contextMenuInteraction;
  NSString *_triggerOpenBehavior;
  UIMenu *_currentMenu;
}

- (instancetype)initWithFrame:(CGRect)frame {
  if (self = [super initWithFrame:frame]) {
    _overlayButton = [UIButton buttonWithType:UIButtonTypeCustom];
    _overlayButton.frame = self.bounds;
    _overlayButton.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
    _triggerOpenBehavior = kZynthMenuOpenOnPress;
    [self applyTriggerInteractionMode];
    [self addSubview:_overlayButton];
  }
  return self;
}

- (void)layoutSubviews {
  [super layoutSubviews];
  _overlayButton.frame = self.bounds;
  // Ensure the overlay button is always on top to capture taps
  [self bringSubviewToFront:_overlayButton];
  // Rebuild menu just in case, though props setters should handle it
  [self updateMenu];
}

- (void)didAddSubview:(UIView *)subview {
  [super didAddSubview:subview];
  if (subview != _overlayButton) {
    [self bringSubviewToFront:_overlayButton];
    [self updateMenu];
  }
}

- (void)setTriggerOpenBehavior:(NSString *)behavior {
  NSString *resolved = [behavior isEqualToString:kZynthMenuOpenOnLongPress]
    ? kZynthMenuOpenOnLongPress
    : kZynthMenuOpenOnPress;

  if ([_triggerOpenBehavior isEqualToString:resolved]) {
    return;
  }

  _triggerOpenBehavior = resolved;
  [self applyTriggerInteractionMode];
}

- (void)applyTriggerInteractionMode {
  BOOL openOnLongPress = [_triggerOpenBehavior isEqualToString:kZynthMenuOpenOnLongPress];

  // We always want the overlay button to capture touches so that if we are in longPress mode,
  // normal taps are swallowed and don't reach the children.
  _overlayButton.userInteractionEnabled = YES;

  if (@available(iOS 14.0, *)) {
    _overlayButton.showsMenuAsPrimaryAction = !openOnLongPress;
    _overlayButton.menu = _currentMenu;
    
    // On iOS 14+, UIButton with a menu and showsMenuAsPrimaryAction=NO
    // handles context menu automatically on long press.
    // So we don't need manual UIContextMenuInteraction here if we have a menu.
    if (_contextMenuInteraction) {
      [self removeInteraction:_contextMenuInteraction];
      [_overlayButton removeInteraction:_contextMenuInteraction];
      _contextMenuInteraction = nil;
    }
  } else if (@available(iOS 13.0, *)) {
    // For iOS 13, we must use UIContextMenuInteraction manually.
    if (openOnLongPress) {
      if (!_contextMenuInteraction) {
        _contextMenuInteraction = [[UIContextMenuInteraction alloc] initWithDelegate:self];
        [_overlayButton addInteraction:_contextMenuInteraction];
      }
    } else if (_contextMenuInteraction) {
      [_overlayButton removeInteraction:_contextMenuInteraction];
      _contextMenuInteraction = nil;
    }
  }
}

- (void)updateMenu {
  NSMutableArray *actions = [NSMutableArray array];
  
  // Iterate through subviews to find MenuItems
  for (UIView *subview in self.subviews) {
    if ([subview isKindOfClass:[ZynthMenuItemView class]]) {
      ZynthMenuItemView *item = (ZynthMenuItemView *)subview;
      
      UIMenuElementAttributes attributes = 0;
      if (item.destructive) attributes |= UIMenuElementAttributesDestructive;
      if (item.disabled) attributes |= UIMenuElementAttributesDisabled;
      
      __weak ZynthMenuItemView *weakItem = item;
      if (@available(iOS 13.0, *)) {
        UIAction *action = [UIAction actionWithTitle:item.label ?: @""
                                               image:[item imageFromIcon]
                                          identifier:nil
                                             handler:^(__kindof UIAction * _Nonnull action) {
          ZynthMenuItemView *strongItem = weakItem;
          if (strongItem && strongItem.onPress) {
            strongItem.onPress();
          }
        }];
        
        action.attributes = attributes;
        [actions addObject:action];
      }
    }
  }

  if (@available(iOS 13.0, *)) {
    _currentMenu = [UIMenu menuWithTitle:@"" children:actions];
  }
  
  if (@available(iOS 14.0, *)) {
    _overlayButton.menu = _currentMenu;
  }
}

- (UIContextMenuConfiguration *)contextMenuInteraction:(UIContextMenuInteraction *)interaction
                         configurationForMenuAtLocation:(CGPoint)location API_AVAILABLE(ios(13.0)) {
  if (![_triggerOpenBehavior isEqualToString:kZynthMenuOpenOnLongPress]) {
    return nil;
  }

  if (!_currentMenu) {
    return nil;
  }

  return [UIContextMenuConfiguration configurationWithIdentifier:nil
                                                 previewProvider:nil
                                                  actionProvider:^UIMenu * _Nullable(NSArray<UIMenuElement *> * _Nonnull suggestedActions) {
    return self->_currentMenu;
  }];
}

@end
