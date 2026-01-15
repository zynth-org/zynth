#ifndef ZYNTH_WEBSERVER_H
#define ZYNTH_WEBSERVER_H

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct ZynthWebServer ZynthWebServer;

typedef struct ZynthWebServerEvent {
  char *type;
  char *payload;
} ZynthWebServerEvent;

typedef struct ZynthWebServerConfig {
  const char *host;
  int port;
  const char *document_root;
  const char *index_html;
  const char *upload_path;
  const char *upload_dir;
  long long max_upload_bytes;
  const char *events_path;
} ZynthWebServerConfig;

ZynthWebServer *zynth_webserver_start(const ZynthWebServerConfig *config);
void zynth_webserver_stop(ZynthWebServer *server);
int zynth_webserver_is_running(ZynthWebServer *server);
int zynth_webserver_get_port(ZynthWebServer *server);
const char *zynth_webserver_get_host(ZynthWebServer *server);

size_t zynth_webserver_drain_events(
  ZynthWebServer *server,
  ZynthWebServerEvent *events,
  size_t max_events
);

void zynth_webserver_free_event(ZynthWebServerEvent *event);

#ifdef __cplusplus
}
#endif

#endif
