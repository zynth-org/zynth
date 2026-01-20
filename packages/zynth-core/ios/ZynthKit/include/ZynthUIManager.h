#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

@interface ZynthUIManager : NSObject

- (instancetype)initWithRootView:(UIView *)rootView;
- (NSNumber *)createNode:(NSString *)type;
- (NSNumber *)createNodeWithId:(NSNumber *)nodeId type:(NSString *)type;
- (void)setProp:(NSNumber *)nodeId name:(NSString *)name value:(NSString *)value;
- (void)setText:(NSNumber *)nodeId text:(NSString *)text;
- (void)insertChild:(NSNumber *)parentId child:(NSNumber *)childId index:(NSNumber *)index;
- (void)removeChild:(NSNumber *)parentId child:(NSNumber *)childId;
- (void)setHandler:(NSNumber *)nodeId name:(NSString *)name;
- (void)applyBatch:(NSString *)batchJSON;
- (void)setSurface:(NSNumber *)surfaceId;
- (void)flush;

@end

NS_ASSUME_NONNULL_END
