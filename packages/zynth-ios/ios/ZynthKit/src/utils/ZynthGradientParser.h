#import <Foundation/Foundation.h>
#if __has_include(<UIKit/UIKit.h>)
#import <UIKit/UIKit.h>
#else
@class UIColor;
#endif

NS_ASSUME_NONNULL_BEGIN

@interface ZynthGradientStop : NSObject
@property(nonatomic, strong) UIColor *color;
@property(nonatomic, strong, nullable) NSNumber *position; // 0..1
- (instancetype)initWithColor:(UIColor *)color position:(NSNumber *_Nullable)position;
@end

@interface ZynthLinearGradient : NSObject
@property(nonatomic, assign) CGFloat angle; // degrees, CSS-style (0 = up)
@property(nonatomic, strong) NSArray<ZynthGradientStop *> *stops;
- (instancetype)initWithAngle:(CGFloat)angle stops:(NSArray<ZynthGradientStop *> *)stops;
@end

@interface ZynthGradientParser : NSObject
+ (nullable ZynthLinearGradient *)parse:(id)value;
@end

NS_ASSUME_NONNULL_END
