#import <Foundation/Foundation.h>
#import "SNUIManager.h"

NS_ASSUME_NONNULL_BEGIN

@interface HermesRuntimeHost : NSObject <RuneJSInvoker>

@property(nonatomic, copy, nullable) NSString *(^moduleCallHandler)(NSString *module, NSString *method, NSString *argsJSON);
@property(nonatomic, copy, nullable) id _Nullable (^moduleCallSyncHandler)(NSString *module, NSString *method, id _Nullable args, NSError **error);
@property(nonatomic, copy, nullable) void (^exceptionHandler)(NSString *message, NSString *_Nullable stack);

- (instancetype)initWithUIManager:(SNUIManager *)manager;
- (void)evaluateString:(NSString *)code;
- (void)evaluateBytecode:(NSData *)data sourceURL:(NSString *)sourceURL;
- (id)callGlobal:(NSString *)name args:(NSArray *)args;

@end

NS_ASSUME_NONNULL_END
