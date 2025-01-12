#ifdef __OBJC__
#import <Foundation/Foundation.h>

#import "SNUIManager.h"

NS_ASSUME_NONNULL_BEGIN

@class SNNode;

@interface SNUIManager (Button)

- (void)sn_buttonAttachIfNeeded:(SNNode *)node;
- (BOOL)sn_buttonHandlesSetPropForNode:(SNNode *)node
                                  name:(NSString *)name
                                 value:(id _Nullable)value
                                rawJSON:(NSString *_Nullable)rawJSON;
- (BOOL)sn_buttonHandlesSetHandlerForNode:(SNNode *)node name:(NSString *)name;

@end

NS_ASSUME_NONNULL_END
#endif
