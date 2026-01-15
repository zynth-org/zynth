#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface ZynthWebServerBridge : NSObject

+ (void *_Nullable)startWithHost:(NSString *_Nullable)host
                            port:(NSInteger)port
                    documentRoot:(NSString *_Nullable)documentRoot
                       indexHtml:(NSString *_Nullable)indexHtml
                      uploadPath:(NSString *_Nullable)uploadPath
                       uploadDir:(NSString *_Nullable)uploadDir
                  maxUploadBytes:(long long)maxUploadBytes
                      eventsPath:(NSString *_Nullable)eventsPath;

+ (void)stop:(void *)handle;
+ (BOOL)isRunning:(void *)handle;
+ (int)port:(void *)handle;
+ (NSArray<NSDictionary *> *)drainEvents:(void *)handle
                               maxEvents:(NSInteger)maxEvents;

@end

NS_ASSUME_NONNULL_END
