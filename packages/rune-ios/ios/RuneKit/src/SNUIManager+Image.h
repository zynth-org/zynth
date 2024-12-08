#ifdef __OBJC__
#import <Foundation/Foundation.h>
#import "SNUIManager+Internal.h"

NS_ASSUME_NONNULL_BEGIN

@interface SNUIManager (Image)

- (BOOL)sn_imageHandlesSetPropForNode:(SNNode *)node
                                 name:(NSString *)name
                             valueJSON:(NSString *)json;
- (BOOL)sn_imageHandlesSetPropCallbackForNode:(SNNode *)node
                                        name:(NSString *)name
                                     callback:(JSValue * _Nullable)callback;
- (BOOL)sn_imageHandlesSetHandlerForNode:(SNNode *)node name:(NSString *)name;
- (void)sn_imageCleanupNode:(SNNode *)node;

@end

NS_ASSUME_NONNULL_END
#endif
