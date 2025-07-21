#import <Foundation/Foundation.h>
#if __has_include(<UIKit/UIKit.h>)
#import <UIKit/UIKit.h>
#else
@class UIColor;
#endif

NS_ASSUME_NONNULL_BEGIN

@interface RuneShadowLayer : NSObject

@property(nonatomic, assign) CGFloat offsetX;
@property(nonatomic, assign) CGFloat offsetY;
@property(nonatomic, assign) CGFloat blurRadius;
@property(nonatomic, assign) CGFloat spread;
@property(nonatomic, assign) BOOL inset;
@property(nonatomic, strong) UIColor *color;

- (instancetype)initWithOffsetX:(CGFloat)offsetX
                        offsetY:(CGFloat)offsetY
                     blurRadius:(CGFloat)blurRadius
                         spread:(CGFloat)spread
                          color:(UIColor *)color
                          inset:(BOOL)inset;

@end

@interface RuneShadowParser : NSObject

+ (nullable NSArray<RuneShadowLayer *> *)parse:(id)value;
+ (nullable NSArray<RuneShadowLayer *> *)fromReactNativeColor:(nullable UIColor *)color
                                                      opacity:(nullable NSNumber *)opacity
                                                       radius:(nullable NSNumber *)radius
                                                      offsetX:(nullable NSNumber *)offsetX
                                                      offsetY:(nullable NSNumber *)offsetY;
+ (nullable NSArray<RuneShadowLayer *> *)merged:(nullable NSArray<RuneShadowLayer *> *)css
                                        fallback:(nullable NSArray<RuneShadowLayer *> *)rn;

@end

NS_ASSUME_NONNULL_END
