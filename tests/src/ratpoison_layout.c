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
