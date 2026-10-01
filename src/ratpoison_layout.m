/* Versioned structural layouts, keyed by macOS Space UUID rather than its transient ID.
 * Window IDs are deliberately not persisted: they can be reused by another process. */
static NSMutableDictionary *ratpoison_saved_layouts;
static bool ratpoison_restoring_layout;
static NSMutableDictionary *ratpoison_saved_members;
static NSMutableDictionary *ratpoison_pending_members;

void ratpoison_layout_forget(void)
{
    if (!g_space_manager.ratpoison_session_persistence) {
        [ratpoison_saved_layouts release];
        ratpoison_saved_layouts = nil;
        [ratpoison_saved_members release]; ratpoison_saved_members = nil;
        [ratpoison_pending_members release]; ratpoison_pending_members = nil;
    }
}

static NSString *ratpoison_layout_path(void)
{
    return [NSHomeDirectory() stringByAppendingPathComponent:@".local/state/yabai/ratpoison-layouts.json"];
}

static NSDictionary *ratpoison_dump_node(struct window_node *node)
{
    if (node->left && node->right) return @{@"split": @(node->split), @"ratio": @(node->ratio),
        @"left": ratpoison_dump_node(node->left), @"right": ratpoison_dump_node(node->right)};
    return @{@"frame": @(node->frame_id)};
}

static NSDictionary *ratpoison_dump_view(struct view *view)
{
    NSMutableDictionary *dump = [NSMutableDictionary dictionaryWithDictionary:@{@"version": @1, @"layout": @(view->layout)}];
    if (view->layout == VIEW_RATPOISON) {
        dump[@"tree"] = ratpoison_dump_node(view->root);
        dump[@"selected"] = @(view_ratpoison_selected_frame(view)->frame_id);
    }
    return dump;
}

static bool ratpoison_save_layouts(void)
{
    NSString *path = ratpoison_layout_path();
    NSError *error = nil;
    if (![[NSFileManager defaultManager] createDirectoryAtPath:[path stringByDeletingLastPathComponent]
          withIntermediateDirectories:YES attributes:@{NSFilePosixPermissions: @0700} error:&error]) return false;
    NSData *data = [NSJSONSerialization dataWithJSONObject:ratpoison_saved_layouts options:NSJSONWritingPrettyPrinted error:&error];
    if (!data || ![data writeToFile:path options:NSDataWritingAtomic error:&error]) return false;
    chmod([path fileSystemRepresentation], 0600);
    return true;
}

void ratpoison_layout_capture(struct view *view)
{
    if (ratpoison_restoring_layout || !view->uuid ||
        (!g_space_manager.ratpoison_layout_persistence && !g_space_manager.ratpoison_session_persistence)) return;
    if (!ratpoison_saved_layouts) ratpoison_saved_layouts = [[NSMutableDictionary alloc] init];
    if (view->layout == VIEW_RATPOISON) {
        if (!ratpoison_saved_members) ratpoison_saved_members = [[NSMutableDictionary alloc] init];
        NSMutableDictionary *members = ratpoison_saved_members[(NSString *)view->uuid];
        if (!members) {
            members = [NSMutableDictionary dictionary];
            ratpoison_saved_members[(NSString *)view->uuid] = members;
        }
        for (struct window_node *node = window_node_find_first_leaf(view->root); node; node = window_node_find_next_leaf(node)) {
            for (int i = 0; i < node->window_count; ++i) {
                struct window *window = window_manager_find_window(&g_window_manager, node->window_list[i]);
                if (window) members[@(window->id)] = @{@"frame": @(node->frame_id), @"identity": @((uintptr_t)window)};
            }
        }
    }
    NSDictionary *dump = ratpoison_dump_view(view);
    NSString *key = (NSString *)view->uuid;
    if ([ratpoison_saved_layouts[key] isEqual:dump]) return;
    ratpoison_saved_layouts[key] = dump;
    if (g_space_manager.ratpoison_session_persistence && !ratpoison_save_layouts())
        fprintf(stderr, "yabai: could not save ratpoison layouts\n");
}

static bool ratpoison_valid_node(id value, NSMutableSet *ids, unsigned depth)
{
    if (![value isKindOfClass:[NSDictionary class]] || depth > 32 || ids.count >= 1024) return false;
    if (value[@"frame"]) {
        id frame = value[@"frame"];
        if (![frame isKindOfClass:[NSNumber class]] || [frame doubleValue] < 0 ||
            [frame doubleValue] >= UINT_MAX || [frame doubleValue] != [frame unsignedIntValue] || [ids containsObject:frame]) return false;
        [ids addObject:frame];
        return !value[@"left"] && !value[@"right"];
    }
    if (![value[@"split"] isKindOfClass:[NSNumber class]] || ![value[@"ratio"] isKindOfClass:[NSNumber class]]) return false;
    int split = [value[@"split"] intValue];
    double ratio = [value[@"ratio"] doubleValue];
    return [value[@"split"] doubleValue] == split && (split == SPLIT_X || split == SPLIT_Y) && isfinite(ratio) && (float)ratio > 0 && (float)ratio < 1 &&
        ratpoison_valid_node(value[@"left"], ids, depth + 1) && ratpoison_valid_node(value[@"right"], ids, depth + 1);
}

static bool ratpoison_valid_dump(id dump)
{
    if (![dump isKindOfClass:[NSDictionary class]] || ![dump[@"version"] isEqual:@1] ||
        ![dump[@"layout"] isKindOfClass:[NSNumber class]]) return false;
    int layout = [dump[@"layout"] intValue];
    if ([dump[@"layout"] doubleValue] != layout || layout < VIEW_BSP || layout > VIEW_RATPOISON) return false;
    if (layout != VIEW_RATPOISON) return true;
    NSMutableSet *ids = [NSMutableSet set];
    return [dump[@"selected"] isKindOfClass:[NSNumber class]] &&
        ratpoison_valid_node(dump[@"tree"], ids, 0) && [ids containsObject:dump[@"selected"]];
}

static struct window_node *ratpoison_load_node(NSDictionary *dump, struct window_node *parent, struct view *view)
{
    struct window_node *node = calloc(1, sizeof(*node));
    node->parent = parent;
    if (dump[@"frame"]) {
        node->frame_id = [dump[@"frame"] unsignedIntValue];
        view->next_frame_id = MAX(view->next_frame_id, node->frame_id + 1);
    } else {
        node->split = [dump[@"split"] intValue];
        node->ratio = [dump[@"ratio"] floatValue];
        node->left = ratpoison_load_node(dump[@"left"], node, view);
        node->right = ratpoison_load_node(dump[@"right"], node, view);
    }
    return node;
}

static bool ratpoison_apply_dump(struct view *view, NSDictionary *dump)
{
    if (!ratpoison_valid_dump(dump)) return false;
    int count = 0;
    uint32_t *windows = view_find_window_list(view, &count);
    /* Copy IDs before clearing the tree; preserve frame membership for live windows. */
    NSMutableArray *members = [NSMutableArray array];
    for (int i = 0; i < count; ++i) {
        struct window_node *node = view_find_window_node(view, windows[i]);
        [members addObject:@{@"id": @(windows[i]), @"frame": @(node ? node->frame_id : 0)}];
    }
    if ([dump[@"layout"] intValue] == VIEW_RATPOISON) {
        NSMutableSet *ids = [NSMutableSet set];
        ratpoison_valid_node(dump[@"tree"], ids, 0);
        if (members.count > ids.count * NODE_MAX_WINDOW_COUNT) return false;
    }
    struct view candidate = *view;
    candidate.next_frame_id = 1;
    candidate.layout = VIEW_RATPOISON;
    if ([dump[@"layout"] intValue] == VIEW_RATPOISON) {
        candidate.root = ratpoison_load_node(dump[@"tree"], NULL, &candidate);
        /* A detached Space has no usable bounds; defer geometry until it returns. */
        if (view->root->area.w > 0 && view->root->area.h > 0 &&
            !ratpoison_plan_geometry(&candidate, candidate.root, view->root->area, 0, NULL, 0, false)) {
            ratpoison_free_tree(candidate.root);
            return false;
        }
    }
    ratpoison_restoring_layout = true;
    view_clear(view);
    view->layout = [dump[@"layout"] intValue];
    view_set_flag(view, VIEW_LAYOUT);
    if (view->layout == VIEW_RATPOISON) {
        free(view->root);
        view->root = candidate.root;
        view->next_frame_id = candidate.next_frame_id;
        view->selected_frame = view_ratpoison_find_frame(view, [dump[@"selected"] unsignedIntValue]);
        for (NSDictionary *member in members) {
            struct window *window = window_manager_find_window(&g_window_manager, [member[@"id"] unsignedIntValue]);
            if (!window) continue;
            struct window_node *target = view_ratpoison_find_frame(view, [member[@"frame"] unsignedIntValue]);
            if (!target || target->window_count == NODE_MAX_WINDOW_COUNT) target = view->selected_frame;
            if (target->window_count == NODE_MAX_WINDOW_COUNT) {
                for (target = window_node_find_first_leaf(view->root); target; target = window_node_find_next_leaf(target))
                    if (target->window_count < NODE_MAX_WINDOW_COUNT) break;
            }
            target->window_list[target->window_count] = window->id;
            target->window_order[target->window_count++] = window->id;
            window_manager_add_managed_window(&g_window_manager, window, view);
        }
    }
    view_update(view);
    ratpoison_restoring_layout = false;
    return true;
}

void ratpoison_layout_restore_cached(struct view *view)
{
    if (ratpoison_restoring_layout || (!g_space_manager.ratpoison_layout_persistence && !g_space_manager.ratpoison_session_persistence) || !view->uuid) return;
    NSDictionary *dump = ratpoison_saved_layouts[(NSString *)view->uuid];
    if (dump && ratpoison_apply_dump(view, dump)) {
        NSDictionary *members = ratpoison_saved_members[(NSString *)view->uuid];
        if (members) {
            if (!ratpoison_pending_members) ratpoison_pending_members = [[NSMutableDictionary alloc] init];
            ratpoison_pending_members[(NSString *)view->uuid] = [[members mutableCopy] autorelease];
        }
    }
}

struct window_node *ratpoison_layout_saved_frame(struct view *view, struct window *window)
{
    if (!view->uuid) return NULL;
    NSMutableDictionary *members = ratpoison_pending_members[(NSString *)view->uuid];
    NSDictionary *member = members[@(window->id)];
    if (!member) return NULL;
    unsigned frame = [member[@"frame"] unsignedIntValue];
    bool same_window = [member[@"identity"] unsignedLongLongValue] == (uintptr_t)window;
    [members removeObjectForKey:@(window->id)];
    struct window_node *node = same_window ? view_ratpoison_find_frame(view, frame) : NULL;
    return node && node->window_count < NODE_MAX_WINDOW_COUNT ? node : NULL;
}

void ratpoison_layout_dump(FILE *rsp, struct view *view)
{
    NSData *data = [NSJSONSerialization dataWithJSONObject:ratpoison_dump_view(view) options:0 error:NULL];
    fwrite(data.bytes, 1, data.length, rsp);
    fputc('\n', rsp);
}

bool ratpoison_layout_restore_json(struct view *view, const char *json, size_t length)
{
    if (length > 1024 * 1024) return false;
    id dump = [NSJSONSerialization JSONObjectWithData:[NSData dataWithBytes:json length:length] options:0 error:NULL];
    if (!ratpoison_apply_dump(view, dump)) return false;
    window_manager_validate_and_check_for_windows_on_space(&g_space_manager, &g_window_manager, view->sid);
    view_flush(view);
    return true;
}

bool ratpoison_session_enable(void)
{
    NSString *path = ratpoison_layout_path();
    if ([[NSFileManager defaultManager] fileExistsAtPath:path]) {
        NSData *data = [NSData dataWithContentsOfFile:path];
        if (!data || data.length > 16 * 1024 * 1024) return false;
        id saved = [NSJSONSerialization JSONObjectWithData:data options:0 error:NULL];
        if (![saved isKindOfClass:[NSDictionary class]]) return false;
        for (id key in saved) if (!ratpoison_valid_dump(saved[key])) return false;
        if (!ratpoison_saved_layouts) ratpoison_saved_layouts = [[NSMutableDictionary alloc] init];
        [ratpoison_saved_layouts addEntriesFromDictionary:saved];
        table_for (struct view *view, g_space_manager.view, {
            NSDictionary *dump = view->uuid ? saved[(NSString *)view->uuid] : nil;
            if (dump && ratpoison_apply_dump(view, dump)) {
                window_manager_validate_and_check_for_windows_on_space(&g_space_manager, &g_window_manager, view->sid);
                view_flush(view);
            }
        })
    }
    if (!ratpoison_saved_layouts) ratpoison_saved_layouts = [[NSMutableDictionary alloc] init];
    bool was_enabled = g_space_manager.ratpoison_session_persistence;
    g_space_manager.ratpoison_session_persistence = true;
    table_for (struct view *view, g_space_manager.view, { ratpoison_layout_capture(view); })
    bool success = ratpoison_save_layouts();
    g_space_manager.ratpoison_session_persistence = was_enabled;
    return success;
}
