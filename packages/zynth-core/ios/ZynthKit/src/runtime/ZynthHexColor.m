#import "ZynthHexColor.h"
#import "ZynthColorParser.h"

UIColor *ZynthColorFromHex(NSString *hex) {
  return [ZynthColorParser parseColor:hex];
}
