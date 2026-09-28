/* Native, non-activating HUD for the Phoenix prefix module. No keyboard hooks:
 * Phoenix owns the session and terminates this process when it closes. */
#import <Cocoa/Cocoa.h>

static NSColor *terminal_color(unsigned rgb)
{
    return [NSColor colorWithSRGBRed:((rgb >> 16) & 255) / 255.0
                            green:((rgb >> 8) & 255) / 255.0
                             blue:(rgb & 255) / 255.0 alpha:1.0];
}

@interface PrefixMenuView : NSView
@property(nonatomic, strong) NSArray<NSString *> *lines;
@property(nonatomic, strong) NSFont *font;
@property(nonatomic, strong) NSArray *groups;
@property(nonatomic) CGFloat lineHeight;
@end

@implementation PrefixMenuView
- (BOOL)isFlipped { return YES; }
- (BOOL)isOpaque { return YES; }
- (void)drawRect:(NSRect)dirtyRect
{
    [[NSColor blackColor] setFill];
    NSRectFill(self.bounds);
    CGFloat y = 14;
    for (NSUInteger i = 0; i < self.lines.count; ++i) {
        NSString *line = self.lines[i];
        unsigned color = 0xc0c0c0;
        if (i == 0) color = 0x55ffff;
        else if (i == 1) color = 0xffff55;
        else if ([line hasPrefix:@"arrows/"] || [line hasPrefix:@"Shift-"]) color = 0xaaaaaa;
        NSDictionary *attributes = @{ NSFontAttributeName: self.font,
                                      NSForegroundColorAttributeName: terminal_color(color) };
        // Clip each line independently: fallback glyphs and long titles cannot
        // spill into the footer or outside the screen-sized panel.
        [NSGraphicsContext saveGraphicsState];
        NSRectClip(NSMakeRect(14, y, MAX(0, self.bounds.size.width - 28), self.lineHeight));
        NSMutableAttributedString *text = [[NSMutableAttributedString alloc] initWithString:line attributes:attributes];
        if (i > 1) {
            for (NSString *pattern in @[@"\\* F[0-9]+", @"\\[empty\\]"]) {
                NSRegularExpression *expression = [NSRegularExpression regularExpressionWithPattern:pattern options:0 error:NULL];
                for (NSTextCheckingResult *match in [expression matchesInString:line options:0 range:NSMakeRange(0, line.length)]) {
                    [text addAttribute:NSForegroundColorAttributeName
                                 value:terminal_color([pattern hasPrefix:@"\\*"] ? 0x55ff55 : 0xffff55) range:match.range];
                }
            }
        }
        // Display colors decorate the outline and heading, preserving readable
        // gray text and the existing selected/empty-frame highlights inside.
        const unsigned palette[] = { 0x55ffff, 0xff55ff, 0x55ff55, 0xffff55, 0x5555ff, 0xff5555 };
        for (NSDictionary *group in self.groups) {
            NSUInteger start = [group[@"start"] unsignedIntegerValue], end = [group[@"end"] unsignedIntegerValue];
            if (i < start || i > end || !line.length) continue;
            NSUInteger display = [group[@"display"] unsignedIntegerValue];
            NSColor *outline = terminal_color(palette[(display ? display - 1 : 0) % 6]);
            if (i == start || i == end) [text addAttribute:NSForegroundColorAttributeName value:outline range:NSMakeRange(0, line.length)];
            else {
                [text addAttribute:NSForegroundColorAttributeName value:outline range:NSMakeRange(0, 1)];
                [text addAttribute:NSForegroundColorAttributeName value:outline range:NSMakeRange(line.length - 1, 1)];
            }
        }
        [text drawAtPoint:NSMakePoint(14, y)];
        [NSGraphicsContext restoreGraphicsState];
        y += self.lineHeight;
    }
}
@end

@interface PrefixMenuPanel : NSPanel
@end
@implementation PrefixMenuPanel
- (BOOL)canBecomeKeyWindow { return NO; }
- (BOOL)canBecomeMainWindow { return NO; }
@end

int main(int argc, const char **argv)
{
    @autoreleasepool {
        BOOL snapshot = argc == 4 && strcmp(argv[1], "--snapshot") == 0;
        if ((!snapshot && argc != 2) || (snapshot && !argv[2][0])) {
            fprintf(stderr, "usage: yabai-prefix [--snapshot output.png] '<menu JSON>'\n");
            return 1;
        }
        NSData *data = [[NSString stringWithUTF8String:argv[snapshot ? 3 : 1]] dataUsingEncoding:NSUTF8StringEncoding];
        id payload = [NSJSONSerialization JSONObjectWithData:data options:0 error:NULL];
        if (![payload isKindOfClass:[NSDictionary class]] || ![payload[@"text"] isKindOfClass:[NSString class]]) {
            fprintf(stderr, "invalid menu JSON\n");
            return 1;
        }
        [NSApplication sharedApplication];
        [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
        NSFont *font = [NSFont fontWithName:@"GoMono Nerd Font Mono" size:12];
        if (!font) {
            fprintf(stderr, "install the GoMono Nerd Font Mono font before using the prefix menu\n");
            return 1;
        }
        NSArray *lines = [payload[@"text"] componentsSeparatedByString:@"\n"];
        CGFloat lineHeight = ceil(font.ascender - font.descender + font.leading) + 2;
        CGFloat width = 0;
        for (NSString *line in lines) {
            width = MAX(width, [line sizeWithAttributes:@{ NSFontAttributeName: font }].width);
        }
        NSRect screen = NSScreen.mainScreen.visibleFrame;
        id geometry = payload[@"screen"];
        if ([geometry isKindOfClass:[NSDictionary class]]) {
            NSArray *properties = @[@"x", @"y", @"width", @"height"];
            for (NSString *property in properties) {
                if (![geometry[property] isKindOfClass:[NSNumber class]] || !isfinite([geometry[property] doubleValue])) {
                    fprintf(stderr, "invalid screen geometry\n");
                    return 1;
                }
            }
            if ([geometry[@"width"] doubleValue] < 100 || [geometry[@"height"] doubleValue] < 100) return 1;
            screen = NSMakeRect([geometry[@"x"] doubleValue], [geometry[@"y"] doubleValue],
                                [geometry[@"width"] doubleValue], [geometry[@"height"] doubleValue]);
        }
        NSSize size = NSMakeSize(MIN(ceil(width) + 28, screen.size.width - 32),
                                 MIN(lines.count * lineHeight + 28, screen.size.height - 32));
        PrefixMenuView *view = [[PrefixMenuView alloc] initWithFrame:NSMakeRect(0, 0, size.width, size.height)];
        view.font = font;
        view.lines = lines;
        id groups = payload[@"groups"];
        if (groups && ![groups isKindOfClass:[NSArray class]]) return 1;
        for (id group in groups) {
            if (![group isKindOfClass:[NSDictionary class]]) return 1;
            for (NSString *key in @[@"start", @"end", @"display"]) {
                if (![group[key] isKindOfClass:[NSNumber class]]) return 1;
            }
            if ([group[@"start"] integerValue] < 0 || [group[@"end"] unsignedIntegerValue] >= lines.count ||
                [group[@"start"] unsignedIntegerValue] > [group[@"end"] unsignedIntegerValue] ||
                [group[@"display"] integerValue] < 1) return 1;
        }
        view.groups = groups;
        view.lineHeight = lineHeight;
        if (snapshot) {
            NSBitmapImageRep *bitmap = [view bitmapImageRepForCachingDisplayInRect:view.bounds];
            [view cacheDisplayInRect:view.bounds toBitmapImageRep:bitmap];
            NSData *png = [bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
            if (![png writeToFile:[NSString stringWithUTF8String:argv[2]] atomically:YES]) return 1;
            printf("{\"font\":\"%s\",\"size\":12,\"width\":%.0f,\"height\":%.0f}\n", font.fontName.UTF8String, size.width, size.height);
            return 0;
        }
        NSRect frame = NSMakeRect(screen.origin.x + (screen.size.width - size.width) / 2,
                                  screen.origin.y + (screen.size.height - size.height) / 2, size.width, size.height);
        PrefixMenuPanel *panel = [[PrefixMenuPanel alloc] initWithContentRect:frame
            styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel
            backing:NSBackingStoreBuffered defer:NO];
        panel.contentView = view;
        panel.backgroundColor = NSColor.blackColor;
        panel.opaque = YES;
        panel.hasShadow = YES;
        panel.ignoresMouseEvents = YES;
        panel.hidesOnDeactivate = NO;
        panel.level = NSStatusWindowLevel;
        panel.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces |
                                   NSWindowCollectionBehaviorFullScreenAuxiliary |
                                   NSWindowCollectionBehaviorIgnoresCycle;
        [panel orderFrontRegardless];
        // A crash/reload of the controller cannot leave an orphaned HUD forever.
        [NSTimer scheduledTimerWithTimeInterval:10 repeats:NO block:^(NSTimer *timer) { [NSApp terminate:nil]; }];
        [NSApp run];
    }
    return 0;
}
