#import "include/ZynthMarkdownBridge.h"

#include "zynth_markdown.h"

@implementation ZynthMarkdownBridge

+ (NSString *)parse:(NSString *)content
           options:(uint32_t)options
        extensions:(uint32_t)extensions {
  const char *input = content ? content.UTF8String : "";
  char *result = zynth_markdown_parse(input, options, extensions);
  if (!result) {
    return @"";
  }
  NSString *output = [NSString stringWithUTF8String:result];
  zynth_markdown_free(result);
  return output ?: @"";
}

@end
