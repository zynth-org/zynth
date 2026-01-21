#import <UIKit/UIKit.h>

#if __has_include(<ZynthKit/ZynthKit.h>)
#import <ZynthKit/ZynthKit.h>
#else
#import "ZynthViewHost.h"
#endif

NS_ASSUME_NONNULL_BEGIN

@class ZynthUIManager;
@class ZynthNode;

@protocol ZynthButtonViewDelegate;

@interface ZynthButtonView : UIButton

@property(nonatomic, weak, nullable) id<ZynthButtonViewDelegate> delegate;
@property(nonatomic, assign) int nodeId;
@property(nonatomic, assign) ZynthPointerEventsMode pointerMode;

- (void)attachToManager:(nullable ZynthUIManager *)manager node:(nullable ZynthNode *)node;

// Existing props
- (void)zynth_setDisabled:(BOOL)disabled;
- (void)zynth_setLoading:(BOOL)loading;
- (void)zynth_setPressEffect:(NSString *_Nullable)effect;
- (void)zynth_setPressRetentionOffset:(NSNumber *_Nullable)offset;
- (void)zynth_setHitSlop:(id _Nullable)hitSlop;
- (void)zynth_setMinimumTouchSize:(id _Nullable)size;
- (void)zynth_setPreventFocusOnPress:(BOOL)prevent;
- (void)zynth_setHapticsMode:(NSString *_Nullable)mode;
- (void)zynth_setHasLongPressHandler:(BOOL)hasHandler;
- (void)zynth_handleCommand:(NSDictionary *_Nullable)command;
- (void)zynth_setEnableGlassIOS:(BOOL)enabled;
- (void)zynth_updateConfigurationCornerRadiusIfNeeded;
- (void)zynth_setGlassTintColor:(UIColor *_Nullable)tintColor;

// New Native Props
- (void)zynth_setVariant:(NSString *_Nullable)variant;
- (void)zynth_setRole:(NSString *_Nullable)role;
- (void)zynth_setSize:(NSString *_Nullable)size;
- (void)zynth_setTitle:(NSString *_Nullable)title;
- (void)zynth_setBaseColor:(UIColor *_Nullable)color;
- (void)zynth_setImage:(UIImage *_Nullable)image;
- (void)zynth_setRounded:(NSString *_Nullable)rounded;

@end

@protocol ZynthButtonViewDelegate <NSObject>
- (void)buttonViewDidPressIn:(ZynthButtonView *)button;
- (void)buttonViewDidPressOut:(ZynthButtonView *)button cancelled:(BOOL)cancelled;
- (void)buttonViewDidActivate:(ZynthButtonView *)button;
- (void)buttonView:(ZynthButtonView *)button didLongPressWithDuration:(CFTimeInterval)duration;
- (void)buttonViewDidFocus:(ZynthButtonView *)button;
- (void)buttonViewDidBlur:(ZynthButtonView *)button;
- (void)buttonView:(ZynthButtonView *)button didEmitKeyEvent:(NSString *)phase key:(NSString *)key;
@end

NS_ASSUME_NONNULL_END
