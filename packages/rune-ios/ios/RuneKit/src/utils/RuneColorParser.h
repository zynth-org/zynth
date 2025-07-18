#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

@interface RuneColorParser : NSObject

+ (nullable UIColor *)parseColor:(NSString *)colorString;

@end

NS_ASSUME_NONNULL_END
