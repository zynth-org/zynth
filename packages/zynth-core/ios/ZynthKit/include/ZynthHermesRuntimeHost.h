#import <Foundation/Foundation.h>

@class ZynthUIManager;

NS_ASSUME_NONNULL_BEGIN

@protocol ZynthModuleBridge;

@interface ZynthHermesRuntimeHost : NSObject

- (instancetype)initWithUIManager:(ZynthUIManager *)manager;
- (BOOL)evaluateString:(NSString *)code
             sourceURL:(NSString *)sourceURL
                error:(NSError *_Nullable *_Nullable)error;
- (BOOL)evaluateBytecode:(NSData *)data
               sourceURL:(NSString *)sourceURL
                  error:(NSError *_Nullable *_Nullable)error;
- (id _Nullable)callGlobal:(NSString *)name args:(NSArray *)args;

- (void)installModuleBridge:(id<ZynthModuleBridge>)bridge constants:(NSDictionary<NSString *, id> *)constants;
- (void)emitDevtoolsEventWithTopic:(NSString *)topic
                             level:(NSString *_Nullable)level
                               tag:(NSString *_Nullable)tag
                              data:(NSDictionary *_Nullable)data;

@end

NS_ASSUME_NONNULL_END
