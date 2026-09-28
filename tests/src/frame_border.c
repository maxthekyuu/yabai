TEST_FUNC(frame_border_geometry_and_rendering,
{
    struct frame_border_config saved = g_space_manager.frame_border;
    uint64_t saved_space = g_space_manager.current_space_id;
    uint32_t saved_focus = g_window_manager.focused_window_id;
    g_space_manager.frame_border = (struct frame_border_config) {
        .enabled = true, .width = 3,
        .active_color = rgba_color_from_hex(0xff55ff55),
        .inactive_color = rgba_color_from_hex(0xff555555),
        .selected_empty_color = rgba_color_from_hex(0xff5555ff)
    };
    struct view view = ratpoison_test_view();
    view.sid = g_space_manager.current_space_id = 123;
    struct window window = { .id = 42 };
    view_add_window_node(&view, &window);
    g_window_manager.focused_window_id = window.id;
    view_ratpoison_split(&view, SPLIT_Y);
    struct window_node *left = view.root->left, *right = view.root->right;
    TEST_CHECK(frame_border_color(&view, left) == 0xff55ff55, true);
    view.selected_frame = right;
    TEST_CHECK(frame_border_color(&view, right) == 0xff5555ff, true);
    TEST_CHECK(frame_border_color(&view, left) == 0xff555555, true);
    struct area content = window_node_content_area(left);
    TEST_CHECK((int)content.x, 3);
    TEST_CHECK((int)content.w, 494);
    TEST_CHECK((int)content.h, 794);
    unsigned char *pixels = calloc(1000 * 800, 4);
    CGColorSpaceRef colors = CGColorSpaceCreateDeviceRGB();
    CGContextRef context = CGBitmapContextCreate(pixels, 1000, 800, 8, 4000, colors,
                                                kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big);
    TEST_CHECK(context != NULL, true);
    if (context) {
        frame_border_draw(context, &view);
        // Interior remains transparent; both sides of a zero-gap split are visible.
        TEST_CHECK(pixels[(400 * 1000 + 250) * 4 + 3], 0);
        TEST_CHECK(pixels[(400 * 1000 + 498) * 4 + 3], 255);
        TEST_CHECK(pixels[(400 * 1000 + 501) * 4 + 2], 255);
        TEST_CHECK(pixels[(400 * 1000 + 501) * 4], 85);
        CGContextRelease(context);
    }
    CGColorSpaceRelease(colors);
    free(pixels);
    g_space_manager.frame_border.enabled = false;
    window_node_update(&view, view.root);
    TEST_CHECK((int)window_node_content_area(left).w, 500);
    g_space_manager.frame_border.enabled = true;
    g_space_manager.frame_border.width = 64;
    TEST_CHECK((int)frame_border_inset(&view, (struct area){0, 0, 5, 3}), 1);
    view.layout = VIEW_BSP;
    TEST_CHECK((int)frame_border_inset(&view, left->area), 0);
    ratpoison_free_tree(view.root);
    g_space_manager.frame_border = saved;
    g_space_manager.current_space_id = saved_space;
    g_window_manager.focused_window_id = saved_focus;
});

TEST_FUNC(frame_border_config_validation,
{
    struct frame_border_config saved = g_space_manager.frame_border;
    struct token width = { .text = "frame_border_width", .length = 18 };
    char *invalid[] = { "0", "65", "-1", "2x", "4294967297" };
    g_space_manager.frame_border.width = 3;
    FILE *stream = tmpfile();
    for (int i = 0; i < array_count(invalid); ++i) {
        struct token value = { .text = invalid[i], .length = strlen(invalid[i]) };
        handle_frame_border_config(stream, width, value);
        TEST_CHECK(g_space_manager.frame_border.width, 3);
    }
    struct token color = { .text = "selected_empty_border_color", .length = 27 };
    struct token blue = { .text = "0xff5555ff", .length = 10 };
    handle_frame_border_config(stream, color, blue);
    TEST_CHECK(g_space_manager.frame_border.selected_empty_color.p == 0xff5555ff, true);
    struct token bad = { .text = "0xff5555fg", .length = 10 };
    handle_frame_border_config(stream, color, bad);
    TEST_CHECK(g_space_manager.frame_border.selected_empty_color.p == 0xff5555ff, true);
    fclose(stream);
    g_space_manager.frame_border = saved;
});
