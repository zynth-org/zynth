#import <JavaScriptCore/JavaScriptCore.h>
#import "SNUIManager.h"

static JSValue *SNBox(JSContext *ctx, id obj) { return [JSValue valueWithObject:obj inContext:ctx]; }

void SNInstallBindings(JSContext *ctx, SNUIManager *mgr) {
  JSValue *ui = [JSValue valueWithNewObjectInContext:ctx];

  ui[@"createNode"] = ^NSNumber* (NSString *type) {
    return [mgr createNode:type];
  };

  ui[@"setProp"] = ^(NSNumber *nodeId, NSString *name, id value) {
    // Handle JavaScript functions specially for callbacks
    if ([name isEqualToString:@"onPress"]) {
      // In JavaScriptCore bridge, functions come as JSValue objects
      JSValue *jsValue = nil;
      if ([value isKindOfClass:[JSValue class]]) {
        jsValue = (JSValue *)value;
      } else {
        // Try to get current JSValue from arguments
        NSArray<JSValue*> *args = [JSContext currentArguments];
        if (args.count >= 3) {
          jsValue = args[2]; // Third argument should be the function
        }
      }
      
      if (jsValue && ![jsValue isUndefined] && ![jsValue isNull]) {
        NSLog(@"[SN] Detected onPress callback for node %@", nodeId);
        [mgr setPropCallback:nodeId name:name callback:jsValue];
        return;
      } else {
        NSLog(@"[SN] onPress value is not a valid function for node %@", nodeId);
      }
    }
    
    NSData *data = [NSJSONSerialization dataWithJSONObject:value ?: @{} options:0 error:nil];
    NSString *json = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    [mgr setProp:nodeId name:name valueJSON:json];
  };

  ui[@"setText"] = ^(NSNumber *nodeId, NSString *text) { [mgr setText:nodeId text:text]; };
  ui[@"insertChild"] = ^(NSNumber *parentId, NSNumber *childId, NSNumber *index) { [mgr insertChild:parentId child:childId index:index]; };
  ui[@"removeChild"] = ^(NSNumber *parentId, NSNumber *childId) { [mgr removeChild:parentId child:childId]; };
  ui[@"flush"] = ^() { [mgr flush]; };

  ctx[@"__ui"] = ui;

  // Bridge console.log/warn/error to NSLog (captures JS args)
  JSValue *console = ctx[@"console"];
  if (console == nil || [console isUndefined]) {
    console = [JSValue valueWithNewObjectInContext:ctx];
    ctx[@"console"] = console;
  }
  console[@"log"] = ^(){
    NSArray<JSValue*> *args = [JSContext currentArguments];
    NSMutableArray<NSString*> *parts = [NSMutableArray new];
    for (JSValue *v in args) { [parts addObject:[[v toString] description]]; }
    NSLog(@"JS[log]: %@", [parts componentsJoinedByString:@" "] ?: @"");
  };
  console[@"warn"] = ^(){
    NSArray<JSValue*> *args = [JSContext currentArguments];
    NSMutableArray<NSString*> *parts = [NSMutableArray new];
    for (JSValue *v in args) { [parts addObject:[[v toString] description]]; }
    NSLog(@"JS[warn]: %@", [parts componentsJoinedByString:@" "] ?: @"");
  };
  console[@"error"] = ^(){
    NSArray<JSValue*> *args = [JSContext currentArguments];
    NSMutableArray<NSString*> *parts = [NSMutableArray new];
    for (JSValue *v in args) { [parts addObject:[[v toString] description]]; }
    NSLog(@"JS[error]: %@", [parts componentsJoinedByString:@" "] ?: @"");
  };
}
