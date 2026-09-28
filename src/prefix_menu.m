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

@interface PrefixHintView : NSView
@property(nonatomic, strong) NSString *keys;
@property(nonatomic, strong) NSFont *font;
@property(nonatomic, strong) NSColor *color;
@end
@implementation PrefixHintView
- (BOOL)isOpaque { return YES; }
- (void)drawRect:(NSRect)dirtyRect
{
    [NSColor.blackColor setFill];
    NSRectFill(self.bounds);
    [self.color setStroke];
    NSBezierPath *outline = [NSBezierPath bezierPathWithRect:NSInsetRect(self.bounds, 1, 1)];
    outline.lineWidth = 2;
    [outline stroke];
    NSDictionary *attributes = @{ NSFontAttributeName: self.font, NSForegroundColorAttributeName: self.color };
    NSSize size = [self.keys sizeWithAttributes:attributes];
    [self.keys drawAtPoint:NSMakePoint((self.bounds.size.width - size.width) / 2,
                                      (self.bounds.size.height - size.height) / 2) withAttributes:attributes];
}
@end

// Yabai geometry uses global top-left coordinates. AppKit uses bottom-left
// coordinates relative to the primary display, including negative-origin screens.
static NSArray *hint_layout(id badges, NSFont *font)
{
    if (!badges) return @[];
    if (![badges isKindOfClass:NSArray.class] || [badges count] > 32) return nil;
    NSMutableArray *groups = [NSMutableArray array];
    CGFloat primaryHeight = CGDisplayBounds(CGMainDisplayID()).size.height;
    for (id badge in badges) {
        if (![badge isKindOfClass:NSDictionary.class]) return nil;
        NSString *key = badge[@"key"];
        NSDictionary *rect = badge[@"rect"];
        if (![key isKindOfClass:NSString.class] || key.length != 1 ||
            [@"0456789abcdefgimnopqrstuvwxyz" rangeOfString:key].location == NSNotFound ||
            ![rect isKindOfClass:NSDictionary.class] || ![badge[@"display"] isKindOfClass:NSNumber.class]) return nil;
        for (NSString *field in @[@"x", @"y", @"w", @"h"]) {
            if (![rect[field] isKindOfClass:NSNumber.class] || !isfinite([rect[field] doubleValue]) ||
                fabs([rect[field] doubleValue]) > 1000000) return nil;
        }
        if ([rect[@"w"] doubleValue] <= 0 || [rect[@"h"] doubleValue] <= 0) return nil;
        CGFloat x = [rect[@"x"] doubleValue] + [rect[@"w"] doubleValue] / 2;
        CGFloat y = primaryHeight - [rect[@"y"] doubleValue] - [rect[@"h"] doubleValue] / 2;
        // Stacked windows share a center. Show their keys together instead of
        // placing opaque labels on top of one another.
        NSMutableDictionary *match = nil;
        for (NSMutableDictionary *group in groups) {
            if (fabs([group[@"cx"] doubleValue] - x) < 1 && fabs([group[@"cy"] doubleValue] - y) < 1) { match = group; break; }
        }
        if (match) match[@"keys"] = [match[@"keys"] stringByAppendingFormat:@" %@", key];
        else [groups addObject:[@{ @"keys":key, @"cx":@(x), @"cy":@(y), @"display":badge[@"display"] } mutableCopy]];
    }
    for (NSMutableDictionary *group in groups) {
        NSSize text = [group[@"keys"] sizeWithAttributes:@{ NSFontAttributeName:font }];
        CGFloat width = MAX(28, ceil(text.width) + 16), height = MAX(28, ceil(text.height) + 10);
        group[@"x"] = @([group[@"cx"] doubleValue] - width / 2);
        group[@"y"] = @([group[@"cy"] doubleValue] - height / 2);
        group[@"width"] = @(width); group[@"height"] = @(height);
    }
    return groups;
}

static PrefixHintView *hint_view(NSDictionary *hint, NSFont *font)
{
    const unsigned colors[] = { 0x55ffff, 0xff55ff, 0x55ff55, 0xffff55, 0x5555ff, 0xff5555 };
    PrefixHintView *view = [[PrefixHintView alloc] initWithFrame:NSMakeRect(0, 0, [hint[@"width"] doubleValue], [hint[@"height"] doubleValue])];
    view.font = font; view.keys = hint[@"keys"];
    NSUInteger display = [hint[@"display"] unsignedIntegerValue];
    view.color = terminal_color(colors[(display ? display - 1 : 0) % 6]);
    return view;
}

// Search is handled within this process: no IPC or yabai query per keystroke.
static BOOL search_entries_valid(id entries)
{
    if (![entries isKindOfClass:NSArray.class]) return NO;
    for (id entry in entries) {
        if (![entry isKindOfClass:NSDictionary.class] || ![entry[@"label"] isKindOfClass:NSString.class] ||
            ![entry[@"text"] isKindOfClass:NSString.class] || ![entry[@"index"] isKindOfClass:NSNumber.class] ||
            ![entry[@"display"] isKindOfClass:NSNumber.class] || [entry[@"display"] integerValue] < 1) return NO;
        if (entry[@"rect"] && !hint_layout(@[@{ @"key":@"0", @"rect":entry[@"rect"], @"display":entry[@"display"] }],
                                            [NSFont fontWithName:@"GoMono Nerd Font Mono" size:12])) return NO;
    }
    return YES;
}

static NSDictionary *search_layout(NSArray *entries, NSString *query, NSInteger selected, NSInteger rows, NSInteger columns)
{
    NSArray *terms = [query componentsSeparatedByCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
    NSMutableArray *matches = [NSMutableArray array];
    for (NSDictionary *entry in entries) {
        BOOL match = YES;
        for (NSString *term in terms) {
            if (term.length && [entry[@"text"] rangeOfString:term options:NSCaseInsensitiveSearch | NSDiacriticInsensitiveSearch].location == NSNotFound) { match = NO; break; }
        }
        if (match) [matches addObject:entry];
    }
    [matches sortUsingComparator:^NSComparisonResult(NSDictionary *a, NSDictionary *b) {
        NSComparisonResult order = [a[@"display"] compare:b[@"display"]];
        return order == NSOrderedSame ? [a[@"index"] compare:b[@"index"]] : order;
    }];
    selected = MAX(0, MIN(selected, (NSInteger)matches.count - 1));
    NSMutableArray *pages = [NSMutableArray array], *page = [NSMutableArray array];
    NSInteger used = 0, display = -1;
    for (NSUInteger i = 0; i < matches.count; ++i) {
        NSInteger next = [matches[i][@"display"] integerValue];
        NSInteger cost = next == display ? 1 : 3;
        if (page.count && (used + cost > rows || page.count == 29)) {
            [pages addObject:page]; page = [NSMutableArray array]; used = 0; display = -1; cost = 3;
        }
        [page addObject:@(i)]; used += cost; display = next;
    }
    if (page.count || !pages.count) [pages addObject:page];
    NSUInteger pageIndex = 0;
    for (NSUInteger i = 0; i < pages.count; ++i) if ([pages[i] containsObject:@(selected)]) pageIndex = i;
    NSString *alphabet = @"0456789abcdefgimnopqrstuvwxyz";
    NSMutableArray *lines = [NSMutableArray arrayWithArray:@[@"Window search", @"", @""]];
    NSMutableArray *groups = [NSMutableArray array], *badges = [NSMutableArray array], *indices = [NSMutableArray array];
    display = -1;
    NSUInteger start = 0, keyIndex = 0;
    NSString *bottom = [@"└" stringByAppendingFormat:@"%@┘", [@"" stringByPaddingToLength:columns - 2 withString:@"─" startingAtIndex:0]];
    for (NSNumber *position in pages[pageIndex]) {
        NSDictionary *entry = matches[position.unsignedIntegerValue];
        NSInteger next = [entry[@"display"] integerValue];
        if (next != display) {
            if (display != -1) { [lines addObject:bottom]; [groups addObject:@{ @"start":@(start), @"end":@(lines.count - 1), @"display":@(display) }]; }
            start = lines.count; display = next;
            NSString *heading = [NSString stringWithFormat:@"┌ Display %ld ", (long)display];
            [lines addObject:[[heading stringByPaddingToLength:columns - 1 withString:@"─" startingAtIndex:0] stringByAppendingString:@"┐"]];
        }
        NSString *key = [alphabet substringWithRange:NSMakeRange(keyIndex++, 1)];
        NSString *label = [NSString stringWithFormat:@"%@ %@ %@", position.integerValue == selected ? @">" : @" ", key, entry[@"label"]];
        if (label.length > (NSUInteger)(columns - 4)) label = [[label substringToIndex:columns - 5] stringByAppendingString:@"…"];
        [lines addObject:[NSString stringWithFormat:@"│ %@ │", [label stringByPaddingToLength:columns - 4 withString:@" " startingAtIndex:0]]];
        [indices addObject:entry[@"index"]];
        if (entry[@"rect"]) [badges addObject:@{ @"key":key, @"rect":entry[@"rect"], @"display":@(display) }];
    }
    if (display != -1) { [lines addObject:bottom]; [groups addObject:@{ @"start":@(start), @"end":@(lines.count - 1), @"display":@(display) }]; }
    if (!matches.count) [lines addObject:@"No matching windows"];
    [lines addObject:[NSString stringWithFormat:@"Page %lu/%lu | %lu matches", pageIndex + 1, pages.count, matches.count]];
    [lines addObject:@"Type to filter | arrows select | Enter focus"];
    [lines addObject:@"Tab: select by label / resume typing | Esc close"];
    return @{ @"text":[lines componentsJoinedByString:@"\n"], @"groups":groups, @"badges":badges,
              @"indices":indices, @"matches":matches, @"selected":@(selected), @"pages":pages, @"page":@(pageIndex) };
}

@class PrefixSearchController;
@interface PrefixSearchPanel : PrefixMenuPanel
@property(nonatomic, weak) PrefixSearchController *searchController;
@end
@interface PrefixSearchController : NSObject <NSTextFieldDelegate>
@property(nonatomic, strong) PrefixSearchPanel *panel;
@property(nonatomic, strong) PrefixMenuView *view;
@property(nonatomic, strong) NSTextField *field;
@property(nonatomic, strong) NSArray *entries;
@property(nonatomic, strong) NSDictionary *state;
@property(nonatomic, strong) NSMutableArray *badges;
@property(nonatomic, strong) NSFont *font;
@property(nonatomic) NSInteger selected;
@property(nonatomic) BOOL hintMode;
@property(nonatomic) NSInteger rows;
@property(nonatomic) NSInteger columns;
- (void)refresh;
- (void)handleKey:(NSEvent *)event;
@end
@implementation PrefixSearchPanel
- (BOOL)canBecomeKeyWindow { return YES; }
- (void)keyDown:(NSEvent *)event { [self.searchController handleKey:event]; }
@end
@implementation PrefixSearchController
- (void)refresh
{
    self.state = search_layout(self.entries, self.field.stringValue, self.selected, self.rows, self.columns);
    self.selected = [self.state[@"selected"] integerValue];
    NSMutableArray *lines = [[self.state[@"text"] componentsSeparatedByString:@"\n"] mutableCopy];
    if (self.hintMode) lines[0] = @"Select a label key | Tab resumes typing";
    self.view.lines = lines;
    self.view.groups = self.state[@"groups"];
    [self.view setNeedsDisplay:YES];
    NSArray *hints = hint_layout(self.state[@"badges"], self.font);
    // Reuse small panels while typing; allocate only when a new center appears.
    while (self.badges.count < hints.count) {
        PrefixMenuPanel *badge = [[PrefixMenuPanel alloc] initWithContentRect:NSZeroRect
            styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel backing:NSBackingStoreBuffered defer:NO];
        badge.opaque = YES; badge.backgroundColor = NSColor.blackColor; badge.hasShadow = NO;
        badge.ignoresMouseEvents = YES; badge.hidesOnDeactivate = NO; badge.level = NSStatusWindowLevel + 1;
        badge.collectionBehavior = self.panel.collectionBehavior;
        [self.badges addObject:badge];
    }
    for (NSUInteger i = 0; i < self.badges.count; ++i) {
        PrefixMenuPanel *badge = self.badges[i];
        if (i >= hints.count) { [badge orderOut:nil]; continue; }
        NSDictionary *hint = hints[i];
        [badge setFrame:NSMakeRect([hint[@"x"] doubleValue], [hint[@"y"] doubleValue], [hint[@"width"] doubleValue], [hint[@"height"] doubleValue]) display:NO];
        badge.contentView = hint_view(hint, self.font);
        [badge orderFrontRegardless];
    }
}
- (void)choose:(NSNumber *)index
{
    if (!index) return;
    for (NSDictionary *entry in self.entries) {
        if ([entry[@"index"] isEqual:index] && [entry[@"hidden"] boolValue] && [entry[@"pid"] isKindOfClass:NSNumber.class]) {
            [[NSRunningApplication runningApplicationWithProcessIdentifier:[entry[@"pid"] intValue]] unhide];
            break;
        }
    }
    printf("{\"selection\":%ld}\n", (long)index.integerValue); fflush(stdout);
    [NSApp terminate:nil];
}
- (void)controlTextDidChange:(NSNotification *)notification { self.selected = 0; [self refresh]; }
- (BOOL)control:(NSControl *)control textView:(NSTextView *)textView doCommandBySelector:(SEL)command
{
    if (command == @selector(cancelOperation:)) { [NSApp terminate:nil]; return YES; }
    if (command == @selector(insertNewline:)) {
        NSArray *matches = self.state[@"matches"];
        if (matches.count) [self choose:matches[self.selected][@"index"]];
        return YES;
    }
    if (command == @selector(insertTab:)) {
        self.hintMode = !self.hintMode;
        [self refresh];
        [self.panel makeFirstResponder:self.hintMode ? (NSResponder *)self.panel : self.field];
        return YES;
    }
    if (command == @selector(moveDown:) || command == @selector(moveUp:)) {
        self.selected += command == @selector(moveDown:) ? 1 : -1; [self refresh]; return YES;
    }
    BOOL nextPage = command == @selector(pageDown:) || command == @selector(scrollPageDown:);
    BOOL previousPage = command == @selector(pageUp:) || command == @selector(scrollPageUp:);
    if (nextPage || previousPage) {
        NSArray *pages = self.state[@"pages"];
        NSInteger page = ([self.state[@"page"] integerValue] + (nextPage ? 1 : -1) + pages.count) % pages.count;
        if ([pages[page] count]) self.selected = [pages[page][0] integerValue];
        [self refresh]; return YES;
    }
    return NO;
}
- (void)handleKey:(NSEvent *)event
{
    if (event.keyCode == 53) { [NSApp terminate:nil]; return; }
    if (event.keyCode == 48) { self.hintMode = NO; [self refresh]; [self.panel makeFirstResponder:self.field]; return; }
    NSString *key = event.charactersIgnoringModifiers.lowercaseString;
    if (key.length != 1) return;
    NSRange range = [@"0456789abcdefgimnopqrstuvwxyz" rangeOfString:key];
    if (range.location != NSNotFound && range.location < [self.state[@"indices"] count]) [self choose:self.state[@"indices"][range.location]];
}
@end

static void run_search(NSArray *entries, NSFont *font, NSRect screen)
{
    __attribute__((objc_precise_lifetime)) PrefixSearchController *controller = [PrefixSearchController new];
    CGFloat lineHeight = ceil(font.ascender - font.descender + font.leading) + 2;
    CGFloat width = MIN(960, screen.size.width - 40), height = MIN(screen.size.height * 0.9, screen.size.height - 40);
    controller.rows = MAX(3, floor((height - 28) / lineHeight) - 6);
    controller.columns = MAX(24, floor((width - 28) / [@"M" sizeWithAttributes:@{ NSFontAttributeName:font }].width));
    controller.entries = entries; controller.font = font; controller.badges = [NSMutableArray array];
    controller.panel = [[PrefixSearchPanel alloc] initWithContentRect:NSMakeRect(screen.origin.x + (screen.size.width - width) / 2,
        screen.origin.y + (screen.size.height - height) / 2, width, height)
        styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel backing:NSBackingStoreBuffered defer:NO];
    controller.panel.searchController = controller;
    controller.panel.backgroundColor = NSColor.blackColor; controller.panel.opaque = YES;
    controller.panel.level = NSStatusWindowLevel;
    controller.panel.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorFullScreenAuxiliary | NSWindowCollectionBehaviorIgnoresCycle;
    controller.view = [[PrefixMenuView alloc] initWithFrame:NSMakeRect(0, 0, width, height)];
    controller.view.font = font; controller.view.lineHeight = lineHeight;
    controller.panel.contentView = controller.view;
    controller.field = [[NSTextField alloc] initWithFrame:NSMakeRect(14, 14 + lineHeight, width - 28, lineHeight + 4)];
    controller.field.font = font; controller.field.textColor = terminal_color(0xc0c0c0);
    controller.field.backgroundColor = NSColor.blackColor; controller.field.bordered = NO;
    controller.field.focusRingType = NSFocusRingTypeNone; controller.field.placeholderString = @"Search app or window title…";
    controller.field.delegate = controller;
    [controller.view addSubview:controller.field];
    [controller refresh];
    [controller.panel makeKeyAndOrderFront:nil];
    [controller.panel makeFirstResponder:controller.field];
    [NSApp run];
}

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
        NSDictionary *searchState = nil;
        if (payload[@"search"]) {
            if (!search_entries_valid(payload[@"search"])) { fprintf(stderr, "invalid search entries\n"); return 1; }
            if (!snapshot) { run_search(payload[@"search"], font, screen); return 0; }
            NSString *query = [payload[@"query"] isKindOfClass:NSString.class] ? payload[@"query"] : @"";
            searchState = search_layout(payload[@"search"], query, [payload[@"selected"] integerValue], 20, 72);
            NSMutableDictionary *rendered = [payload mutableCopy];
            [rendered addEntriesFromDictionary:searchState];
            NSMutableArray *preview = [[searchState[@"text"] componentsSeparatedByString:@"\n"] mutableCopy];
            preview[1] = [@"/ " stringByAppendingString:query];
            rendered[@"text"] = [preview componentsJoinedByString:@"\n"];
            payload = rendered;
        }
        NSArray *hints = hint_layout(payload[@"badges"], font);
        if (!hints) { fprintf(stderr, "invalid hint geometry\n"); return 1; }
        NSArray *lines = [payload[@"text"] componentsSeparatedByString:@"\n"];
        CGFloat lineHeight = ceil(font.ascender - font.descender + font.leading) + 2;
        CGFloat width = 0;
        for (NSString *line in lines) {
            width = MAX(width, [line sizeWithAttributes:@{ NSFontAttributeName: font }].width);
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
            NSDictionary *metrics = @{ @"font":font.fontName, @"size":@12, @"width":@(size.width), @"height":@(size.height), @"badges":hints, @"search":searchState ?: @{} };
            NSData *json = [NSJSONSerialization dataWithJSONObject:metrics options:0 error:NULL];
            puts([[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding].UTF8String);
            if (hints.count) {
                PrefixHintView *hint = hint_view(hints[0], font);
                NSBitmapImageRep *bitmap = [hint bitmapImageRepForCachingDisplayInRect:hint.bounds];
                [hint cacheDisplayInRect:hint.bounds toBitmapImageRep:bitmap];
                NSString *path = [[NSString stringWithUTF8String:argv[2]] stringByAppendingString:@".hint.png"];
                if (![[bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}] writeToFile:path atomically:YES]) return 1;
            }
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
        __attribute__((objc_precise_lifetime)) NSMutableArray *hintPanels = [NSMutableArray array];
        for (NSDictionary *hint in hints) {
            NSRect bounds = NSMakeRect([hint[@"x"] doubleValue], [hint[@"y"] doubleValue],
                                      [hint[@"width"] doubleValue], [hint[@"height"] doubleValue]);
            PrefixMenuPanel *badge = [[PrefixMenuPanel alloc] initWithContentRect:bounds
                styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel
                backing:NSBackingStoreBuffered defer:NO];
            badge.contentView = hint_view(hint, font);
            badge.backgroundColor = NSColor.blackColor;
            badge.opaque = YES; badge.hasShadow = NO;
            badge.ignoresMouseEvents = YES; badge.hidesOnDeactivate = NO;
            badge.level = NSStatusWindowLevel + 1;
            badge.collectionBehavior = panel.collectionBehavior;
            [badge orderFrontRegardless];
            [hintPanels addObject:badge];
        }
        [NSApp run];
    }
    return 0;
}
