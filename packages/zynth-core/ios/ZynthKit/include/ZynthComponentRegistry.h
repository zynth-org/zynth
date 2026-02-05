#ifndef ZYNTH_COMPONENT_REGISTRY_H
#define ZYNTH_COMPONENT_REGISTRY_H

#ifdef __OBJC__
#import <Foundation/Foundation.h>
#import "ZynthNode.h"

@class ZynthUIManager;

NS_ASSUME_NONNULL_BEGIN

@protocol ZynthInspectableComponent <NSObject>
- (NSDictionary *)zynthInspectState;
@end

typedef UIView *_Nullable (^ZynthComponentViewFactory)(ZynthUIManager *manager, NSString *type);
typedef void (^ZynthComponentAttachBlock)(ZynthUIManager *manager, ZynthNode *node);
typedef BOOL (^ZynthComponentSetPropBlock)(ZynthUIManager *manager,
                                           ZynthNode *node,
                                           NSString *name,
                                           id _Nullable value,
                                           NSString *_Nullable rawJSON);
typedef BOOL (^ZynthComponentSetHandlerBlock)(ZynthUIManager *manager, ZynthNode *node, NSString *name);
typedef void (^ZynthComponentCleanupBlock)(ZynthUIManager *manager, ZynthNode *node);
typedef BOOL (^ZynthComponentInsertChildBlock)(ZynthUIManager *manager,
                                               ZynthNode *parent,
                                               ZynthNode *child,
                                               NSNumber *childId,
                                               NSUInteger index);
typedef BOOL (^ZynthComponentRemoveChildBlock)(ZynthUIManager *manager,
                                               ZynthNode *parent,
                                               ZynthNode *child,
                                               NSNumber *childId);
typedef void (^ZynthComponentApplyStyleBlock)(ZynthUIManager *manager,
                                              ZynthNode *node,
                                              NSDictionary *style);
typedef NSDictionary *_Nullable (^ZynthComponentInspectStateBlock)(ZynthUIManager *manager,
                                                                   ZynthNode *node);

@interface ZynthComponentDescriptor : NSObject

- (instancetype)initWithType:(NSString *)type NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;

@property(nonatomic, copy, readonly) NSString *type;
@property(nonatomic, copy, nullable) ZynthComponentViewFactory createView;
@property(nonatomic, copy, nullable) ZynthComponentAttachBlock attach;
@property(nonatomic, copy, nullable) ZynthComponentSetPropBlock handleSetProp;
@property(nonatomic, copy, nullable) ZynthComponentSetHandlerBlock handleSetHandler;
@property(nonatomic, copy, nullable) ZynthComponentCleanupBlock cleanup;
@property(nonatomic, copy, nullable) ZynthComponentInsertChildBlock handleInsertChild;
@property(nonatomic, copy, nullable) ZynthComponentRemoveChildBlock handleRemoveChild;
@property(nonatomic, copy, nullable) ZynthComponentApplyStyleBlock applyStyle;
@property(nonatomic, copy, nullable) ZynthComponentInspectStateBlock inspectState;

@end

@interface ZynthComponentRegistry : NSObject

+ (instancetype)shared;
- (void)registerDescriptor:(ZynthComponentDescriptor *)descriptor;
- (ZynthComponentDescriptor *_Nullable)getDescriptor:(NSString *)type;
- (NSArray<ZynthComponentDescriptor *> *)allDescriptors;

@end

void ZynthRegisterComponentDescriptor(ZynthComponentDescriptor *descriptor);
ZynthComponentDescriptor *_Nullable ZynthGetComponentDescriptor(NSString *type);
NSArray<ZynthComponentDescriptor *> *ZynthAllComponentDescriptors(void);

NS_ASSUME_NONNULL_END
#endif

#endif /* ZYNTH_COMPONENT_REGISTRY_H */
