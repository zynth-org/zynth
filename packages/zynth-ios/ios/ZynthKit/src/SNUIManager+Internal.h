#ifdef __OBJC__
#import <Foundation/Foundation.h>
#if __has_include(<UIKit/UIKit.h>)
#import <UIKit/UIKit.h>
#else
@class UIView;
@class UIImageView;
@class UIColor;
#endif
#import <Yoga/Yoga.h>
#import "SNUIManager.h"
#import "SNNode.h"
@class ZynthShadowLayer;

NS_ASSUME_NONNULL_BEGIN

@interface SNUIManager (Internal)
@property(nonatomic, strong, readonly) UIView *root;
@property(nonatomic, strong, readonly) NSMutableDictionary<NSNumber *, SNNode *> *nodes;
@property(nonatomic, assign, readonly) int nextId;
@property(nonatomic, assign, readonly) YGNodeRef rootYoga;
@property(nonatomic, strong, readonly, nullable) CADisplayLink *displayLink;
@property(nonatomic, assign, readonly) BOOL needsFlush;
@property(nonatomic, strong, readonly) NSMutableDictionary<NSString *, NSDictionary *> *eventPayloads;
@property(nonatomic, strong, readonly) NSMutableDictionary<NSNumber *, UIView *> *surfaceRoots;
@property(nonatomic, strong, readonly) NSMutableDictionary<NSNumber *, NSValue *> *surfaceYoga;
@property(nonatomic, assign, readonly) int activeSurfaceId;

- (CADisplayLink *)zynth_displayLink;
- (void)zynth_setDisplayLink:(CADisplayLink *_Nullable)displayLink;
- (BOOL)zynth_needsFlush;
- (void)zynth_setNeedsFlush:(BOOL)needsFlush;
- (NSMutableDictionary<NSString *, NSDictionary *> *)zynth_eventPayloads;
- (void)zynth_setEventPayloads:(NSMutableDictionary<NSString *, NSDictionary *> *)payloads;
- (NSArray<NSNumber *> *)zynth_allSurfaceIds;
- (UIView *_Nullable)zynth_rootViewForSurface:(int)surfaceId;
- (YGNodeRef)zynth_rootYogaForSurface:(int)surfaceId;
- (int)zynth_rootSurfaceId;
- (void)zynth_dispatchSurfaceFirstFrameIfNeeded:(int)surfaceId;

- (void)sn_markNeedsFlush;
- (void)sn_startDisplayLinkIfNeeded;
- (void)sn_stopDisplayLink;
- (void)sn_performFlush;
- (void)sn_applyStyleDictionary:(NSDictionary *)style toNode:(SNNode *)node;
- (void)sn_storeEventPayload:(NSDictionary *_Nullable)payload forNode:(SNNode *)node name:(NSString *)name;
- (NSString *_Nullable)sn_eventKeyForNode:(int)nid name:(NSString *)name;
- (void)sn_dispatchEvent:(NSString *)name payload:(NSDictionary *_Nullable)payload toNode:(SNNode *)node;
- (void)sn_applyBorderStyle:(NSDictionary *)style toView:(UIView *)view;
- (void)sn_applyShadowLayers:(NSArray<ZynthShadowLayer *> *_Nullable)layers elevation:(NSNumber *_Nullable)elevation toView:(UIView *)view;
@end

NS_ASSUME_NONNULL_END
#endif
