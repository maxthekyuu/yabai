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
});
