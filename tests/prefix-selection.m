#define main prefix_renderer_main
#include "../src/prefix_menu.m"
#undef main
#include <assert.h>

static BOOL column_has_color(NSBitmapImageRep *bitmap, NSInteger x)
{
    for (NSInteger y = 0; y < bitmap.pixelsHigh; ++y) {
        NSColor *color = [[bitmap colorAtX:x y:y] colorUsingColorSpace:NSColorSpace.deviceRGBColorSpace];
        if (color.redComponent + color.greenComponent + color.blueComponent > 0.01) return YES;
    }
    return NO;
}

int main(void)
{
    @autoreleasepool {
        [NSApplication sharedApplication];
        NSFont *hintFont = [NSFont fontWithName:@"Menlo" size:12];
        NSAttributedString *labels = hint_text(@"0 1 2", @[@"normal", @"front", @"focused"], @[], hintFont, terminal_color(0x55ffff));
        NSDictionary *plain = [labels attributesAtIndex:0 effectiveRange:NULL];
        NSDictionary *front = [labels attributesAtIndex:2 effectiveRange:NULL];
        NSDictionary *focused = [labels attributesAtIndex:4 effectiveRange:NULL];
        assert([plain[NSForegroundColorAttributeName] isEqual:terminal_color(0x55ffff)]);
        assert([front[NSForegroundColorAttributeName] isEqual:terminal_color(0xffff55)]);
        assert([focused[NSForegroundColorAttributeName] isEqual:terminal_color(0xff5555)]);
        NSFontTraitMask frontTraits = [[NSFontManager sharedFontManager] traitsOfFont:front[NSFontAttributeName]];
        NSFontTraitMask focusedTraits = [[NSFontManager sharedFontManager] traitsOfFont:focused[NSFontAttributeName]];
        assert((frontTraits & NSBoldFontMask) || front[NSStrokeWidthAttributeName]);
        assert((focusedTraits & NSBoldFontMask) || focused[NSStrokeWidthAttributeName]);
        assert((focusedTraits & NSItalicFontMask) || focused[NSObliquenessAttributeName]);

        assert(configure_theme(@{@"font":@"Menlo", @"fontSize":@12}));
        NSAttributedString *states = hint_text(@"0 1 2", @[@"covered", @"empty", @"minimized"],
                                               @[@"#966454", NSNull.null, NSNull.null], hintFont, terminal_color(0x55ffff));
        assert([[states attribute:NSForegroundColorAttributeName atIndex:0 effectiveRange:NULL] isEqual:terminal_color(0x966454)]);
        assert([[states attribute:NSForegroundColorAttributeName atIndex:2 effectiveRange:NULL] isEqual:terminal_color(0x5555ff)]);
        assert([[states attribute:NSForegroundColorAttributeName atIndex:4 effectiveRange:NULL] isEqual:terminal_color(0x707070)]);

        PrefixMenuView *view = [[PrefixMenuView alloc] initWithFrame:NSMakeRect(0, 0, 800, 120)];
        view.font = menu_font; view.lineHeight = 20;
        view.lines = @[@"YABAI", @"r / f / b", @"│   0 Terminal                  1 Browser",
                       @"│ > 2 Editor                                                   │"];
        view.selections = @[@{@"line":@3, @"start":@2, @"length":@24}];
        NSBitmapImageRep *bitmap = [view bitmapImageRepForCachingDisplayInRect:view.bounds];
        [view cacheDisplayInRect:view.bounds toBitmapImageRep:bitmap];
        // The selected final row has a left cell and an empty right column.
        assert(column_has_color(bitmap, 140 * bitmap.pixelsWide / 800));
        assert(!column_has_color(bitmap, 750 * bitmap.pixelsWide / 800));
        // Selected-display shading reaches unused cell space without changing
        // the group's palette color or the focused-cell selection range.
        view.groups = @[@{@"start":@2, @"end":@3, @"display":@1, @"selected":@YES}];
        bitmap = [view bitmapImageRepForCachingDisplayInRect:view.bounds];
        [view cacheDisplayInRect:view.bounds toBitmapImageRep:bitmap];
        assert(column_has_color(bitmap, 750 * bitmap.pixelsWide / 800));
        view.groups = @[];

        // The selected frame number remains red after the cell highlight.
        view.lines = @[@"YABAI", @"r / f / b", @"│ > 0 * F0 Terminal    1 F1 Browser"];
        view.selections = @[@{@"line":@2, @"start":@2, @"length":@17}];
        bitmap = [view bitmapImageRepForCachingDisplayInRect:view.bounds];
        [view cacheDisplayInRect:view.bounds toBitmapImageRep:bitmap];
        BOOL redFrameNumber = NO;
        for (NSInteger y = 54 * bitmap.pixelsHigh / 120; y < 74 * bitmap.pixelsHigh / 120; ++y)
            for (NSInteger x = 70 * bitmap.pixelsWide / 800; x < 87 * bitmap.pixelsWide / 800; ++x) {
                NSColor *c = [[bitmap colorAtX:x y:y] colorUsingColorSpace:NSColorSpace.deviceRGBColorSpace];
                if (c.redComponent > 0.5 && c.greenComponent < 0.45 && c.blueComponent < 0.45) redFrameNumber = YES;
            }
        assert(redFrameNumber);
        view.lines = @[@"YABAI", @"r / f / b", @"│   0 Terminal                  1 Browser",
                       @"│ > 2 Editor                                                   │"];
        // Single-column search retains its full-row highlight fallback.
        view.selections = @[];
        bitmap = [view bitmapImageRepForCachingDisplayInRect:view.bounds];
        [view cacheDisplayInRect:view.bounds toBitmapImageRep:bitmap];
        assert(column_has_color(bitmap, 750 * bitmap.pixelsWide / 800));
    }
    return 0;
}
