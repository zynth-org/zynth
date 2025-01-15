#import "SNUIManager.h"

NS_ASSUME_NONNULL_BEGIN

@class SNNode;

@interface SNUIManager (Pressable)

- (void)sn_pressableAttachIfNeeded:(SNNode *)node;
- (BOOL)sn_pressableHandlesSetPropForNode:(SNNode *)node
                                    name:(NSString *)name
                                   value:(id)value
                                  rawJSON:(NSString *)rawJSON;
- (BOOL)sn_pressableHandlesSetHandlerForNode:(SNNode *)node name:(NSString *)name;

@end

NS_ASSUME_NONNULL_END
