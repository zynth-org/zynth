#import <UIKit/UIKit.h>

#import "RuneUIManager+View.h"

NS_ASSUME_NONNULL_BEGIN

@class SNUIManager;
@class SNNode;

@protocol RuneButtonViewDelegate;

@interface RuneButtonView : RuneHitTestingView

@property(nonatomic, weak, nullable) id<RuneButtonViewDelegate> delegate;
@property(nonatomic, assign) int nodeId;

- (void)attachToManager:(nullable SNUIManager *)manager node:(nullable SNNode *)node;
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
