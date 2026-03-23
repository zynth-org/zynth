#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface ZynthWebServerBridge : NSObject

+ (void *_Nullable)startWithHost:(NSString *_Nullable)host
                            port:(NSInteger)port
                      tlsEnabled:(BOOL)tlsEnabled
                   tlsCertificate:(NSString *_Nullable)tlsCertificate
                    documentRoot:(NSString *_Nullable)documentRoot
                       indexHtml:(NSString *_Nullable)indexHtml
                      uploadPath:(NSString *_Nullable)uploadPath
                       uploadDir:(NSString *_Nullable)uploadDir
               uploadMetadataPath:(NSString *_Nullable)uploadMetadataPath
                  uploadAuthToken:(NSString *_Nullable)uploadAuthToken
                 uploadAuthHeader:(NSString *_Nullable)uploadAuthHeader
               uploadAuthQueryKey:(NSString *_Nullable)uploadAuthQueryKey
                  maxUploadBytes:(long long)maxUploadBytes
                      eventsPath:(NSString *_Nullable)eventsPath;
+ (BOOL)supportsTls;
+ (NSString *_Nullable)lastError;

+ (void)stop:(void *)handle;
+ (BOOL)isRunning:(void *)handle;
+ (int)port:(void *)handle;
+ (NSArray<NSDictionary *> *)drainEvents:(void *)handle
                               maxEvents:(NSInteger)maxEvents;
+ (NSString *_Nullable)uploadStateJson:(void *)handle;
+ (BOOL)setReply:(void *)handle key:(NSString *)key payloadJson:(NSString *)payloadJson;
+ (NSString *_Nullable)getReplyJson:(void *)handle
                                 key:(NSString *)key
                             consume:(BOOL)consume;

@end

NS_ASSUME_NONNULL_END
