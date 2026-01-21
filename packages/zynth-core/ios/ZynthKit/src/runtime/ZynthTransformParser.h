#import <QuartzCore/QuartzCore.h>

NS_ASSUME_NONNULL_BEGIN

@interface ZynthTransformParser : NSObject

+ (CATransform3D)parse:(id)json;

@end

NS_ASSUME_NONNULL_END
