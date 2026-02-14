#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

@interface ZynthSkiaRendererBridge : NSObject
+ (void)setRuntimeState:(void *_Nullable)state;
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
+ (NSArray<NSNumber *> *)surfaceNodeIdsForSignalId:(int)signalId;
+ (double)measureText:(NSString *)text
           familyName:(NSString *)familyName
             fontSize:(double)fontSize
            fontStyle:(NSString *)fontStyle
           fontWeight:(NSString *)fontWeight;
+ (NSArray<NSString *> *)listFontFamilies;
+ (BOOL)registerFont:(NSString *)familyName data:(NSData *)data;
+ (BOOL)registerFont:(NSString *)familyName path:(NSString *)path;
+ (NSInteger)createImageFromEncodedData:(NSData *)data;
+ (NSInteger)createImageFromPixelsWithWidth:(NSInteger)width
                                    height:(NSInteger)height
                                 alphaType:(NSInteger)alphaType
                                 colorType:(NSInteger)colorType
                                  rowBytes:(NSInteger)rowBytes
                                      data:(NSData *)data;
+ (nullable NSDictionary<NSString *, NSNumber *> *)getImageInfo:(NSInteger)imageId;
+ (BOOL)releaseImage:(NSInteger)imageId;
+ (NSInteger)createSVGFromString:(NSString *)source;
+ (NSInteger)createSVGFromData:(NSData *)data;
+ (nullable NSDictionary<NSString *, NSNumber *> *)getSVGSize:(NSInteger)svgId;
+ (BOOL)releaseSVG:(NSInteger)svgId;
@end

NS_ASSUME_NONNULL_END
