#ifndef ZYNTH_MARKDOWN_H
#define ZYNTH_MARKDOWN_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

enum {
  ZYNTH_MD_OPT_SOURCEPOS = 1 << 0,
  ZYNTH_MD_OPT_HARDBREAKS = 1 << 1,
  ZYNTH_MD_OPT_SMART = 1 << 2,
  ZYNTH_MD_OPT_SAFE = 1 << 3,
};

enum {
  ZYNTH_MD_EXT_TABLE = 1 << 0,
  ZYNTH_MD_EXT_STRIKETHROUGH = 1 << 1,
  ZYNTH_MD_EXT_AUTOLINK = 1 << 2,
  ZYNTH_MD_EXT_TAGFILTER = 1 << 3,
  ZYNTH_MD_EXT_TASKLIST = 1 << 4,
};

char *zynth_markdown_parse(const char *input, uint32_t options, uint32_t extensions);
void zynth_markdown_free(char *value);

#ifdef __cplusplus
}
#endif

#endif
