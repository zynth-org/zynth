//
//  ZynthKeyboardAwareScrollView.m
//  ZynthKeyboard
//
//  A scroll view that automatically adjusts for keyboard appearance
//  and scrolls to keep focused inputs visible.
//

#import "ZynthKeyboardAwareScrollView.h"
#import "ZynthUIManager+Internal.h"
#import "ZynthUIManager.h"

@interface ZynthKeyboardAwareScrollView ()
@property(nonatomic, weak) ZynthUIManager *manager;
@property(nonatomic, weak) ZynthNode *node;
@property(nonatomic, strong) UIScrollView *scrollView;
@property(nonatomic, strong) UIView *contentView;

// Keyboard tracking
@property(nonatomic, assign) BOOL keyboardEnabled;
@property(nonatomic, assign) BOOL scrollToInputOnFocus;
@property(nonatomic, assign) CGFloat extraScrollHeight;
@property(nonatomic, assign) CGFloat keyboardVerticalOffset;
@property(nonatomic, assign) CGFloat currentKeyboardHeight;
@property(nonatomic, assign) UIEdgeInsets originalContentInset;
@property(nonatomic, assign) BOOL isKeyboardVisible;
@property(nonatomic, strong) NSArray<id> *observers;
@end

@implementation ZynthKeyboardAwareScrollView

- (instancetype)init {
  return [self initWithFrame:CGRectZero];
}

- (instancetype)initWithFrame:(CGRect)frame {
  if (self = [super initWithFrame:frame]) {
    [self commonInit];
  }
  return self;
}

- (instancetype)initWithCoder:(NSCoder *)coder {
  if (self = [super initWithCoder:coder]) {
    [self commonInit];
  }
  return self;
}

- (void)commonInit {
  _scrollView = [[UIScrollView alloc] initWithFrame:CGRectZero];
  _scrollView.delegate = self;
  _scrollView.delaysContentTouches = NO;
  _scrollView.canCancelContentTouches = YES;
  _scrollView.contentInsetAdjustmentBehavior = UIScrollViewContentInsetAdjustmentNever;
  _scrollView.showsVerticalScrollIndicator = YES;
  _scrollView.showsHorizontalScrollIndicator = NO;
  _scrollView.alwaysBounceVertical = YES;
  _scrollView.alwaysBounceHorizontal = NO;
  _scrollView.bounces = YES;
  _scrollView.keyboardDismissMode = UIScrollViewKeyboardDismissModeInteractive;
  
  _contentView = [[UIView alloc] initWithFrame:CGRectZero];
  _contentView.clipsToBounds = NO;
  _contentView.backgroundColor = UIColor.clearColor;
  
  [self addSubview:_scrollView];
  [_scrollView addSubview:_contentView];
  
  _keyboardEnabled = YES;
  _scrollToInputOnFocus = YES;
  _extraScrollHeight = 75.0;
  _keyboardVerticalOffset = 0;
  _isKeyboardVisible = NO;
  _originalContentInset = UIEdgeInsetsZero;
  
  [self startObserving];
}

- (void)dealloc {
  [self stopObserving];
  _scrollView.delegate = nil;
}

- (void)cleanup {
  [self stopObserving];
  [self resetContentInset];
}

- (void)attachToManager:(ZynthUIManager *_Nullable)manager node:(ZynthNode *_Nullable)node {
  self.manager = manager;
  self.node = node;
}

// MARK: - Layout

- (void)layoutSubviews {
  [super layoutSubviews];
  _scrollView.frame = self.bounds;
  [self updateContentGeometry];
}

- (void)insertContentSubview:(UIView *)view atIndex:(NSInteger)index {
  NSInteger safeIndex = MAX(0, MIN(index, (NSInteger)_contentView.subviews.count));
  [_contentView insertSubview:view atIndex:safeIndex];
  [self setNeedsLayout];
}

- (void)removeContentSubview:(UIView *)view {
  [view removeFromSuperview];
  [self setNeedsLayout];
}

- (void)updateContentGeometry {
  CGSize boundsSize = self.bounds.size;
  __block CGFloat contentWidth = boundsSize.width;
  __block CGFloat contentHeight = 0;
  
  // Accumulate content size from all subviews
  for (UIView *subview in _contentView.subviews) {
    CGRect frame = subview.frame;
    contentWidth = MAX(contentWidth, CGRectGetMaxX(frame));
    contentHeight = MAX(contentHeight, CGRectGetMaxY(frame));
  }
  
  // Ensure minimum height
  contentHeight = MAX(contentHeight, boundsSize.height);
  
  _contentView.frame = CGRectMake(0, 0, contentWidth, contentHeight);
  _scrollView.contentSize = CGSizeMake(contentWidth, contentHeight);
}

// MARK: - Configuration

- (void)zynth_setScrollEnabled:(BOOL)enabled {
  _scrollView.scrollEnabled = enabled;
}

- (void)zynth_setShowsVerticalScrollIndicator:(BOOL)show {
  _scrollView.showsVerticalScrollIndicator = show;
}

- (void)zynth_setShowsHorizontalScrollIndicator:(BOOL)show {
  _scrollView.showsHorizontalScrollIndicator = show;
}

- (void)zynth_setBounces:(BOOL)enabled {
  _scrollView.bounces = enabled;
  _scrollView.alwaysBounceVertical = enabled;
}

- (void)zynth_setContentInset:(NSDictionary *_Nullable)inset {
  if (!inset) {
    _originalContentInset = UIEdgeInsetsZero;
    [self updateContentInsetForKeyboard];
    return;
  }
  
  CGFloat top = [inset[@"top"] floatValue] ?: 0;
  CGFloat left = [inset[@"left"] floatValue] ?: 0;
  CGFloat bottom = [inset[@"bottom"] floatValue] ?: 0;
  CGFloat right = [inset[@"right"] floatValue] ?: 0;
  
  _originalContentInset = UIEdgeInsetsMake(top, left, bottom, right);
  [self updateContentInsetForKeyboard];
}

- (void)zynth_setExtraScrollHeight:(CGFloat)height {
  _extraScrollHeight = height;
}

- (void)zynth_setKeyboardVerticalOffset:(CGFloat)offset {
  _keyboardVerticalOffset = offset;
  if (_isKeyboardVisible) {
    [self updateContentInsetForKeyboard];
  }
}

- (void)zynth_setKeyboardEnabled:(BOOL)enabled {
  _keyboardEnabled = enabled;
  if (!enabled) {
    [self resetContentInset];
  }
}

- (void)zynth_setScrollToInputOnFocus:(BOOL)enabled {
  _scrollToInputOnFocus = enabled;
}

// MARK: - Keyboard Observation

- (void)startObserving {
  NSMutableArray *observers = [NSMutableArray array];
  
  id willShowObserver = [[NSNotificationCenter defaultCenter]
    addObserverForName:UIKeyboardWillShowNotification
    object:nil
    queue:[NSOperationQueue mainQueue]
    usingBlock:^(NSNotification *notification) {
      [self handleKeyboardWillShow:notification];
    }];
  [observers addObject:willShowObserver];
  
  id willHideObserver = [[NSNotificationCenter defaultCenter]
    addObserverForName:UIKeyboardWillHideNotification
    object:nil
    queue:[NSOperationQueue mainQueue]
    usingBlock:^(NSNotification *notification) {
      [self handleKeyboardWillHide:notification];
    }];
  [observers addObject:willHideObserver];
  
  id willChangeFrameObserver = [[NSNotificationCenter defaultCenter]
    addObserverForName:UIKeyboardWillChangeFrameNotification
    object:nil
    queue:[NSOperationQueue mainQueue]
    usingBlock:^(NSNotification *notification) {
      [self handleKeyboardWillChangeFrame:notification];
    }];
  [observers addObject:willChangeFrameObserver];
  
  // Observe text field focus
  id textFieldBeginObserver = [[NSNotificationCenter defaultCenter]
    addObserverForName:UITextFieldTextDidBeginEditingNotification
    object:nil
    queue:[NSOperationQueue mainQueue]
    usingBlock:^(NSNotification *notification) {
      [self handleTextInputFocus:notification];
    }];
  [observers addObject:textFieldBeginObserver];
  
  id textViewBeginObserver = [[NSNotificationCenter defaultCenter]
    addObserverForName:UITextViewTextDidBeginEditingNotification
    object:nil
    queue:[NSOperationQueue mainQueue]
    usingBlock:^(NSNotification *notification) {
      [self handleTextInputFocus:notification];
    }];
  [observers addObject:textViewBeginObserver];
  
  self.observers = observers;
}

- (void)stopObserving {
  for (id observer in self.observers) {
    [[NSNotificationCenter defaultCenter] removeObserver:observer];
  }
  self.observers = nil;
}

// MARK: - Keyboard Event Handlers

- (void)handleKeyboardWillShow:(NSNotification *)notification {
  if (!_keyboardEnabled) return;
  
  NSDictionary *userInfo = notification.userInfo;
  CGRect endFrame = [userInfo[UIKeyboardFrameEndUserInfoKey] CGRectValue];
  NSTimeInterval duration = [userInfo[UIKeyboardAnimationDurationUserInfoKey] doubleValue];
  UIViewAnimationCurve curve = [userInfo[UIKeyboardAnimationCurveUserInfoKey] integerValue];
  
  CGFloat screenHeight = UIScreen.mainScreen.bounds.size.height;
  _currentKeyboardHeight = screenHeight - endFrame.origin.y;
  _isKeyboardVisible = YES;
  
  [UIView animateWithDuration:duration delay:0 options:(curve << 16) animations:^{
    [self updateContentInsetForKeyboard];
  } completion:nil];
}

- (void)handleKeyboardWillHide:(NSNotification *)notification {
  if (!_keyboardEnabled) return;
  
  NSDictionary *userInfo = notification.userInfo;
  NSTimeInterval duration = [userInfo[UIKeyboardAnimationDurationUserInfoKey] doubleValue];
  UIViewAnimationCurve curve = [userInfo[UIKeyboardAnimationCurveUserInfoKey] integerValue];
  
  _currentKeyboardHeight = 0;
  _isKeyboardVisible = NO;
  
  [UIView animateWithDuration:duration delay:0 options:(curve << 16) animations:^{
    [self resetContentInset];
  } completion:nil];
}

- (void)handleKeyboardWillChangeFrame:(NSNotification *)notification {
  if (!_keyboardEnabled) return;
  
  NSDictionary *userInfo = notification.userInfo;
  CGRect endFrame = [userInfo[UIKeyboardFrameEndUserInfoKey] CGRectValue];
  NSTimeInterval duration = [userInfo[UIKeyboardAnimationDurationUserInfoKey] doubleValue];
  UIViewAnimationCurve curve = [userInfo[UIKeyboardAnimationCurveUserInfoKey] integerValue];
  
  CGFloat screenHeight = UIScreen.mainScreen.bounds.size.height;
  BOOL isShowing = endFrame.origin.y < screenHeight;
  
  _currentKeyboardHeight = isShowing ? (screenHeight - endFrame.origin.y) : 0;
  _isKeyboardVisible = isShowing;
  
  [UIView animateWithDuration:duration delay:0 options:(curve << 16) animations:^{
    if (isShowing) {
      [self updateContentInsetForKeyboard];
    } else {
      [self resetContentInset];
    }
  } completion:nil];
}

- (void)handleTextInputFocus:(NSNotification *)notification {
  if (!_keyboardEnabled || !_scrollToInputOnFocus) return;
  if (!_isKeyboardVisible) return;
  
  UIView *textInput = notification.object;
  if (!textInput) return;
  
  // Check if this text input is a descendant of our content view
  if (![textInput isDescendantOfView:_contentView]) return;
  
  // Schedule scroll after a short delay to let keyboard frame settle
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.1 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    [self scrollToFocusedInput:textInput];
  });
}

// MARK: - Content Inset Management

- (void)updateContentInsetForKeyboard {
  CGFloat keyboardHeight = _currentKeyboardHeight + _keyboardVerticalOffset;
  
  // Calculate keyboard overlap with scroll view
  CGRect scrollViewFrame = [self convertRect:self.bounds toView:nil];
  CGFloat screenHeight = UIScreen.mainScreen.bounds.size.height;
  CGFloat scrollViewBottom = CGRectGetMaxY(scrollViewFrame);
  CGFloat keyboardTop = screenHeight - keyboardHeight;
  
  CGFloat overlap = scrollViewBottom - keyboardTop;
  if (overlap < 0) overlap = 0;
  
  UIEdgeInsets newInset = _originalContentInset;
  newInset.bottom = _originalContentInset.bottom + overlap + _extraScrollHeight;
  
  _scrollView.contentInset = newInset;
  _scrollView.scrollIndicatorInsets = newInset;
}

- (void)resetContentInset {
  _scrollView.contentInset = _originalContentInset;
  _scrollView.scrollIndicatorInsets = _originalContentInset;
}

// MARK: - Scroll to Input

- (void)scrollToFocusedInput:(UIView *)inputView {
  if (!inputView) return;
  
  // Get the input's frame relative to the scroll view content
  CGRect inputFrame = [inputView convertRect:inputView.bounds toView:_contentView];
  
  // Add some padding around the input
  CGFloat padding = _extraScrollHeight;
  CGRect targetRect = CGRectInset(inputFrame, -padding, -padding);
  
  // Calculate visible area (accounting for keyboard)
  CGFloat visibleHeight = _scrollView.bounds.size.height - _scrollView.contentInset.bottom;
  
  // Calculate desired scroll offset to center the input in visible area
  CGFloat inputCenterY = CGRectGetMidY(inputFrame);
  CGFloat desiredOffsetY = inputCenterY - (visibleHeight / 2);
  
  // Clamp to valid range
  CGFloat maxOffsetY = _scrollView.contentSize.height - _scrollView.bounds.size.height + _scrollView.contentInset.bottom;
  desiredOffsetY = MAX(0, MIN(desiredOffsetY, maxOffsetY));
  
  CGPoint targetOffset = CGPointMake(_scrollView.contentOffset.x, desiredOffsetY);
  
  [_scrollView setContentOffset:targetOffset animated:YES];
}

// MARK: - UIScrollViewDelegate

- (void)scrollViewDidScroll:(UIScrollView *)scrollView {
  // Can dispatch scroll events to JS if needed
}

@end
