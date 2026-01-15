#include "zynth_webserver.h"
#include "civetweb/civetweb.h"

#include <ctype.h>
#include <errno.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <time.h>

typedef struct ZynthWebServerEventNode {
  ZynthWebServerEvent event;
  struct ZynthWebServerEventNode *next;
} ZynthWebServerEventNode;

struct ZynthWebServer {
  struct mg_context *ctx;
  char *host;
  int port;
  char *document_root;
  char *index_html;
  char *upload_path;
  char *upload_dir;
  long long max_upload_bytes;
  char *events_path;
  pthread_mutex_t events_mutex;
  ZynthWebServerEventNode *events_head;
  ZynthWebServerEventNode *events_tail;
};

static char *zynth_strdup(const char *value) {
  if (!value) return NULL;
  size_t length = strlen(value) + 1;
  char *copy = (char *)malloc(length);
  if (!copy) return NULL;
  memcpy(copy, value, length);
  return copy;
}

static void zynth_free(void *value) {
  if (value) free(value);
}

static void zynth_webserver_queue_event(
  ZynthWebServer *server,
  const char *type,
  const char *payload
) {
  if (!server || !type || !payload) return;
  ZynthWebServerEventNode *node =
    (ZynthWebServerEventNode *)calloc(1, sizeof(ZynthWebServerEventNode));
  if (!node) return;
  node->event.type = zynth_strdup(type);
  node->event.payload = zynth_strdup(payload);
  if (!node->event.type || !node->event.payload) {
    zynth_free(node->event.type);
    zynth_free(node->event.payload);
    zynth_free(node);
    return;
  }
  pthread_mutex_lock(&server->events_mutex);
  if (server->events_tail) {
    server->events_tail->next = node;
  } else {
    server->events_head = node;
  }
  server->events_tail = node;
  pthread_mutex_unlock(&server->events_mutex);
}

static void zynth_webserver_clear_events(ZynthWebServer *server) {
  if (!server) return;
  pthread_mutex_lock(&server->events_mutex);
  ZynthWebServerEventNode *node = server->events_head;
  server->events_head = NULL;
  server->events_tail = NULL;
  pthread_mutex_unlock(&server->events_mutex);

  while (node) {
    ZynthWebServerEventNode *next = node->next;
    zynth_free(node->event.type);
    zynth_free(node->event.payload);
    zynth_free(node);
    node = next;
  }
}

static int zynth_is_allowed_filename_char(char value) {
  if (value >= 'a' && value <= 'z') return 1;
  if (value >= 'A' && value <= 'Z') return 1;
  if (value >= '0' && value <= '9') return 1;
  if (value == '.' || value == '_' || value == '-') return 1;
  return 0;
}

static int zynth_hex_value(char value) {
  if (value >= '0' && value <= '9') return value - '0';
  if (value >= 'a' && value <= 'f') return value - 'a' + 10;
  if (value >= 'A' && value <= 'F') return value - 'A' + 10;
  return -1;
}

static void zynth_url_decode(char *value) {
  if (!value) return;
  char *src = value;
  char *dst = value;
  while (*src) {
    if (*src == '%' && isxdigit((unsigned char)src[1]) &&
        isxdigit((unsigned char)src[2])) {
      int hi = zynth_hex_value(src[1]);
      int lo = zynth_hex_value(src[2]);
      if (hi >= 0 && lo >= 0) {
        *dst++ = (char)((hi << 4) | lo);
        src += 3;
        continue;
      }
    }
    if (*src == '+') {
      *dst++ = ' ';
      src++;
      continue;
    }
    *dst++ = *src++;
  }
  *dst = '\0';
}

static char *zynth_sanitize_filename(const char *input) {
  if (!input || !*input) return NULL;
  const char *base = input;
  for (const char *cursor = input; *cursor; cursor++) {
    if (*cursor == '/' || *cursor == '\\') {
      base = cursor + 1;
    }
  }
  if (!*base) return NULL;
  char *copy = zynth_strdup(base);
  if (!copy) return NULL;
  for (char *cursor = copy; *cursor; cursor++) {
    if (!zynth_is_allowed_filename_char(*cursor)) {
      *cursor = '_';
    }
  }
  if (strcmp(copy, ".") == 0 || strcmp(copy, "..") == 0 || !*copy) {
    zynth_free(copy);
    return zynth_strdup("upload");
  }
  return copy;
}

static int zynth_ensure_directory(const char *path) {
  if (!path || !*path) return 0;
  struct stat st;
  if (stat(path, &st) == 0) {
    return S_ISDIR(st.st_mode) ? 1 : 0;
  }
  if (mkdir(path, 0755) == 0) {
    return 1;
  }
  return 0;
}

static char *zynth_json_escape(const char *value) {
  if (!value) return zynth_strdup("");
  size_t length = 0;
  for (const char *cursor = value; *cursor; cursor++) {
    switch (*cursor) {
      case '\\':
      case '"':
        length += 2;
        break;
      case '\n':
      case '\r':
      case '\t':
        length += 2;
        break;
      default:
        length += 1;
        break;
    }
  }
  char *result = (char *)malloc(length + 1);
  if (!result) return NULL;
  char *out = result;
  for (const char *cursor = value; *cursor; cursor++) {
    switch (*cursor) {
      case '\\':
        *out++ = '\\';
        *out++ = '\\';
        break;
      case '"':
        *out++ = '\\';
        *out++ = '"';
        break;
      case '\n':
        *out++ = '\\';
        *out++ = 'n';
        break;
      case '\r':
        *out++ = '\\';
        *out++ = 'r';
        break;
      case '\t':
        *out++ = '\\';
        *out++ = 't';
        break;
      default:
        *out++ = *cursor;
        break;
    }
  }
  *out = '\0';
  return result;
}

static char *zynth_build_upload_payload(
  const char *name,
  const char *path,
  long long size
) {
  char size_buffer[32];
  snprintf(size_buffer, sizeof(size_buffer), "%lld", size);
  char *safe_name = zynth_json_escape(name);
  char *safe_path = zynth_json_escape(path);
  if (!safe_name || !safe_path) {
    zynth_free(safe_name);
    zynth_free(safe_path);
    return NULL;
  }
  const char *format = "{\"name\":\"%s\",\"path\":\"%s\",\"size\":%s}";
  size_t length = snprintf(NULL, 0, format, safe_name, safe_path, size_buffer);
  char *payload = (char *)malloc(length + 1);
  if (!payload) {
    zynth_free(safe_name);
    zynth_free(safe_path);
    return NULL;
  }
  snprintf(payload, length + 1, format, safe_name, safe_path, size_buffer);
  zynth_free(safe_name);
  zynth_free(safe_path);
  return payload;
}

static void zynth_send_status(
  struct mg_connection *conn,
  int status,
  const char *message
) {
  if (!message) message = "";
  mg_printf(
    conn,
    "HTTP/1.1 %d\r\nContent-Length: %zu\r\nContent-Type: text/plain\r\n\r\n%s",
    status,
    strlen(message),
    message
  );
}

static int zynth_handle_index(struct mg_connection *conn, void *cbdata) {
  ZynthWebServer *server = (ZynthWebServer *)cbdata;
  if (!server || !server->index_html) {
    return 0;
  }
  const struct mg_request_info *request = mg_get_request_info(conn);
  if (!request || !request->request_method) {
    return 0;
  }
  if (strcmp(request->request_method, "GET") != 0 &&
      strcmp(request->request_method, "HEAD") != 0) {
    zynth_send_status(conn, 405, "Method Not Allowed");
    return 1;
  }

  const char *html = server->index_html;
  size_t length = strlen(html);
  mg_printf(
    conn,
    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: %zu\r\n\r\n",
    length
  );
  if (strcmp(request->request_method, "HEAD") != 0) {
    mg_write(conn, html, length);
  }
  return 1;
}

static int zynth_write_request_body(
  struct mg_connection *conn,
  FILE *file,
  long long content_length,
  long long max_bytes,
  long long *out_written
) {
  long long written = 0;
  char buffer[8192];
  while (content_length < 0 || written < content_length) {
    size_t to_read = sizeof(buffer);
    if (content_length >= 0) {
      long long remaining = content_length - written;
      if (remaining <= 0) break;
      if (remaining < (long long)sizeof(buffer)) {
        to_read = (size_t)remaining;
      }
    }
    int read = mg_read(conn, buffer, (int)to_read);
    if (read <= 0) {
      break;
    }
    written += read;
    if (max_bytes > 0 && written > max_bytes) {
      return -1;
    }
    if (fwrite(buffer, 1, (size_t)read, file) != (size_t)read) {
      return 0;
    }
  }
  if (out_written) {
    *out_written = written;
  }
  return 1;
}

static int zynth_handle_upload(struct mg_connection *conn, void *cbdata) {
  ZynthWebServer *server = (ZynthWebServer *)cbdata;
  if (!server || !server->upload_dir) {
    zynth_send_status(conn, 400, "Uploads not configured");
    return 1;
  }
  const struct mg_request_info *request = mg_get_request_info(conn);
  if (!request || !request->request_method) {
    return 0;
  }
  if (strcmp(request->request_method, "POST") != 0 &&
      strcmp(request->request_method, "PUT") != 0) {
    zynth_send_status(conn, 405, "Method Not Allowed");
    return 1;
  }

  long long content_length = request->content_length;
  if (server->max_upload_bytes > 0 &&
      content_length > server->max_upload_bytes) {
    zynth_send_status(conn, 413, "Upload too large");
    return 1;
  }

  const char *header_name = mg_get_header(conn, "X-File-Name");
  const char *query_string = request->query_string;
  char name_buffer[256];
  const char *requested_name = header_name;
  if (!requested_name && query_string) {
    const char *param = strstr(query_string, "name=");
    if (param) {
      param += 5;
      size_t i = 0;
      while (param[i] && param[i] != '&' && i < sizeof(name_buffer) - 1) {
        name_buffer[i] = param[i];
        i++;
      }
      name_buffer[i] = '\0';
      zynth_url_decode(name_buffer);
      requested_name = name_buffer;
    }
  }

  char *safe_name = zynth_sanitize_filename(requested_name);
  if (!safe_name) {
    time_t now = time(NULL);
    char fallback[64];
    snprintf(fallback, sizeof(fallback), "upload-%lld", (long long)now);
    safe_name = zynth_strdup(fallback);
  }
  if (!safe_name) {
    zynth_send_status(conn, 500, "Upload failed");
    return 1;
  }

  if (!zynth_ensure_directory(server->upload_dir)) {
    zynth_free(safe_name);
    zynth_send_status(conn, 500, "Upload directory unavailable");
    return 1;
  }

  size_t path_length =
    strlen(server->upload_dir) + strlen(safe_name) + 2;
  char *full_path = (char *)malloc(path_length);
  if (!full_path) {
    zynth_free(safe_name);
    zynth_send_status(conn, 500, "Upload failed");
    return 1;
  }
  snprintf(full_path, path_length, "%s/%s", server->upload_dir, safe_name);

  FILE *file = fopen(full_path, "wb");
  if (!file) {
    zynth_free(safe_name);
    zynth_free(full_path);
    zynth_send_status(conn, 500, "Upload failed");
    return 1;
  }

  long long written = 0;
  int result = zynth_write_request_body(
    conn,
    file,
    content_length,
    server->max_upload_bytes,
    &written
  );
  fclose(file);

  if (result == -1) {
    remove(full_path);
    zynth_free(safe_name);
    zynth_free(full_path);
    zynth_send_status(conn, 413, "Upload too large");
    return 1;
  }
  if (result == 0) {
    remove(full_path);
    zynth_free(safe_name);
    zynth_free(full_path);
    zynth_send_status(conn, 500, "Upload failed");
    return 1;
  }

  char *payload = zynth_build_upload_payload(safe_name, full_path, written);
  if (payload) {
    zynth_webserver_queue_event(server, "upload", payload);
    zynth_free(payload);
  }

  zynth_free(safe_name);
  zynth_send_status(conn, 201, "Uploaded");
  zynth_free(full_path);
  return 1;
}

static int zynth_handle_events(struct mg_connection *conn, void *cbdata) {
  ZynthWebServer *server = (ZynthWebServer *)cbdata;
  if (!server) return 0;
  const struct mg_request_info *request = mg_get_request_info(conn);
  if (!request || !request->request_method) {
    return 0;
  }
  if (strcmp(request->request_method, "POST") != 0) {
    zynth_send_status(conn, 405, "Method Not Allowed");
    return 1;
  }

  long long content_length = request->content_length;
  long long max_bytes = server->max_upload_bytes > 0
    ? server->max_upload_bytes
    : 1024 * 1024;
  if (max_bytes > 1024 * 1024) {
    max_bytes = 1024 * 1024;
  }
  if (content_length > max_bytes) {
    zynth_send_status(conn, 413, "Payload too large");
    return 1;
  }

  size_t buffer_size = (content_length > 0 && content_length < max_bytes)
    ? (size_t)content_length
    : (size_t)max_bytes;
  if (buffer_size == 0) buffer_size = 1024;

  char *buffer = (char *)malloc(buffer_size + 1);
  if (!buffer) {
    zynth_send_status(conn, 500, "Event failed");
    return 1;
  }

  long long written = 0;
  while (content_length < 0 || written < content_length) {
    size_t remaining = buffer_size - (size_t)written;
    if (remaining == 0) {
      zynth_free(buffer);
      zynth_send_status(conn, 413, "Payload too large");
      return 1;
    }
    int read = mg_read(conn, buffer + written, (int)remaining);
    if (read <= 0) {
      break;
    }
    written += read;
    if (max_bytes > 0 && written > max_bytes) {
      zynth_free(buffer);
      zynth_send_status(conn, 413, "Payload too large");
      return 1;
    }
  }

  buffer[written] = '\0';
  zynth_webserver_queue_event(server, "message", buffer);
  zynth_free(buffer);
  zynth_send_status(conn, 204, "");
  return 1;
}

ZynthWebServer *zynth_webserver_start(const ZynthWebServerConfig *config) {
  if (!config) return NULL;
  ZynthWebServer *server = (ZynthWebServer *)calloc(1, sizeof(ZynthWebServer));
  if (!server) return NULL;

  server->host = zynth_strdup(config->host ? config->host : "0.0.0.0");
  server->port = config->port;
  server->document_root = zynth_strdup(config->document_root);
  server->index_html = zynth_strdup(config->index_html);
  server->upload_path = zynth_strdup(config->upload_path);
  server->upload_dir = zynth_strdup(config->upload_dir);
  server->max_upload_bytes = config->max_upload_bytes;
  server->events_path = zynth_strdup(config->events_path);

  pthread_mutex_init(&server->events_mutex, NULL);

  char port_buffer[64];
  if (server->host && *server->host) {
    snprintf(
      port_buffer,
      sizeof(port_buffer),
      "%s:%d",
      server->host,
      server->port > 0 ? server->port : 0
    );
  } else {
    snprintf(
      port_buffer,
      sizeof(port_buffer),
      "%d",
      server->port > 0 ? server->port : 0
    );
  }

  const char *options[] = {
    "listening_ports",
    port_buffer,
    "document_root",
    server->document_root ? server->document_root : ".",
    "num_threads",
    "4",
    NULL
  };

  struct mg_callbacks callbacks;
  memset(&callbacks, 0, sizeof(callbacks));
  server->ctx = mg_start(&callbacks, server, options);
  if (!server->ctx) {
    zynth_webserver_stop(server);
    return NULL;
  }

  if (server->index_html) {
    mg_set_request_handler(server->ctx, "/", zynth_handle_index, server);
    mg_set_request_handler(server->ctx, "/index.html", zynth_handle_index, server);
  }
  if (server->upload_path && *server->upload_path) {
    mg_set_request_handler(server->ctx, server->upload_path, zynth_handle_upload, server);
  }
  if (server->events_path && *server->events_path) {
    mg_set_request_handler(server->ctx, server->events_path, zynth_handle_events, server);
  }

  struct mg_server_ports ports[1];
  int count = mg_get_server_ports(server->ctx, 1, ports);
  if (count > 0) {
    server->port = ports[0].port;
  }

  return server;
}

void zynth_webserver_stop(ZynthWebServer *server) {
  if (!server) return;
  if (server->ctx) {
    mg_stop(server->ctx);
    server->ctx = NULL;
  }
  zynth_webserver_clear_events(server);
  pthread_mutex_destroy(&server->events_mutex);
  zynth_free(server->host);
  zynth_free(server->document_root);
  zynth_free(server->index_html);
  zynth_free(server->upload_path);
  zynth_free(server->upload_dir);
  zynth_free(server->events_path);
  zynth_free(server);
}

int zynth_webserver_is_running(ZynthWebServer *server) {
  if (!server) return 0;
  return server->ctx != NULL;
}

int zynth_webserver_get_port(ZynthWebServer *server) {
  if (!server) return 0;
  return server->port;
}

const char *zynth_webserver_get_host(ZynthWebServer *server) {
  if (!server) return NULL;
  return server->host;
}

size_t zynth_webserver_drain_events(
  ZynthWebServer *server,
  ZynthWebServerEvent *events,
  size_t max_events
) {
  if (!server || !events || max_events == 0) return 0;
  size_t count = 0;
  pthread_mutex_lock(&server->events_mutex);
  while (server->events_head && count < max_events) {
    ZynthWebServerEventNode *node = server->events_head;
    server->events_head = node->next;
    if (!server->events_head) {
      server->events_tail = NULL;
    }
    events[count] = node->event;
    zynth_free(node);
    count++;
  }
  pthread_mutex_unlock(&server->events_mutex);
  return count;
}

void zynth_webserver_free_event(ZynthWebServerEvent *event) {
  if (!event) return;
  zynth_free(event->type);
  zynth_free(event->payload);
  event->type = NULL;
  event->payload = NULL;
}
