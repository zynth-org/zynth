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
  const char *upload_metadata_path;
  const char *upload_auth_token;
  const char *upload_auth_header;
  const char *upload_auth_query_key;
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
char *zynth_webserver_get_upload_state_json(ZynthWebServer *server);
int zynth_webserver_set_reply(
  ZynthWebServer *server,
  const char *key,
  const char *payload_json
);
char *zynth_webserver_get_reply_json(
  ZynthWebServer *server,
  const char *key,
  int consume
);
void zynth_webserver_free_string(char *value);

#ifdef __cplusplus
}
#endif

#endif
