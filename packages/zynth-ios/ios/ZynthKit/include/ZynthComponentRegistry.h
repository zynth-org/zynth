#ifndef ZYNTH_COMPONENT_REGISTRY_H
#define ZYNTH_COMPONENT_REGISTRY_H

#ifdef __OBJC__
#import <Foundation/Foundation.h>
#import "SNNode.h"

@class SNUIManager;

typedef UIView *_Nullable (^ZynthComponentViewFactory)(SNUIManager *manager, NSString *type);
typedef void (^ZynthComponentAttachBlock)(SNUIManager *manager, SNNode *node);
typedef BOOL (^ZynthComponentSetPropBlock)(SNUIManager *manager, SNNode *node, NSString *name, id _Nullable value, NSString *rawJSON);
typedef BOOL (^ZynthComponentSetHandlerBlock)(SNUIManager *manager, SNNode *node, NSString *name);
typedef BOOL (^ZynthComponentSetPropCallbackBlock)(SNUIManager *manager, SNNode *node, NSString *name, id _Nullable callback);
typedef void (^ZynthComponentCleanupBlock)(SNUIManager *manager, SNNode *node);
typedef BOOL (^ZynthComponentInsertChildBlock)(SNUIManager *manager, SNNode *parent, SNNode *child, NSNumber *childId, NSUInteger index);
typedef BOOL (^ZynthComponentRemoveChildBlock)(SNUIManager *manager, SNNode *parent, SNNode *child, NSNumber *childId);
typedef void (^ZynthComponentApplyStyleBlock)(SNUIManager *manager, SNNode *node, NSDictionary *style);

NS_ASSUME_NONNULL_BEGIN

/**
 Descriptor object describing how a custom host component integrates with the
 core UI manager. Component packages should create an instance, configure the
 relevant blocks, and register it via `ZynthRegisterComponentDescriptor`.
 */
@interface ZynthComponentDescriptor : NSObject

- (instancetype)initWithType:(NSString *)type NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;

@property(nonatomic, copy, readonly) NSString *type;
@property(nonatomic, copy, nullable) ZynthComponentViewFactory createView;
@property(nonatomic, copy, nullable) ZynthComponentAttachBlock attach;
@property(nonatomic, copy, nullable) ZynthComponentSetPropBlock handleSetProp;
@property(nonatomic, copy, nullable) ZynthComponentSetHandlerBlock handleSetHandler;
@property(nonatomic, copy, nullable) ZynthComponentSetPropCallbackBlock handleSetPropCallback;
@property(nonatomic, copy, nullable) ZynthComponentCleanupBlock cleanup;
@property(nonatomic, copy, nullable) ZynthComponentInsertChildBlock handleInsertChild;
@property(nonatomic, copy, nullable) ZynthComponentRemoveChildBlock handleRemoveChild;
@property(nonatomic, copy, nullable) ZynthComponentApplyStyleBlock applyStyle;

@end

/// Registers the descriptor globally so future UI managers can utilize it.
void ZynthRegisterComponentDescriptor(ZynthComponentDescriptor *descriptor);

/// Retrieves the descriptor for a given component type, if any.
ZynthComponentDescriptor *_Nullable ZynthGetComponentDescriptor(NSString *type);

/// Returns all registered descriptors. Primarily useful for diagnostics.
NSArray<ZynthComponentDescriptor *> *ZynthAllComponentDescriptors(void);

NS_ASSUME_NONNULL_END
#endif  // __OBJC__

#endif /* ZYNTH_COMPONENT_REGISTRY_H */
