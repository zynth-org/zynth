#import "ZynthProgressIndicatorView.h"

// Size constants matching UIActivityIndicatorView intrinsic sizes
static const CGFloat kZynthProgressIndicatorSmallSize = 20.0;
static const CGFloat kZynthProgressIndicatorLargeSize = 37.0;

@interface ZynthProgressIndicatorView ()
@property(nonatomic, strong, nullable) UIColor *customColor;
@property(nonatomic, copy) NSString *sizeMode;
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
    self.hidesWhenStopped = NO;
    [self startAnimating];
  }
  return self;
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

- (void)zynth_setAnimating:(BOOL)animating {
  if (animating) {
    [self startAnimating];
  } else {
    [self stopAnimating];
  }
}

@end
