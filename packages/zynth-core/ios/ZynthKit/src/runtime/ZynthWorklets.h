#pragma once

#import <Foundation/Foundation.h>

@class ZynthHermesRuntimeHost;

#ifdef __cplusplus
namespace facebook::jsi {
class Runtime;
}
#endif

NS_ASSUME_NONNULL_BEGIN

typedef void (*ZynthSharedSignalChangedCallback)(void *state, int signalId);

@interface ZynthWorklets : NSObject

- (instancetype)initWithHost:(ZynthHermesRuntimeHost *)host;

#ifdef __cplusplus
- (void)installSharedSignalsOnRuntime:(facebook::jsi::Runtime &)rt;
- (void)installWorkletsBridgeOnRuntime:(facebook::jsi::Runtime &)rt;
#endif

- (int)createSharedSignalWithValue:(double)initialValue;
- (double)sharedSignalValueForId:(int)signalId;
- (BOOL)setSharedSignalValue:(int)signalId value:(double)value;
- (int)createSyncSignalWithValue:(NSString *)initialValue;
- (nullable NSString *)syncSignalValueForId:(int)signalId;
- (BOOL)setSyncSignalValue:(int)signalId value:(NSString *)value;
- (nullable NSString *)runInputHandlerWorkletWithId:(int)workletId
                                         currentText:(NSString *)currentText
                                            newInput:(NSString *)newInput
                                        proposedText:(NSString *)proposedText;

+ (void)registerSharedSignalChangedCallback:(ZynthSharedSignalChangedCallback)callback;

@end

NS_ASSUME_NONNULL_END
