#import "ZynthProgressIndicatorView.h"

// Size constants matching UIActivityIndicatorView intrinsic sizes
static const CGFloat kZynthProgressIndicatorSmallSize = 20.0;
static const CGFloat kZynthProgressIndicatorLargeSize = 37.0;

@interface ZynthProgressIndicatorView ()
@property(nonatomic, strong, nullable) UIColor *customColor;
@property(nonatomic, copy) NSString *sizeMode;
@property(nonatomic, assign) BOOL shouldAnimate;
@end

@implementation ZynthProgressIndicatorView

- (instancetype)init {
  return [self initWithFrame:CGRectZero];
}

- (instancetype)initWithFrame:(CGRect)frame {
  // Default to medium style (small)
  if (self = [super initWithActivityIndicatorStyle:UIActivityIndicatorViewStyleMedium]) {
    _sizeMode = @"small";
    _pointerMode = ZynthPointerEventsAuto;
    _shouldAnimate = YES;
    self.hidesWhenStopped = NO;
    
    // Position way off-screen and hide initially to avoid a flash at (0,0)
    // before the first layout flush from Yoga.
    self.frame = CGRectMake(-9999, -9999, 0, 0);
    self.hidden = YES;
  }
  return self;
}

#pragma mark - Layout Overrides

- (void)setBounds:(CGRect)bounds {
  [super setBounds:bounds];
  [self _checkInitialLayout];
}

- (void)setCenter:(CGPoint)center {
  [super setCenter:center];
  [self _checkInitialLayout];
}

- (void)_checkInitialLayout {
  // If we have a superview and non-zero bounds, it's likely we've been positioned by Yoga.
  if (self.hidden && self.superview && self.bounds.size.width > 0) {
    self.hidden = NO;
    [self _updateAnimationState];
  }
}

#pragma mark - Intrinsic Size

- (CGSize)intrinsicContentSize {
  if ([_sizeMode isEqualToString:@"large"]) {
    return CGSizeMake(kZynthProgressIndicatorLargeSize, kZynthProgressIndicatorLargeSize);
  }
  return CGSizeMake(kZynthProgressIndicatorSmallSize, kZynthProgressIndicatorSmallSize);
}

- (CGFloat)zynth_indicatorSize {
  if ([_sizeMode isEqualToString:@"large"]) {
    return kZynthProgressIndicatorLargeSize;
  }
  return kZynthProgressIndicatorSmallSize;
}

#pragma mark - Property Setters

- (void)zynth_setColor:(UIColor *)color {
  self.customColor = color;
  self.color = color;
}

- (void)zynth_setSize:(NSString *)size {
  if (!size || [size isEqualToString:_sizeMode]) {
    return;
  }
  
  _sizeMode = size;
  
  if (self.hidden) {
    // Still waiting for initial layout, keep it hidden and away
    if ([size isEqualToString:@"large"]) {
      self.activityIndicatorViewStyle = UIActivityIndicatorViewStyleLarge;
    } else {
      self.activityIndicatorViewStyle = UIActivityIndicatorViewStyleMedium;
    }
    self.frame = CGRectMake(-9999, -9999, 0, 0);
  } else {
    CGRect currentFrame = self.frame;
    if ([size isEqualToString:@"large"]) {
      self.activityIndicatorViewStyle = UIActivityIndicatorViewStyleLarge;
    } else {
      self.activityIndicatorViewStyle = UIActivityIndicatorViewStyleMedium;
    }
    self.frame = currentFrame;
  }
  
  // Restore color after style change (style change resets color)
  if (self.customColor) {
    self.color = self.customColor;
  }
  
  // Restore animation state
  [self _updateAnimationState];
  
  // Invalidate intrinsic content size
  [self invalidateIntrinsicContentSize];
}

- (void)zynth_setAnimating:(BOOL)animating {
  _shouldAnimate = animating;
  [self _updateAnimationState];
}

- (void)_updateAnimationState {
  // Only actually start animating if we are visible (layout done) and should animate.
  if (_shouldAnimate && !self.hidden) {
    [self startAnimating];
  } else {
    [self stopAnimating];
  }
}

@end
