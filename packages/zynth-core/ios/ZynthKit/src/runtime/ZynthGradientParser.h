#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

@interface ZynthGradientStop : NSObject

@property (nonatomic, strong) UIColor *color;
@property (nonatomic, strong, nullable) NSNumber *position;

- (instancetype)initWithColor:(UIColor *)color position:(nullable NSNumber *)position;

@end

@interface ZynthLinearGradient : NSObject

@property (nonatomic, assign) CGFloat angle;
@property (nonatomic, strong) NSArray<ZynthGradientStop *> *stops;

- (instancetype)initWithAngle:(CGFloat)angle stops:(NSArray<ZynthGradientStop *> *)stops;

@end

@interface ZynthGradientParser : NSObject

+ (nullable ZynthLinearGradient *)parse:(id)value;

@end

NS_ASSUME_NONNULL_END
