#import "ZynthNativePerformanceOverlayManager.h"
#import "ZynthRuntime.h"

#import <float.h>
#import <math.h>
#import <mach/mach.h>
#import <QuartzCore/QuartzCore.h>
#import <UIKit/UIKit.h>

@interface ZynthNativePerformanceOverlayManager ()
@property(nonatomic, weak) ZynthRuntime *runtime;
@property(nonatomic, weak) UIView *rootView;
@property(nonatomic, strong) UIView *performanceOverlay;
@property(nonatomic, strong) UILabel *performanceRamValueLabel;
@property(nonatomic, strong) UILabel *performanceViewsValueLabel;
@property(nonatomic, strong) UILabel *performanceUiFpsValueLabel;
@property(nonatomic, strong) UILabel *performanceJsFpsValueLabel;
@property(nonatomic, strong) UILabel *performanceChevronLabel;
@property(nonatomic, strong) UIStackView *performanceBudgetDetailsStack;
@property(nonatomic, strong) UILabel *performanceLastPassValueLabel;
@property(nonatomic, strong) UILabel *performanceShortestPassValueLabel;
@property(nonatomic, strong) UILabel *performanceLongestPassValueLabel;
@property(nonatomic, strong) UILabel *performanceBudgetOverrunsValueLabel;
@property(nonatomic, strong) UILabel *performanceBudgetPassesValueLabel;
@property(nonatomic, assign) BOOL performanceEnabled;
@property(nonatomic, assign) BOOL performanceOverlayExpanded;
@property(nonatomic, assign) NSUInteger performanceUiFrameCount;
@property(nonatomic, assign) NSUInteger performanceJsTickCount;
@property(nonatomic, assign) NSUInteger performanceNodeCount;
@property(nonatomic, assign) NSUInteger performanceRamMb;
@property(nonatomic, assign) NSUInteger performanceUiFps;
@property(nonatomic, assign) NSUInteger performanceJsFps;
@property(nonatomic, assign) CFTimeInterval performanceLastSampleTs;
@property(nonatomic, assign) BOOL performanceJSPingPending;
@property(nonatomic, assign) CGPoint performanceDragOrigin;
@property(nonatomic, strong) CADisplayLink *performanceDisplayLink;
@property(nonatomic, assign) double performanceUiFpsEma;
@property(nonatomic, assign) double performanceJsFpsEma;
@property(nonatomic, assign) BOOL performanceUiWarnActive;
@property(nonatomic, assign) BOOL performanceJsWarnActive;
@property(nonatomic, assign) NSUInteger performanceUiWarnStreak;
@property(nonatomic, assign) NSUInteger performanceJsWarnStreak;
@property(nonatomic, assign) NSUInteger performanceUiRecoverStreak;
@property(nonatomic, assign) NSUInteger performanceJsRecoverStreak;
@property(nonatomic, assign) NSUInteger performanceBudgetPasses;
@property(nonatomic, assign) NSUInteger performanceBudgetOverruns;
@property(nonatomic, assign) NSTimeInterval performanceLastPassMs;
@property(nonatomic, assign) NSTimeInterval performanceShortestPassMs;
@property(nonatomic, assign) NSTimeInterval performanceLongestPassMs;
- (void)resetPerformanceCounters;
- (void)ensurePerformanceOverlayVisible;
- (void)removePerformanceOverlay;
- (void)samplePerformanceIfNeeded;
- (void)updatePerformanceOverlayLabels;
- (NSUInteger)residentMemoryInMB;
- (void)positionPerformanceOverlayAtDefault;
- (void)clampPerformanceOverlayToBounds;
- (void)onPerformanceOverlayPan:(UIPanGestureRecognizer *)recognizer;
- (void)onPerformanceOverlayTap:(UITapGestureRecognizer *)recognizer;
- (UIView *)performanceMetricColumnWithTitle:(NSString *)title
	                                  valueLabel:(UILabel **)valueLabel
	                                  valueColor:(UIColor *)valueColor;
- (UIView *)performanceBudgetRowWithTitle:(NSString *)title valueLabel:(UILabel **)valueLabel;
- (void)recordBudgetPassWithFrameMs:(NSTimeInterval)frameMs overBudget:(BOOL)overBudget;
- (void)togglePerformanceOverlayExpanded;
- (void)applyPerformanceOverlayExpandedState;
- (NSString *)formatMilliseconds:(NSTimeInterval)value;
- (void)startDisplayLink;
- (void)stopDisplayLink;
- (void)onDisplayLinkTick:(CADisplayLink *)displayLink;
- (NSUInteger)targetFramesPerSecond;
- (NSUInteger)countViewsRecursively:(UIView *)view;
- (void)updateWarnStateForTargetFps:(NSUInteger)targetFps;
@end

static const double ZynthPerfFpsEmaAlpha = 0.26;
static const NSUInteger ZynthPerfWarnOffset = 6;
static const NSUInteger ZynthPerfRecoverOffset = 3;
static const NSUInteger ZynthPerfWarnSamples = 3;
static const NSUInteger ZynthPerfRecoverSamples = 2;
static const CGFloat ZynthPerfOverlayCollapsedHeight = 62.0;
static const CGFloat ZynthPerfOverlayExpandedHeight = 142.0;

@implementation ZynthNativePerformanceOverlayManager

+ (instancetype)shared {
  static ZynthNativePerformanceOverlayManager *instance;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    instance = [[ZynthNativePerformanceOverlayManager alloc] init];
  });
  return instance;
}

- (void)attachRuntime:(ZynthRuntime *)runtime {
  self.runtime = runtime;
  self.rootView = runtime.rootView;
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self.performanceEnabled) {
      [self ensurePerformanceOverlayVisible];
    }
  });
}

- (void)detach {
  dispatch_async(dispatch_get_main_queue(), ^{
    [self stopDisplayLink];
    [self removePerformanceOverlay];
    self.performanceEnabled = NO;
    [self resetPerformanceCounters];
  });
  self.runtime = nil;
  self.rootView = nil;
}

- (void)setPerformanceOverlayEnabled:(BOOL)enabled {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self.performanceEnabled == enabled) {
      if (enabled) {
        [self ensurePerformanceOverlayVisible];
      }
      return;
    }
    self.performanceEnabled = enabled;
    [self resetPerformanceCounters];
    if (!enabled) {
      [self stopDisplayLink];
      [self removePerformanceOverlay];
      return;
    }
    [self startDisplayLink];
    [self ensurePerformanceOverlayVisible];
    [self updatePerformanceOverlayLabels];
  });
}

- (NSDictionary<NSString *, NSNumber *> *)performanceOverlaySnapshot {
  __block NSDictionary<NSString *, NSNumber *> *snapshot = nil;
  dispatch_block_t readBlock = ^{
    snapshot = @{
      @"enabled": @(self.performanceEnabled),
      @"ramMb": @(self.performanceRamMb),
	      @"views": @(self.performanceNodeCount),
	      @"uiFps": @(self.performanceUiFps),
	      @"jsFps": @(self.performanceJsFps),
	      @"lastPassMs": @(self.performanceLastPassMs),
	      @"shortestPassMs": @(self.performanceBudgetPasses > 0 ? self.performanceShortestPassMs : 0.0),
	      @"longestPassMs": @(self.performanceLongestPassMs),
	      @"budgetOverruns": @(self.performanceBudgetOverruns),
	      @"totalPasses": @(self.performanceBudgetPasses),
	    };
	  };
  if ([NSThread isMainThread]) {
    readBlock();
  } else {
    dispatch_sync(dispatch_get_main_queue(), readBlock);
  }
  return snapshot ?: @{};
}

- (void)recordPerformanceFrameWithFrameMs:(NSTimeInterval)frameMs
                               overBudget:(BOOL)overBudget
                                 nodeCount:(NSUInteger)nodeCount {
  dispatch_block_t updateBlock = ^{
    if (!self.performanceEnabled) return;
    self.performanceNodeCount = nodeCount;
    [self ensurePerformanceOverlayVisible];
    [self recordBudgetPassWithFrameMs:frameMs overBudget:overBudget];
    if (self.performanceOverlay != nil && self.rootView != nil) {
      [self.rootView bringSubviewToFront:self.performanceOverlay];
    }
  };
  if ([NSThread isMainThread]) {
    updateBlock();
  } else {
    dispatch_async(dispatch_get_main_queue(), updateBlock);
  }
}

- (BOOL)requestPerformanceJSPing {
  __block BOOL shouldSchedule = NO;
  dispatch_block_t decideBlock = ^{
    if (!self.performanceEnabled) {
      self.performanceJSPingPending = NO;
      shouldSchedule = NO;
      return;
    }
    if (self.performanceJSPingPending) {
      shouldSchedule = NO;
      return;
    }
    self.performanceJSPingPending = YES;
    shouldSchedule = YES;
  };
  if ([NSThread isMainThread]) {
    decideBlock();
  } else {
    dispatch_sync(dispatch_get_main_queue(), decideBlock);
  }
  return shouldSchedule;
}

- (void)recordPerformanceJSPing {
  dispatch_async(dispatch_get_main_queue(), ^{
    self.performanceJSPingPending = NO;
    if (!self.performanceEnabled) return;
    self.performanceJsTickCount += 1;
  });
}

- (void)resetPerformanceCounters {
  self.performanceUiFrameCount = 0;
  self.performanceJsTickCount = 0;
  self.performanceNodeCount = 0;
  self.performanceRamMb = 0;
  self.performanceUiFps = 0;
  self.performanceJsFps = 0;
  self.performanceLastSampleTs = CACurrentMediaTime();
  self.performanceJSPingPending = NO;
  self.performanceUiFpsEma = -1.0;
  self.performanceJsFpsEma = -1.0;
  self.performanceUiWarnActive = NO;
  self.performanceJsWarnActive = NO;
  self.performanceUiWarnStreak = 0;
	  self.performanceJsWarnStreak = 0;
	  self.performanceUiRecoverStreak = 0;
	  self.performanceJsRecoverStreak = 0;
	  self.performanceBudgetPasses = 0;
	  self.performanceBudgetOverruns = 0;
	  self.performanceLastPassMs = 0.0;
	  self.performanceShortestPassMs = DBL_MAX;
	  self.performanceLongestPassMs = 0.0;
	}

- (void)ensurePerformanceOverlayVisible {
  UIView *root = self.rootView;
  if (!root || !self.performanceEnabled) return;

  if (self.performanceOverlay != nil && self.performanceOverlay.superview != root) {
    [self.performanceOverlay removeFromSuperview];
    [root addSubview:self.performanceOverlay];
  }

  if (self.performanceOverlay == nil) {
    CGFloat horizontal = 16.0;
    CGFloat topInset = root.safeAreaInsets.top;
    CGFloat availableWidth = MAX(210.0, root.bounds.size.width - horizontal * 2.0);
    CGFloat width = MIN(360.0, availableWidth);
	    CGFloat height = self.performanceOverlayExpanded ? ZynthPerfOverlayExpandedHeight : ZynthPerfOverlayCollapsedHeight;
	    CGRect frame = CGRectMake(horizontal, topInset + 10.0, width, height);
    UIView *pill = [[UIView alloc] initWithFrame:frame];
    pill.autoresizingMask = UIViewAutoresizingNone;
    pill.backgroundColor = [UIColor colorWithRed:0.06 green:0.07 blue:0.10 alpha:0.68];
    pill.layer.cornerRadius = 18.0;
    pill.layer.borderWidth = 1.0;
    pill.layer.borderColor = [UIColor colorWithRed:0.27 green:0.30 blue:0.35 alpha:0.55].CGColor;
    if (@available(iOS 13.0, *)) {
      pill.layer.cornerCurve = kCACornerCurveContinuous;
    }
    pill.layer.zPosition = 100001.0;
    pill.clipsToBounds = YES;

	    UIPanGestureRecognizer *pan =
	      [[UIPanGestureRecognizer alloc] initWithTarget:self action:@selector(onPerformanceOverlayPan:)];
	    [pill addGestureRecognizer:pan];
	    UITapGestureRecognizer *tap =
	      [[UITapGestureRecognizer alloc] initWithTarget:self action:@selector(onPerformanceOverlayTap:)];
	    [pill addGestureRecognizer:tap];

    UIVisualEffectView *blur = nil;
    if (@available(iOS 13.0, *)) {
      blur = [[UIVisualEffectView alloc] initWithEffect:[UIBlurEffect effectWithStyle:UIBlurEffectStyleSystemUltraThinMaterialDark]];
      blur.frame = pill.bounds;
      blur.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
      blur.userInteractionEnabled = NO;
      [pill addSubview:blur];
    }

	    UIStackView *stack = [[UIStackView alloc] init];
	    stack.translatesAutoresizingMaskIntoConstraints = NO;
	    stack.axis = UILayoutConstraintAxisVertical;
	    stack.alignment = UIStackViewAlignmentFill;
	    stack.distribution = UIStackViewDistributionFill;
	    stack.spacing = 8.0;

	    UIStackView *row = [[UIStackView alloc] init];
	    row.axis = UILayoutConstraintAxisHorizontal;
	    row.alignment = UIStackViewAlignmentFill;
	    row.distribution = UIStackViewDistributionFill;
	    row.spacing = 8.0;

    UILabel *ramValue = nil;
    UILabel *viewsValue = nil;
    UILabel *uiValue = nil;
    UILabel *jsValue = nil;
    UIView *ramColumn = [self performanceMetricColumnWithTitle:@"RAM" valueLabel:&ramValue valueColor:[UIColor colorWithWhite:0.90 alpha:1.0]];
	    UIView *viewsColumn = [self performanceMetricColumnWithTitle:@"VIEWS" valueLabel:&viewsValue valueColor:[UIColor colorWithWhite:0.90 alpha:1.0]];
	    UIView *uiColumn = [self performanceMetricColumnWithTitle:@"UI" valueLabel:&uiValue valueColor:[UIColor colorWithRed:0.30 green:0.86 blue:0.57 alpha:1.0]];
	    UIView *jsColumn = [self performanceMetricColumnWithTitle:@"JS" valueLabel:&jsValue valueColor:[UIColor colorWithRed:0.34 green:0.91 blue:0.63 alpha:1.0]];
	    UILabel *chevronLabel = [[UILabel alloc] init];
	    chevronLabel.text = @"v";
	    chevronLabel.textColor = [UIColor colorWithWhite:0.90 alpha:1.0];
	    chevronLabel.font = [UIFont systemFontOfSize:18.0 weight:UIFontWeightBold];
	    chevronLabel.textAlignment = NSTextAlignmentCenter;

	    [row addArrangedSubview:ramColumn];
	    [row addArrangedSubview:viewsColumn];
	    [row addArrangedSubview:uiColumn];
	    [row addArrangedSubview:jsColumn];
	    [row addArrangedSubview:chevronLabel];
	    [NSLayoutConstraint activateConstraints:@[
	      [viewsColumn.widthAnchor constraintEqualToAnchor:ramColumn.widthAnchor],
	      [uiColumn.widthAnchor constraintEqualToAnchor:ramColumn.widthAnchor],
	      [jsColumn.widthAnchor constraintEqualToAnchor:ramColumn.widthAnchor],
	      [chevronLabel.widthAnchor constraintEqualToConstant:30.0],
	    ]];

	    UILabel *lastPassValue = nil;
	    UILabel *shortestPassValue = nil;
	    UILabel *longestPassValue = nil;
	    UILabel *overrunsValue = nil;
	    UILabel *passesValue = nil;
	    UIStackView *details = [[UIStackView alloc] init];
	    details.axis = UILayoutConstraintAxisVertical;
	    details.alignment = UIStackViewAlignmentFill;
	    details.distribution = UIStackViewDistributionFill;
	    details.spacing = 2.0;
	    [details addArrangedSubview:[self performanceBudgetRowWithTitle:@"Last Pass" valueLabel:&lastPassValue]];
	    [details addArrangedSubview:[self performanceBudgetRowWithTitle:@"Shortest" valueLabel:&shortestPassValue]];
	    [details addArrangedSubview:[self performanceBudgetRowWithTitle:@"Longest" valueLabel:&longestPassValue]];
	    [details addArrangedSubview:[self performanceBudgetRowWithTitle:@"Overruns" valueLabel:&overrunsValue]];
	    [details addArrangedSubview:[self performanceBudgetRowWithTitle:@"Passes" valueLabel:&passesValue]];
	    details.hidden = !self.performanceOverlayExpanded;
	    [stack addArrangedSubview:row];
	    [stack addArrangedSubview:details];

	    [pill addSubview:stack];
	    [NSLayoutConstraint activateConstraints:@[
	      [stack.leadingAnchor constraintEqualToAnchor:pill.leadingAnchor constant:10.0],
	      [stack.trailingAnchor constraintEqualToAnchor:pill.trailingAnchor constant:-10.0],
	      [stack.topAnchor constraintEqualToAnchor:pill.topAnchor constant:6.0],
	      [stack.bottomAnchor constraintLessThanOrEqualToAnchor:pill.bottomAnchor constant:-6.0],
	    ]];

	    self.performanceRamValueLabel = ramValue;
	    self.performanceViewsValueLabel = viewsValue;
	    self.performanceUiFpsValueLabel = uiValue;
	    self.performanceJsFpsValueLabel = jsValue;
	    self.performanceChevronLabel = chevronLabel;
	    self.performanceBudgetDetailsStack = details;
	    self.performanceLastPassValueLabel = lastPassValue;
	    self.performanceShortestPassValueLabel = shortestPassValue;
	    self.performanceLongestPassValueLabel = longestPassValue;
	    self.performanceBudgetOverrunsValueLabel = overrunsValue;
	    self.performanceBudgetPassesValueLabel = passesValue;
	    self.performanceOverlay = pill;

	    [root addSubview:pill];
	    [self positionPerformanceOverlayAtDefault];
	    [self applyPerformanceOverlayExpandedState];
	  }

  [self clampPerformanceOverlayToBounds];
  [root bringSubviewToFront:self.performanceOverlay];
}

- (void)removePerformanceOverlay {
  [self.performanceOverlay removeFromSuperview];
  self.performanceOverlay = nil;
  self.performanceRamValueLabel = nil;
	  self.performanceViewsValueLabel = nil;
	  self.performanceUiFpsValueLabel = nil;
	  self.performanceJsFpsValueLabel = nil;
	  self.performanceChevronLabel = nil;
	  self.performanceBudgetDetailsStack = nil;
	  self.performanceLastPassValueLabel = nil;
	  self.performanceShortestPassValueLabel = nil;
	  self.performanceLongestPassValueLabel = nil;
	  self.performanceBudgetOverrunsValueLabel = nil;
	  self.performanceBudgetPassesValueLabel = nil;
	  self.performanceJSPingPending = NO;
	}

- (void)samplePerformanceIfNeeded {
  CFTimeInterval now = CACurrentMediaTime();
  if (self.performanceLastSampleTs <= 0.0) {
    self.performanceLastSampleTs = now;
    return;
  }
  CFTimeInterval elapsed = now - self.performanceLastSampleTs;
  if (elapsed < 1.0) return;

  NSUInteger rawUiFps = (NSUInteger)llround((double)self.performanceUiFrameCount / elapsed);
  NSUInteger rawJsFps = (NSUInteger)llround((double)self.performanceJsTickCount / elapsed);
  if (self.performanceUiFpsEma < 0.0) {
    self.performanceUiFpsEma = (double)rawUiFps;
  } else {
    self.performanceUiFpsEma = self.performanceUiFpsEma * (1.0 - ZynthPerfFpsEmaAlpha) + (double)rawUiFps * ZynthPerfFpsEmaAlpha;
  }
  if (self.performanceJsFpsEma < 0.0) {
    self.performanceJsFpsEma = (double)rawJsFps;
  } else {
    self.performanceJsFpsEma = self.performanceJsFpsEma * (1.0 - ZynthPerfFpsEmaAlpha) + (double)rawJsFps * ZynthPerfFpsEmaAlpha;
  }
  NSUInteger targetFps = [self targetFramesPerSecond];
  self.performanceUiFps = (NSUInteger)MIN((double)targetFps, MAX(0.0, llround(self.performanceUiFpsEma)));
  self.performanceJsFps = (NSUInteger)MIN((double)targetFps, MAX(0.0, llround(self.performanceJsFpsEma)));
  [self updateWarnStateForTargetFps:targetFps];
  self.performanceRamMb = [self residentMemoryInMB];
  if (self.rootView != nil) {
    self.performanceNodeCount = [self countViewsRecursively:self.rootView];
  }
  self.performanceUiFrameCount = 0;
  self.performanceJsTickCount = 0;
  self.performanceLastSampleTs = now;
  [self updatePerformanceOverlayLabels];
}

- (void)updatePerformanceOverlayLabels {
  if (self.performanceOverlay == nil) return;

  self.performanceRamValueLabel.text = [NSString stringWithFormat:@"%luMB", (unsigned long)self.performanceRamMb];
	  self.performanceViewsValueLabel.text = [NSString stringWithFormat:@"%lu", (unsigned long)self.performanceNodeCount];
	  self.performanceUiFpsValueLabel.text = [NSString stringWithFormat:@"%lu", (unsigned long)self.performanceUiFps];
	  self.performanceJsFpsValueLabel.text = [NSString stringWithFormat:@"%lu", (unsigned long)self.performanceJsFps];
	  self.performanceLastPassValueLabel.text = [self formatMilliseconds:self.performanceLastPassMs];
	  self.performanceShortestPassValueLabel.text =
	    [self formatMilliseconds:(self.performanceBudgetPasses > 0 ? self.performanceShortestPassMs : 0.0)];
	  self.performanceLongestPassValueLabel.text = [self formatMilliseconds:self.performanceLongestPassMs];
	  self.performanceBudgetOverrunsValueLabel.text =
	    [NSString stringWithFormat:@"%lu", (unsigned long)self.performanceBudgetOverruns];
	  self.performanceBudgetPassesValueLabel.text =
	    [NSString stringWithFormat:@"%lu", (unsigned long)self.performanceBudgetPasses];

	  UIColor *goodColor = [UIColor colorWithRed:0.30 green:0.86 blue:0.57 alpha:1.0];
  UIColor *warnColor = [UIColor colorWithRed:0.98 green:0.80 blue:0.22 alpha:1.0];
  self.performanceUiFpsValueLabel.textColor = self.performanceUiWarnActive ? warnColor : goodColor;
  self.performanceJsFpsValueLabel.textColor = self.performanceJsWarnActive ? warnColor : goodColor;
}

- (NSUInteger)residentMemoryInMB {
  mach_task_basic_info_data_t info;
  mach_msg_type_number_t count = MACH_TASK_BASIC_INFO_COUNT;
  kern_return_t result = task_info(mach_task_self_, MACH_TASK_BASIC_INFO, (task_info_t)&info, &count);
  if (result != KERN_SUCCESS) return 0;
  return (NSUInteger)llround((double)info.resident_size / (1024.0 * 1024.0));
}

- (void)positionPerformanceOverlayAtDefault {
  UIView *root = self.rootView;
  UIView *overlay = self.performanceOverlay;
  if (!root || !overlay) return;
  CGFloat left = 16.0;
  CGFloat top = root.safeAreaInsets.top + 10.0;
  CGRect frame = overlay.frame;
  frame.origin.x = left;
  frame.origin.y = top;
  overlay.frame = frame;
}

- (void)clampPerformanceOverlayToBounds {
  UIView *root = self.rootView;
  UIView *overlay = self.performanceOverlay;
  if (!root || !overlay) return;
  UIEdgeInsets insets = root.safeAreaInsets;
  CGFloat minX = 8.0;
  CGFloat maxX = MAX(minX, root.bounds.size.width - overlay.bounds.size.width - 8.0);
  CGFloat minY = insets.top + 8.0;
  CGFloat maxY = MAX(minY, root.bounds.size.height - insets.bottom - overlay.bounds.size.height - 8.0);
  CGRect frame = overlay.frame;
  frame.origin.x = MIN(maxX, MAX(minX, frame.origin.x));
  frame.origin.y = MIN(maxY, MAX(minY, frame.origin.y));
  overlay.frame = frame;
}

- (void)onPerformanceOverlayPan:(UIPanGestureRecognizer *)recognizer {
  UIView *overlay = self.performanceOverlay;
  UIView *root = self.rootView;
  if (!overlay || !root) return;

  CGPoint translation = [recognizer translationInView:root];
  if (recognizer.state == UIGestureRecognizerStateBegan) {
    self.performanceDragOrigin = overlay.frame.origin;
  }

  if (recognizer.state == UIGestureRecognizerStateChanged ||
      recognizer.state == UIGestureRecognizerStateEnded ||
      recognizer.state == UIGestureRecognizerStateCancelled) {
    CGRect frame = overlay.frame;
    frame.origin.x = self.performanceDragOrigin.x + translation.x;
    frame.origin.y = self.performanceDragOrigin.y + translation.y;
    overlay.frame = frame;
    [self clampPerformanceOverlayToBounds];
	  }
	}

- (void)onPerformanceOverlayTap:(UITapGestureRecognizer *)recognizer {
  UIView *overlay = self.performanceOverlay;
  if (!overlay || recognizer.state != UIGestureRecognizerStateEnded) return;
  CGPoint location = [recognizer locationInView:overlay];
  if (location.x >= overlay.bounds.size.width - 52.0 && location.y <= ZynthPerfOverlayCollapsedHeight) {
    [self togglePerformanceOverlayExpanded];
  }
}

- (UIView *)performanceMetricColumnWithTitle:(NSString *)title
	                                  valueLabel:(UILabel **)valueLabel
	                                  valueColor:(UIColor *)valueColor {
  UIStackView *column = [[UIStackView alloc] init];
  column.axis = UILayoutConstraintAxisVertical;
  column.alignment = UIStackViewAlignmentCenter;
  column.distribution = UIStackViewDistributionFill;
  column.spacing = 2.0;

  UILabel *titleLabel = [[UILabel alloc] init];
  titleLabel.text = title;
  titleLabel.textColor = [UIColor colorWithWhite:0.68 alpha:0.95];
  titleLabel.font = [UIFont systemFontOfSize:9 weight:UIFontWeightHeavy];
  titleLabel.textAlignment = NSTextAlignmentCenter;
  [column addArrangedSubview:titleLabel];

  UILabel *metricValue = [[UILabel alloc] init];
  metricValue.text = @"0";
  metricValue.textColor = valueColor;
  metricValue.font = [UIFont monospacedDigitSystemFontOfSize:12 weight:UIFontWeightSemibold];
  metricValue.textAlignment = NSTextAlignmentCenter;
  [column addArrangedSubview:metricValue];

  if (valueLabel != NULL) {
    *valueLabel = metricValue;
	  }
	  return column;
	}

- (UIView *)performanceBudgetRowWithTitle:(NSString *)title valueLabel:(UILabel **)valueLabel {
  UIStackView *row = [[UIStackView alloc] init];
  row.axis = UILayoutConstraintAxisHorizontal;
  row.alignment = UIStackViewAlignmentCenter;
  row.distribution = UIStackViewDistributionFill;
  row.spacing = 8.0;

  UILabel *titleLabel = [[UILabel alloc] init];
  titleLabel.text = title;
  titleLabel.textColor = [UIColor colorWithWhite:0.68 alpha:0.95];
  titleLabel.font = [UIFont systemFontOfSize:10.0 weight:UIFontWeightSemibold];
  titleLabel.textAlignment = NSTextAlignmentLeft;
  [row addArrangedSubview:titleLabel];

  UILabel *metricValue = [[UILabel alloc] init];
  metricValue.text = @"0";
  metricValue.textColor = [UIColor colorWithWhite:0.90 alpha:1.0];
  metricValue.font = [UIFont monospacedDigitSystemFontOfSize:10.0 weight:UIFontWeightSemibold];
  metricValue.textAlignment = NSTextAlignmentRight;
  [row addArrangedSubview:metricValue];
  NSLayoutConstraint *valueWidth = [metricValue.widthAnchor constraintGreaterThanOrEqualToConstant:96.0];
  valueWidth.active = YES;

  if (valueLabel != NULL) {
    *valueLabel = metricValue;
  }
  return row;
}

- (void)recordBudgetPassWithFrameMs:(NSTimeInterval)frameMs overBudget:(BOOL)overBudget {
  if (!isfinite(frameMs) || frameMs < 0.0) return;
  self.performanceBudgetPasses += 1;
  self.performanceLastPassMs = frameMs;
  self.performanceShortestPassMs = MIN(self.performanceShortestPassMs, frameMs);
  self.performanceLongestPassMs = MAX(self.performanceLongestPassMs, frameMs);
  if (overBudget) {
    self.performanceBudgetOverruns += 1;
  }
  [self updatePerformanceOverlayLabels];
}

- (void)togglePerformanceOverlayExpanded {
  self.performanceOverlayExpanded = !self.performanceOverlayExpanded;
  [self applyPerformanceOverlayExpandedState];
  [self updatePerformanceOverlayLabels];
}

- (void)applyPerformanceOverlayExpandedState {
  UIView *overlay = self.performanceOverlay;
  if (!overlay) return;
  self.performanceChevronLabel.text = self.performanceOverlayExpanded ? @"^" : @"v";
  self.performanceBudgetDetailsStack.hidden = !self.performanceOverlayExpanded;
  CGRect frame = overlay.frame;
  frame.size.height = self.performanceOverlayExpanded ? ZynthPerfOverlayExpandedHeight : ZynthPerfOverlayCollapsedHeight;
  overlay.frame = frame;
  [overlay setNeedsLayout];
  [overlay layoutIfNeeded];
  [self clampPerformanceOverlayToBounds];
}

- (NSString *)formatMilliseconds:(NSTimeInterval)value {
  return [NSString stringWithFormat:@"%.2fms", value];
}

- (void)startDisplayLink {
  if (self.performanceDisplayLink != nil) return;
  CADisplayLink *displayLink = [CADisplayLink displayLinkWithTarget:self selector:@selector(onDisplayLinkTick:)];
  if (@available(iOS 15.0, *)) {
    displayLink.preferredFrameRateRange = CAFrameRateRangeMake((float)[self targetFramesPerSecond], (float)[self targetFramesPerSecond], (float)[self targetFramesPerSecond]);
  } else {
    displayLink.preferredFramesPerSecond = (NSInteger)[self targetFramesPerSecond];
  }
  [displayLink addToRunLoop:[NSRunLoop mainRunLoop] forMode:NSRunLoopCommonModes];
  self.performanceDisplayLink = displayLink;
}

- (void)stopDisplayLink {
  [self.performanceDisplayLink invalidate];
  self.performanceDisplayLink = nil;
}

- (void)onDisplayLinkTick:(CADisplayLink *)displayLink {
  (void)displayLink;
  if (!self.performanceEnabled) return;
  self.performanceUiFrameCount += 1;
  [self samplePerformanceIfNeeded];
  [self ensurePerformanceOverlayVisible];
  if (self.performanceOverlay != nil && self.rootView != nil) {
    [self.rootView bringSubviewToFront:self.performanceOverlay];
  }
}

- (NSUInteger)targetFramesPerSecond {
  NSInteger maxFps = UIScreen.mainScreen.maximumFramesPerSecond;
  if (maxFps < 30) return 60;
  return (NSUInteger)maxFps;
}

- (NSUInteger)countViewsRecursively:(UIView *)view {
  NSUInteger total = 1;
  for (UIView *child in view.subviews) {
    total += [self countViewsRecursively:child];
  }
  return total;
}

- (void)updateWarnStateForTargetFps:(NSUInteger)targetFps {
  NSUInteger warnThreshold = targetFps > ZynthPerfWarnOffset ? targetFps - ZynthPerfWarnOffset : 1;
  NSUInteger recoverThreshold = targetFps > ZynthPerfRecoverOffset ? targetFps - ZynthPerfRecoverOffset : warnThreshold;
  if (recoverThreshold < warnThreshold) recoverThreshold = warnThreshold;

  if (self.performanceUiWarnActive) {
    if (self.performanceUiFps >= recoverThreshold) {
      self.performanceUiRecoverStreak += 1;
      if (self.performanceUiRecoverStreak >= ZynthPerfRecoverSamples) {
        self.performanceUiWarnActive = NO;
        self.performanceUiRecoverStreak = 0;
        self.performanceUiWarnStreak = 0;
      }
    } else {
      self.performanceUiRecoverStreak = 0;
    }
  } else {
    if (self.performanceUiFps <= warnThreshold) {
      self.performanceUiWarnStreak += 1;
      if (self.performanceUiWarnStreak >= ZynthPerfWarnSamples) {
        self.performanceUiWarnActive = YES;
        self.performanceUiWarnStreak = 0;
        self.performanceUiRecoverStreak = 0;
      }
    } else {
      self.performanceUiWarnStreak = 0;
    }
  }

  if (self.performanceJsWarnActive) {
    if (self.performanceJsFps >= recoverThreshold) {
      self.performanceJsRecoverStreak += 1;
      if (self.performanceJsRecoverStreak >= ZynthPerfRecoverSamples) {
        self.performanceJsWarnActive = NO;
        self.performanceJsRecoverStreak = 0;
        self.performanceJsWarnStreak = 0;
      }
    } else {
      self.performanceJsRecoverStreak = 0;
    }
  } else {
    if (self.performanceJsFps <= warnThreshold) {
      self.performanceJsWarnStreak += 1;
      if (self.performanceJsWarnStreak >= ZynthPerfWarnSamples) {
        self.performanceJsWarnActive = YES;
        self.performanceJsWarnStreak = 0;
        self.performanceJsRecoverStreak = 0;
      }
    } else {
      self.performanceJsWarnStreak = 0;
    }
  }
}

@end
