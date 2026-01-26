#pragma once

#import <Foundation/Foundation.h>

@class ZynthHermesRuntimeHost;

#ifdef __cplusplus
namespace facebook::jsi {
class Runtime;
}
#endif

NS_ASSUME_NONNULL_BEGIN

@interface ZynthWorklets : NSObject

- (instancetype)initWithHost:(ZynthHermesRuntimeHost *)host;
- (void)installSharedSignalsOnRuntime:(facebook::jsi::Runtime &)rt;
- (void)installWorkletsBridgeOnRuntime:(facebook::jsi::Runtime &)rt;

@end

NS_ASSUME_NONNULL_END
