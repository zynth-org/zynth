#import "RuneButtonView.h"
#import "SNUIManager+Internal.h"
#import <QuartzCore/QuartzCore.h>

static const CFTimeInterval kRuneButtonLongPressDuration = 0.5;

@interface RuneButtonView ()
@property(nonatomic, weak, nullable) SNUIManager *manager;
@property(nonatomic, weak, nullable) SNNode *node;

// State
@property(nonatomic, assign) BOOL runeDisabled;
@property(nonatomic, assign) BOOL runeLoading;
@property(nonatomic, assign) NSInteger lastCommandSeq;

// Configuration Props
@property(nonatomic, copy) NSString *variant;
@property(nonatomic, copy) NSString *runeRole;
@property(nonatomic, copy) NSString *size;
@property(nonatomic, copy) NSString *buttonTitle;
@property(nonatomic, copy) NSString *rounded;
@property(nonatomic, strong, nullable) UIImage *buttonImage;
@property(nonatomic, strong, nullable) UIColor *baseColor;

// Interaction Props
@property(nonatomic, copy) NSString *pressEffect;
@property(nonatomic, copy) NSString *hapticsMode;
@property(nonatomic, assign) BOOL hasLongPressHandler;
@property(nonatomic, assign) BOOL preventFocusOnPress;
@property(nonatomic, assign) CGFloat pressRetentionOffset;
@property(nonatomic, assign) UIEdgeInsets hitSlopInsets;
@property(nonatomic, assign) CGSize minimumTouchSize;

// Internal State for Long Press / Interaction
@property(nonatomic, strong, nullable) NSTimer *longPressTimer;
@property(nonatomic, assign) CFTimeInterval pressStartTimestamp;
@property(nonatomic, assign) BOOL longPressFired;

@end

@implementation RuneButtonView

- (BOOL)isSystemSubview:(UIView *)subview {
  NSString *name = NSStringFromClass([subview class]);
  return [name hasPrefix:@"_UI"] || [name containsString:@"UIButtonConfiguration"];
}

- (instancetype)init {
  return [self initWithFrame:CGRectZero];
}

- (instancetype)initWithFrame:(CGRect)frame {
  if (self = [super initWithFrame:frame]) {
    // Default values
    _variant = @"plain";
    _runeRole = @"normal";
    _size = @"medium";
    _rounded = @"md";
    _pressRetentionOffset = 14.0;
    _hitSlopInsets = UIEdgeInsetsZero;
    _minimumTouchSize = CGSizeMake(44.0, 44.0);
    _pressEffect = @"highlight";
    _hapticsMode = @"none";
    _lastCommandSeq = -1;
    _pointerMode = RunePointerEventsAuto;
    
    // Setup target-actions for touch events
    [self addTarget:self action:@selector(handleTouchDown) forControlEvents:UIControlEventTouchDown];
    [self addTarget:self action:@selector(handleTouchUp) forControlEvents:UIControlEventTouchUpInside];
    [self addTarget:self action:@selector(handleTouchCancel) forControlEvents:UIControlEventTouchUpOutside | UIControlEventTouchCancel];
    [self addTarget:self action:@selector(handleTouchDragExit) forControlEvents:UIControlEventTouchDragExit];
    
    // Initial Configuration
    if (@available(iOS 15.0, *)) {
      [self updateNativeConfiguration];
    }
  }
  return self;
}

- (void)dealloc {
  [_longPressTimer invalidate];
}

- (void)attachToManager:(SNUIManager *)manager node:(SNNode *)node {
  self.manager = manager;
  self.node = node;
  self.nodeId = node ? node.nid : -1;
}

#pragma mark - Native Configuration (iOS 15+)

- (void)updateNativeConfiguration {
  if (!@available(iOS 15.0, *)) {
    return;
  }

  UIButtonConfiguration *config = nil;
  BOOL usesNativeContent = (self.buttonTitle != nil) || (self.buttonImage != nil);
  
  // 1. Variant
  if ([self.variant isEqualToString:@"filled"]) {
    config = [UIButtonConfiguration filledButtonConfiguration];
  } else if ([self.variant isEqualToString:@"tinted"]) {
    config = [UIButtonConfiguration tintedButtonConfiguration];
  } else if ([self.variant isEqualToString:@"gray"]) {
    config = [UIButtonConfiguration grayButtonConfiguration];
  } else {
    config = [UIButtonConfiguration plainButtonConfiguration];
  }

  // 2. Size
  if ([self.size isEqualToString:@"mini"]) {
    config.buttonSize = UIButtonConfigurationSizeMini;
  } else if ([self.size isEqualToString:@"small"]) {
    config.buttonSize = UIButtonConfigurationSizeSmall;
  } else if ([self.size isEqualToString:@"large"]) {
    config.buttonSize = UIButtonConfigurationSizeLarge;
  } else {
    config.buttonSize = UIButtonConfigurationSizeMedium;
  }

  // 3. Base Color
  if (self.baseColor) {
    if ([self.variant isEqualToString:@"filled"]) {
      config.baseBackgroundColor = self.baseColor;
      config.baseForegroundColor = nil;
    } else {
      config.baseForegroundColor = self.baseColor;
      config.baseBackgroundColor = nil; 
    }
  }

  // 4. Title & Image
  if (self.buttonTitle) {
    config.title = self.buttonTitle;
  } else {
    config.title = nil;
  }
  
  if (self.buttonImage) {
    config.image = self.buttonImage;
  } else {
    config.image = nil;
  }

  if (usesNativeContent) {
    config.titleAlignment = UIButtonConfigurationTitleAlignmentCenter;
    config.imagePadding = 6.0;
  }

  // If we're rendering custom content (no native title/image), let our subviews
  // own the entire content area.
  if (!usesNativeContent) {
    config.contentInsets = NSDirectionalEdgeInsetsZero;
  }
  
  // 5. Loading State
  // Only show native spinner when using native title/image; otherwise it interferes with custom layout.
  config.showsActivityIndicator = self.runeLoading && usesNativeContent;

  // 6. Corner Style
  if ([self.rounded isEqualToString:@"pill"] || [self.rounded isEqualToString:@"full"]) {
    config.cornerStyle = UIButtonConfigurationCornerStyleCapsule;
  } else if ([self.rounded isEqualToString:@"none"]) {
    config.cornerStyle = UIButtonConfigurationCornerStyleFixed;
    if (config.background) {
      config.background.cornerRadius = 0.0;
    }
  } else {
    // Default to system-defined dynamic corner style (available iOS 15+)
    config.cornerStyle = UIButtonConfigurationCornerStyleDynamic;
  }

  // Apply Configuration
  self.configuration = config;
  if (usesNativeContent) {
    self.contentHorizontalAlignment = UIControlContentHorizontalAlignmentCenter;
    self.contentVerticalAlignment = UIControlContentVerticalAlignmentCenter;
  } else {
    self.contentHorizontalAlignment = UIControlContentHorizontalAlignmentFill;
    self.contentVerticalAlignment = UIControlContentVerticalAlignmentFill;
  }
  [self bringCustomContentToFrontIfNeeded];
  
  // Sync legacy properties for compatibility and robust rendering
  [super setTitle:self.buttonTitle forState:UIControlStateNormal];
  [super setImage:self.buttonImage forState:UIControlStateNormal];
  
  // Role
  if ([self.runeRole isEqualToString:@"destructive"]) {
    self.role = UIButtonRoleDestructive;
    self.tintColor = [UIColor systemRedColor];
  } else if ([self.runeRole isEqualToString:@"cancel"]) {
    self.role = UIButtonRoleCancel;
  } else {
    self.role = UIButtonRoleNormal;
  }

  // Disabled State
  self.enabled = !self.runeDisabled;
  
  [self setNeedsLayout];
}

#pragma mark - Prop Setters

- (void)rune_setVariant:(NSString *)variant {
  _variant = variant ?: @"plain";
  [self updateNativeConfiguration];
}

- (void)rune_setRole:(NSString *)role {
  _runeRole = role ?: @"normal";
  [self updateNativeConfiguration];
}

- (void)rune_setSize:(NSString *)size {
  _size = size ?: @"medium";
  [self updateNativeConfiguration];
}

- (void)rune_setTitle:(NSString *)title {
  _buttonTitle = title;
  [self updateNativeConfiguration];
}

- (void)rune_setBaseColor:(UIColor *)color {
  _baseColor = color;
  [self updateNativeConfiguration];
}

- (void)rune_setImage:(UIImage *)image {
  _buttonImage = image;
  [self updateNativeConfiguration];
}

- (void)rune_setRounded:(NSString *)rounded {
  _rounded = rounded ?: @"md";
  [self updateNativeConfiguration];
}

- (void)rune_setDisabled:(BOOL)disabled {
  _runeDisabled = disabled;
  self.enabled = !disabled;
}

- (void)rune_setLoading:(BOOL)loading {
  _runeLoading = loading;
  [self updateNativeConfiguration];
}

- (void)rune_setPressEffect:(NSString *)effect {
  _pressEffect = effect ?: @"highlight";
}

- (void)rune_setPressRetentionOffset:(NSNumber *)offset {
  if (!offset || [offset isKindOfClass:[NSNull class]]) return;
  _pressRetentionOffset = MAX(0.0, offset.doubleValue);
}

- (void)rune_setHitSlop:(id)hitSlop {
  if (!hitSlop || [hitSlop isKindOfClass:[NSNull class]]) {
    _hitSlopInsets = UIEdgeInsetsZero;
    return;
  }
  if ([hitSlop isKindOfClass:[NSNumber class]]) {
    CGFloat inset = ((NSNumber *)hitSlop).doubleValue;
    _hitSlopInsets = UIEdgeInsetsMake(inset, inset, inset, inset);
    return;
  }
  if ([hitSlop isKindOfClass:[NSDictionary class]]) {
    NSDictionary *dict = (NSDictionary *)hitSlop;
    CGFloat top = [dict[@"top"] doubleValue];
    CGFloat left = [dict[@"left"] doubleValue];
    CGFloat bottom = [dict[@"bottom"] doubleValue];
    CGFloat right = [dict[@"right"] doubleValue];
    _hitSlopInsets = UIEdgeInsetsMake(top, left, bottom, right);
  }
}

- (void)rune_setMinimumTouchSize:(id)sizeValue {
  if (!sizeValue || [sizeValue isKindOfClass:[NSNull class]]) {
    _minimumTouchSize = CGSizeMake(44.0, 44.0);
    return;
  }
  if ([sizeValue isKindOfClass:[NSDictionary class]]) {
    NSDictionary *dict = (NSDictionary *)sizeValue;
    CGFloat width = [dict[@"width"] doubleValue];
    CGFloat height = [dict[@"height"] doubleValue];
    _minimumTouchSize = CGSizeMake(MAX(0.0, width), MAX(0.0, height));
  } else {
    _minimumTouchSize = CGSizeMake(44.0, 44.0);
  }
}

- (void)rune_setPreventFocusOnPress:(BOOL)prevent {
  _preventFocusOnPress = prevent;
}

- (void)rune_setHapticsMode:(NSString *)mode {
  _hapticsMode = mode ?: @"none";
}

- (void)rune_setHasLongPressHandler:(BOOL)hasHandler {
  _hasLongPressHandler = hasHandler;
}

#pragma mark - Event Handling

- (void)handleTouchDown {
  self.pressStartTimestamp = CACurrentMediaTime();
  self.longPressFired = NO;
  
  if (self.hasLongPressHandler) {
    [self startLongPressTimer];
  }
  
  [self notifyPressIn];
  [self triggerHapticsIfNeeded];
}

- (void)handleTouchUp {
  [self cancelLongPressTimer];
  
  if (!self.longPressFired) {
    [self notifyActivate];
  }
  
  [self notifyPressOutWithCancel:NO];
}

- (void)handleTouchCancel {
  [self cancelLongPressTimer];
  [self notifyPressOutWithCancel:YES];
}

- (void)handleTouchDragExit {
  [self cancelLongPressTimer];
}

#pragma mark - Long Press

- (void)startLongPressTimer {
  [_longPressTimer invalidate];
  _longPressTimer = [NSTimer scheduledTimerWithTimeInterval:kRuneButtonLongPressDuration
                                                     target:self
                                                   selector:@selector(handleLongPressTimer)
                                                   userInfo:nil
                                                    repeats:NO];
}

- (void)cancelLongPressTimer {
  [_longPressTimer invalidate];
  _longPressTimer = nil;
}

- (void)handleLongPressTimer {
  self.longPressFired = YES;
  if (self.delegate && [self.delegate respondsToSelector:@selector(buttonView:didLongPressWithDuration:)]) {
    [self.delegate buttonView:self didLongPressWithDuration:kRuneButtonLongPressDuration * 1000.0];
  }
}

#pragma mark - Delegate Notifications

- (void)notifyPressIn {
  if (self.delegate && [self.delegate respondsToSelector:@selector(buttonViewDidPressIn:)]) {
    [self.delegate buttonViewDidPressIn:self];
  }
}

- (void)notifyPressOutWithCancel:(BOOL)cancelled {
  if (self.delegate && [self.delegate respondsToSelector:@selector(buttonViewDidPressOut:cancelled:)]) {
    [self.delegate buttonViewDidPressOut:self cancelled:cancelled];
  }
}

- (void)notifyActivate {
  if (self.delegate && [self.delegate respondsToSelector:@selector(buttonViewDidActivate:)]) {
    [self.delegate buttonViewDidActivate:self];
  }
}

- (void)triggerHapticsIfNeeded {
  if (!self.hapticsMode || [self.hapticsMode isEqualToString:@"none"]) return;
  
  UIImpactFeedbackGenerator *generator = nil;
  if ([self.hapticsMode isEqualToString:@"light"]) {
    generator = [[UIImpactFeedbackGenerator alloc] initWithStyle:UIImpactFeedbackStyleLight];
  } else if ([self.hapticsMode isEqualToString:@"medium"]) {
    generator = [[UIImpactFeedbackGenerator alloc] initWithStyle:UIImpactFeedbackStyleMedium];
  } else if ([self.hapticsMode isEqualToString:@"heavy"]) {
    generator = [[UIImpactFeedbackGenerator alloc] initWithStyle:UIImpactFeedbackStyleHeavy];
  }
  
  if (generator) {
    [generator impactOccurred];
  }
}

#pragma mark - Hit Testing & Layout

- (BOOL)pointInside:(CGPoint)point withEvent:(UIEvent *)event {
  CGRect bounds = self.bounds;
  
  if (bounds.size.width < self.minimumTouchSize.width) {
    CGFloat inset = (self.minimumTouchSize.width - bounds.size.width) / 2.0;
    bounds = CGRectInset(bounds, -inset, 0);
  }
  if (bounds.size.height < self.minimumTouchSize.height) {
    CGFloat inset = (self.minimumTouchSize.height - bounds.size.height) / 2.0;
    bounds = CGRectInset(bounds, 0, -inset);
  }
  
  bounds.origin.x -= self.hitSlopInsets.left;
  bounds.origin.y -= self.hitSlopInsets.top;
  bounds.size.width += (self.hitSlopInsets.left + self.hitSlopInsets.right);
  bounds.size.height += (self.hitSlopInsets.top + self.hitSlopInsets.bottom);
  
  return CGRectContainsPoint(bounds, point);
}

- (UIView *)hitTest:(CGPoint)point withEvent:(UIEvent *)event {
  if (self.hidden || self.alpha <= 0.01) return nil;

  // Respect Pointer Events Mode
  switch (self.pointerMode) {
    case RunePointerEventsNone:
      return nil;

    case RunePointerEventsBoxNone: {
      // Pass through to children, but don't catch self
      for (UIView *subview in self.subviews.reverseObjectEnumerator) {
        CGPoint converted = [subview convertPoint:point fromView:self];
        UIView *hit = [subview hitTest:converted withEvent:event];
        if (hit) return hit;
      }
      return nil;
    }

    case RunePointerEventsBoxOnly:
      // Catch self if inside, ignore children
      return [self pointInside:point withEvent:event] ? self : nil;

    case RunePointerEventsAuto:
    default:
      return [super hitTest:point withEvent:event];
  }
}

- (void)rune_handleCommand:(NSDictionary *)command {
    NSString *type = command[@"type"];
    if ([type isEqualToString:@"focus"]) {
        [self becomeFirstResponder];
    } else if ([type isEqualToString:@"blur"]) {
        [self resignFirstResponder];
    } else if ([type isEqualToString:@"click"]) {
        [self sendActionsForControlEvents:UIControlEventTouchUpInside];
    }
}

#pragma mark - Z-Ordering Helpers

- (void)bringCustomContentToFrontIfNeeded {
  if (self.buttonTitle || self.buttonImage) return;
  for (UIView *subview in self.subviews) {
    if (![self isSystemSubview:subview]) {
      subview.userInteractionEnabled = NO;
      [self bringSubviewToFront:subview];
    }
  }
}

- (void)didAddSubview:(UIView *)subview {
  [super didAddSubview:subview];
  if (![self isSystemSubview:subview]) {
    subview.userInteractionEnabled = NO; // let touches reach the button
    if (!self.buttonTitle && !self.buttonImage) {
      [self bringSubviewToFront:subview];
    }
  }
}

@end
