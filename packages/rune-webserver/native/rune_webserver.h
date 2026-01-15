#ifndef RUNE_WEBSERVER_H
#define RUNE_WEBSERVER_H

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct RuneWebServer RuneWebServer;

typedef struct RuneWebServerEvent {
  char *type;
  char *payload;
} RuneWebServerEvent;

typedef struct RuneWebServerConfig {
  const char *host;
  int port;
  const char *document_root;
  const char *index_html;
  const char *upload_path;
  const char *upload_dir;
  long long max_upload_bytes;
  const char *events_path;
} RuneWebServerConfig;

RuneWebServer *rune_webserver_start(const RuneWebServerConfig *config);
void rune_webserver_stop(RuneWebServer *server);
int rune_webserver_is_running(RuneWebServer *server);
int rune_webserver_get_port(RuneWebServer *server);
const char *rune_webserver_get_host(RuneWebServer *server);

size_t rune_webserver_drain_events(
  RuneWebServer *server,
  RuneWebServerEvent *events,
  size_t max_events
);

void rune_webserver_free_event(RuneWebServerEvent *event);

#ifdef __cplusplus
}
#endif

#endif
