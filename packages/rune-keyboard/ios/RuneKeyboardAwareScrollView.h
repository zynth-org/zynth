//
//  RuneKeyboardAwareScrollView.h
//  RuneKeyboard
//
//  A scroll view that automatically adjusts for keyboard appearance
//  and scrolls to keep focused inputs visible.
//

#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

@class SNUIManager;
@class SNNode;

@interface RuneKeyboardAwareScrollView : UIView <UIScrollViewDelegate>

- (void)attachToManager:(nullable SNUIManager *)manager node:(nullable SNNode *)node;
- (void)insertContentSubview:(UIView *)view atIndex:(NSInteger)index;
- (void)removeContentSubview:(UIView *)view;

// Scroll configuration
- (void)rune_setScrollEnabled:(BOOL)enabled;
- (void)rune_setShowsVerticalScrollIndicator:(BOOL)show;
- (void)rune_setShowsHorizontalScrollIndicator:(BOOL)show;
- (void)rune_setBounces:(BOOL)enabled;
- (void)rune_setContentInset:(NSDictionary *_Nullable)inset;

// Keyboard configuration
- (void)rune_setExtraScrollHeight:(CGFloat)height;
- (void)rune_setKeyboardVerticalOffset:(CGFloat)offset;
- (void)rune_setKeyboardEnabled:(BOOL)enabled;
- (void)rune_setScrollToInputOnFocus:(BOOL)enabled;

// Cleanup
- (void)cleanup;

@end

NS_ASSUME_NONNULL_END
