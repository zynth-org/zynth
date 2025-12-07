#import "RuneMenuItemView.h"
#import "RuneMenuView.h"
#if __has_include("RuneTextView.h")
#import "RuneTextView.h"
#else
#import "../Text/RuneTextView.h"
#endif

@implementation RuneMenuItemView

- (instancetype)init {
  self = [super init];
  if (self) {
    self.hidden = YES;
  }
  return self;
}

- (void)didAddSubview:(UIView *)subview {
  [super didAddSubview:subview];
  [self notifyParent];
}

- (void)notifyParent {
  if ([self.superview isKindOfClass:[RuneMenuView class]]) {
    [(RuneMenuView *)self.superview updateMenu];
  }
}

- (void)setLabel:(NSString *)label {
  _label = label;
  [self notifyParent];
}

- (void)setDestructive:(BOOL)destructive {
  _destructive = destructive;
  [self notifyParent];
}

- (void)setDisabled:(BOOL)disabled {
  _disabled = disabled;
  [self notifyParent];
}

- (void)setOnPress:(void (^)(void))onPress {
  _onPress = onPress;
  // onPress change doesn't need menu rebuild usually, but good for safety
  [self notifyParent];
}

- (UIImage *)imageFromIcon {
  RuneTextView *iconView = nil;
  for (UIView *subview in self.subviews) {
    // Check purely by class name string to avoid linking issues if header not found? 
    // No, better to cast if we imported it.
    if ([subview isKindOfClass:[RuneTextView class]]) {
      iconView = (RuneTextView *)subview;
      break;
    }
  }
  
  if (!iconView) return nil;
  
  NSString *text = iconView.text;
  UIFont *font = iconView.font;
  
  if (!text || text.length == 0 || !font) return nil;
  
  // Create attributes
  NSMutableDictionary *attributes = [NSMutableDictionary dictionary];
  attributes[NSFontAttributeName] = font;
  attributes[NSForegroundColorAttributeName] = iconView.textColor ?: [UIColor blackColor];
  
  CGSize size = [text sizeWithAttributes:attributes];
  // Ceil to ensure full pixel coverage
  size.width = ceil(size.width);
  size.height = ceil(size.height);
  
  if (size.width <= 0 || size.height <= 0) return nil;
  
  UIGraphicsBeginImageContextWithOptions(size, NO, 0.0);
  [text drawInRect:CGRectMake(0, 0, size.width, size.height) withAttributes:attributes];
  UIImage *image = UIGraphicsGetImageFromCurrentImageContext();
  UIGraphicsEndImageContext();
  
  return image;
}

@end
