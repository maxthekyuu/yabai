TEST_FUNC(ratpoison_layout_validation,
{
    NSDictionary *dump = @{@"version":@1, @"layout":@(VIEW_RATPOISON), @"selected":@2,
        @"tree":@{@"split":@(SPLIT_Y), @"ratio":@(1.0/3), @"left":@{@"frame":@0}, @"right":@{@"frame":@2}}};
    TEST_CHECK(ratpoison_valid_dump(dump), true);
    NSMutableDictionary *bad = [[dump mutableCopy] autorelease];
    bad[@"selected"] = @999;
    TEST_CHECK(ratpoison_valid_dump(bad), false);
    bad[@"selected"] = @2;
    bad[@"tree"] = @{@"split":@1, @"ratio":@0, @"left":@{@"frame":@0}, @"right":@{@"frame":@2}};
    TEST_CHECK(ratpoison_valid_dump(bad), false);
    bad[@"tree"] = @{@"split":@1, @"ratio":@0.5, @"left":@{@"frame":@2}, @"right":@{@"frame":@2}};
    TEST_CHECK(ratpoison_valid_dump(bad), false);
    TEST_CHECK(ratpoison_valid_dump(@[]), false);
    TEST_CHECK(ratpoison_valid_dump(@{@"version":@1, @"layout":@3}), true);
    struct view view = {0};
    view.root = ratpoison_load_node(dump[@"tree"], NULL, &view);
    view.layout = VIEW_RATPOISON;
    view.selected_frame = view.root->right;
    TEST_CHECK(view.next_frame_id, 3);
    TEST_CHECK(view.root->right->parent == view.root, true);
    NSDictionary *roundtrip = ratpoison_dump_view(&view);
    TEST_CHECK(ratpoison_valid_dump(roundtrip), true);
    TEST_CHECK([roundtrip[@"selected"] intValue], 2);
    TEST_CHECK(fabs([roundtrip[@"tree"][@"ratio"] doubleValue] - 1.0/3) < 0.0001, true);
    view.root->left->area.x = NAN;
    view.root->right->area.w = INFINITY;
    char *json = NULL;
    size_t length = 0;
    FILE *rsp = open_memstream(&json, &length);
    view_serialize(rsp, &view, SPACE_PROPERTY_FRAMES);
    fclose(rsp);
    id parsed = [NSJSONSerialization JSONObjectWithData:[NSData dataWithBytes:json length:length] options:0 error:NULL];
    TEST_CHECK(parsed != nil, true);
    free(json);
    ratpoison_free_tree(view.root);
});

TEST_FUNC(ratpoison_layout_restore_transaction,
{
    TEST_CHECK(ts_init(4096), true);
    struct view view = ratpoison_test_view();
    NSDictionary *dump = @{@"version":@1, @"layout":@(VIEW_RATPOISON), @"selected":@2,
        @"tree":@{@"split":@1, @"ratio":@0.000001, @"left":@{@"frame":@0}, @"right":@{@"frame":@2}}};
    struct window_node *original = view.root;
    TEST_CHECK(ratpoison_apply_dump(&view, dump), false);
    TEST_CHECK(view.root == original, true);
    TEST_CHECK(view.next_frame_id, 1);
    dump = @{@"version":@1, @"layout":@(VIEW_RATPOISON), @"selected":@2,
        @"tree":@{@"split":@1, @"ratio":@0.5, @"left":@{@"frame":@0}, @"right":@{@"frame":@2}}};
    TEST_CHECK(ratpoison_apply_dump(&view, dump), true);
    TEST_CHECK(view.selected_frame == view.root->right, true);
    TEST_CHECK(view.next_frame_id, 3);
    view.uuid = CFSTR("test-layout-uuid");
    struct window window = {.id=123};
    if (!ratpoison_pending_members) ratpoison_pending_members = [[NSMutableDictionary alloc] init];
    ratpoison_pending_members[(NSString *)view.uuid] = [NSMutableDictionary dictionaryWithDictionary:
        @{@123: @{@"frame":@0, @"identity":@((uintptr_t)&window)}}];
    TEST_CHECK(ratpoison_layout_saved_frame(&view, &window) == view.root->left, true);
    TEST_CHECK(ratpoison_layout_saved_frame(&view, &window) == NULL, true);
    ratpoison_pending_members[(NSString *)view.uuid] = [NSMutableDictionary dictionaryWithDictionary:
        @{@123: @{@"frame":@0, @"identity":@0}}];
    TEST_CHECK(ratpoison_layout_saved_frame(&view, &window) == NULL, true);
    ratpoison_free_tree(view.root);
    munmap(g_temp_storage.memory, g_temp_storage.size + getpagesize());
    memset(&g_temp_storage, 0, sizeof(g_temp_storage));
});

TEST_FUNC(ratpoison_layout_reconnect_members,
{
    TEST_CHECK(ts_init(16384), true);
    struct window_manager old_wm = g_window_manager;
    memset(&g_window_manager, 0, sizeof(g_window_manager));
    table_init(&g_window_manager.window, 8, hash_wm, compare_wm);
    table_init(&g_window_manager.managed_window, 8, hash_wm, compare_wm);
    bool old_persistence = g_space_manager.ratpoison_layout_persistence;
    bool old_session = g_space_manager.ratpoison_session_persistence;
    g_space_manager.ratpoison_layout_persistence = true;
    g_space_manager.ratpoison_session_persistence = false;
    struct view view = ratpoison_test_view();
    view.uuid = CFSTR("test-reconnect-members");
    struct window a = {.id = 101}, b = {.id = 102}, late = {.id = 103};
    window_manager_add_window(&g_window_manager, &a);
    window_manager_add_window(&g_window_manager, &b);
    window_manager_add_window(&g_window_manager, &late);
    TEST_CHECK(view_ratpoison_split(&view, SPLIT_Y), true);
    view.selected_frame = view.root->left;
    view_add_window_node(&view, &a);
    view_add_window_node(&view, &late);
    view.selected_frame = view.root->right;
    view_add_window_node(&view, &b);
    NSDictionary *saved = ratpoison_saved_members[(NSString *)view.uuid];
    TEST_CHECK([saved[@101][@"frame"] unsignedIntValue], view.root->left->frame_id);
    TEST_CHECK([saved[@102][@"frame"] unsignedIntValue], view.root->right->frame_id);
    TEST_CHECK(saved[@103] != nil, true);

    /* A retained view can already contain temporary assignments when display_added arrives. */
    ratpoison_restoring_layout = true;
    view_remove_window_node(&view, &late);
    TEST_CHECK(view_ratpoison_move_window(&view, &a, view.root->right), true);
    ratpoison_restoring_layout = false;
    ratpoison_layout_restore_cached(&view);
    TEST_CHECK(view_find_window_node(&view, a.id) == view.root->left, true);
    TEST_CHECK(view_find_window_node(&view, b.id) == view.root->right, true);
    TEST_CHECK(ratpoison_layout_saved_frame(&view, &a) == NULL, true);
    TEST_CHECK(window_manager_find_managed_window(&g_window_manager, &a) == &view, true);
    TEST_CHECK(view_add_window_node(&view, &late) == view.root->left, true);
    TEST_CHECK(ratpoison_layout_saved_frame(&view, &late) == NULL, true);

    /* Repeated disconnects retain hints even when a Space returns empty. */
    view_remove_window_node(&view, &a);
    view_remove_window_node(&view, &b);
    view_remove_window_node(&view, &late);
    ratpoison_layout_restore_cached(&view);
    TEST_CHECK(view_add_window_node(&view, &b) == view.root->right, true);
    TEST_CHECK(view_add_window_node(&view, &late) == view.root->left, true);
    TEST_CHECK(view_add_window_node(&view, &a) == view.root->left, true);

    /* Manual JSON restoration preserves current membership instead of using the cache. */
    NSDictionary *dump = ratpoison_dump_view(&view);
    ratpoison_restoring_layout = true;
    TEST_CHECK(view_ratpoison_move_window(&view, &a, view.root->right), true);
    ratpoison_restoring_layout = false;
    TEST_CHECK(ratpoison_apply_dump(&view, dump), true);
    TEST_CHECK(view_find_window_node(&view, a.id) == view.root->right, true);

    ratpoison_free_tree(view.root);
    [ratpoison_saved_layouts removeObjectForKey:(NSString *)view.uuid];
    [ratpoison_saved_members removeObjectForKey:(NSString *)view.uuid];
    [ratpoison_pending_members removeObjectForKey:(NSString *)view.uuid];
    table_free(&g_window_manager.window);
    table_free(&g_window_manager.managed_window);
    g_window_manager = old_wm;
    g_space_manager.ratpoison_layout_persistence = old_persistence;
    g_space_manager.ratpoison_session_persistence = old_session;
    munmap(g_temp_storage.memory, g_temp_storage.size + getpagesize());
    memset(&g_temp_storage, 0, sizeof(g_temp_storage));
});
