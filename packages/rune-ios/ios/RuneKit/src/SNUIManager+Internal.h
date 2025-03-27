#ifdef __OBJC__
#import <Foundation/Foundation.h>
#if __has_include(<UIKit/UIKit.h>)
#import <UIKit/UIKit.h>
#else
@class UIView;
@class UIImageView;
@class UIColor;
#endif
#import <JavaScriptCore/JavaScriptCore.h>
#import <Yoga/Yoga.h>
#import "SNUIManager.h"
#import "SNNode.h"

NS_ASSUME_NONNULL_BEGIN

@interface SNUIManager (Internal)
@property(nonatomic, strong, readonly) UIView *root;
@property(nonatomic, strong, readonly) NSMutableDictionary<NSNumber *, SNNode *> *nodes;
@property(nonatomic, assign, readonly) int nextId;
@property(nonatomic, assign, readonly) YGNodeRef rootYoga;
@property(nonatomic, strong, readonly, nullable) CADisplayLink *displayLink;
@property(nonatomic, assign, readonly) BOOL needsFlush;
@property(nonatomic, strong, readonly) NSMutableDictionary<NSString *, NSDictionary *> *eventPayloads;

- (CADisplayLink *)rune_displayLink;
- (void)rune_setDisplayLink:(CADisplayLink *_Nullable)displayLink;
- (BOOL)rune_needsFlush;
- (void)rune_setNeedsFlush:(BOOL)needsFlush;
- (NSMutableDictionary<NSString *, NSDictionary *> *)rune_eventPayloads;
- (void)rune_setEventPayloads:(NSMutableDictionary<NSString *, NSDictionary *> *)payloads;

- (void)sn_markNeedsFlush;
- (void)sn_startDisplayLinkIfNeeded;
- (void)sn_stopDisplayLink;
- (void)sn_performFlush;
- (void)sn_applyStyleDictionary:(NSDictionary *)style toNode:(SNNode *)node;
- (void)sn_storeEventPayload:(NSDictionary *_Nullable)payload forNode:(SNNode *)node name:(NSString *)name;
- (NSString *_Nullable)sn_eventKeyForNode:(int)nid name:(NSString *)name;
- (void)sn_dispatchEvent:(NSString *)name payload:(NSDictionary *_Nullable)payload toNode:(SNNode *)node;
@end

NS_ASSUME_NONNULL_END
#endif
