#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
#import <Yoga/Yoga.h>

NS_ASSUME_NONNULL_BEGIN

@interface ZynthYogaLayout : NSObject

- (instancetype)initWithRootView:(UIView *)rootView;
- (void)createNodeWithId:(NSNumber *)nodeId type:(NSString *)type view:(UIView *)view;
- (YGNodeRef)yogaForNode:(NSNumber *)nodeId;
- (void)setStyle:(NSNumber *)nodeId name:(NSString *)name value:(NSString *_Nullable)value;
- (void)insertChild:(NSNumber *)parentId child:(NSNumber *)childId index:(NSNumber *)index;
- (void)removeChild:(NSNumber *)parentId child:(NSNumber *)childId;
- (void)markDirty:(NSNumber *)nodeId;
- (void)applyLayout;
- (NSUInteger)nodeCount;

@end

NS_ASSUME_NONNULL_END
