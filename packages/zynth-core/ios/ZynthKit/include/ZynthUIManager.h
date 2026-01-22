#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

@class ZynthNode;

@interface ZynthUIManager : NSObject

- (instancetype)initWithRootView:(UIView *)rootView;
- (NSNumber *)createNode:(NSString *)type;
- (void)setProp:(NSNumber *)nodeId name:(NSString *)name value:(NSString *_Nullable)value;
- (void)setText:(NSNumber *)nodeId text:(NSString *)text;
- (void)insertChild:(NSNumber *)parentId child:(NSNumber *)childId index:(NSNumber *)index;
- (void)removeChild:(NSNumber *)parentId child:(NSNumber *)childId;
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
- (void)markNodeDirty:(NSNumber *)nodeId;

@end

NS_ASSUME_NONNULL_END
