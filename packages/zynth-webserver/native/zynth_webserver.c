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

typedef struct ZynthActiveUploadNode {
  long long upload_id;
  char *name;
  char *path;
  long long bytes_received;
  long long total_bytes;
  long long started_at_ms;
  long long updated_at_ms;
  struct ZynthActiveUploadNode *next;
} ZynthActiveUploadNode;

struct ZynthWebServer {
  struct mg_context *ctx;
  char *host;
  int port;
  char *document_root;
  char *index_html;
  char *upload_path;
  char *upload_dir;
  char *upload_metadata_path;
  char *upload_auth_token;
  char *upload_auth_header;
  char *upload_auth_query_key;
  long long max_upload_bytes;
  char *events_path;
  pthread_mutex_t events_mutex;
  ZynthWebServerEventNode *events_head;
  ZynthWebServerEventNode *events_tail;
  pthread_mutex_t uploads_mutex;
  ZynthActiveUploadNode *active_uploads_head;
  long long next_upload_id;
  long long total_uploads_started;
  long long total_uploads_completed;
  long long total_uploads_failed;
  long long total_upload_bytes_received;
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

void zynth_webserver_free_string(char *value) { zynth_free(value); }

static long long zynth_now_ms(void) {
  struct timespec ts;
  clock_gettime(CLOCK_REALTIME, &ts);
  return ((long long)ts.tv_sec * 1000LL) + ((long long)ts.tv_nsec / 1000000LL);
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

static ZynthActiveUploadNode *zynth_upload_begin(
  ZynthWebServer *server,
  const char *name,
  const char *path,
  long long total_bytes
) {
  if (!server) return NULL;
  ZynthActiveUploadNode *node =
    (ZynthActiveUploadNode *)calloc(1, sizeof(ZynthActiveUploadNode));
  if (!node) return NULL;

  node->name = zynth_strdup(name ? name : "");
  node->path = zynth_strdup(path ? path : "");
  if (!node->name || !node->path) {
    zynth_free(node->name);
    zynth_free(node->path);
    zynth_free(node);
    return NULL;
  }

  node->total_bytes = total_bytes;
  node->started_at_ms = zynth_now_ms();
  node->updated_at_ms = node->started_at_ms;

  pthread_mutex_lock(&server->uploads_mutex);
  node->upload_id = ++server->next_upload_id;
  node->next = server->active_uploads_head;
  server->active_uploads_head = node;
  server->total_uploads_started += 1;
  pthread_mutex_unlock(&server->uploads_mutex);
  return node;
}

static void zynth_upload_update(
  ZynthWebServer *server,
  ZynthActiveUploadNode *upload,
  long long bytes_received
) {
  if (!server || !upload) return;
  pthread_mutex_lock(&server->uploads_mutex);
  upload->bytes_received = bytes_received;
  upload->updated_at_ms = zynth_now_ms();
  pthread_mutex_unlock(&server->uploads_mutex);
}

static void zynth_upload_finalize(
  ZynthWebServer *server,
  ZynthActiveUploadNode *upload,
  int success
) {
  if (!server || !upload) return;
  pthread_mutex_lock(&server->uploads_mutex);
  ZynthActiveUploadNode **cursor = &server->active_uploads_head;
  while (*cursor) {
    if (*cursor == upload) {
      *cursor = upload->next;
      break;
    }
    cursor = &((*cursor)->next);
  }

  upload->updated_at_ms = zynth_now_ms();
  if (success) {
    server->total_uploads_completed += 1;
    server->total_upload_bytes_received += upload->bytes_received;
  } else {
    server->total_uploads_failed += 1;
  }
  pthread_mutex_unlock(&server->uploads_mutex);

  zynth_free(upload->name);
  zynth_free(upload->path);
  zynth_free(upload);
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

static void zynth_webserver_clear_active_uploads(ZynthWebServer *server) {
  if (!server) return;
  pthread_mutex_lock(&server->uploads_mutex);
  ZynthActiveUploadNode *node = server->active_uploads_head;
  server->active_uploads_head = NULL;
  pthread_mutex_unlock(&server->uploads_mutex);

  while (node) {
    ZynthActiveUploadNode *next = node->next;
    zynth_free(node->name);
    zynth_free(node->path);
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

static int zynth_get_query_param(
  const char *query_string,
  const char *key,
  char *out,
  size_t out_size
) {
  if (!query_string || !key || !out || out_size == 0) return 0;
  size_t key_len = strlen(key);
  const char *cursor = query_string;

  while (*cursor) {
    const char *pair_end = strchr(cursor, '&');
    if (!pair_end) pair_end = cursor + strlen(cursor);
    const char *equals = memchr(cursor, '=', (size_t)(pair_end - cursor));
    if (equals) {
      size_t name_len = (size_t)(equals - cursor);
      if (name_len == key_len && strncmp(cursor, key, key_len) == 0) {
        size_t value_len = (size_t)(pair_end - equals - 1);
        if (value_len >= out_size) {
          value_len = out_size - 1;
        }
        memcpy(out, equals + 1, value_len);
        out[value_len] = '\0';
        zynth_url_decode(out);
        return 1;
      }
    }
    if (*pair_end == '&') {
      cursor = pair_end + 1;
    } else {
      break;
    }
  }
  return 0;
}

static int zynth_string_equals(const char *a, const char *b) {
  if (!a || !b) return 0;
  return strcmp(a, b) == 0;
}

static int zynth_is_authorized(
  ZynthWebServer *server,
  struct mg_connection *conn,
  const struct mg_request_info *request
) {
  if (!server || !server->upload_auth_token || !*server->upload_auth_token) {
    return 1;
  }

  const char *header_name =
    (server->upload_auth_header && *server->upload_auth_header)
      ? server->upload_auth_header
      : "X-Zynth-Upload-Token";
  const char *query_key =
    (server->upload_auth_query_key && *server->upload_auth_query_key)
      ? server->upload_auth_query_key
      : "token";

  const char *header_value = mg_get_header(conn, header_name);
  if (header_value && zynth_string_equals(header_value, server->upload_auth_token)) {
    return 1;
  }

  char query_token[512];
  if (request && zynth_get_query_param(
    request->query_string,
    query_key,
    query_token,
    sizeof(query_token)
  )) {
    if (zynth_string_equals(query_token, server->upload_auth_token)) {
      return 1;
    }
  }

  return 0;
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

static int zynth_is_json_like(const char *value) {
  if (!value) return 0;
  while (*value && isspace((unsigned char)*value)) value++;
  return *value == '{' || *value == '[';
}

static char *zynth_upload_metadata_json(
  const struct mg_request_info *request,
  const char *header_metadata
) {
  const char *query = request ? request->query_string : NULL;
  char query_metadata[2048];
  if (zynth_get_query_param(query, "metadata", query_metadata, sizeof(query_metadata))) {
    if (zynth_is_json_like(query_metadata)) {
      return zynth_strdup(query_metadata);
    }
    char *escaped = zynth_json_escape(query_metadata);
    if (!escaped) return NULL;
    const char *format = "{\"value\":\"%s\"}";
    size_t length = snprintf(NULL, 0, format, escaped);
    char *out = (char *)malloc(length + 1);
    if (!out) {
      zynth_free(escaped);
      return NULL;
    }
    snprintf(out, length + 1, format, escaped);
    zynth_free(escaped);
    return out;
  }

  if (header_metadata && *header_metadata) {
    if (zynth_is_json_like(header_metadata)) {
      return zynth_strdup(header_metadata);
    }
    char *escaped = zynth_json_escape(header_metadata);
    if (!escaped) return NULL;
    const char *format = "{\"value\":\"%s\"}";
    size_t length = snprintf(NULL, 0, format, escaped);
    char *out = (char *)malloc(length + 1);
    if (!out) {
      zynth_free(escaped);
      return NULL;
    }
    snprintf(out, length + 1, format, escaped);
    zynth_free(escaped);
    return out;
  }

  return zynth_strdup("{}");
}

static char *zynth_build_upload_lifecycle_payload(
  const char *phase,
  long long upload_id,
  const char *name,
  const char *path,
  long long bytes_received,
  long long total_bytes,
  const char *method,
  const char *remote_addr,
  const char *content_type,
  const char *reason,
  int status_code,
  const char *metadata_json
) {
  char *safe_phase = zynth_json_escape(phase ? phase : "");
  char *safe_name = zynth_json_escape(name ? name : "");
  char *safe_path = zynth_json_escape(path ? path : "");
  char *safe_method = zynth_json_escape(method ? method : "");
  char *safe_remote = zynth_json_escape(remote_addr ? remote_addr : "");
  char *safe_content_type = zynth_json_escape(content_type ? content_type : "");
  char *safe_reason = zynth_json_escape(reason ? reason : "");
  if (!safe_phase || !safe_name || !safe_path || !safe_method ||
      !safe_remote || !safe_content_type || !safe_reason) {
    zynth_free(safe_phase);
    zynth_free(safe_name);
    zynth_free(safe_path);
    zynth_free(safe_method);
    zynth_free(safe_remote);
    zynth_free(safe_content_type);
    zynth_free(safe_reason);
    return NULL;
  }

  const char *meta = metadata_json && *metadata_json ? metadata_json : "{}";
  const char *format =
    "{\"uploadId\":%lld,\"phase\":\"%s\",\"name\":\"%s\",\"path\":\"%s\","
    "\"bytesReceived\":%lld,\"totalBytes\":%lld,\"method\":\"%s\","
    "\"remoteAddress\":\"%s\",\"contentType\":\"%s\",\"reason\":\"%s\","
    "\"statusCode\":%d,\"metadata\":%s}";

  size_t length = snprintf(
    NULL,
    0,
    format,
    upload_id,
    safe_phase,
    safe_name,
    safe_path,
    bytes_received,
    total_bytes,
    safe_method,
    safe_remote,
    safe_content_type,
    safe_reason,
    status_code,
    meta
  );
  char *payload = (char *)malloc(length + 1);
  if (!payload) {
    zynth_free(safe_phase);
    zynth_free(safe_name);
    zynth_free(safe_path);
    zynth_free(safe_method);
    zynth_free(safe_remote);
    zynth_free(safe_content_type);
    zynth_free(safe_reason);
    return NULL;
  }

  snprintf(
    payload,
    length + 1,
    format,
    upload_id,
    safe_phase,
    safe_name,
    safe_path,
    bytes_received,
    total_bytes,
    safe_method,
    safe_remote,
    safe_content_type,
    safe_reason,
    status_code,
    meta
  );
  zynth_free(safe_phase);
  zynth_free(safe_name);
  zynth_free(safe_path);
  zynth_free(safe_method);
  zynth_free(safe_remote);
  zynth_free(safe_content_type);
  zynth_free(safe_reason);
  return payload;
}

static void zynth_emit_upload_event(
  ZynthWebServer *server,
  const char *event_type,
  const char *phase,
  ZynthActiveUploadNode *upload,
  const struct mg_request_info *request,
  const char *content_type,
  const char *reason,
  int status_code,
  const char *metadata_json
) {
  if (!server || !upload) return;
  const char *method = request && request->request_method ? request->request_method : "";
  const char *remote_addr = request && request->remote_addr ? request->remote_addr : "";
  char *payload = zynth_build_upload_lifecycle_payload(
    phase,
    upload->upload_id,
    upload->name,
    upload->path,
    upload->bytes_received,
    upload->total_bytes,
    method,
    remote_addr,
    content_type,
    reason,
    status_code,
    metadata_json
  );
  if (payload) {
    zynth_webserver_queue_event(server, event_type, payload);
    zynth_free(payload);
  }
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
  long long *out_written,
  ZynthWebServer *server,
  ZynthActiveUploadNode *upload,
  const struct mg_request_info *request,
  const char *content_type,
  const char *metadata_json
) {
  long long written = 0;
  long long next_progress_emit = 0;
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
    zynth_upload_update(server, upload, written);
    if (max_bytes > 0 && written > max_bytes) {
      return -1;
    }
    if (fwrite(buffer, 1, (size_t)read, file) != (size_t)read) {
      return 0;
    }

    int should_emit = 0;
    if (written >= next_progress_emit) {
      should_emit = 1;
      next_progress_emit = written + (256 * 1024);
    }
    if (should_emit) {
      zynth_emit_upload_event(
        server,
        "upload_progress",
        "progress",
        upload,
        request,
        content_type,
        "",
        0,
        metadata_json
      );
    }
  }
  if (out_written) {
    *out_written = written;
  }
  if (content_length >= 0 && written < content_length) {
    return 0;
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
  if (!zynth_is_authorized(server, conn, request)) {
    zynth_send_status(conn, 401, "Unauthorized");
    return 1;
  }

  long long content_length = request->content_length;
  if (server->max_upload_bytes > 0 &&
      content_length > server->max_upload_bytes) {
    zynth_send_status(conn, 413, "Upload too large");
    return 1;
  }

  const char *header_name = mg_get_header(conn, "X-File-Name");
  const char *header_metadata = mg_get_header(conn, "X-Upload-Metadata");
  const char *content_type = mg_get_header(conn, "Content-Type");
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

  ZynthActiveUploadNode *upload =
    zynth_upload_begin(server, safe_name, full_path, content_length);
  if (!upload) {
    zynth_free(safe_name);
    zynth_free(full_path);
    zynth_send_status(conn, 500, "Upload failed");
    return 1;
  }

  char *metadata_json = zynth_upload_metadata_json(request, header_metadata);
  zynth_emit_upload_event(
    server,
    "upload_started",
    "started",
    upload,
    request,
    content_type,
    "",
    0,
    metadata_json
  );

  FILE *file = fopen(full_path, "wb");
  if (!file) {
    zynth_emit_upload_event(
      server,
      "upload_failed",
      "failed",
      upload,
      request,
      content_type,
      "open_failed",
      500,
      metadata_json
    );
    zynth_upload_finalize(server, upload, 0);
    zynth_free(safe_name);
    zynth_free(full_path);
    zynth_free(metadata_json);
    zynth_send_status(conn, 500, "Upload failed");
    return 1;
  }

  long long written = 0;
  int result = zynth_write_request_body(
    conn,
    file,
    content_length,
    server->max_upload_bytes,
    &written,
    server,
    upload,
    request,
    content_type,
    metadata_json
  );
  fclose(file);

  if (result == -1) {
    zynth_emit_upload_event(
      server,
      "upload_failed",
      "failed",
      upload,
      request,
      content_type,
      "max_bytes_exceeded",
      413,
      metadata_json
    );
    zynth_upload_finalize(server, upload, 0);
    remove(full_path);
    zynth_free(safe_name);
    zynth_free(full_path);
    zynth_free(metadata_json);
    zynth_send_status(conn, 413, "Upload too large");
    return 1;
  }
  if (result == 0) {
    zynth_emit_upload_event(
      server,
      "upload_failed",
      "failed",
      upload,
      request,
      content_type,
      "write_failed",
      500,
      metadata_json
    );
    zynth_upload_finalize(server, upload, 0);
    remove(full_path);
    zynth_free(safe_name);
    zynth_free(full_path);
    zynth_free(metadata_json);
    zynth_send_status(conn, 500, "Upload failed");
    return 1;
  }

  zynth_upload_update(server, upload, written);
  zynth_emit_upload_event(
    server,
    "upload_completed",
    "completed",
    upload,
    request,
    content_type,
    "",
    201,
    metadata_json
  );
  zynth_upload_finalize(server, upload, 1);

  zynth_free(safe_name);
  zynth_send_status(conn, 201, "Uploaded");
  zynth_free(full_path);
  zynth_free(metadata_json);
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

static int zynth_handle_upload_metadata(struct mg_connection *conn, void *cbdata) {
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
  if (!zynth_is_authorized(server, conn, request)) {
    zynth_send_status(conn, 401, "Unauthorized");
    return 1;
  }

  long long max_bytes = server->max_upload_bytes > 0
    ? server->max_upload_bytes
    : (256 * 1024);
  if (max_bytes > (1024 * 1024)) {
    max_bytes = 1024 * 1024;
  }
  long long content_length = request->content_length;
  if (content_length > max_bytes) {
    zynth_send_status(conn, 413, "Payload too large");
    return 1;
  }

  size_t capacity = (content_length > 0 && content_length < max_bytes)
    ? (size_t)content_length
    : (size_t)max_bytes;
  if (capacity == 0) capacity = 1024;

  char *body = (char *)malloc(capacity + 1);
  if (!body) {
    zynth_send_status(conn, 500, "Metadata failed");
    return 1;
  }

  long long written = 0;
  while (content_length < 0 || written < content_length) {
    size_t remaining = capacity - (size_t)written;
    if (remaining == 0) {
      zynth_free(body);
      zynth_send_status(conn, 413, "Payload too large");
      return 1;
    }
    int read = mg_read(conn, body + written, (int)remaining);
    if (read <= 0) break;
    written += read;
    if (written > max_bytes) {
      zynth_free(body);
      zynth_send_status(conn, 413, "Payload too large");
      return 1;
    }
  }
  body[written] = '\0';

  const char *method = request->request_method ? request->request_method : "";
  const char *remote_addr = request->remote_addr ? request->remote_addr : "";
  char *safe_method = zynth_json_escape(method);
  char *safe_remote = zynth_json_escape(remote_addr);
  if (!safe_method || !safe_remote) {
    zynth_free(safe_method);
    zynth_free(safe_remote);
    zynth_free(body);
    zynth_send_status(conn, 500, "Metadata failed");
    return 1;
  }
  const char *format = "{\"method\":\"%s\",\"remoteAddress\":\"%s\",\"metadata\":%s}";
  size_t payload_length = snprintf(NULL, 0, format, safe_method, safe_remote, body);
  char *payload = (char *)malloc(payload_length + 1);
  if (payload) {
    snprintf(payload, payload_length + 1, format, safe_method, safe_remote, body);
    zynth_webserver_queue_event(server, "upload_metadata", payload);
    zynth_free(payload);
  }

  zynth_free(safe_method);
  zynth_free(safe_remote);
  zynth_free(body);
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
  server->upload_metadata_path = zynth_strdup(config->upload_metadata_path);
  server->upload_auth_token = zynth_strdup(config->upload_auth_token);
  server->upload_auth_header = zynth_strdup(config->upload_auth_header);
  server->upload_auth_query_key = zynth_strdup(config->upload_auth_query_key);
  server->max_upload_bytes = config->max_upload_bytes;
  server->events_path = zynth_strdup(config->events_path);

  pthread_mutex_init(&server->events_mutex, NULL);
  pthread_mutex_init(&server->uploads_mutex, NULL);

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
  if (server->upload_metadata_path && *server->upload_metadata_path) {
    mg_set_request_handler(
      server->ctx,
      server->upload_metadata_path,
      zynth_handle_upload_metadata,
      server
    );
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
  zynth_webserver_clear_active_uploads(server);
  pthread_mutex_destroy(&server->events_mutex);
  pthread_mutex_destroy(&server->uploads_mutex);
  zynth_free(server->host);
  zynth_free(server->document_root);
  zynth_free(server->index_html);
  zynth_free(server->upload_path);
  zynth_free(server->upload_dir);
  zynth_free(server->upload_metadata_path);
  zynth_free(server->upload_auth_token);
  zynth_free(server->upload_auth_header);
  zynth_free(server->upload_auth_query_key);
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

char *zynth_webserver_get_upload_state_json(ZynthWebServer *server) {
  if (!server) {
    return zynth_strdup(
      "{\"activeCount\":0,\"totalStarted\":0,\"totalCompleted\":0,"
      "\"totalFailed\":0,\"totalBytesReceived\":0,\"activeUploads\":[]}"
    );
  }

  pthread_mutex_lock(&server->uploads_mutex);
  int active_count = 0;
  size_t uploads_json_length = 2;
  ZynthActiveUploadNode *cursor = server->active_uploads_head;
  while (cursor) {
    active_count += 1;
    uploads_json_length += 256;
    uploads_json_length += strlen(cursor->name ? cursor->name : "");
    uploads_json_length += strlen(cursor->path ? cursor->path : "");
    cursor = cursor->next;
  }

  char *uploads_json = (char *)malloc(uploads_json_length + 1);
  if (!uploads_json) {
    pthread_mutex_unlock(&server->uploads_mutex);
    return NULL;
  }

  size_t offset = 0;
  uploads_json[offset++] = '[';
  cursor = server->active_uploads_head;
  while (cursor) {
    char *safe_name = zynth_json_escape(cursor->name ? cursor->name : "");
    char *safe_path = zynth_json_escape(cursor->path ? cursor->path : "");
    if (!safe_name || !safe_path) {
      zynth_free(safe_name);
      zynth_free(safe_path);
      zynth_free(uploads_json);
      pthread_mutex_unlock(&server->uploads_mutex);
      return NULL;
    }

    int written = snprintf(
      uploads_json + offset,
      uploads_json_length - offset + 1,
      "%s{\"uploadId\":%lld,\"name\":\"%s\",\"path\":\"%s\","
      "\"bytesReceived\":%lld,\"totalBytes\":%lld,\"startedAt\":%lld,"
      "\"updatedAt\":%lld}",
      offset > 1 ? "," : "",
      cursor->upload_id,
      safe_name,
      safe_path,
      cursor->bytes_received,
      cursor->total_bytes,
      cursor->started_at_ms,
      cursor->updated_at_ms
    );
    zynth_free(safe_name);
    zynth_free(safe_path);
    if (written < 0) {
      zynth_free(uploads_json);
      pthread_mutex_unlock(&server->uploads_mutex);
      return NULL;
    }
    offset += (size_t)written;
    cursor = cursor->next;
  }
  uploads_json[offset++] = ']';
  uploads_json[offset] = '\0';

  long long total_started = server->total_uploads_started;
  long long total_completed = server->total_uploads_completed;
  long long total_failed = server->total_uploads_failed;
  long long total_bytes_received = server->total_upload_bytes_received;
  pthread_mutex_unlock(&server->uploads_mutex);

  const char *format =
    "{\"activeCount\":%d,\"totalStarted\":%lld,\"totalCompleted\":%lld,"
    "\"totalFailed\":%lld,\"totalBytesReceived\":%lld,\"activeUploads\":%s}";
  size_t length = snprintf(
    NULL,
    0,
    format,
    active_count,
    total_started,
    total_completed,
    total_failed,
    total_bytes_received,
    uploads_json
  );
  char *out = (char *)malloc(length + 1);
  if (!out) {
    zynth_free(uploads_json);
    return NULL;
  }
  snprintf(
    out,
    length + 1,
    format,
    active_count,
    total_started,
    total_completed,
    total_failed,
    total_bytes_received,
    uploads_json
  );
  zynth_free(uploads_json);
  return out;
}

void zynth_webserver_free_event(ZynthWebServerEvent *event) {
  if (!event) return;
  zynth_free(event->type);
  zynth_free(event->payload);
  event->type = NULL;
  event->payload = NULL;
}
