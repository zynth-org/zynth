#import <Foundation/Foundation.h>

@interface ZynthIconsFontRegistrar : NSObject
@end

@implementation ZynthIconsFontRegistrar
@end

__attribute__((constructor)) static void ZynthIconsRegisterFonts(void) {
  // Intentionally left blank.
  // Fonts are loaded lazily via @zynthjs/apis Font.loadAsync from JS.
  // Registering at Obj-C constructor time causes duplicate registration noise
  // (GSFont "file already registered") when runtime font loading runs too.
}
