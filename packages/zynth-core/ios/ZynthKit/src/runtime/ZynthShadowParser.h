#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

@interface ZynthShadowLayer : NSObject

@property (nonatomic, assign) CGFloat offsetX;
@property (nonatomic, assign) CGFloat offsetY;
@property (nonatomic, assign) CGFloat blurRadius;
@property (nonatomic, assign) CGFloat spread;
@property (nonatomic, strong) UIColor *color;
@property (nonatomic, assign) BOOL inset;

- (instancetype)initWithOffsetX:(CGFloat)offsetX
                        offsetY:(CGFloat)offsetY
                     blurRadius:(CGFloat)blurRadius
                         spread:(CGFloat)spread
                          color:(UIColor *)color
                          inset:(BOOL)inset;

@end

@interface ZynthShadowParser : NSObject

+ (nullable NSArray<ZynthShadowLayer *> *)parse:(id)value;
+ (nullable NSArray<ZynthShadowLayer *> *)fromReactNativeColor:(nullable UIColor *)color
                                                      opacity:(nullable NSNumber *)opacity
                                                       radius:(nullable NSNumber *)radius
                                                      offsetX:(nullable NSNumber *)offsetX
                                                      offsetY:(nullable NSNumber *)offsetY;
+ (nullable NSArray<ZynthShadowLayer *> *)merged:(nullable NSArray<ZynthShadowLayer *> *)css
                                        fallback:(nullable NSArray<ZynthShadowLayer *> *)rn;

@end

NS_ASSUME_NONNULL_END
