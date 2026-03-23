#import "include/ZynthWebServerBridge.h"

#include "zynth_webserver.h"

@implementation ZynthWebServerBridge

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
                      eventsPath:(NSString *_Nullable)eventsPath {
  ZynthWebServerConfig config;
  config.host = host ? host.UTF8String : NULL;
  config.port = (int)port;
  config.tls_enabled = tlsEnabled ? 1 : 0;
  config.tls_certificate = tlsCertificate ? tlsCertificate.UTF8String : NULL;
  config.document_root = documentRoot ? documentRoot.UTF8String : NULL;
  config.index_html = indexHtml ? indexHtml.UTF8String : NULL;
  config.upload_path = uploadPath ? uploadPath.UTF8String : NULL;
  config.upload_dir = uploadDir ? uploadDir.UTF8String : NULL;
  config.upload_metadata_path =
    uploadMetadataPath ? uploadMetadataPath.UTF8String : NULL;
  config.upload_auth_token = uploadAuthToken ? uploadAuthToken.UTF8String : NULL;
  config.upload_auth_header = uploadAuthHeader ? uploadAuthHeader.UTF8String : NULL;
  config.upload_auth_query_key =
    uploadAuthQueryKey ? uploadAuthQueryKey.UTF8String : NULL;
  config.max_upload_bytes = maxUploadBytes;
  config.events_path = eventsPath ? eventsPath.UTF8String : NULL;

  return zynth_webserver_start(&config);
}

+ (BOOL)supportsTls {
  return zynth_webserver_supports_tls() != 0;
}

+ (NSString *_Nullable)lastError {
  char *message = zynth_webserver_get_last_error();
  if (!message) {
    return nil;
  }
  NSString *value = [NSString stringWithUTF8String:message];
  zynth_webserver_free_string(message);
  return value;
}

+ (void)stop:(void *)handle {
  if (handle) {
    zynth_webserver_stop((ZynthWebServer *)handle);
  }
}

+ (BOOL)isRunning:(void *)handle {
  if (!handle) {
    return NO;
  }
  return zynth_webserver_is_running((ZynthWebServer *)handle) != 0;
}

+ (int)port:(void *)handle {
  if (!handle) {
    return 0;
  }
  return zynth_webserver_get_port((ZynthWebServer *)handle);
}

+ (NSArray<NSDictionary *> *)drainEvents:(void *)handle
                               maxEvents:(NSInteger)maxEvents {
  if (!handle || maxEvents <= 0) {
    return @[];
  }

  size_t capacity = (size_t)maxEvents;
  ZynthWebServerEvent *events =
    (ZynthWebServerEvent *)calloc(capacity, sizeof(ZynthWebServerEvent));
  if (!events) {
    return @[];
  }

  size_t count =
    zynth_webserver_drain_events((ZynthWebServer *)handle, events, capacity);
  NSMutableArray<NSDictionary *> *result =
    [[NSMutableArray alloc] initWithCapacity:count];

  for (size_t i = 0; i < count; i++) {
    const char *type = events[i].type ? events[i].type : "";
    const char *payload = events[i].payload ? events[i].payload : "";
    NSString *typeString = [NSString stringWithUTF8String:type];
    NSString *payloadString = [NSString stringWithUTF8String:payload];
    [result addObject:@{
      @"type": typeString ?: @"",
      @"payload": payloadString ?: @""
    }];
    zynth_webserver_free_event(&events[i]);
  }

  free(events);
  return result;
}

+ (NSString *_Nullable)uploadStateJson:(void *)handle {
  if (!handle) {
    return nil;
  }
  char *json = zynth_webserver_get_upload_state_json((ZynthWebServer *)handle);
  if (!json) {
    return nil;
  }
  NSString *result = [NSString stringWithUTF8String:json];
  zynth_webserver_free_string(json);
  return result;
}

+ (BOOL)setReply:(void *)handle key:(NSString *)key payloadJson:(NSString *)payloadJson {
  if (!handle || key.length == 0 || payloadJson == nil) {
    return NO;
  }
  int ok = zynth_webserver_set_reply(
    (ZynthWebServer *)handle,
    key.UTF8String,
    payloadJson.UTF8String
  );
  return ok != 0;
}

+ (NSString *_Nullable)getReplyJson:(void *)handle
                                 key:(NSString *)key
                             consume:(BOOL)consume {
  if (!handle || key.length == 0) {
    return nil;
  }
  char *json = zynth_webserver_get_reply_json(
    (ZynthWebServer *)handle,
    key.UTF8String,
    consume ? 1 : 0
  );
  if (!json) {
    return nil;
  }
  NSString *result = [NSString stringWithUTF8String:json];
  zynth_webserver_free_string(json);
  return result;
}

@end
