#import <Foundation/Foundation.h>
#if __has_include(<UIKit/UIKit.h>)
#import <UIKit/UIKit.h>
#else
@class UIColor;
#endif

NS_ASSUME_NONNULL_BEGIN

@interface RuneGradientStop : NSObject
@property(nonatomic, strong) UIColor *color;
@property(nonatomic, strong, nullable) NSNumber *position; // 0..1
- (instancetype)initWithColor:(UIColor *)color position:(NSNumber *_Nullable)position;
@end

@interface RuneLinearGradient : NSObject
@property(nonatomic, assign) CGFloat angle; // degrees, CSS-style (0 = up)
@property(nonatomic, strong) NSArray<RuneGradientStop *> *stops;
- (instancetype)initWithAngle:(CGFloat)angle stops:(NSArray<RuneGradientStop *> *)stops;
@end

@interface RuneGradientParser : NSObject
+ (nullable RuneLinearGradient *)parse:(id)value;
@end

NS_ASSUME_NONNULL_END
