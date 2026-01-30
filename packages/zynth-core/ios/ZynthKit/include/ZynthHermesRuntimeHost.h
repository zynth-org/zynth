#import <Foundation/Foundation.h>
#import "ZynthRuntime.h"

@class ZynthUIManager;

NS_ASSUME_NONNULL_BEGIN

@interface ZynthHermesRuntimeHost : NSObject

- (instancetype)initWithUIManager:(ZynthUIManager *)manager;
- (void)installModuleBridge:(id<ZynthModuleBridge>)bridge constants:(NSDictionary<NSString *, id> *)constants;
- (BOOL)evaluateString:(NSString *)code
             sourceURL:(NSString *)sourceURL
                error:(NSError *_Nullable *_Nullable)error;
- (BOOL)evaluateBytecode:(NSData *)data
               sourceURL:(NSString *)sourceURL
                  error:(NSError *_Nullable *_Nullable)error;

- (id _Nullable)callGlobal:(NSString *)name args:(NSArray *)args;

- (id _Nullable)callGlobalObjectMethod:(NSString *)objectName
                                method:(NSString *)methodName
                                  args:(NSArray *)args;

- (void)emitDevtoolsEventWithTopic:(NSString *)topic
                             level:(NSString *)level
                               tag:(NSString *)tag
                              data:(NSDictionary *)data;

@end

NS_ASSUME_NONNULL_END
