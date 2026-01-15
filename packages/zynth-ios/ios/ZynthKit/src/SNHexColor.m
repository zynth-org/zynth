#import "SNHexColor.h"
#import "utils/ZynthColorParser.h"

UIColor *SNColorFromHex(NSString *hex) {
  return [ZynthColorParser parseColor:hex];
}

