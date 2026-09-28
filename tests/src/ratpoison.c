static struct view ratpoison_test_view(void)
{
    struct view view = {0};
    view.layout = VIEW_RATPOISON;
    view.root = calloc(1, sizeof(struct window_node));
    view.root->area = (struct area) { 0, 0, 1000, 800 };
    view.next_frame_id = 1;
    view.auto_balance = SPLIT_X | SPLIT_Y;
    g_space_manager.split_ratio = 0.5f;
    return view;
}

TEST_FUNC(ratpoison_lifecycle,
{
    struct view view = ratpoison_test_view();
    struct window a = { .id = 10 }, b = { .id = 20 }, c = { .id = 30 };
    view_add_window_node(&view, &a);
    view_add_window_node(&view, &b);
    TEST_CHECK(view.root->window_count, 2);
    TEST_CHECK(window_node_is_leaf(view.root), true);
    TEST_CHECK(view_ratpoison_split(&view, SPLIT_Y), true);
    TEST_CHECK(view.root->left->window_count, 2);
    TEST_CHECK(view.root->right->window_count, 0);
    TEST_CHECK((int) view.root->left->area.w, 500);
    TEST_CHECK(view.root->left->frame_id, 0);
    TEST_CHECK(view.root->right->frame_id, 1);
    view.selected_frame = view.root->right;
    view_add_window_node(&view, &c);
    TEST_CHECK(view.root->right->window_list[0], 30);
    TEST_CHECK(view_ratpoison_move_window(&view, &b, view.root->right), true);
    TEST_CHECK(view.root->left->window_count, 1);
    TEST_CHECK(view.root->right->window_count, 2);
    view_remove_window_node(&view, &a);
    TEST_CHECK(view.root->left->window_count, 0);
    TEST_CHECK(view.root->left->window_order[0], 0);
    TEST_CHECK(window_node_is_leaf(view.root), false);
    TEST_CHECK((int) view.root->right->area.w, 500);
    TEST_CHECK(view_ratpoison_split(&view, SPLIT_X), true);
    TEST_CHECK(view.root->right->right->frame_id, 2);
    TEST_CHECK((int) view.root->right->left->area.h, 400);
    view.selected_frame = view.root->left;
    TEST_CHECK(view_ratpoison_remove_frame(&view), true);
    TEST_CHECK(view.root->split, SPLIT_X);
    TEST_CHECK(view.root->left->parent == view.root, true);
    TEST_CHECK(view.selected_frame == view.root->left, true);
    TEST_CHECK(view.root->left->frame_id, 1);
    TEST_CHECK((int) view.root->left->area.w, 1000);
    TEST_CHECK(view_ratpoison_only_frame(&view), true);
    TEST_CHECK(view.root->window_count, 2);
    TEST_CHECK(view.root->frame_id, 1);
    TEST_CHECK(view.selected_frame == view.root, true);
    TEST_CHECK(view_ratpoison_remove_frame(&view), false);
    ratpoison_free_tree(view.root);
});

TEST_FUNC(ratpoison_capacity,
{
    struct view view = ratpoison_test_view();
    for (int i = 0; i < NODE_MAX_WINDOW_COUNT; ++i) {
        struct window window = { .id = i + 1 };
        TEST_CHECK(view_add_window_node(&view, &window) == view.root, true);
    }
    struct window extra = { .id = 99 };
    TEST_CHECK(view_add_window_node(&view, &extra) == NULL, true);
    TEST_CHECK(view.root->window_count, NODE_MAX_WINDOW_COUNT);
    TEST_CHECK(view_ratpoison_split(&view, SPLIT_Y), true);
    view.selected_frame = view.root->right;
    view_add_window_node(&view, &extra);
    TEST_CHECK(view_ratpoison_move_window(&view, &extra, view.root->left), false);
    TEST_CHECK(view_ratpoison_remove_frame(&view), false);
    TEST_CHECK(view_ratpoison_only_frame(&view), false);
    TEST_CHECK(view.root->right->window_order[0], 99);
    struct window first = { .id = 1 };
    view_remove_window_node(&view, &first);
    TEST_CHECK(view_ratpoison_remove_frame(&view), true);
    TEST_CHECK(view.root->window_count, NODE_MAX_WINDOW_COUNT);
    TEST_CHECK(view.root->frame_id, 0);
    TEST_CHECK(view.selected_frame == view.root, true);
    ratpoison_free_tree(view.root);
});

TEST_FUNC(ratpoison_empty_frames,
{
    struct view view = ratpoison_test_view();
    TEST_CHECK(view_ratpoison_split(&view, SPLIT_Y), true);
    view.selected_frame = view.root->right;
    TEST_CHECK(view_ratpoison_split(&view, SPLIT_X), true);
    TEST_CHECK(view_ratpoison_find_frame(&view, 2) == view.root->right->right, true);
    struct token next = { .text = "next", .length = 4 };
    struct token prev = { .text = "prev", .length = 4 };
    TEST_CHECK(parse_frame_selector(NULL, &view, next)->frame_id, 2);
    TEST_CHECK(parse_frame_selector(NULL, &view, prev)->frame_id, 0);
    view.selected_frame = view.root->right->right;
    TEST_CHECK(parse_frame_selector(NULL, &view, next)->frame_id, 0);
    struct token id = { .text = "2", .length = 1 };
    TEST_CHECK(parse_frame_selector(NULL, &view, id) == view.selected_frame, true);
    struct token invalid = { .text = "42949672960", .length = 11 };
    TEST_CHECK(parse_frame_selector(NULL, &view, invalid) == NULL, true);
    struct token trailing = { .text = "2x", .length = 2 };
    TEST_CHECK(parse_frame_selector(NULL, &view, trailing) == NULL, true);
    struct token negative = { .text = "-1", .length = 2 };
    TEST_CHECK(parse_frame_selector(NULL, &view, negative) == NULL, true);
    TEST_CHECK(view_ratpoison_only_frame(&view), true);
    TEST_CHECK(view.root->frame_id, 2);
    TEST_CHECK(view.root->window_count, 0);
    TEST_CHECK(view_ratpoison_split(&view, SPLIT_NONE), false);
    view.root->area.w = 1;
    TEST_CHECK(view_ratpoison_split(&view, SPLIT_Y), false);
    view.root->area.w = 1000;
    view.layout = VIEW_BSP;
    TEST_CHECK(view_ratpoison_split(&view, SPLIT_Y), false);
    TEST_CHECK(view_ratpoison_remove_frame(&view), false);
    TEST_CHECK(view_ratpoison_only_frame(&view), false);
    TEST_CHECK(view_ratpoison_find_frame(&view, 2) == NULL, true);
    ratpoison_free_tree(view.root);
});

TEST_FUNC(ratpoison_geometry_and_query,
{
    struct view view = ratpoison_test_view();
    view.window_gap = 10;
    view_set_flag(&view, VIEW_ENABLE_GAP);
    g_space_manager.split_ratio = 0.3f;
    TEST_CHECK(view_ratpoison_split(&view, SPLIT_Y), true);
    TEST_CHECK((int) view.root->left->area.w, 297);
    TEST_CHECK((int) view.root->right->area.x, 307);
    view.root->area.w = 2000;
    window_node_update(&view, view.root);
    TEST_CHECK((int) view.root->left->area.w, 597);
    TEST_CHECK(view.root->left->frame_id, 0);
    TEST_CHECK(view.root->right->frame_id, 1);
    char *json = NULL;
    size_t length = 0;
    struct window window = { .id = 42 };
    view.selected_frame = view.root->right;
    view_add_window_node(&view, &window);
    view.selected_frame = view.root->left;
    FILE *stream = open_memstream(&json, &length);
    view_serialize(stream, &view, SPACE_PROPERTY_FRAMES | SPACE_PROPERTY_TYPE | SPACE_PROPERTY_FIRST_WINDOW | SPACE_PROPERTY_LAST_WINDOW);
    fclose(stream);
    NSData *data = [NSData dataWithBytes:json length:length];
    NSDictionary *object = [NSJSONSerialization JSONObjectWithData:data options:0 error:NULL];
    TEST_CHECK(object != nil, true);
    TEST_CHECK([object[@"frames"] count] == 2, true);
    TEST_CHECK([object[@"type"] isEqualToString:@"ratpoison"], true);
    TEST_CHECK([object[@"frames"][0][@"selected"] boolValue], true);
    TEST_CHECK([object[@"frames"][0][@"windows"] count] == 0, true);
    TEST_CHECK([object[@"first-window"] intValue], 42);
    TEST_CHECK([object[@"last-window"] intValue], 42);
    free(json);
    ratpoison_free_tree(view.root);
});

TEST_FUNC(ratpoison_window_list_capacity,
{
    struct view view = ratpoison_test_view();
    TEST_CHECK(ts_init(4096), true);
    for (int frame = 0; frame < 3; ++frame) {
        for (int i = 0; i < NODE_MAX_WINDOW_COUNT; ++i) {
            struct window window = { .id = frame * NODE_MAX_WINDOW_COUNT + i + 1 };
            view_add_window_node(&view, &window);
        }
        if (frame != 2) {
            view_ratpoison_split(&view, SPLIT_Y);
            view.selected_frame = view_ratpoison_find_frame(&view, frame + 1);
        }
    }
    int count;
    uint32_t *list = view_find_window_list(&view, &count);
    TEST_CHECK(count, 3 * NODE_MAX_WINDOW_COUNT);
    TEST_CHECK(g_temp_storage.used >= sizeof(uint32_t) * count, true);
    uint32_t *sentinel = ts_alloc_list(uint32_t, 1);
    *sentinel = 12345;
    for (int i = 0; i < count; ++i) TEST_CHECK(list[i], i + 1);
    munmap(g_temp_storage.memory, g_temp_storage.size + getpagesize());
    memset(&g_temp_storage, 0, sizeof(g_temp_storage));
    ratpoison_free_tree(view.root);
});

static bool ratpoison_check_tree(struct window_node *node, struct window_node *parent, int *windows, int *frames)
{
    if (node->parent != parent) return false;
    if (window_node_is_leaf(node)) {
        *windows += node->window_count;
        ++*frames;
        return node->window_count >= 0 && node->window_count <= NODE_MAX_WINDOW_COUNT;
    }
    if (!node->left || !node->right || node->window_count) return false;
    return ratpoison_check_tree(node->left, node, windows, frames) &&
           ratpoison_check_tree(node->right, node, windows, frames);
}

TEST_FUNC(ratpoison_nested_removal,
{
    struct view view = ratpoison_test_view();
    struct window window = { .id = 42 };
    view_add_window_node(&view, &window);
    for (int i = 0; i < 8; ++i) {
        TEST_CHECK(view_ratpoison_split(&view, i % 2 ? SPLIT_X : SPLIT_Y), true);
        view.selected_frame = view_ratpoison_find_frame(&view, view.next_frame_id - 1);
        TEST_CHECK(view_ratpoison_move_window(&view, &window, view.selected_frame), true);
    }
    for (int i = 0; i < 8; ++i) {
        view.selected_frame = i % 2 ? window_node_find_last_leaf(view.root) : window_node_find_first_leaf(view.root);
        TEST_CHECK(view_ratpoison_remove_frame(&view), true);
        int windows = 0, frames = 0;
        TEST_CHECK(ratpoison_check_tree(view.root, NULL, &windows, &frames), true);
        TEST_CHECK(windows, 1);
        TEST_CHECK(frames, 8 - i);
        TEST_CHECK(view_ratpoison_find_frame(&view, view.selected_frame->frame_id) == view.selected_frame, true);
    }
    TEST_CHECK(view.root->window_list[0], 42);
    ratpoison_free_tree(view.root);
});

TEST_FUNC(ratpoison_directional_frames,
{
    struct view view = ratpoison_test_view();
    struct window a = { .id = 10 }, b = { .id = 20 };
    view_add_window_node(&view, &a);
    view_ratpoison_split(&view, SPLIT_Y);
    struct window_node *left = view.root->left;
    struct window_node *right = view.root->right;
    TEST_CHECK(view_ratpoison_frame_in_direction(&view, DIR_EAST) == right, true);
    TEST_CHECK(right->window_count, 0);
    struct token east = { .text = "east", .length = 4 };
    TEST_CHECK(parse_frame_selector(NULL, &view, east) == right, true);
    view.selected_frame = right;
    TEST_CHECK(view_ratpoison_frame_in_direction(&view, DIR_WEST) == left, true);
    TEST_CHECK(view_ratpoison_frame_in_direction(&view, DIR_EAST) == NULL, true);
    TEST_CHECK(view_ratpoison_frame_in_direction(&view, DIR_NORTH) == NULL, true);
    // Duplicate focus from the old macOS window must preserve empty selection.
    view_ratpoison_select_window(&view, a.id, false);
    TEST_CHECK(view.selected_frame == right, true);
    view_add_window_node(&view, &b);
    TEST_CHECK(view_find_window_node(&view, b.id) == right, true);
    view_ratpoison_select_window(&view, b.id, true);
    view_ratpoison_split(&view, SPLIT_X);
    struct window_node *top = right->left;
    struct window_node *bottom = right->right;
    TEST_CHECK(view_ratpoison_frame_in_direction(&view, DIR_SOUTH) == bottom, true);
    view.selected_frame = bottom;
    TEST_CHECK(view_ratpoison_frame_in_direction(&view, DIR_NORTH) == top, true);
    TEST_CHECK(view_ratpoison_frame_in_direction(&view, DIR_WEST) == left, true);
    struct token south = { .text = "south", .length = 5 };
    TEST_CHECK(parse_frame_selector(NULL, &view, south) == NULL, true);
    view_ratpoison_select_window(&view, a.id, true);
    TEST_CHECK(view.selected_frame == left, true);
    // Both right leaves are equally far: stable tree order wins.
    TEST_CHECK(view_ratpoison_frame_in_direction(&view, DIR_EAST) == top, true);
    view.layout = VIEW_BSP;
    TEST_CHECK(view_ratpoison_frame_in_direction(&view, DIR_EAST) == NULL, true);
    ratpoison_free_tree(view.root);
});

TEST_FUNC(ratpoison_recall_covered_window,
{
    struct view view = ratpoison_test_view();
    struct window a = { .id = 10 }, b = { .id = 20 }, absent = { .id = 99 };
    view_add_window_node(&view, &a);
    view_add_window_node(&view, &b);
    view_ratpoison_split(&view, SPLIT_Y);
    struct window_node *source = view.root->left, *target = view.root->right;
    view.selected_frame = target;
    TEST_CHECK(source->window_order[0], b.id);
    TEST_CHECK(view_ratpoison_recall_window(&view, &b), false);
    TEST_CHECK(view_ratpoison_recall_window(&view, &absent), false);
    TEST_CHECK(view.selected_frame == target, true);
    TEST_CHECK(view_ratpoison_recall_window(&view, &a), true);
    TEST_CHECK(source->window_count, 1);
    TEST_CHECK(source->window_order[0], b.id);
    TEST_CHECK(target->window_count, 1);
    TEST_CHECK(target->window_order[0], a.id);
    TEST_CHECK(view.selected_frame == target, true);
    TEST_CHECK(view_ratpoison_recall_window(&view, &b), false);
    view_ratpoison_move_window(&view, &a, source);
    view.selected_frame = target;
    view.layout = VIEW_BSP;
    TEST_CHECK(view_ratpoison_recall_window(&view, &b), false);
    ratpoison_free_tree(view.root);
});

TEST_FUNC(ratpoison_resize_and_equalize,
{
    struct frame_border_config saved = g_space_manager.frame_border;
    g_space_manager.frame_border.enabled = true;
    g_space_manager.frame_border.width = 3;
    struct view view = ratpoison_test_view();
    struct window a = { .id = 10 }, b = { .id = 20 };
    view_add_window_node(&view, &a);
    view_add_window_node(&view, &b);
    TEST_CHECK(view_ratpoison_resize_frame(&view, SPLIT_Y, 40), false);
    TEST_CHECK(view_ratpoison_split(&view, SPLIT_Y), true);
    struct window_node *left = view.root->left, *right = view.root->right;
    view.selected_frame = right; // Empty frame, independent of macOS focus.
    TEST_CHECK(view_ratpoison_resize_frame(&view, SPLIT_Y, 100), true);
    TEST_CHECK((int)right->area.w, 600);
    TEST_CHECK((int)window_node_content_area(right).w, 594);
    TEST_CHECK((int)left->area.w, 400);
    TEST_CHECK(view.selected_frame == right, true);
    TEST_CHECK(view_ratpoison_resize_frame(&view, SPLIT_X, 40), false);
    TEST_CHECK(view_ratpoison_resize_frame(&view, SPLIT_Y, INFINITY), false);
    TEST_CHECK(view_ratpoison_resize_frame(&view, SPLIT_Y, 1000), false);
    TEST_CHECK((int)right->area.w, 600);
    TEST_CHECK(view_ratpoison_split(&view, SPLIT_X), true);
    struct window_node *bottom = right->right;
    view.selected_frame = bottom;
    TEST_CHECK(view_ratpoison_resize_frame(&view, SPLIT_Y, 100), true);
    TEST_CHECK((int)bottom->area.w, 700);
    TEST_CHECK(view_ratpoison_resize_frame(&view, SPLIT_X, -100), true);
    TEST_CHECK((int)bottom->area.h, 300);
    TEST_CHECK(view_ratpoison_equalize_frames(&view, SPLIT_Y), true);
    TEST_CHECK((int)bottom->area.w, 500);
    TEST_CHECK((int)bottom->area.h, 300);
    TEST_CHECK(view_ratpoison_equalize_frames(&view, SPLIT_X), true);
    TEST_CHECK((int)bottom->area.h, 400);
    TEST_CHECK(view.selected_frame == bottom, true);
    TEST_CHECK(view_ratpoison_resize_frame(&view, SPLIT_Y, 494), false); // Six points cannot fit borders + content.
    TEST_CHECK((int)bottom->area.w, 500);
    TEST_CHECK(left->window_count, 2);
    TEST_CHECK(left->window_order[0], b.id);
    TEST_CHECK(bottom->window_count, 0);
    view.layout = VIEW_FLOAT;
    TEST_CHECK(view_ratpoison_equalize_frames(&view, SPLIT_X | SPLIT_Y), false);
    ratpoison_free_tree(view.root);
    g_space_manager.frame_border = saved;
});

TEST_FUNC(ratpoison_equalize_nested_columns,
{
    struct view view = ratpoison_test_view();
    view.window_gap = 10;
    view_set_flag(&view, VIEW_ENABLE_GAP);
    view_ratpoison_split(&view, SPLIT_Y);
    view.selected_frame = view.root->left;
    view_ratpoison_split(&view, SPLIT_Y);
    struct window_node *selected = view.selected_frame;
    TEST_CHECK(view_ratpoison_equalize_frames(&view, SPLIT_Y), true);
    for (struct window_node *node = window_node_find_first_leaf(view.root); node; node = window_node_find_next_leaf(node)) {
        TEST_CHECK(abs((int)node->area.w - 326) <= 1, true);
    }
    TEST_CHECK(view.selected_frame == selected, true);
    // Failure in a descendant must not partially change another split.
    float root_ratio = view.root->ratio, child_ratio = view.root->left->ratio;
    TEST_CHECK(view_ratpoison_resize_frame(&view, SPLIT_Y, 10000), false);
    TEST_CHECK(view.root->ratio == root_ratio, true);
    TEST_CHECK(view.root->left->ratio == child_ratio, true);
    ratpoison_free_tree(view.root);
    view = ratpoison_test_view();
    view.root->area.w = 1000000;
    for (int i = 0; i < 13; ++i) {
        TEST_CHECK(view_ratpoison_split(&view, SPLIT_Y), true);
        view.selected_frame = view_ratpoison_find_frame(&view, view.next_frame_id - 1);
    }
    view.root->area.w = 1400;
    TEST_CHECK(view_ratpoison_equalize_frames(&view, SPLIT_Y), true);
    TEST_CHECK(view.root->ratio < 0.1f, true);
    window_node_update(&view, view.root); // Later refresh must preserve small valid ratios.
    for (struct window_node *node = window_node_find_first_leaf(view.root); node; node = window_node_find_next_leaf(node)) {
        TEST_CHECK(abs((int)node->area.w - 100) <= 1, true);
    }
    ratpoison_free_tree(view.root);
});
