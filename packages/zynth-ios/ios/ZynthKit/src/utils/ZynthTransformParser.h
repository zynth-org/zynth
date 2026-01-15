#import <Foundation/Foundation.h>
#import <QuartzCore/QuartzCore.h>

@interface ZynthTransformParser : NSObject

+ (CATransform3D)parse:(id)json;

@end
