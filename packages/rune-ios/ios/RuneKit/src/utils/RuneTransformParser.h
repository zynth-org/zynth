#import <Foundation/Foundation.h>
#import <QuartzCore/QuartzCore.h>

@interface RuneTransformParser : NSObject

+ (CATransform3D)parse:(id)json;

@end
