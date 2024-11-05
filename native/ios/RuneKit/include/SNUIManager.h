#ifndef SNUIMANAGER_H
#define SNUIMANAGER_H

#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
#import <JavaScriptCore/JavaScriptCore.h>
#import "RuneJSInvoker.h"

NS_ASSUME_NONNULL_BEGIN

@class JSContext;

@interface SNUIManager : NSObject

@property(nonatomic, weak) id<RuneJSInvoker> jsInvoker;

- (instancetype)initWithRootView:(UIView *)rootView;
- (NSNumber *)createNode:(NSString *)type; // returns nodeId
- (void)setProp:(NSNumber *)nodeId name:(NSString *)name valueJSON:(NSString *)json;
- (void)setPropCallback:(NSNumber *)nodeId name:(NSString *)name callback:(JSValue *)callback;
- (void)setHandler:(NSNumber *)nodeId name:(NSString *)name;
- (void)setStyle:(NSNumber *)nodeId style:(NSDictionary *)style;
- (void)setText:(NSNumber *)nodeId text:(NSString *)text;
- (void)insertChild:(NSNumber *)parentId child:(NSNumber *)childId index:(NSNumber *)index;
- (void)removeChild:(NSNumber *)parentId child:(NSNumber *)childId;
- (void)flush; // layout + commit

@end

/// Install __ui object into a JSContext (JavaScriptCore)
#ifdef __cplusplus
extern "C" {
#endif
void SNInstallBindings(JSContext *ctx, SNUIManager *mgr);
void RuneInstallBindings(JSContext *ctx, SNUIManager *mgr); // TODO: remove SNInstallBindings shim once call sites migrate
#ifdef __cplusplus
}
#endif

NS_ASSUME_NONNULL_END

#endif /* SNUIMANAGER_H */
