#import "RuneMenuView.h"
#import "RuneMenuItemView.h"

@implementation RuneMenuView {
  UIButton *_overlayButton;
}

- (instancetype)initWithFrame:(CGRect)frame {
  if (self = [super initWithFrame:frame]) {
    _overlayButton = [UIButton buttonWithType:UIButtonTypeCustom];
    _overlayButton.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
    
    if (@available(iOS 14.0, *)) {
      _overlayButton.showsMenuAsPrimaryAction = YES;
    }
    [self addSubview:_overlayButton];
  }
  return self;
}

- (void)layoutSubviews {
  [super layoutSubviews];
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

- (void)updateMenu {
  if (!@available(iOS 14.0, *)) return;

  NSMutableArray *actions = [NSMutableArray array];
  
  // Iterate through subviews to find MenuItems
  // We expect them to be direct children of RuneMenuView
  for (UIView *subview in self.subviews) {
    if ([subview isKindOfClass:[RuneMenuItemView class]]) {
      RuneMenuItemView *item = (RuneMenuItemView *)subview;
      
      UIMenuElementAttributes attributes = 0;
      if (item.destructive) attributes |= UIMenuElementAttributesDestructive;
      if (item.disabled) attributes |= UIMenuElementAttributesDisabled;
      
      // Capture the press handler
      __weak RuneMenuItemView *weakItem = item;
      UIAction *action = [UIAction actionWithTitle:item.label ?: @""
                                             image:[item imageFromIcon]
                                        identifier:nil
                                           handler:^(__kindof UIAction * _Nonnull action) {
        RuneMenuItemView *strongItem = weakItem;
        if (strongItem && strongItem.onPress) {
          strongItem.onPress();
        }
      }];
      
      action.attributes = attributes;
      [actions addObject:action];
    }
  }
  
  UIMenu *menu = [UIMenu menuWithTitle:@"" children:actions];
  _overlayButton.menu = menu;
}

// Hit test: We want the overlay button to capture touches, 
// but visually it's transparent.
// If the Trigger view has its own interactions, this overlay BLOCKS them.
// This is a trade-off. For a "Menu Trigger", usually the whole area triggers the menu.
// If the user puts a TextInput inside a Menu Trigger, they probably didn't mean to.

@end
