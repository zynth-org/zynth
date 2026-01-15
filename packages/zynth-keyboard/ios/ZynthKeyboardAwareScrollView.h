//
//  ZynthKeyboardAwareScrollView.h
//  ZynthKeyboard
//
//  A scroll view that automatically adjusts for keyboard appearance
//  and scrolls to keep focused inputs visible.
//

#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

@class SNUIManager;
@class SNNode;

@interface ZynthKeyboardAwareScrollView : UIView <UIScrollViewDelegate>

- (void)attachToManager:(nullable SNUIManager *)manager node:(nullable SNNode *)node;
- (void)insertContentSubview:(UIView *)view atIndex:(NSInteger)index;
- (void)removeContentSubview:(UIView *)view;

// Scroll configuration
- (void)zynth_setScrollEnabled:(BOOL)enabled;
- (void)zynth_setShowsVerticalScrollIndicator:(BOOL)show;
- (void)zynth_setShowsHorizontalScrollIndicator:(BOOL)show;
- (void)zynth_setBounces:(BOOL)enabled;
- (void)zynth_setContentInset:(NSDictionary *_Nullable)inset;

// Keyboard configuration
- (void)zynth_setExtraScrollHeight:(CGFloat)height;
- (void)zynth_setKeyboardVerticalOffset:(CGFloat)offset;
- (void)zynth_setKeyboardEnabled:(BOOL)enabled;
- (void)zynth_setScrollToInputOnFocus:(BOOL)enabled;

// Cleanup
- (void)cleanup;

@end

NS_ASSUME_NONNULL_END
