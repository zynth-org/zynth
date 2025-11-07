#import <UIKit/UIKit.h>
#if __has_include(<RuneKit/RuneViewHost.h>)
#import <RuneKit/RuneViewHost.h>
#else
#import "RuneViewHost.h"
#endif

#import "RuneHitTestingView.h"

NS_ASSUME_NONNULL_BEGIN

@class SNUIManager;
@class SNNode;

@protocol RunePressableViewDelegate;

@interface RunePressableView : RuneHitTestingView

@property(nonatomic, weak, nullable) id<RunePressableViewDelegate> delegate;
@property(nonatomic, assign) int nodeId;
@property(nonatomic, weak, nullable, readonly) SNNode *rune_node;

- (void)attachToManager:(nullable SNUIManager *)manager node:(nullable SNNode *)node;
- (void)rune_setDisabled:(BOOL)disabled;
- (void)rune_setPressEffect:(NSString *_Nullable)effect;
- (void)rune_setPressRetentionOffset:(NSNumber *_Nullable)offset;
- (void)rune_setHitSlop:(id _Nullable)hitSlop;
- (void)rune_setPreventFocusOnPress:(BOOL)prevent;
- (void)rune_setDelayPressIn:(NSNumber *_Nullable)delay;
- (void)rune_setDelayPressOut:(NSNumber *_Nullable)delay;
- (void)rune_setDelayLongPress:(NSNumber *_Nullable)delay;
- (void)rune_setAllowTouchPropagation:(BOOL)allow;
- (void)rune_setCancelOnOutside:(BOOL)cancel;
- (void)rune_setEnableDoublePress:(BOOL)enable;
- (void)rune_setDoublePressWindow:(NSNumber *_Nullable)window;
- (void)rune_setActivateKeys:(NSArray<NSString *> *_Nullable)keys;
- (void)rune_setFocusable:(BOOL)focusable;
- (void)rune_setPointerEvents:(NSString *_Nullable)pointerEvents;
- (void)rune_setEnableGlassIOS:(BOOL)enabled;
- (void)rune_setHasLongPressHandler:(BOOL)hasHandler;
- (void)rune_handleCommand:(NSDictionary *_Nullable)command;

@end

@protocol RunePressableViewDelegate <NSObject>
- (void)pressableView:(RunePressableView *)view didPressIn:(NSDictionary *)payload;
- (void)pressableView:(RunePressableView *)view didPressOut:(NSDictionary *)payload cancelled:(BOOL)cancelled;
- (void)pressableView:(RunePressableView *)view didPress:(NSDictionary *)payload;
- (void)pressableView:(RunePressableView *)view didLongPress:(NSDictionary *)payload duration:(CFTimeInterval)duration;
- (void)pressableView:(RunePressableView *)view didDoublePress:(NSDictionary *)payload;
- (void)pressableViewDidHover:(RunePressableView *)view hovering:(BOOL)hovering;
- (void)pressableViewDidFocus:(RunePressableView *)view;
- (void)pressableViewDidBlur:(RunePressableView *)view;
- (void)pressableView:(RunePressableView *)view didEmitKeyEvent:(NSString *)phase payload:(NSDictionary *)payload;
@end

NS_ASSUME_NONNULL_END
