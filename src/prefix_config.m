#define PREFIX_CONFIG_INCLUDED 1
/* Included by prefix_menu.m. All backend arguments are passed directly, never through a shell. */
@interface PrefixConfigPanel : NSPanel
@end
@implementation PrefixConfigPanel
- (BOOL)canBecomeKeyWindow { return YES; }
@end

@interface PrefixConfigButton : NSButton
@end
@implementation PrefixConfigButton
- (void)drawRect:(NSRect)dirtyRect
{
    [theme_color(@"selectionBackground", 0x004444) setFill]; NSRectFill(self.bounds);
    NSDictionary *attributes = @{ NSFontAttributeName:self.font, NSForegroundColorAttributeName:theme_color(self.enabled ? @"selectionText" : @"help", self.enabled ? 0xffffff : 0xaaaaaa) };
    NSSize size = [self.title sizeWithAttributes:attributes];
    [self.title drawAtPoint:NSMakePoint((self.bounds.size.width-size.width)/2, (self.bounds.size.height-size.height)/2) withAttributes:attributes];
}
@end

@interface PrefixConfigController : NSObject <NSTableViewDataSource, NSTableViewDelegate, NSTextFieldDelegate, NSSearchFieldDelegate, NSWindowDelegate>
@property(nonatomic, strong) PrefixConfigPanel *panel;
@property(nonatomic, strong) NSTextField *search;
@property(nonatomic, strong) NSTableView *table;
@property(nonatomic, strong) NSTextField *detail;
@property(nonatomic, strong) NSTextField *value;
@property(nonatomic, strong) NSPopUpButton *choices;
@property(nonatomic, strong) NSTextField *status;
@property(nonatomic, strong) NSButton *save;
@property(nonatomic, strong) NSArray *settings;
@property(nonatomic, strong) NSArray *filtered;
@property(nonatomic, strong) NSDictionary *theme;
@property(nonatomic, copy) NSString *backend;
@property(nonatomic) BOOL busy;
- (void)reloadFilter;
- (void)loadSettings;
@end

@implementation PrefixConfigController
- (NSTextField *)label:(NSRect)frame text:(NSString *)text
{
    NSTextField *label = [[NSTextField alloc] initWithFrame:frame];
    label.stringValue = text; label.editable = NO; label.selectable = YES;
    label.bezeled = NO; label.drawsBackground = NO;
    label.font = menu_font; label.textColor = theme_color(@"text", 0xc0c0c0);
    [self.panel.contentView addSubview:label]; return label;
}
- (void)build { [self buildWithDisplay:YES]; }
- (void)buildWithDisplay:(BOOL)display
{
    NSScreen *screen = NSScreen.mainScreen ?: NSScreen.screens.firstObject;
    NSRect area = screen.visibleFrame;
    CGFloat width = MIN(880, area.size.width - 40), height = MIN(680, area.size.height - 40);
    CGFloat line = MAX(24, ceil(menu_font.pointSize * 1.5));
    CGFloat helpY = 12, statusY = helpY + line + 6;
    CGFloat editY = statusY + 2*line + 6, detailY = editY + line + 8;
    CGFloat tableY = detailY + 2*line + 8, searchY = height - 2*line - 28;
    self.panel = [[PrefixConfigPanel alloc] initWithContentRect:NSMakeRect(NSMidX(area)-width/2, NSMidY(area)-height/2, width, height)
        styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable backing:NSBackingStoreBuffered defer:NO];
    self.panel.title = @"Ratpoison configuration"; self.panel.delegate = self;
    self.panel.backgroundColor = theme_color(@"background", 0); self.panel.opaque = YES;
    self.panel.level = NSFloatingWindowLevel; self.panel.hidesOnDeactivate = NO;
    self.panel.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorFullScreenAuxiliary;
    [self label:NSMakeRect(18, height-line-16, width-36, line) text:@"Configuration · saved to .yabairc"];
    self.search = [[NSTextField alloc] initWithFrame:NSMakeRect(18, searchY, width-36, line)];
    self.search.textColor = theme_color(@"inputText", 0xffffff); self.search.backgroundColor = theme_color(@"inputBackground", 0x111111);
    self.search.placeholderString = @"Search settings"; self.search.delegate = self; self.search.font = menu_font;
    [self.panel.contentView addSubview:self.search];
    NSScrollView *scroll = [[NSScrollView alloc] initWithFrame:NSMakeRect(18, tableY, width-36, MAX(line, searchY-tableY-12))];
    scroll.hasVerticalScroller = YES; scroll.borderType = NSLineBorder;
    self.table = [[NSTableView alloc] initWithFrame:scroll.bounds]; self.table.delegate = self; self.table.dataSource = self;
    self.table.backgroundColor = theme_color(@"background", 0); self.table.rowHeight = MAX(24, menu_font.pointSize * 1.7);
    self.table.selectionHighlightStyle = NSTableViewSelectionHighlightStyleNone;
    for (NSString *name in @[@"Setting", @"Value"]) {
        NSTableColumn *column = [[NSTableColumn alloc] initWithIdentifier:name]; column.title = name;
        column.width = [name isEqual:@"Setting"] ? (width-60)*0.67 : (width-60)*0.3;
        [self.table addTableColumn:column];
    }
    scroll.documentView = self.table; [self.panel.contentView addSubview:scroll];
    self.detail = [self label:NSMakeRect(18, detailY, width-36, 2*line) text:@""];
    self.detail.lineBreakMode = NSLineBreakByWordWrapping;
    self.value = [[NSTextField alloc] initWithFrame:NSMakeRect(18, editY, width-174, line)];
    self.value.font = menu_font; self.value.delegate = self;
    self.value.textColor = theme_color(@"inputText", 0xffffff); self.value.backgroundColor = theme_color(@"inputBackground", 0x111111);
    self.value.target = self; self.value.action = @selector(saveValue:); [self.panel.contentView addSubview:self.value];
    self.choices = [[NSPopUpButton alloc] initWithFrame:self.value.frame pullsDown:NO];
    self.choices.font = menu_font; self.choices.hidden = YES; [self.panel.contentView addSubview:self.choices];
    self.save = [[PrefixConfigButton alloc] initWithFrame:NSMakeRect(width-144, editY, 126, line)];
    self.save.title = @"Save"; self.save.target = self; self.save.action = @selector(saveValue:);
    self.save.font = menu_font; self.save.keyEquivalent = @"\r"; [self.panel.contentView addSubview:self.save];
    self.status = [self label:NSMakeRect(18, statusY, width-36, 2*line) text:@"Loading settings…"];
    self.status.lineBreakMode = NSLineBreakByWordWrapping;
    [self label:NSMakeRect(18, helpY, width-36, line) text:@"Esc close · Tab edit · Return save"];
    if (display) {
        [self.panel makeKeyAndOrderFront:nil]; [NSApp activateIgnoringOtherApps:YES];
        [self.panel makeFirstResponder:self.search];
    }
}
- (void)request:(NSArray *)arguments complete:(void (^)(NSDictionary *, NSString *))complete
{
    NSString *backend = self.backend;
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        NSTask *task = [[NSTask alloc] init]; task.launchPath = @"/usr/bin/python3";
        task.arguments = [@[backend] arrayByAddingObjectsFromArray:arguments];
        NSPipe *output = NSPipe.pipe;
        task.standardOutput = output; task.standardError = output;
        NSDictionary *reply = nil; NSString *message = nil;
        @try {
            [task launch]; NSData *data = [output.fileHandleForReading readDataToEndOfFile]; [task waitUntilExit];
            id json = [NSJSONSerialization JSONObjectWithData:data options:0 error:NULL];
            if (task.terminationStatus == 0 && [json isKindOfClass:NSDictionary.class]) reply = json;
            else message = [json isKindOfClass:NSDictionary.class] ? json[@"error"] : nil;
            if (!reply && !message) message = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
            if (!reply && !message.length) message = @"Configuration backend failed.";
        } @catch (NSException *exception) { message = exception.reason; }
        dispatch_async(dispatch_get_main_queue(), ^{ complete(reply, message); });
    });
}
- (void)loadSettings
{
    self.busy = YES; self.save.enabled = NO;
    [self request:@[@"list"] complete:^(NSDictionary *reply, NSString *error) {
        self.busy = NO;
        if (error) { if (!self.panel) [self build]; self.status.stringValue = error; return; }
        if (!self.panel) {
            if (!configure_theme(reply[@"theme"])) { configure_theme(@{}); if (!menu_font) menu_font = [NSFont monospacedSystemFontOfSize:12 weight:NSFontWeightRegular]; }
            [self build];
        }
        self.settings = [reply[@"settings"] isKindOfClass:NSArray.class] ? reply[@"settings"] : @[];
        self.theme = reply[@"theme"] ?: @{};
        self.status.stringValue = @"Select a setting to edit."; [self reloadFilter];
    }];
}
- (NSString *)stringValue:(id)value
{
    if (!value || value == NSNull.null) return @"";
    if ([value isKindOfClass:NSString.class]) return value;
    if ([NSJSONSerialization isValidJSONObject:value]) return [[NSString alloc] initWithData:[NSJSONSerialization dataWithJSONObject:value options:0 error:NULL] encoding:NSUTF8StringEncoding];
    return [value description];
}
- (NSDictionary *)selected
{
    NSInteger row = self.table.selectedRow;
    return row >= 0 && row < (NSInteger)self.filtered.count ? self.filtered[row] : nil;
}
- (void)reloadFilter
{
    NSString *query = self.search.stringValue;
    self.filtered = [self.settings filteredArrayUsingPredicate:[NSPredicate predicateWithBlock:^BOOL(NSDictionary *item, NSDictionary *bindings) {
        NSString *text = [NSString stringWithFormat:@"%@ %@ %@ %@", item[@"key"], item[@"label"], item[@"group"], item[@"description"] ?: @""];
        return !query.length || [text rangeOfString:query options:NSCaseInsensitiveSearch | NSDiacriticInsensitiveSearch].location != NSNotFound;
    }]];
    [self.table reloadData];
    if (self.filtered.count) [self.table selectRowIndexes:[NSIndexSet indexSetWithIndex:0] byExtendingSelection:NO];
    [self tableViewSelectionDidChange:[NSNotification notificationWithName:NSTableViewSelectionDidChangeNotification object:self.table]];
}
- (NSInteger)numberOfRowsInTableView:(NSTableView *)table { return self.filtered.count; }
- (NSView *)tableView:(NSTableView *)table viewForTableColumn:(NSTableColumn *)column row:(NSInteger)row
{
    NSDictionary *setting = self.filtered[row]; BOOL selected = row == table.selectedRow;
    NSTextField *cell = [[NSTextField alloc] initWithFrame:NSZeroRect];
    cell.bezeled = NO; cell.editable = NO; cell.drawsBackground = selected;
    cell.backgroundColor = theme_color(@"selectionBackground", 0x004444);
    cell.textColor = theme_color(selected ? @"selectionText" : @"text", selected ? 0xffffff : 0xc0c0c0);
    cell.font = selected ? [[NSFontManager sharedFontManager] convertFont:menu_font toHaveTrait:NSBoldFontMask] : menu_font;
    cell.stringValue = [column.identifier isEqual:@"Setting"] ? [NSString stringWithFormat:@"%@ · %@", setting[@"group"] ?: @"", setting[@"label"] ?: setting[@"key"]] : [self stringValue:setting[@"value"]];
    cell.lineBreakMode = NSLineBreakByTruncatingTail; return cell;
}
- (void)tableViewSelectionDidChange:(NSNotification *)notification
{
    NSDictionary *item = [self selected];
    [self.table reloadDataForRowIndexes:[NSIndexSet indexSetWithIndexesInRange:NSMakeRange(0, self.filtered.count)] columnIndexes:[NSIndexSet indexSetWithIndexesInRange:NSMakeRange(0, 2)]];
    self.detail.stringValue = item ? [NSString stringWithFormat:@"%@\n%@", item[@"key"], item[@"description"] ?: item[@"label"] ?: @""] : @"No matching settings.";
    self.value.stringValue = [self stringValue:item[@"value"]];
    NSArray *choices = item[@"choices"];
    if (!choices.count && [item[@"type"] isEqual:@"bool"]) choices = @[@"on", @"off"];
    self.choices.hidden = !choices.count; self.value.hidden = choices.count > 0;
    [self.choices removeAllItems]; for (id choice in choices) [self.choices addItemWithTitle:[self stringValue:choice]];
    [self.choices selectItemWithTitle:self.value.stringValue];
    BOOL supported = item && (!item[@"supported"] || [item[@"supported"] boolValue]);
    self.save.enabled = supported && !self.busy; self.value.enabled = supported; self.choices.enabled = supported;
    if (item[@"error"]) self.status.stringValue = [self stringValue:item[@"error"]];
}
- (void)saveValue:(id)sender
{
    NSDictionary *item = [self selected]; if (!item || self.busy || !self.save.enabled) return;
    NSString *key = item[@"key"], *value = self.choices.hidden ? self.value.stringValue : self.choices.titleOfSelectedItem;
    if (([key isEqual:@"font"] || [key hasSuffix:@".font"]) && ![NSFont fontWithName:value size:12]) {
        self.status.stringValue = @"Font is not installed. Enter an installed font name."; return;
    }
    self.busy = YES; self.save.enabled = NO; self.status.stringValue = @"Saving…";
    [self request:@[@"apply", key, value ?: @""] complete:^(NSDictionary *reply, NSString *error) {
        self.busy = NO; self.save.enabled = YES;
        self.status.stringValue = error ?: @"Saved. Theme changes appear when the menu next opens.";
        if (error) return;
        self.theme = reply[@"theme"] ?: self.theme;
        NSMutableArray *settings = self.settings.mutableCopy;
        for (NSUInteger i = 0; i < settings.count; ++i) if ([settings[i][@"key"] isEqual:key]) {
            NSMutableDictionary *updated = [settings[i] mutableCopy]; updated[@"value"] = reply[@"value"] ?: value; settings[i] = updated; break;
        }
        self.settings = settings;
        NSInteger selected = self.table.selectedRow; [self reloadFilter];
        if (selected >= 0 && selected < (NSInteger)self.filtered.count) [self.table selectRowIndexes:[NSIndexSet indexSetWithIndex:selected] byExtendingSelection:NO];
    }];
}
- (void)controlTextDidChange:(NSNotification *)note { if (note.object == self.search) [self reloadFilter]; }
- (BOOL)control:(NSControl *)control textView:(NSTextView *)textView doCommandBySelector:(SEL)selector
{
    if (selector == @selector(cancelOperation:)) { [self.panel performClose:nil]; return YES; }
    if (control == self.search && (selector == @selector(moveDown:) || selector == @selector(moveUp:))) {
        NSInteger row = self.table.selectedRow + (selector == @selector(moveDown:) ? 1 : -1);
        if (row >= 0 && row < (NSInteger)self.filtered.count) { [self.table selectRowIndexes:[NSIndexSet indexSetWithIndex:row] byExtendingSelection:NO]; [self.table scrollRowToVisible:row]; }
        return YES;
    }
    return NO;
}
- (BOOL)windowShouldClose:(NSWindow *)sender
{
    if (self.busy) self.status.stringValue = @"Please wait for the current configuration operation to finish.";
    return !self.busy;
}
- (void)windowWillClose:(NSNotification *)notification
{
    NSData *data = [NSJSONSerialization dataWithJSONObject:@{@"theme":self.theme ?: @{}} options:0 error:NULL];
    fwrite(data.bytes, 1, data.length, stdout); fputc('\n', stdout); fflush(stdout);
    [NSApp stop:nil]; [NSApp postEvent:[NSEvent otherEventWithType:NSEventTypeApplicationDefined location:NSZeroPoint modifierFlags:0 timestamp:0 windowNumber:0 context:nil subtype:0 data1:0 data2:0] atStart:NO];
}
@end

static int run_configuration(NSString *backend)
{
    [NSApplication sharedApplication]; [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
    if (!configure_theme(@{})) menu_font = [NSFont monospacedSystemFontOfSize:12 weight:NSFontWeightRegular];
    PrefixConfigController *controller = [[PrefixConfigController alloc] init]; controller.backend = backend;
    [controller loadSettings];
    id monitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskKeyDown handler:^NSEvent *(NSEvent *event) {
        if (event.keyCode == 53) { [controller.panel performClose:nil]; return nil; } return event;
    }];
    [NSApp run]; [NSEvent removeMonitor:monitor]; return 0;
}
