#import <UIKit/UIKit.h>

#if __has_include(<RuneKit/RuneKit.h>)
#import <RuneKit/RuneKit.h>
#else
#import "RuneViewHost.h"
#endif

NS_ASSUME_NONNULL_BEGIN

@class SNUIManager;
@class SNNode;

@protocol RuneButtonViewDelegate;

@interface RuneButtonView : UIButton

@property(nonatomic, weak, nullable) id<RuneButtonViewDelegate> delegate;
@property(nonatomic, assign) int nodeId;
@property(nonatomic, assign) RunePointerEventsMode pointerMode;

- (void)attachToManager:(nullable SNUIManager *)manager node:(nullable SNNode *)node;

// Existing props
- (void)rune_setDisabled:(BOOL)disabled;
- (void)rune_setLoading:(BOOL)loading;
- (void)rune_setPressEffect:(NSString *_Nullable)effect;
- (void)rune_setPressRetentionOffset:(NSNumber *_Nullable)offset;
- (void)rune_setHitSlop:(id _Nullable)hitSlop;
- (void)rune_setMinimumTouchSize:(id _Nullable)size;
- (void)rune_setPreventFocusOnPress:(BOOL)prevent;
- (void)rune_setHapticsMode:(NSString *_Nullable)mode;
- (void)rune_setHasLongPressHandler:(BOOL)hasHandler;
- (void)rune_handleCommand:(NSDictionary *_Nullable)command;

// New Native Props
- (void)rune_setVariant:(NSString *_Nullable)variant;
- (void)rune_setRole:(NSString *_Nullable)role;
- (void)rune_setSize:(NSString *_Nullable)size;
- (void)rune_setTitle:(NSString *_Nullable)title;
- (void)rune_setBaseColor:(UIColor *_Nullable)color;
- (void)rune_setImage:(UIImage *_Nullable)image;
- (void)rune_setRounded:(NSString *_Nullable)rounded;

@end

@protocol RuneButtonViewDelegate <NSObject>
- (void)buttonViewDidPressIn:(RuneButtonView *)button;
- (void)buttonViewDidPressOut:(RuneButtonView *)button cancelled:(BOOL)cancelled;
- (void)buttonViewDidActivate:(RuneButtonView *)button;
- (void)buttonView:(RuneButtonView *)button didLongPressWithDuration:(CFTimeInterval)duration;
- (void)buttonViewDidFocus:(RuneButtonView *)button;
- (void)buttonViewDidBlur:(RuneButtonView *)button;
- (void)buttonView:(RuneButtonView *)button didEmitKeyEvent:(NSString *)phase key:(NSString *)key;
@end

NS_ASSUME_NONNULL_END
