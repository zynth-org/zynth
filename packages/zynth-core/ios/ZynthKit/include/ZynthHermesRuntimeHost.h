#import <Foundation/Foundation.h>

@class ZynthUIManager;

NS_ASSUME_NONNULL_BEGIN

@interface ZynthHermesRuntimeHost : NSObject

- (instancetype)initWithUIManager:(ZynthUIManager *)manager;
- (BOOL)evaluateString:(NSString *)code
             sourceURL:(NSString *)sourceURL
                error:(NSError *_Nullable *_Nullable)error;
- (BOOL)evaluateBytecode:(NSData *)data
               sourceURL:(NSString *)sourceURL
                  error:(NSError *_Nullable *_Nullable)error;
- (id _Nullable)callGlobal:(NSString *)name args:(NSArray *)args;

@end

NS_ASSUME_NONNULL_END
