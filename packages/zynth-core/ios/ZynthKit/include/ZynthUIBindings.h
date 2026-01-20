#import <Foundation/Foundation.h>

#ifdef __cplusplus
#include <jsi/jsi.h>
#endif

@class ZynthUIManager;

#ifdef __cplusplus
void ZynthInstallUIBindings(facebook::jsi::Runtime &rt, ZynthUIManager *manager);
#endif
