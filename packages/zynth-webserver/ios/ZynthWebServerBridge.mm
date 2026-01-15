#import "include/ZynthWebServerBridge.h"

#include "zynth_webserver.h"

@implementation ZynthWebServerBridge

+ (void *_Nullable)startWithHost:(NSString *_Nullable)host
                            port:(NSInteger)port
                    documentRoot:(NSString *_Nullable)documentRoot
                       indexHtml:(NSString *_Nullable)indexHtml
                      uploadPath:(NSString *_Nullable)uploadPath
                       uploadDir:(NSString *_Nullable)uploadDir
                  maxUploadBytes:(long long)maxUploadBytes
                      eventsPath:(NSString *_Nullable)eventsPath {
  ZynthWebServerConfig config;
  config.host = host ? host.UTF8String : NULL;
  config.port = (int)port;
  config.document_root = documentRoot ? documentRoot.UTF8String : NULL;
  config.index_html = indexHtml ? indexHtml.UTF8String : NULL;
  config.upload_path = uploadPath ? uploadPath.UTF8String : NULL;
  config.upload_dir = uploadDir ? uploadDir.UTF8String : NULL;
  config.max_upload_bytes = maxUploadBytes;
  config.events_path = eventsPath ? eventsPath.UTF8String : NULL;

  return zynth_webserver_start(&config);
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

@end
