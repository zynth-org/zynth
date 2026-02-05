#pragma once

#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

@class ZynthNode;

@interface ZynthUIManager : NSObject

- (instancetype)initWithRootView:(UIView *)rootView;
- (NSNumber *)createNode:(NSString *)type;
- (void)setProp:(NSNumber *)nodeId name:(NSString *)name value:(NSString *_Nullable)value;
- (void)setProp:(NSNumber *)nodeId name:(NSString *)name valueAny:(id _Nullable)value;
- (void)setText:(NSNumber *)nodeId text:(NSString *)text;
- (void)insertChild:(NSNumber *)parentId child:(NSNumber *)childId index:(NSNumber *)index;
- (void)removeChild:(NSNumber *)parentId child:(NSNumber *)childId;
- (void)dropNode:(NSNumber *)nodeId;
- (void)setHandler:(NSNumber *)nodeId name:(NSString *)name;
- (void)applyBatch:(NSString *)batchJSON;
- (void)setSurface:(NSNumber *)surfaceId;
- (void)flush;
- (void)setFrameProfiler:(void (^_Nullable)(NSTimeInterval frameMs,
                                            NSTimeInterval layoutMs,
                                            BOOL overBudget,
                                            NSUInteger nodeCount))profiler;
- (ZynthNode *_Nullable)getNodeState:(NSNumber *)nodeId;
- (NSNumber *_Nullable)getParentId:(NSNumber *)nodeId;
- (NSDictionary *)snapshot:(NSDictionary *_Nullable)options;
- (void)markNodeDirty:(NSNumber *)nodeId;
- (void)zynth_recursiveRemoveNode:(NSNumber *)nodeId;
- (void)applyKeyboardAvoidingAdjustment:(NSNumber *)nodeId behavior:(NSString *)behavior overlap:(CGFloat)overlap availableHeight:(NSNumber *_Nullable)availableHeight;

@end

NS_ASSUME_NONNULL_END
