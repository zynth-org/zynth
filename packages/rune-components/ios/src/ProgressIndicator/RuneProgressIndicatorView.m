#import "RuneProgressIndicatorView.h"

// Size constants matching UIActivityIndicatorView intrinsic sizes
static const CGFloat kRuneProgressIndicatorSmallSize = 20.0;
static const CGFloat kRuneProgressIndicatorLargeSize = 37.0;

@interface RuneProgressIndicatorView ()
@property(nonatomic, strong, nullable) UIColor *customColor;
@property(nonatomic, copy) NSString *sizeMode;
@end

@implementation RuneProgressIndicatorView

- (instancetype)init {
  return [self initWithFrame:CGRectZero];
}

- (instancetype)initWithFrame:(CGRect)frame {
  // Default to medium style (small)
  if (self = [super initWithActivityIndicatorStyle:UIActivityIndicatorViewStyleMedium]) {
    _sizeMode = @"small";
    _pointerMode = RunePointerEventsAuto;
    self.hidesWhenStopped = NO;
    [self startAnimating];
  }
  return self;
}

#pragma mark - Intrinsic Size

- (CGSize)intrinsicContentSize {
  if ([_sizeMode isEqualToString:@"large"]) {
    return CGSizeMake(kRuneProgressIndicatorLargeSize, kRuneProgressIndicatorLargeSize);
  }
  return CGSizeMake(kRuneProgressIndicatorSmallSize, kRuneProgressIndicatorSmallSize);
}

- (CGFloat)rune_indicatorSize {
  if ([_sizeMode isEqualToString:@"large"]) {
    return kRuneProgressIndicatorLargeSize;
  }
  return kRuneProgressIndicatorSmallSize;
}

#pragma mark - Property Setters

- (void)rune_setColor:(UIColor *)color {
  self.customColor = color;
  self.color = color;
}

- (void)rune_setSize:(NSString *)size {
  if (!size || [size isEqualToString:_sizeMode]) {
    return;
  }
  
  _sizeMode = size;
  
  BOOL wasAnimating = self.isAnimating;
  
  if ([size isEqualToString:@"large"]) {
    self.activityIndicatorViewStyle = UIActivityIndicatorViewStyleLarge;
  } else {
    // "small" or default
    self.activityIndicatorViewStyle = UIActivityIndicatorViewStyleMedium;
  }
  
  // Restore color after style change (style change resets color)
  if (self.customColor) {
    self.color = self.customColor;
  }
  
  // Restore animation state
  if (wasAnimating) {
    [self startAnimating];
  }
  
  // Invalidate intrinsic content size
  [self invalidateIntrinsicContentSize];
}

- (void)rune_setAnimating:(BOOL)animating {
  if (animating) {
    [self startAnimating];
  } else {
    [self stopAnimating];
  }
}

@end
