#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

@interface ZynthSkiaRendererBridge : NSObject
+ (BOOL)createSurface:(NSInteger)nodeId;
+ (BOOL)disposeSurface:(NSInteger)nodeId;
+ (BOOL)setFrameLoopEnabled:(BOOL)enabled forNode:(NSInteger)nodeId;
+ (BOOL)submitPacked:(const double *)ops
             opCount:(NSInteger)opCount
         stringTable:(NSArray<NSString *> *)stringTable
             forNode:(NSInteger)nodeId;
+ (BOOL)submitCommands:(NSArray<NSDictionary *> *)commands forNode:(NSInteger)nodeId;
+ (BOOL)submitFrame:(NSDictionary *)frame forNode:(NSInteger)nodeId;
+ (nullable UIImage *)renderImageForNode:(NSInteger)nodeId
                                   width:(NSInteger)width
                                  height:(NSInteger)height
                              clearColor:(uint32_t)clearColor;
+ (BOOL)hasSurface:(NSInteger)nodeId;
@end

NS_ASSUME_NONNULL_END
