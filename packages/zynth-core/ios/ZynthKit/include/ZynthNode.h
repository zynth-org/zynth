#ifndef ZYNTH_NODE_H
#define ZYNTH_NODE_H

#ifdef __OBJC__
#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
#import <Yoga/Yoga.h>

NS_ASSUME_NONNULL_BEGIN

@class ZynthLayoutTransitionConfig;

/**
 Lightweight node wrapper exposed to native component descriptors.
 */
@interface ZynthNode : NSObject

@property(nonatomic, assign) int nid;
@property(nonatomic, strong) UIView *view;
@property(nonatomic, assign, nullable) YGNodeRef yoga;
@property(nonatomic, strong) NSMutableArray<NSNumber *> *children;
@property(nonatomic, assign) int parentId;
@property(nonatomic, copy) NSString *type;
@property(nonatomic, assign) int surfaceId;
@property(nonatomic, copy, nullable) NSString *pointerEvents;
@property(nonatomic, assign) BOOL hasOnPressHandler;
@property(nonatomic, assign) BOOL hasOnLoadHandler;
@property(nonatomic, assign) BOOL hasOnErrorHandler;
@property(nonatomic, assign) BOOL hasOnLayoutHandler;
@property(nonatomic, assign) BOOL hasDispatchedLayout;
@property(nonatomic, assign) CGRect lastLayoutFrame;
@property(nonatomic, strong, nullable) ZynthLayoutTransitionConfig *layoutTransition;
@property(nonatomic, strong) NSMutableDictionary<NSString *, id> *attachments;

@end

NS_ASSUME_NONNULL_END
#endif

#endif /* ZYNTH_NODE_H */
