#define main prefix_renderer_main
#include "../src/prefix_menu.m"
#undef main
#ifndef PREFIX_CONFIG_INCLUDED
#include "../src/prefix_config.m"
#endif
#include <assert.h>

int main(void)
{
    @autoreleasepool {
        [NSApplication sharedApplication];
        configure_theme(@{ @"font": @"Menlo", @"fontSize": @12 });
        PrefixConfigController *controller = [[PrefixConfigController alloc] init];
        controller.search = [[NSSearchField alloc] init]; controller.table = [[NSTableView alloc] init];
        for (NSString *name in @[@"Setting", @"Value"]) [controller.table addTableColumn:[[NSTableColumn alloc] initWithIdentifier:name]];
        controller.table.dataSource = controller;
        controller.detail = [[NSTextField alloc] init]; controller.value = [[NSTextField alloc] init];
        controller.choices = [[NSPopUpButton alloc] init]; controller.status = [[NSTextField alloc] init]; controller.save = [[NSButton alloc] init];
        controller.settings = @[
            @{ @"key":@"prefix.font", @"label":@"Font", @"group":@"Menu", @"value":@"Menlo", @"supported":@YES },
            @{ @"key":@"frame_border", @"label":@"Borders", @"group":@"Layout", @"value":@"on", @"type":@"bool" },
            @{ @"key":@"unsupported", @"label":@"Unavailable", @"group":@"Layout", @"value":@0, @"supported":@NO, @"error":@"Not supported" }
        ];
        [controller reloadFilter]; assert(controller.filtered.count == 3); assert(controller.save.enabled);
        controller.search.stringValue = @"LAYOUT"; [controller reloadFilter]; assert(controller.filtered.count == 2);
        assert(!controller.choices.hidden); assert([controller.choices.titleOfSelectedItem isEqual:@"on"]);
        controller.search.stringValue = @"Unavailable"; [controller reloadFilter]; assert(!controller.save.enabled);
        controller.search.stringValue = @"does not exist"; [controller reloadFilter]; assert(controller.filtered.count == 0); assert(!controller.save.enabled);
        controller.search.stringValue = @"Font"; [controller reloadFilter];
        controller.value.stringValue = @"Definitely not an installed font 76543";
        [controller saveValue:nil]; assert([controller.status.stringValue containsString:@"not installed"]); assert(!controller.busy);
        NSString *backend = [NSTemporaryDirectory() stringByAppendingPathComponent:[NSString stringWithFormat:@"yabai-config-test-%@.py", NSUUID.UUID.UUIDString]];
        [@"import json,sys\nprint(json.dumps({'settings': [], 'theme': {}}) if sys.argv[1] == 'list' else json.dumps({'key': sys.argv[2], 'value':sys.argv[3], 'theme': {}}))\n" writeToFile:backend atomically:YES encoding:NSUTF8StringEncoding error:NULL];
        controller.backend = backend;
        __block BOOL completed = NO;
        [controller request:@[@"list"] complete:^(NSDictionary *reply, NSString *error) {
            assert(!error); assert([reply[@"settings"] isKindOfClass:NSArray.class]); completed = YES;
        }];
        NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:5];
        while (!completed && deadline.timeIntervalSinceNow > 0) [NSRunLoop.currentRunLoop runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
        assert(completed);
        controller.value.stringValue = @"Menlo"; [controller saveValue:nil]; assert(controller.busy);
        deadline = [NSDate dateWithTimeIntervalSinceNow:5];
        while (controller.busy && deadline.timeIntervalSinceNow > 0) [NSRunLoop.currentRunLoop runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.01]];
        assert(!controller.busy); assert([controller.status.stringValue hasPrefix:@"Saved"]);
        [[NSFileManager defaultManager] removeItemAtPath:backend error:NULL];
        // Render a populated panel off-screen; this never activates or shows it.
        PrefixConfigController *preview = [[PrefixConfigController alloc] init];
        [preview buildWithDisplay:NO]; preview.settings = controller.settings;
        [preview reloadFilter]; preview.status.stringValue = @"Select a setting to edit. Changes apply immediately.";
        [preview.panel.contentView layoutSubtreeIfNeeded];
        [preview.table layoutSubtreeIfNeeded]; [preview.panel display];
        [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.1]];
        NSView *view = preview.panel.contentView;
        NSBitmapImageRep *bitmap = [view bitmapImageRepForCachingDisplayInRect:view.bounds];
        NSMutableArray *views = [NSMutableArray arrayWithObject:view];
        for (NSUInteger i = 0; i < views.count; ++i) { NSView *part = views[i]; [views addObjectsFromArray:part.subviews]; part.wantsLayer = NO; }
        [view cacheDisplayInRect:view.bounds toBitmapImageRep:bitmap];
        [[NSFileManager defaultManager] createDirectoryAtPath:@"tests/bin" withIntermediateDirectories:YES attributes:nil error:NULL];
        assert([[bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}] writeToFile:@"tests/bin/prefix-config.png" atomically:YES]);
        assert(!preview.panel.visible);
        configure_theme(@{ @"font": @"Menlo", @"fontSize": @36 });
        PrefixConfigController *large = [[PrefixConfigController alloc] init]; [large buildWithDisplay:NO];
        assert(NSContainsRect(large.panel.contentView.bounds, large.save.frame));
        assert(NSContainsRect(large.panel.contentView.bounds, large.value.frame));
        assert(large.value.frame.size.height >= 36); assert(!large.panel.visible);
        large.settings = controller.settings; [large reloadFilter]; large.status.stringValue = @"Settings save immediately.";
        [large.panel.contentView layoutSubtreeIfNeeded]; [large.table layoutSubtreeIfNeeded]; [large.panel display];
        [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.1]];
        view = large.panel.contentView; bitmap = [view bitmapImageRepForCachingDisplayInRect:view.bounds];
        views = [NSMutableArray arrayWithObject:view];
        for (NSUInteger i = 0; i < views.count; ++i) { NSView *part = views[i]; [views addObjectsFromArray:part.subviews]; part.wantsLayer = NO; }
        [view cacheDisplayInRect:view.bounds toBitmapImageRep:bitmap];
        assert([[bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}] writeToFile:@"tests/bin/prefix-config-large.png" atomically:YES]);
        puts("configuration filtering, choices, availability, font validation, async backend and save passed");
    }
    return 0;
}
