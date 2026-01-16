#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface ZynthMarkdownBridge : NSObject

+ (NSString *)parse:(NSString *)content
           options:(uint32_t)options
        extensions:(uint32_t)extensions;

@end

NS_ASSUME_NONNULL_END
