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
        puts("configuration filtering, choices, availability, font validation, async backend and save passed");
    }
    return 0;
}
