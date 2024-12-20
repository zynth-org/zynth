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

NS_ASSUME_NONNULL_BEGIN

@interface SNNode : NSObject
@property(nonatomic, assign) int nid;
@property(nonatomic, strong) UIView *view;
@property(nonatomic, assign) YGNodeRef yoga;
@property(nonatomic, strong) NSMutableArray<NSNumber *> *children;
@property(nonatomic, strong, nullable) JSValue *onPressCallback;
@property(nonatomic, strong, nullable) JSValue *onLoadCallback;
@property(nonatomic, strong, nullable) JSValue *onErrorCallback;
@property(nonatomic, assign) BOOL hasOnPressHandler;
@property(nonatomic, assign) BOOL hasOnLoadHandler;
@property(nonatomic, assign) BOOL hasOnErrorHandler;
@property(nonatomic, strong, nullable) NSURLSessionDataTask *imageTask;
@property(nonatomic, copy, nullable) NSString *imageSourceToken;
@property(nonatomic, strong, nullable) UIColor *imageTintColor;
@property(nonatomic, assign) int parentId;
@property(nonatomic, copy, nullable) NSString *pointerEvents;
@end

@interface SNUIManager (Internal)
@property(nonatomic, strong, readonly) UIView *root;
@property(nonatomic, strong, readonly) NSMutableDictionary<NSNumber *, SNNode *> *nodes;
@property(nonatomic, assign, readonly) int nextId;
@property(nonatomic, assign, readonly) YGNodeRef rootYoga;
@property(nonatomic, strong, readonly, nullable) CADisplayLink *displayLink;
@property(nonatomic, assign, readonly) BOOL needsFlush;
@property(nonatomic, strong, readonly) NSMutableDictionary<NSString *, NSDictionary *> *eventPayloads;

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
