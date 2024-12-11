#import <Foundation/Foundation.h>
BOOL rune_wait_for_dev_server(NSString *urlString, NSTimeInterval timeout) {
  NSURLComponents *components = [NSURLComponents componentsWithString:urlString];
  if (components == nil) {
    return NO;
  }

  NSURL *baseURL = components.URL;
  if (baseURL == nil) {
    return NO;
  }

  NSURL *probeURL = [baseURL URLByAppendingPathComponent:@"main.js"];
  if (probeURL == nil) {
    return NO;
  }

  NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:timeout];
  NSURLSession *session = [NSURLSession sessionWithConfiguration:NSURLSessionConfiguration.ephemeralSessionConfiguration];

  while ([[NSDate date] compare:deadline] == NSOrderedAscending) {
    __block BOOL requestFinished = NO;
    __block BOOL success = NO;

    NSURLSessionDataTask *task = [session dataTaskWithURL:probeURL
                                        completionHandler:^(NSData *_Nullable data,
                                                            NSURLResponse *_Nullable response,
                                                            NSError *_Nullable error) {
                                          NSHTTPURLResponse *http = (NSHTTPURLResponse *)response;
                                          if (error == nil && [http isKindOfClass:[NSHTTPURLResponse class]] && http.statusCode == 200) {
                                            success = YES;
                                          }
                                          requestFinished = YES;
                                        }];
    [task resume];

    while (!requestFinished) {
      [[NSRunLoop currentRunLoop] runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
    }

    if (success) {
      [session finishTasksAndInvalidate];
      return YES;
    }

    [NSThread sleepForTimeInterval:0.25];
  }

  [session invalidateAndCancel];
  return NO;
}
