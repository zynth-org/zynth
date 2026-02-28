#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@class ZynthRuntime;

@interface ZynthNativeErrorOverlayManager : NSObject

+ (instancetype)shared;
- (void)attachRuntime:(ZynthRuntime *)runtime;
- (void)detach;
- (void)handleEventWithTopic:(NSString *)topic
                       level:(NSString *_Nullable)level
                         tag:(NSString *_Nullable)tag
                        data:(id _Nullable)data;
- (void)handleRawEventJSON:(NSString *)json;
- (void)dismissForHmrUpdate;
- (void)flashHmrIndicator;

@end

NS_ASSUME_NONNULL_END
