#ifndef RUNE_COMPONENT_REGISTRY_H
#define RUNE_COMPONENT_REGISTRY_H

#ifdef __OBJC__
#import <Foundation/Foundation.h>
#import "SNNode.h"

@class SNUIManager;

typedef UIView *_Nullable (^RuneComponentViewFactory)(SNUIManager *manager, NSString *type);
typedef void (^RuneComponentAttachBlock)(SNUIManager *manager, SNNode *node);
typedef BOOL (^RuneComponentSetPropBlock)(SNUIManager *manager, SNNode *node, NSString *name, id _Nullable value, NSString *rawJSON);
typedef BOOL (^RuneComponentSetHandlerBlock)(SNUIManager *manager, SNNode *node, NSString *name);
typedef BOOL (^RuneComponentSetPropCallbackBlock)(SNUIManager *manager, SNNode *node, NSString *name, id _Nullable callback);

NS_ASSUME_NONNULL_BEGIN

/**
 Descriptor object describing how a custom host component integrates with the
 core UI manager. Component packages should create an instance, configure the
 relevant blocks, and register it via `RuneRegisterComponentDescriptor`.
 */
@interface RuneComponentDescriptor : NSObject

- (instancetype)initWithType:(NSString *)type NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;

@property(nonatomic, copy, readonly) NSString *type;
@property(nonatomic, copy, nullable) RuneComponentViewFactory createView;
@property(nonatomic, copy, nullable) RuneComponentAttachBlock attach;
@property(nonatomic, copy, nullable) RuneComponentSetPropBlock handleSetProp;
@property(nonatomic, copy, nullable) RuneComponentSetHandlerBlock handleSetHandler;
@property(nonatomic, copy, nullable) RuneComponentSetPropCallbackBlock handleSetPropCallback;

@end

/// Registers the descriptor globally so future UI managers can utilize it.
void RuneRegisterComponentDescriptor(RuneComponentDescriptor *descriptor);

/// Retrieves the descriptor for a given component type, if any.
RuneComponentDescriptor *_Nullable RuneGetComponentDescriptor(NSString *type);

/// Returns all registered descriptors. Primarily useful for diagnostics.
NSArray<RuneComponentDescriptor *> *RuneAllComponentDescriptors(void);

NS_ASSUME_NONNULL_END
#endif  // __OBJC__

#endif /* RUNE_COMPONENT_REGISTRY_H */
