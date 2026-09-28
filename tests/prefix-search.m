// Offscreen controller tests: no panel is shown and selection is intercepted.
#define main prefix_renderer_main
#include "../src/prefix_menu.m"
#undef main
#import <assert.h>
@interface TestSearchController : PrefixSearchController
@property(nonatomic, strong) NSNumber *chosen;
@end
@implementation TestSearchController
- (void)choose:(NSNumber *)index { self.chosen = index; }
@end
int main(void)
{
    @autoreleasepool {
        [NSApplication sharedApplication];
        TestSearchController *controller = [TestSearchController new];
        controller.font = [NSFont fontWithName:@"GoMono Nerd Font Mono" size:12];
        controller.field = [NSTextField new];
        controller.badges = [NSMutableArray array];
        controller.rows = 5; controller.columns = 72;
        NSMutableArray *entries = [NSMutableArray array];
        for (int i = 0; i < 12; ++i) [entries addObject:@{ @"index":@(i), @"display":@(i / 6 + 1),
            @"text":[NSString stringWithFormat:@"Editor notes %d", i], @"label":[NSString stringWithFormat:@"Window %d", i] }];
        controller.entries = entries;
        [controller refresh];
        assert([controller.state[@"matches"] count] == 12);
        [controller control:nil textView:nil doCommandBySelector:@selector(moveDown:)];
        assert(controller.selected == 1);
        [controller control:nil textView:nil doCommandBySelector:@selector(insertNewline:)];
        assert(controller.chosen.intValue == 1);
        [controller control:nil textView:nil doCommandBySelector:@selector(pageDown:)];
        assert([controller.state[@"page"] intValue] == 1);
        controller.field.stringValue = @"EDITOR 11";
        [controller controlTextDidChange:nil];
        assert([controller.state[@"matches"] count] == 1);
        assert(controller.selected == 0);
        [controller control:nil textView:nil doCommandBySelector:@selector(insertTab:)];
        assert(controller.hintMode);
        NSEvent *key = [NSEvent keyEventWithType:NSEventTypeKeyDown location:NSZeroPoint modifierFlags:0
            timestamp:0 windowNumber:0 context:nil characters:@"0" charactersIgnoringModifiers:@"0" isARepeat:NO keyCode:29];
        [controller handleKey:key];
        assert(controller.chosen.intValue == 11);
        controller.field.stringValue = @"unmatched";
        [controller controlTextDidChange:nil];
        controller.chosen = nil;
        [controller control:nil textView:nil doCommandBySelector:@selector(insertNewline:)];
        assert(controller.chosen == nil);
        controller.field.stringValue = @"";
        [controller controlTextDidChange:nil];
        assert([controller.state[@"matches"] count] == 12);
    }
    puts("Native search editing, navigation, selection, paging and label tests passed");
    return 0;
}
