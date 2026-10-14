/* Native, non-activating HUD for the Phoenix prefix module. No keyboard hooks:
 * Phoenix owns a resident socket server; search/configuration use separate panels. */
#import <Cocoa/Cocoa.h>

static NSColor *terminal_color(unsigned rgb)
{
    return [NSColor colorWithSRGBRed:((rgb >> 16) & 255) / 255.0
                            green:((rgb >> 8) & 255) / 255.0
                             blue:(rgb & 255) / 255.0 alpha:1.0];
}

static NSDictionary *menu_theme;
static NSFont *menu_font;
static BOOL menu_hidden;

static NSColor *theme_color(NSString *name, unsigned fallback)
{
    NSString *value = menu_theme[@"colors"][name];
    if (!value) return terminal_color(fallback);
    unsigned color = 0;
    [[NSScanner scannerWithString:[value substringFromIndex:1]] scanHexInt:&color];
    return terminal_color(color);
}

static NSColor *display_color(NSUInteger display)
{
    NSArray *palette = menu_theme[@"displayColors"];
    if (palette.count) {
        unsigned color = 0;
        [[NSScanner scannerWithString:[palette[(display ? display - 1 : 0) % palette.count] substringFromIndex:1]] scanHexInt:&color];
        return terminal_color(color);
    }
    const unsigned colors[] = { 0x55ffff, 0xff55ff, 0x55ff55, 0xffff55, 0x5555ff, 0xff5555 };
    return terminal_color(colors[(display ? display - 1 : 0) % 6]);
}

static BOOL theme_hex_valid(id value)
{
    return [value isKindOfClass:NSString.class] && [value length] == 7 && [value hasPrefix:@"#"] &&
        [[value substringFromIndex:1] rangeOfCharacterFromSet:[[NSCharacterSet characterSetWithCharactersInString:@"0123456789abcdefABCDEF"] invertedSet]].location == NSNotFound;
}

static BOOL configure_theme(id theme)
{
    if (menu_font && [menu_theme isEqual:theme ?: @{}]) return YES;
    if (theme && ![theme isKindOfClass:NSDictionary.class]) return NO;
    if (theme[@"font"] && ![theme[@"font"] isKindOfClass:NSString.class]) return NO;
    if (theme[@"fontSize"] && (![theme[@"fontSize"] isKindOfClass:NSNumber.class] ||
        !isfinite([theme[@"fontSize"] doubleValue]) || [theme[@"fontSize"] doubleValue] < 6 || [theme[@"fontSize"] doubleValue] > 36)) return NO;
    if (theme[@"selectionWeight"] && ![@[@"bold", @"regular"] containsObject:theme[@"selectionWeight"]]) return NO;
    id colors = theme[@"colors"];
    if (colors && ![colors isKindOfClass:NSDictionary.class]) return NO;
    for (NSString *name in colors) if (!theme_hex_valid(colors[name])) return NO;
    id palette = theme[@"displayColors"];
    if (palette && (![palette isKindOfClass:NSArray.class] || ![palette count])) return NO;
    for (id color in palette) if (!theme_hex_valid(color)) return NO;
    menu_theme = theme ?: @{};
    menu_font = [NSFont fontWithName:theme[@"font"] ?: @"GoMono Nerd Font Mono" size:theme[@"fontSize"] ? [theme[@"fontSize"] doubleValue] : 12];
    return menu_font != nil;
}

static NSRegularExpression *menu_expression(NSString *pattern)
{
    static NSMutableDictionary *expressions;
    if (!expressions) expressions = [NSMutableDictionary dictionary];
    NSRegularExpression *expression = expressions[pattern];
    if (!expression) expressions[pattern] = expression = [NSRegularExpression regularExpressionWithPattern:pattern options:0 error:NULL];
    return expression;
}

static BOOL entry_state_valid(id state)
{
    return [state isKindOfClass:NSString.class] && [@[@"normal", @"front", @"focused", @"empty", @"covered", @"minimized"] containsObject:state];
}

static NSColor *entry_color(NSString *state, id explicitColor, BOOL menu, NSColor *fallback)
{
    if (theme_hex_valid(explicitColor)) return terminal_color((unsigned)strtoul([explicitColor UTF8String] + 1, NULL, 16));
    if ([state isEqual:@"minimized"]) return theme_color(@"minimizedWindow", 0x707070);
    if ([state isEqual:@"covered"]) return theme_color(@"text", 0xc0c0c0);
    if ([state isEqual:@"front"]) return theme_color(@"hintFront", 0xffff55);
    if ([state isEqual:@"focused"]) return menu ? theme_color(@"selectionText", 0xffffff) : theme_color(@"hintFocused", 0xff5555);
    if ([state isEqual:@"empty"]) return theme_color(@"emptyFrame", 0x5555ff);
    return fallback;
}

@interface PrefixMenuView : NSView
@property(nonatomic, strong) NSArray<NSString *> *lines;
@property(nonatomic, strong) NSFont *font;
@property(nonatomic, strong) NSArray *groups;
@property(nonatomic, strong) NSArray *selections;
@property(nonatomic, strong) NSArray *highlights;
@property(nonatomic) CGFloat lineHeight;
@end

@implementation PrefixMenuView
- (BOOL)isFlipped { return YES; }
- (BOOL)isOpaque { return YES; }
- (void)drawRect:(NSRect)dirtyRect
{
    [theme_color(@"background", 0x000000) setFill];
    NSRectFill(self.bounds);
    CGFloat y = 14;
    for (NSUInteger i = 0; i < self.lines.count; ++i) {
        NSString *line = self.lines[i];
        for (NSDictionary *group in self.groups) {
            if ([group[@"selected"] boolValue] && i >= [group[@"start"] unsignedIntegerValue] && i <= [group[@"end"] unsignedIntegerValue]) {
                [theme_color(@"selectedDisplayBackground", 0x182828) setFill];
                NSRectFill(NSMakeRect(14, y, self.bounds.size.width - 28, self.lineHeight));
            }
        }
        NSColor *color = theme_color(@"text", 0xc0c0c0);
        if (i == 0) color = theme_color([line hasPrefix:@"yabai:"] ? @"error" : @"title", [line hasPrefix:@"yabai:"] ? 0xff5555 : 0x55ffff);
        else if (i == 1) color = theme_color(@"accent", 0xffff55);
        else if ([line hasPrefix:@"Page "]) color = theme_color(@"status", 0xaaaaaa);
        else if ([line hasPrefix:@"Shift-"] || [line hasPrefix:@"["] || [line hasPrefix:@"hjkl/"] ||
                 [line hasPrefix:@"Type "] || [line hasPrefix:@"Tab:"] || [line hasPrefix:@"Esc "]) color = theme_color(@"help", 0xaaaaaa);
        // Whole-row highlighting is only the fallback for single-column search.
        // Chooser selections provide exact cell ranges, including sparse last rows.
        BOOL selected = !self.selections.count && [line hasPrefix:@"│ > "];
        NSFont *font = self.font;
        if (selected) {
            [theme_color(@"selectionBackground", 0x004444) setFill];
            NSRectFill(NSMakeRect(14, y, self.bounds.size.width - 28, self.lineHeight));
            color = theme_color(@"selectionText", 0xffffff);
            if (![menu_theme[@"selectionWeight"] isEqual:@"regular"]) font = [[NSFontManager sharedFontManager] convertFont:font toHaveTrait:NSBoldFontMask];
        }
        NSDictionary *attributes = @{ NSFontAttributeName: font, NSForegroundColorAttributeName: color };
        // Clip each line independently: fallback glyphs and long titles cannot
        // spill into the footer or outside the screen-sized panel.
        [NSGraphicsContext saveGraphicsState];
        NSRectClip(NSMakeRect(14, y, MAX(0, self.bounds.size.width - 28), self.lineHeight));
        NSMutableAttributedString *text = [[NSMutableAttributedString alloc] initWithString:line attributes:attributes];
        if (i > 1) {
            for (NSString *pattern in @[@"\\* F[0-9]+", @"\\[empty\\]"]) {
                NSRegularExpression *expression = menu_expression(pattern);
                for (NSTextCheckingResult *match in [expression matchesInString:line options:0 range:NSMakeRange(0, line.length)]) {
                    [text addAttribute:NSForegroundColorAttributeName
                                 value:theme_color([pattern hasPrefix:@"\\*"] ? @"activeFrame" : @"emptyFrame", [pattern hasPrefix:@"\\*"] ? 0x55ff55 : 0x5555ff) range:match.range];
                }
            }
        }
        // Display colors decorate the outline and heading, preserving readable
        // gray text and the existing selected/empty-frame highlights inside.
        for (NSDictionary *group in self.groups) {
            NSUInteger start = [group[@"start"] unsignedIntegerValue], end = [group[@"end"] unsignedIntegerValue];
            if (i < start || i > end || !line.length) continue;
            NSUInteger display = [group[@"display"] unsignedIntegerValue];
            NSColor *outline = display_color(display);
            if (i == start || i == end) [text addAttribute:NSForegroundColorAttributeName value:outline range:NSMakeRange(0, line.length)];
            else {
                [text addAttribute:NSForegroundColorAttributeName value:outline range:NSMakeRange(0, 1)];
                [text addAttribute:NSForegroundColorAttributeName value:outline range:NSMakeRange(line.length - 1, 1)];
            }

        }
        // Explicit UTF-16 cell ranges distinguish the selected entry from its
        // neighbour in a two-column chooser. Frame markers alone are ambiguous.
        for (NSDictionary *selection in self.selections) {
            if ([selection[@"line"] unsignedIntegerValue] != i) continue;
            NSRange range = NSMakeRange([selection[@"start"] unsignedIntegerValue], [selection[@"length"] unsignedIntegerValue]);
            if (NSMaxRange(range) > line.length) continue;
            NSDictionary *metrics = @{NSFontAttributeName:self.font};
            CGFloat left = [[line substringToIndex:range.location] sizeWithAttributes:metrics].width;
            CGFloat width = [[line substringWithRange:range] sizeWithAttributes:metrics].width;
            [theme_color(@"selectionBackground", 0x004444) setFill];
            NSRectFill(NSMakeRect(14 + left, y, width, self.lineHeight));
            NSFont *selectedFont = [menu_theme[@"selectionWeight"] isEqual:@"regular"] ? self.font :
                [[NSFontManager sharedFontManager] convertFont:self.font toHaveTrait:NSBoldFontMask];
            [text addAttributes:@{NSFontAttributeName:selectedFont, NSForegroundColorAttributeName:theme_color(@"selectionText", 0xffffff)} range:range];
        }
        // State colors apply per cell after selection backgrounds, so empty
        // frames remain blue even when selected, including in column two.
        for (NSDictionary *highlight in self.highlights) {
            if ([highlight[@"line"] unsignedIntegerValue] != i) continue;
            NSRange range = NSMakeRange([highlight[@"start"] unsignedIntegerValue], [highlight[@"length"] unsignedIntegerValue]);
            if (NSMaxRange(range) <= line.length)
                [text addAttribute:NSForegroundColorAttributeName value:entry_color(highlight[@"state"], highlight[@"color"], YES, color) range:range];
        }
        // Paint the selected frame number last so the cell selection cannot
        // overwrite its color. Leave neighbouring and covered frame labels alone.
        if (i > 1) {
            NSRegularExpression *frame = menu_expression(@"\\* (F[0-9]+)");
            for (NSTextCheckingResult *match in [frame matchesInString:line options:0 range:NSMakeRange(0, line.length)]) {
                BOOL empty = NO;
                for (NSDictionary *highlight in self.highlights)
                    if ([highlight[@"line"] unsignedIntegerValue] == i && [highlight[@"state"] isEqual:@"empty"] &&
                        NSLocationInRange(match.range.location, NSMakeRange([highlight[@"start"] unsignedIntegerValue], [highlight[@"length"] unsignedIntegerValue]))) empty = YES;
                if (!empty) [text addAttribute:NSForegroundColorAttributeName value:theme_color(@"selectedFrameNumber", 0xff5555) range:[match rangeAtIndex:1]];
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

static NSAttributedString *hint_text(NSString *keys, NSArray *states, NSArray *colors, NSFont *font, NSColor *color)
{
    NSMutableAttributedString *text = [[NSMutableAttributedString alloc] initWithString:keys attributes:@{
        NSFontAttributeName:font, NSForegroundColorAttributeName:menu_theme[@"colors"][@"hintText"] ? theme_color(@"hintText", 0) : color }];
    NSArray *labels = [keys componentsSeparatedByString:@" "];
    NSUInteger offset = 0;
    for (NSUInteger i = 0; i < states.count && i < labels.count; ++i) {
        NSRange labelRange = NSMakeRange(offset, [labels[i] length]);
        offset += labelRange.length + 1;
        NSString *state = states[i];
        if ([state isEqual:@"normal"]) continue;
        BOOL focused = [state isEqual:@"focused"];
        NSFontTraitMask wanted = ([state isEqual:@"front"] || [state isEqual:@"empty"] || focused ? NSBoldFontMask : 0) | (focused ? NSItalicFontMask : 0);
        NSFont *styled = [[NSFontManager sharedFontManager] convertFont:font toHaveTrait:wanted];
        NSFontTraitMask actual = [[NSFontManager sharedFontManager] traitsOfFont:styled];
        NSMutableDictionary *attributes = [@{NSFontAttributeName:styled,
            NSForegroundColorAttributeName:entry_color(state, i < colors.count ? colors[i] : nil, NO, color)} mutableCopy];
        if ((wanted & NSBoldFontMask) && !(actual & NSBoldFontMask)) attributes[NSStrokeWidthAttributeName] = @-2;
        if (focused && !(actual & NSItalicFontMask)) attributes[NSObliquenessAttributeName] = @0.2;
        [text addAttributes:attributes range:labelRange];
    }
    return text;
}

@interface PrefixHintView : NSView
@property(nonatomic, strong) NSString *keys;
@property(nonatomic, strong) NSArray *states;
@property(nonatomic, strong) NSArray *colors;
@property(nonatomic, strong) NSArray *prefixes;
@property(nonatomic, strong) NSAttributedString *styledText;
@property(nonatomic, strong) NSDictionary *theme;
@property(nonatomic, strong) NSFont *font;
@property(nonatomic, strong) NSColor *color;
@end
@implementation PrefixHintView
- (BOOL)isOpaque { return YES; }
- (void)drawRect:(NSRect)dirtyRect
{
    [theme_color(@"hintBackground", 0x000000) setFill];
    NSRectFill(self.bounds);
    [(menu_theme[@"colors"][@"hintBorder"] ? theme_color(@"hintBorder", 0) : self.color) setStroke];
    NSBezierPath *outline = [NSBezierPath bezierPathWithRect:NSInsetRect(self.bounds, 1, 1)];
    outline.lineWidth = 2;
    [outline stroke];
    NSAttributedString *text = self.styledText;
    NSSize size = text.size;
    [text drawAtPoint:NSMakePoint((self.bounds.size.width - size.width) / 2,
                                 (self.bounds.size.height - size.height) / 2)];
}
@end

// Yabai geometry uses global top-left coordinates. AppKit uses bottom-left
// coordinates relative to the primary display, including negative-origin screens.
static NSArray *hint_layout(id badges, NSFont *font)
{
    if (!badges) return @[];
    if (![badges isKindOfClass:NSArray.class] || [badges count] > 4096) return nil;
    NSMutableArray *groups = [NSMutableArray array];
    CGFloat primaryHeight = CGDisplayBounds(CGMainDisplayID()).size.height;
    for (id badge in badges) {
        if (![badge isKindOfClass:NSDictionary.class]) return nil;
        NSString *state = badge[@"state"] ?: @"normal";
        if (!entry_state_valid(state) || (badge[@"color"] && !theme_hex_valid(badge[@"color"]))) return nil;
        NSString *key = badge[@"key"];
        NSDictionary *rect = badge[@"rect"];
        if (![key isKindOfClass:NSString.class] || key.length == 0 || key.length > 64 ||
            [key rangeOfCharacterFromSet:[[NSCharacterSet characterSetWithCharactersInString:@"0123456789abcdefgimnopqrstuvwxyz-"] invertedSet]].location != NSNotFound ||
            ![badge[@"display"] isKindOfClass:NSNumber.class]) return nil;
        NSString *prefix = badge[@"prefix"] ?: @"";
        if (![prefix isKindOfClass:NSString.class] || (prefix.length && ![key hasPrefix:prefix])) return nil;
        // Display reconfiguration can temporarily invalidate individual window
        // or frame rectangles. Hints are optional: preserve the chooser and
        // other labels instead of failing the entire renderer.
        if (![rect isKindOfClass:NSDictionary.class]) continue;
        BOOL valid = YES;
        for (NSString *field in @[@"x", @"y", @"w", @"h"]) {
            if (![rect[field] isKindOfClass:NSNumber.class] || !isfinite([rect[field] doubleValue]) ||
                fabs([rect[field] doubleValue]) > 1000000) { valid = NO; break; }
        }
        if (!valid || [rect[@"w"] doubleValue] <= 0 || [rect[@"h"] doubleValue] <= 0) continue;
        CGFloat x = [rect[@"x"] doubleValue] + [rect[@"w"] doubleValue] / 2;
        CGFloat y = primaryHeight - [rect[@"y"] doubleValue] - [rect[@"h"] doubleValue] / 2;
        // Stacked windows share a center. Show their keys together instead of
        // placing opaque labels on top of one another.
        NSMutableDictionary *match = nil;
        for (NSMutableDictionary *group in groups) {
            if (fabs([group[@"cx"] doubleValue] - x) < 1 && fabs([group[@"cy"] doubleValue] - y) < 1) { match = group; break; }
        }
        if (match) {
            match[@"keys"] = [match[@"keys"] stringByAppendingFormat:@" %@", key];
            [match[@"states"] addObject:state];
            [match[@"prefixes"] addObject:prefix];
            [match[@"colors"] addObject:badge[@"color"] ?: NSNull.null];
        } else [groups addObject:[@{ @"keys":key, @"prefixes":[NSMutableArray arrayWithObject:prefix], @"states":[NSMutableArray arrayWithObject:state], @"colors":[NSMutableArray arrayWithObject:badge[@"color"] ?: NSNull.null], @"cx":@(x), @"cy":@(y), @"display":badge[@"display"] } mutableCopy]];
    }
    for (NSMutableDictionary *group in groups) {
        NSSize text = hint_text(group[@"keys"], group[@"states"], group[@"colors"], font, display_color([group[@"display"] unsignedIntegerValue])).size;
        CGFloat width = MAX(28, ceil(text.width) + 16), height = MAX(28, ceil(text.height) + 10);
        group[@"x"] = @([group[@"cx"] doubleValue] - width / 2);
        group[@"y"] = @([group[@"cy"] doubleValue] - height / 2);
        group[@"width"] = @(width); group[@"height"] = @(height);
    }
    return groups;
}

static PrefixHintView *hint_view(NSDictionary *hint, NSFont *font, PrefixHintView *existing)
{
    NSColor *color = display_color([hint[@"display"] unsignedIntegerValue]);
    if (existing && [existing.keys isEqual:hint[@"keys"]] && [existing.states isEqual:hint[@"states"]] &&
        [existing.colors isEqual:hint[@"colors"]] && [existing.prefixes isEqual:hint[@"prefixes"]] && [existing.font isEqual:font] && [existing.color isEqual:color] && [existing.theme isEqual:menu_theme]) return existing;
    PrefixHintView *view = existing ?: [[PrefixHintView alloc] initWithFrame:NSZeroRect];
    view.frame = NSMakeRect(0, 0, [hint[@"width"] doubleValue], [hint[@"height"] doubleValue]);
    view.font = font; view.keys = hint[@"keys"]; view.states = hint[@"states"]; view.colors = hint[@"colors"];
    NSUInteger display = [hint[@"display"] unsignedIntegerValue];
    view.color = display_color(display);
    view.theme = menu_theme;
    view.prefixes = hint[@"prefixes"];
    NSMutableAttributedString *styled = [hint_text(view.keys, view.states, view.colors, font, view.color) mutableCopy];
    NSArray *labels = [view.keys componentsSeparatedByString:@" "];
    NSUInteger offset = 0;
    for (NSUInteger i = 0; i < labels.count; ++i) {
        NSUInteger length = i < view.prefixes.count ? [view.prefixes[i] length] : 0;
        if (length) [styled addAttributes:@{NSForegroundColorAttributeName:theme_color(@"accent", 0xffff55),
            NSBackgroundColorAttributeName:theme_color(@"selectionBackground", 0x004444),
            NSUnderlineStyleAttributeName:@(NSUnderlineStyleSingle)} range:NSMakeRange(offset, length)];
        offset += [labels[i] length] + 1;
    }
    view.styledText = styled;
    [view setNeedsDisplay:YES];
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
        if (entry[@"state"] && !entry_state_valid(entry[@"state"])) return NO;
        if (entry[@"color"] && !theme_hex_valid(entry[@"color"])) return NO;
        if (entry[@"rect"] && !hint_layout(@[@{ @"key":@"0", @"rect":entry[@"rect"], @"display":entry[@"display"], @"state":entry[@"state"] ?: @"normal" }],
                                            (menu_font ?: [NSFont monospacedSystemFontOfSize:12 weight:NSFontWeightRegular]))) return NO;
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
    NSMutableArray *groups = [NSMutableArray array], *badges = [NSMutableArray array], *indices = [NSMutableArray array], *highlights = [NSMutableArray array];
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
        NSMutableDictionary *highlight = [@{@"line":@(lines.count), @"start":@2, @"length":@(label.length), @"state":entry[@"state"] ?: @"normal"} mutableCopy];
        if (entry[@"color"]) highlight[@"color"] = entry[@"color"];
        [highlights addObject:highlight];
        [lines addObject:[NSString stringWithFormat:@"│ %@ │", [label stringByPaddingToLength:columns - 4 withString:@" " startingAtIndex:0]]];
        [indices addObject:entry[@"index"]];
        if (entry[@"rect"]) {
            NSMutableDictionary *badge = [@{ @"key":key, @"rect":entry[@"rect"], @"display":@(display), @"state":entry[@"state"] ?: @"normal" } mutableCopy];
            if (entry[@"color"]) badge[@"color"] = entry[@"color"];
            [badges addObject:badge];
        }
    }
    if (display != -1) { [lines addObject:bottom]; [groups addObject:@{ @"start":@(start), @"end":@(lines.count - 1), @"display":@(display) }]; }
    if (!matches.count) [lines addObject:@"No matching windows"];
    [lines addObject:[NSString stringWithFormat:@"Page %lu/%lu | %lu matches", pageIndex + 1, pages.count, matches.count]];
    [lines addObject:@"Type to filter | arrows select | Enter focus"];
    [lines addObject:@"Tab: select by label / resume typing | Esc close"];
    return @{ @"text":[lines componentsJoinedByString:@"\n"], @"groups":groups, @"badges":badges,
              @"highlights":highlights, @"indices":indices, @"matches":matches, @"selected":@(selected), @"pages":pages, @"page":@(pageIndex) };
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
    self.view.highlights = self.state[@"highlights"];
    [self.view setNeedsDisplay:YES];
    NSArray *hints = hint_layout(self.state[@"badges"], self.font);
    // Reuse small panels while typing; allocate only when a new center appears.
    while (self.badges.count < hints.count) {
        PrefixMenuPanel *badge = [[PrefixMenuPanel alloc] initWithContentRect:NSZeroRect
            styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel backing:NSBackingStoreBuffered defer:NO];
        badge.opaque = YES; badge.backgroundColor = theme_color(@"hintBackground", 0); badge.hasShadow = NO;
        badge.ignoresMouseEvents = YES; badge.hidesOnDeactivate = NO; badge.level = NSStatusWindowLevel + 1;
        badge.collectionBehavior = self.panel.collectionBehavior;
        [self.badges addObject:badge];
    }
    for (NSUInteger i = 0; i < self.badges.count; ++i) {
        PrefixMenuPanel *badge = self.badges[i];
        if (i >= hints.count) { [badge orderOut:nil]; continue; }
        NSDictionary *hint = hints[i];
        [badge setFrame:NSMakeRect([hint[@"x"] doubleValue], [hint[@"y"] doubleValue], [hint[@"width"] doubleValue], [hint[@"height"] doubleValue]) display:NO];
        badge.contentView = hint_view(hint, self.font, [badge.contentView isKindOfClass:PrefixHintView.class] ? (PrefixHintView *)badge.contentView : nil);
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
    NSRange range = [@"0123456789abcdefgimnopqrstuvwxyz" rangeOfString:key];
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
    controller.panel.backgroundColor = theme_color(@"background", 0); controller.panel.opaque = YES;
    controller.panel.level = NSStatusWindowLevel;
    controller.panel.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorFullScreenAuxiliary | NSWindowCollectionBehaviorIgnoresCycle;
    controller.view = [[PrefixMenuView alloc] initWithFrame:NSMakeRect(0, 0, width, height)];
    controller.view.font = font; controller.view.lineHeight = lineHeight;
    controller.panel.contentView = controller.view;
    controller.field = [[NSTextField alloc] initWithFrame:NSMakeRect(14, 14 + lineHeight, width - 28, lineHeight + 4)];
    controller.field.font = font; controller.field.textColor = theme_color(@"inputText", 0xc0c0c0);
    controller.field.backgroundColor = theme_color(@"inputBackground", 0); controller.field.bordered = NO;
    controller.field.focusRingType = NSFocusRingTypeNone; controller.field.placeholderAttributedString = [[NSAttributedString alloc] initWithString:@"Search app or window title…" attributes:@{NSForegroundColorAttributeName:theme_color(@"placeholder", 0x777777), NSFontAttributeName:font}];
    controller.field.delegate = controller;
    [controller.view addSubview:controller.field];
    [controller refresh];
    [controller.panel makeKeyAndOrderFront:nil];
    [controller.panel makeFirstResponder:controller.field];
    NSTextView *editor = (NSTextView *)controller.field.currentEditor;
    editor.insertionPointColor = theme_color(@"caret", 0xffffff);
    editor.selectedTextAttributes = @{NSForegroundColorAttributeName:theme_color(@"inputSelectionText", 0xffffff),
                                      NSBackgroundColorAttributeName:theme_color(@"inputSelectionBackground", 0x005577)};
    [NSApp run];
}

// JSON null is an absent optional search request, not a search entry array.
static BOOL has_search(NSDictionary *payload)
{
    id search = payload[@"search"];
    return search && search != NSNull.null;
}

static int render_menu(id payload, NSString *snapshotPath, PrefixMenuPanel *existingPanel,
                       NSMutableArray *existingHints, PrefixMenuPanel **resultPanel)
{
    BOOL snapshot = snapshotPath != nil;
        if (![payload isKindOfClass:[NSDictionary class]] || ![payload[@"text"] isKindOfClass:[NSString class]]) {
            fprintf(stderr, "invalid menu JSON\n");
            return 1;
        }
        if (!configure_theme(payload[@"theme"])) {
            fprintf(stderr, "invalid theme or unavailable font; check font, fontSize (6-36), and #RRGGBB colors\n");
            return 1;
        }
        NSFont *font = menu_font;
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
        if (has_search(payload)) {
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
        id selections = payload[@"selections"] ?: @[];
        if (![selections isKindOfClass:NSArray.class] || [selections count] > 64) { fprintf(stderr, "invalid selection ranges\n"); return 1; }
        for (id selection in selections) {
            if (![selection isKindOfClass:NSDictionary.class]) { fprintf(stderr, "invalid selection range\n"); return 1; }
            for (NSString *field in @[@"line", @"start", @"length"]) {
                id value = selection[field];
                if (![value isKindOfClass:NSNumber.class] || !isfinite([value doubleValue]) ||
                    [value doubleValue] < 0 || [value doubleValue] > 1000000 || [value doubleValue] != [value unsignedIntegerValue]) {
                    fprintf(stderr, "invalid selection range\n"); return 1;
                }
            }
            NSUInteger row = [selection[@"line"] unsignedIntegerValue], start = [selection[@"start"] unsignedIntegerValue], length = [selection[@"length"] unsignedIntegerValue];
            if (row >= lines.count || !length || start + length > [lines[row] length]) { fprintf(stderr, "selection range outside text\n"); return 1; }
        }
        id highlights = payload[@"highlights"] ?: @[];
        if (![highlights isKindOfClass:NSArray.class] || [highlights count] > 64) return 1;
        for (id highlight in highlights) {
            if (![highlight isKindOfClass:NSDictionary.class] || !entry_state_valid(highlight[@"state"]) ||
                (highlight[@"color"] && !theme_hex_valid(highlight[@"color"]))) return 1;
            for (NSString *field in @[@"line", @"start", @"length"]) {
                id value = highlight[field];
                if (![value isKindOfClass:NSNumber.class] || !isfinite([value doubleValue]) ||
                    [value doubleValue] < 0 || [value doubleValue] > 1000000 || [value doubleValue] != [value unsignedIntegerValue]) return 1;
            }
            NSUInteger row = [highlight[@"line"] unsignedIntegerValue], start = [highlight[@"start"] unsignedIntegerValue], length = [highlight[@"length"] unsignedIntegerValue];
            if (row >= lines.count || !length || start + length > [lines[row] length]) return 1;
        }
        CGFloat lineHeight = ceil(font.ascender - font.descender + font.leading) + 2;
        CGFloat width = 0;
        for (NSString *line in lines) {
            width = MAX(width, [line sizeWithAttributes:@{ NSFontAttributeName: font }].width);
        }
        NSSize size = NSMakeSize(MIN(ceil(width) + 28, screen.size.width - 32),
                                 MIN(lines.count * lineHeight + 28, screen.size.height - 32));
        PrefixMenuView *view = existingPanel ? (PrefixMenuView *)existingPanel.contentView : [[PrefixMenuView alloc] initWithFrame:NSMakeRect(0, 0, size.width, size.height)];
        view.frame = NSMakeRect(0, 0, size.width, size.height);
        [view setNeedsDisplay:YES];
        view.font = font;
        view.selections = selections;
        view.highlights = highlights;
        view.lines = lines;
        id groups = payload[@"groups"];
        if (groups && ![groups isKindOfClass:[NSArray class]]) return 1;
        for (id group in groups) {
            if (![group isKindOfClass:[NSDictionary class]]) return 1;
            for (NSString *key in @[@"start", @"end", @"display"]) {
                if (![group[key] isKindOfClass:[NSNumber class]]) return 1;
            }
            if (group[@"selected"] && ![group[@"selected"] isKindOfClass:NSNumber.class]) return 1;
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
            if (![png writeToFile:[NSString stringWithUTF8String:snapshotPath.UTF8String] atomically:YES]) return 1;
            NSDictionary *metrics = @{ @"font":font.fontName, @"size":@(font.pointSize), @"width":@(size.width), @"height":@(size.height), @"badges":hints, @"selections":selections, @"highlights":highlights, @"groups":groups ?: @[], @"search":searchState ?: @{} };
            NSData *json = [NSJSONSerialization dataWithJSONObject:metrics options:0 error:NULL];
            puts([[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding].UTF8String);
            if (hints.count) {
                PrefixHintView *hint = hint_view(hints[0], font, nil);
                NSBitmapImageRep *bitmap = [hint bitmapImageRepForCachingDisplayInRect:hint.bounds];
                [hint cacheDisplayInRect:hint.bounds toBitmapImageRep:bitmap];
                NSString *path = [[NSString stringWithUTF8String:snapshotPath.UTF8String] stringByAppendingString:@".hint.png"];
                if (![[bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}] writeToFile:path atomically:YES]) return 1;
            }
            return 0;
        }
        NSRect frame = NSMakeRect(screen.origin.x + (screen.size.width - size.width) / 2,
                                  screen.origin.y + (screen.size.height - size.height) / 2, size.width, size.height);
        PrefixMenuPanel *panel = existingPanel ?: [[PrefixMenuPanel alloc] initWithContentRect:frame
            styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel
            backing:NSBackingStoreBuffered defer:NO];
        [panel setFrame:frame display:NO];
        panel.contentView = view;
        panel.backgroundColor = theme_color(@"background", 0);
        panel.opaque = YES;
        panel.hasShadow = YES;
        panel.ignoresMouseEvents = YES;
        panel.hidesOnDeactivate = NO;
        panel.level = NSStatusWindowLevel;
        panel.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces |
                                   NSWindowCollectionBehaviorFullScreenAuxiliary |
                                   NSWindowCollectionBehaviorIgnoresCycle;
        if (!menu_hidden) [panel orderFrontRegardless];
        NSMutableArray *hintPanels = existingHints;
        NSUInteger hintIndex = 0;
        for (NSDictionary *hint in hints) {
            NSRect bounds = NSMakeRect([hint[@"x"] doubleValue], [hint[@"y"] doubleValue],
                                      [hint[@"width"] doubleValue], [hint[@"height"] doubleValue]);
            PrefixMenuPanel *badge = hintIndex < hintPanels.count ? hintPanels[hintIndex] : [[PrefixMenuPanel alloc] initWithContentRect:bounds
                styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel
                backing:NSBackingStoreBuffered defer:NO];
            [badge setFrame:bounds display:NO];
            badge.contentView = hint_view(hint, font, [badge.contentView isKindOfClass:PrefixHintView.class] ? (PrefixHintView *)badge.contentView : nil);
            badge.backgroundColor = theme_color(@"hintBackground", 0);
            badge.opaque = YES; badge.hasShadow = NO;
            badge.ignoresMouseEvents = YES; badge.hidesOnDeactivate = NO;
            badge.level = NSStatusWindowLevel + 1;
            badge.collectionBehavior = panel.collectionBehavior;
            if (!menu_hidden) [badge orderFrontRegardless];
            if (hintIndex == hintPanels.count) [hintPanels addObject:badge];
            hintIndex++;
        }
        while (hintPanels.count > hintIndex) {
            [hintPanels.lastObject orderOut:nil]; [hintPanels removeLastObject];
        }
        *resultPanel = panel;
        return 0;
}

#include "prefix_config.m"
#include "prefix_server.m"

int main(int argc, const char **argv)
{
    if (argc == 3 && strcmp(argv[1], "--serve") == 0) { @autoreleasepool { return prefix_serve(argv[2]); } }
    @autoreleasepool {
        if (argc == 3 && strcmp(argv[1], "--configure") == 0) {
            [NSApplication sharedApplication];
            [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
            return run_configuration([NSString stringWithUTF8String:argv[2]]);
        }
        BOOL snapshot = argc == 4 && strcmp(argv[1], "--snapshot") == 0;
        BOOL session = argc == 4 && strcmp(argv[1], "--session") == 0;
        BOOL update = argc == 4 && strcmp(argv[1], "--update") == 0;
        if (argc != 2 && !snapshot && !session && !update) return 1;
        NSString *json = [NSString stringWithUTF8String:argv[argc == 4 ? 3 : 1]];
        NSDistributedNotificationCenter *center = NSDistributedNotificationCenter.defaultCenter;
        NSString *name = argc == 4 ? [@"org.yabai.prefix." stringByAppendingString:[NSString stringWithUTF8String:argv[2]]] : nil;
        if (update) {
            // Wait for acknowledgment: a helper that died must never silently leave stale hints.
            NSString *reply = [name stringByAppendingFormat:@".%d", getpid()];
            __block BOOL received = NO;
            __block BOOL accepted = NO;
            id observer = [center addObserverForName:reply object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) {
                accepted = [note.userInfo[@"accepted"] boolValue]; received = YES;
            }];
            [center postNotificationName:name object:nil userInfo:@{@"json":json, @"reply":reply} deliverImmediately:YES];
            NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:1];
            while (!received && deadline.timeIntervalSinceNow > 0)
                [NSRunLoop.currentRunLoop runMode:NSDefaultRunLoopMode beforeDate:deadline];
            [center removeObserver:observer];
            return received && accepted ? 0 : 1;
        }
        id payload = [NSJSONSerialization JSONObjectWithData:[json dataUsingEncoding:NSUTF8StringEncoding] options:0 error:NULL];
        [NSApplication sharedApplication];
        [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
        __block PrefixMenuPanel *panel = nil;
        NSMutableArray *hints = [NSMutableArray array];
        int status = render_menu(payload, snapshot ? [NSString stringWithUTF8String:argv[2]] : nil, nil, hints, &panel);
        if (status || snapshot || has_search(payload)) return status;
        id observer = nil;
        if (session) observer = [center addObserverForName:name object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) {
            NSString *updateJSON = note.userInfo[@"json"];
            NSString *reply = note.userInfo[@"reply"];
            if (![updateJSON isKindOfClass:NSString.class] || ![reply isKindOfClass:NSString.class] ||
                ![reply hasPrefix:[name stringByAppendingString:@"."]] || updateJSON.length > 4 * 1024 * 1024) return;
            id next = [NSJSONSerialization JSONObjectWithData:[updateJSON dataUsingEncoding:NSUTF8StringEncoding] options:0 error:NULL];
            BOOL accepted = [next isKindOfClass:NSDictionary.class] && !has_search(next) && render_menu(next, nil, panel, hints, &panel) == 0;
            [NSDistributedNotificationCenter.defaultCenter postNotificationName:reply object:nil userInfo:@{@"accepted":@(accepted)} deliverImmediately:YES];
        }];
        [NSApp run];
        if (observer) [center removeObserver:observer];
    }
    return 0;
}
