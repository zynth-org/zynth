#ifndef SNUIMANAGER_H
#define SNUIMANAGER_H

#ifdef __OBJC__
#import <Foundation/Foundation.h>
#import <dispatch/dispatch.h>
#if __has_include(<UIKit/UIKit.h>)
#import <UIKit/UIKit.h>
#else
@class UIView;
#endif
#import "RuneJSInvoker.h"

NS_ASSUME_NONNULL_BEGIN


@interface SNUIManager : NSObject

@property(nonatomic, weak) id<RuneJSInvoker> jsInvoker;

- (instancetype)initWithRootView:(UIView *)rootView;
/// Initializer for guest runtimes (e.g., Hypervisor). Pass YES to isGuest to allocate
/// a unique surface ID instead of using surface 0 (the host's main surface).
- (instancetype)initWithRootView:(UIView *)rootView isGuest:(BOOL)isGuest;
- (NSNumber *)createNode:(NSString *)type; // returns nodeId
- (void)setProp:(NSNumber *)nodeId name:(NSString *)name valueJSON:(NSString *)json;
- (void)setHandler:(NSNumber *)nodeId name:(NSString *)name;
- (void)setActiveSurface:(int)surfaceId;
- (void)setStyle:(NSNumber *)nodeId style:(NSDictionary *)style;
- (void)setText:(NSNumber *)nodeId text:(NSString *)text;
- (void)insertChild:(NSNumber *)parentId child:(NSNumber *)childId index:(NSNumber *)index;
- (void)removeChild:(NSNumber *)parentId child:(NSNumber *)childId;
- (void)applyBatch:(NSString *)batchJSON;
- (void)flush; // layout + commit
- (void)addSurfaceFirstFrameListener:(int)surfaceId listener:(dispatch_block_t)listener;
- (void)removeSurfaceFirstFrameListener:(int)surfaceId listener:(dispatch_block_t)listener;
- (NSDictionary *)dequeueEventPayloadForNode:(int)nodeId name:(NSString *)name;
- (void)clearAllNodes; // Clear all nodes and views for HMR reload
- (NSNumber *)registerSurfaceWithRootView:(UIView *)rootView;
- (void)unregisterSurface:(int)surfaceId;
- (int)rootSurfaceId;

@end

NS_ASSUME_NONNULL_END
#endif

#endif /* SNUIMANAGER_H */
