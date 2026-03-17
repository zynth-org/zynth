#import <UIKit/UIKit.h>
#if __has_include(<ZynthKit/ZynthViewHost.h>)
#import <ZynthKit/ZynthViewHost.h>
#else
#import "ZynthViewHost.h"
#endif

#import "ZynthHitTestingView.h"

NS_ASSUME_NONNULL_BEGIN

@class ZynthUIManager;
@class ZynthNode;

@protocol ZynthPressableViewDelegate;

@interface ZynthPressableView : ZynthHitTestingView

@property(nonatomic, weak, nullable) id<ZynthPressableViewDelegate> delegate;
@property(nonatomic, assign) int nodeId;
@property(nonatomic, weak, nullable, readonly) ZynthNode *zynth_node;

- (void)attachToManager:(nullable ZynthUIManager *)manager node:(nullable ZynthNode *)node;
- (void)zynth_setDisabled:(BOOL)disabled;
- (void)zynth_setPressEffect:(NSString *_Nullable)effect;
- (void)zynth_setPressRetentionOffset:(NSNumber *_Nullable)offset;
- (void)zynth_setHitSlop:(id _Nullable)hitSlop;
- (void)zynth_setPreventFocusOnPress:(BOOL)prevent;
- (void)zynth_setDelayPressIn:(NSNumber *_Nullable)delay;
- (void)zynth_setDelayPressOut:(NSNumber *_Nullable)delay;
- (void)zynth_setDelayLongPress:(NSNumber *_Nullable)delay;
- (void)zynth_setAllowTouchPropagation:(BOOL)allow;
- (void)zynth_setCancelOnOutside:(BOOL)cancel;
- (void)zynth_setEnableDoublePress:(BOOL)enable;
- (void)zynth_setDoublePressWindow:(NSNumber *_Nullable)window;
- (void)zynth_setActivateKeys:(NSArray<NSString *> *_Nullable)keys;
- (void)zynth_setFocusable:(BOOL)focusable;
- (void)zynth_setPointerEvents:(NSString *_Nullable)pointerEvents;
- (void)zynth_setEnableGlassIOS:(BOOL)enabled;
- (void)zynth_setReady:(BOOL)ready;
- (void)zynth_setHasLongPressHandler:(BOOL)hasHandler;
- (void)zynth_handleCommand:(NSDictionary *_Nullable)command;

@end

@protocol ZynthPressableViewDelegate <NSObject>
- (void)pressableView:(ZynthPressableView *)view didPressIn:(NSDictionary *)payload;
- (void)pressableView:(ZynthPressableView *)view didPressOut:(NSDictionary *)payload cancelled:(BOOL)cancelled;
- (void)pressableView:(ZynthPressableView *)view didPress:(NSDictionary *)payload;
- (void)pressableView:(ZynthPressableView *)view didLongPress:(NSDictionary *)payload duration:(CFTimeInterval)duration;
- (void)pressableView:(ZynthPressableView *)view didDoublePress:(NSDictionary *)payload;
- (void)pressableViewDidHover:(ZynthPressableView *)view hovering:(BOOL)hovering;
- (void)pressableViewDidFocus:(ZynthPressableView *)view;
- (void)pressableViewDidBlur:(ZynthPressableView *)view;
- (void)pressableView:(ZynthPressableView *)view didEmitKeyEvent:(NSString *)phase payload:(NSDictionary *)payload;
@end

NS_ASSUME_NONNULL_END
