#import <UIKit/UIKit.h>
#import "AppDelegate.h"
#include <stdlib.h>

int main(int argc, char * argv[]) {
  @autoreleasepool {
#if DEBUG
    // Suppress noisy iOS system network diagnostics (e.g. nw_socket_*).
    setenv("OS_ACTIVITY_MODE", "disable", 1);
#endif
    return UIApplicationMain(argc, argv, nil, NSStringFromClass([AppDelegate class]));
  }
}
