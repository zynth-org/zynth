#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

@class ZynthRuntime;

@protocol ZynthModuleBridge <NSObject>
- (id _Nullable)callModule:(NSString *)moduleName method:(NSString *)methodName args:(id _Nullable)args;
- (id _Nullable)callModuleSync:(NSString *)moduleName method:(NSString *)methodName args:(id _Nullable)args;
@end

@interface ZynthRuntime : NSObject

@property (nonatomic, weak, readonly) UIView *rootView;
@property (nonatomic, assign, readonly) int rootSurfaceId;

- (instancetype)initWithRootView:(UIView *)rootView;
- (BOOL)loadInitialBundleWithJsBundleURL:(NSURL *_Nullable)url
                                   error:(NSError *_Nullable *_Nullable)error;
- (void)startWithRootId:(int)rootId;
- (void)emitEventWithName:(NSString *)name payload:(id _Nullable)payload;
- (int)registerSurfaceWithRootView:(UIView *)rootView NS_SWIFT_NAME(registerSurface(rootView:));
- (void)unregisterSurfaceWithId:(int)surfaceId NS_SWIFT_NAME(unregisterSurface(id:));
- (void)setActiveSurface:(int)surfaceId;
- (void)callGlobal:(NSString *)name args:(NSArray *)args;
- (void)flush;
- (void)destroy;

- (void)installModuleBridge:(id<ZynthModuleBridge>)bridge constants:(NSDictionary<NSString *, id> *)constants NS_SWIFT_NAME(installModuleBridge(_:constants:));

@end

NS_ASSUME_NONNULL_END
