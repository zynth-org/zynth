#ifndef RUNE_SN_NODE_H
#define RUNE_SN_NODE_H

#ifdef __OBJC__
#import <Foundation/Foundation.h>
#if __has_include(<UIKit/UIKit.h>)
#import <UIKit/UIKit.h>
#else
@class UIView;
@class UIColor;
#endif
@class RuneShadowLayer;
#import <Yoga/Yoga.h>

NS_ASSUME_NONNULL_BEGIN

/**
 A lightweight wrapper representing a node managed by `SNUIManager`.

 This class is intentionally exposed so component extensions can inspect the
 backing UIView and metadata when registering custom host components.
 */
@interface SNNode : NSObject

@property(nonatomic, assign) int nid;
@property(nonatomic, strong) UIView *view;
@property(nonatomic, assign) YGNodeRef yoga;
@property(nonatomic, strong) NSMutableArray<NSNumber *> *children;
@property(nonatomic, assign) BOOL hasOnPressHandler;
@property(nonatomic, assign) BOOL hasOnLoadHandler;
@property(nonatomic, assign) BOOL hasOnErrorHandler;
@property(nonatomic, strong, nullable) NSURLSessionDataTask *imageTask;
@property(nonatomic, copy, nullable) NSString *imageSourceToken;
@property(nonatomic, strong, nullable) UIColor *imageTintColor;
@property(nonatomic, assign) int parentId;
@property(nonatomic, copy, nullable) NSString *pointerEvents;
@property(nonatomic, assign) BOOL hasOnLayoutHandler;
@property(nonatomic, assign) BOOL hasDispatchedLayout;
@property(nonatomic, assign) CGRect lastLayoutFrame;
@property(nonatomic, copy) NSString *type;
@property(nonatomic, assign) int surfaceId;
@property(nonatomic, copy, nullable) NSDictionary *latestStyle;
@property(nonatomic, copy, nullable) NSArray<RuneShadowLayer *> *latestShadowLayers;
@property(nonatomic, strong, nullable) NSNumber *latestElevation;
@property(nonatomic, copy, nullable) NSDictionary *layoutTransition;
@property(nonatomic, copy, nullable) id transformOrigin;

@end

NS_ASSUME_NONNULL_END
#endif

#endif /* RUNE_SN_NODE_H */
