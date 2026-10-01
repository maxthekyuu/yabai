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
        assert(configure_theme(@{@"font":@"Menlo", @"fontSize":@12}));
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
        // Front-most entries have colored glyphs without a selected background.
        view.lines = @[@"YABAI", @"r / f / b", @"│   0 Terminal                  1 Browser"];
        view.selections = @[@{@"line":@2, @"start":@2, @"length":@24,
                              @"emphasisOnly":@YES, @"foreground":@"#ff0000"}];
        bitmap = [view bitmapImageRepForCachingDisplayInRect:view.bounds];
        [view cacheDisplayInRect:view.bounds toBitmapImageRep:bitmap];
        BOOL redGlyph = NO;
        for (NSInteger y = 54 * bitmap.pixelsHigh / 120; y < 74 * bitmap.pixelsHigh / 120; ++y)
            for (NSInteger x = 30 * bitmap.pixelsWide / 800; x < 140 * bitmap.pixelsWide / 800; ++x) {
                NSColor *c = [[bitmap colorAtX:x y:y] colorUsingColorSpace:NSColorSpace.deviceRGBColorSpace];
                if (c.redComponent > 0.3 && c.greenComponent < 0.1 && c.blueComponent < 0.1) redGlyph = YES;
            }
        assert(redGlyph);
        assert(!column_has_color(bitmap, 190 * bitmap.pixelsWide / 800));
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
