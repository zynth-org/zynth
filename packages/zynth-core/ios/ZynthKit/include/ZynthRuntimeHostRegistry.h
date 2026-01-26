#pragma once

#import <Foundation/Foundation.h>

@class ZynthHermesRuntimeHost;

NS_ASSUME_NONNULL_BEGIN

#ifdef __cplusplus
void ZynthSetCurrentRuntimeHost(ZynthHermesRuntimeHost *_Nullable host);
ZynthHermesRuntimeHost *_Nullable ZynthGetCurrentRuntimeHost(void);
#endif

NS_ASSUME_NONNULL_END

