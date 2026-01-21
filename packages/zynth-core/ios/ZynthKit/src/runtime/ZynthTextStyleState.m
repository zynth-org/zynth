#import "ZynthTextStyleState.h"

@implementation ZynthTextStyleState

- (void)applyToLabel:(UILabel *)label {
  if (!label) return;
  NSString *baseText = self.rawText ?: (label.text ?: @"");
  NSString *resolvedText = [self applyTextTransform:baseText];

  NSMutableParagraphStyle *paragraph = [[NSMutableParagraphStyle alloc] init];
  if (self.hasLineHeight) {
    paragraph.minimumLineHeight = self.lineHeight;
    paragraph.maximumLineHeight = self.lineHeight;
  }
  if (self.hasLineSpacing) {
    paragraph.lineSpacing = self.lineSpacing;
  }
  if (self.hasParagraphSpacing) {
    paragraph.paragraphSpacing = self.paragraphSpacing;
  }
  if (self.hyphenation.length > 0) {
    if ([self.hyphenation isEqualToString:@"none"]) {
      paragraph.hyphenationFactor = 0.0;
    } else {
      paragraph.hyphenationFactor = 1.0;
    }
  }

  NSMutableDictionary<NSAttributedStringKey, id> *attributes = [NSMutableDictionary dictionary];
  if (label.font) {
    attributes[NSFontAttributeName] = label.font;
  }
  if (label.textColor) {
    attributes[NSForegroundColorAttributeName] = label.textColor;
  }
  attributes[NSParagraphStyleAttributeName] = paragraph;

  if (self.hasLetterSpacing) {
    attributes[NSKernAttributeName] = @(self.letterSpacing);
  }
  if (self.hasBaselineShift) {
    attributes[NSBaselineOffsetAttributeName] = @(self.baselineShift);
  }

  if (self.textDecorationLine.length > 0) {
    NSString *value = self.textDecorationLine;
    if ([value containsString:@"underline"]) {
      attributes[NSUnderlineStyleAttributeName] = @(NSUnderlineStyleSingle);
    }
    if ([value containsString:@"line-through"]) {
      attributes[NSStrikethroughStyleAttributeName] = @(NSUnderlineStyleSingle);
    }
  }

  if (self.hasMinimumFontScale) {
    label.adjustsFontSizeToFitWidth = YES;
    label.minimumScaleFactor = self.minimumFontScale;
  }

  label.attributedText = [[NSAttributedString alloc] initWithString:resolvedText attributes:attributes];
}

- (NSString *)applyTextTransform:(NSString *)text {
  if (self.textTransform.length == 0) return text;
  NSString *value = [self.textTransform lowercaseString];
  if ([value isEqualToString:@"uppercase"]) {
    return [text uppercaseString];
  }
  if ([value isEqualToString:@"lowercase"]) {
    return [text lowercaseString];
  }
  if ([value isEqualToString:@"capitalize"]) {
    NSMutableString *result = [text mutableCopy];
    __block BOOL capitalizeNext = YES;
    [result enumerateSubstringsInRange:NSMakeRange(0, result.length)
                               options:NSStringEnumerationByComposedCharacterSequences
                            usingBlock:^(NSString *substring, NSRange subRange, NSRange enclosingRange, BOOL *stop) {
      if (substring.length == 0) return;
      unichar c = [substring characterAtIndex:0];
      if ([[NSCharacterSet whitespaceAndNewlineCharacterSet] characterIsMember:c]) {
        capitalizeNext = YES;
        return;
      }
      if (capitalizeNext) {
        NSString *upper = [substring uppercaseString];
        [result replaceCharactersInRange:subRange withString:upper];
        capitalizeNext = NO;
      }
    }];
    return result;
  }
  return text;
}

@end
