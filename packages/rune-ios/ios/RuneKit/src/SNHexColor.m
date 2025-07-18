#import "SNHexColor.h"
#import "utils/RuneColorParser.h"

UIColor *SNColorFromHex(NSString *hex) {
  return [RuneColorParser parseColor:hex];
}

