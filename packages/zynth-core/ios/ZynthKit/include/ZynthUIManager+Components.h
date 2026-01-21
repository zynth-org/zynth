#ifndef ZYNTH_UIMANAGER_COMPONENTS_H
#define ZYNTH_UIMANAGER_COMPONENTS_H

#ifdef __OBJC__
#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
#import "ZynthUIManager.h"
#import "ZynthJSInvoker.h"

NS_ASSUME_NONNULL_BEGIN

@interface ZynthUIManager (Components)

@property(nonatomic, weak) id<ZynthJSInvoker> jsInvoker;

@end

NS_ASSUME_NONNULL_END
#endif

#endif /* ZYNTH_UIMANAGER_COMPONENTS_H */
