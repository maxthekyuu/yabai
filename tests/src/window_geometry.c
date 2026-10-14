TEST_FUNC(window_geometry_fallback,
    CGRect observed = CGRectMake(-1440, 38, 1000, 800);
    CGRect server = CGRectMake(3, 41, 1364, 1285);
    CGRect cached = CGRectMake(10, 20, 600, 400);
    TEST_CHECK(CGRectEqualToRect(window_frame_with_fallback(observed, server, cached), observed), true);
    TEST_CHECK(CGRectEqualToRect(window_frame_with_fallback(CGRectZero, server, cached), server), true);
    TEST_CHECK(CGRectEqualToRect(window_frame_with_fallback(CGRectNull, CGRectNull, cached), cached), true);
    TEST_CHECK(window_frame_is_valid(CGRectMake(NAN, 0, 100, 100)), false);
    TEST_CHECK(window_frame_is_valid(CGRectMake(0, 0, INFINITY, 100)), false);
    TEST_CHECK(window_frame_is_valid(CGRectMake(0, 0, -100, 100)), false);
    TEST_CHECK(window_frame_is_valid(CGRectMake(0, 0, 100, 100)), true);
)

TEST_FUNC(window_display_move_geometry,
    CGRect bounds = CGRectMake(-1920, -200, 1920, 1080);
    CGRect result_frame = window_manager_display_move_frame(CGRectMake(10, 10, 800, 600), bounds);
    TEST_CHECK(CGRectContainsRect(bounds, result_frame), true);
    TEST_CHECK(CGRectEqualToRect(result_frame, CGRectMake(-1360, 40, 800, 600)), true);
    result_frame = window_manager_display_move_frame(CGRectMake(0, 0, 4000, 2000), bounds);
    TEST_CHECK(CGRectEqualToRect(result_frame, bounds), true);
    TEST_CHECK(window_manager_send_window_to_space(NULL, NULL, NULL, 1, false), false);
)

static uint64_t reconnect_window_spaces[3];
static uint64_t reconnect_lookup_space(uint32_t wid)
{
    return wid >= 101 && wid <= 103 ? reconnect_window_spaces[wid - 101] : 0;
}

TEST_FUNC(window_layout_reconnect_ownership,
    TEST_CHECK(ts_init(16384), true);
    struct table old_windows = g_window_manager.window;
    table_init(&g_window_manager.window, 8, hash_wm, compare_wm);
    struct window windows[] = {{.id=101}, {.id=102}, {.id=103}};
    struct view main = ratpoison_test_view();
    struct view external = ratpoison_test_view();
    main.sid = 1;
    external.sid = 2;
    external.root->area.x = -1440;
    TEST_CHECK(view_ratpoison_split(&main, SPLIT_Y), true);
    for (int i = 0; i < 3; ++i) {
        window_manager_add_window(&g_window_manager, &windows[i]);
        view_stack_window_node(i == 2 ? main.root->right : main.root->left, &windows[i]);
    }
    view_stack_window_node(external.root, &windows[1]);
    reconnect_window_spaces[0] = 1;
    reconnect_window_spaces[1] = 1;
    reconnect_window_spaces[2] = 1;
    struct window_capture *captures = NULL;
    window_node_capture_windows_on_space(main.root, &captures, main.sid, reconnect_lookup_space);
    TEST_CHECK(ts_buf_len(captures), 3);

    /* Display 2 returns late: the main display's cached tree still lists its window. */
    reconnect_window_spaces[1] = 2;
    reconnect_window_spaces[2] = 0; // WindowServer ownership is temporarily unavailable.
    captures = NULL;
    window_node_capture_windows_on_space(main.root, &captures, main.sid, reconnect_lookup_space);
    TEST_CHECK(ts_buf_len(captures), 1);
    TEST_CHECK(captures[0].window->id, 101);
    captures = NULL;
    window_node_capture_windows_on_space(external.root, &captures, external.sid, reconnect_lookup_space);
    TEST_CHECK(ts_buf_len(captures), 1);
    TEST_CHECK(captures[0].window->id, 102);
    TEST_CHECK((int)captures[0].x, -1440);

    /* A later refresh of the stale main tree must not pull either window back. */
    reconnect_window_spaces[2] = 3;
    captures = NULL;
    window_node_capture_windows_on_space(main.root, &captures, main.sid, reconnect_lookup_space);
    TEST_CHECK(ts_buf_len(captures), 1);
    TEST_CHECK(captures[0].window->id, 101);
    captures = NULL;
    window_node_capture_windows_on_space(main.root, &captures, 0, reconnect_lookup_space);
    TEST_CHECK(ts_buf_len(captures), 0);

    /* Explicit window swaps/warps retain their cross-Space capture behavior. */
    captures = NULL;
    window_node_capture_windows(main.root, &captures);
    TEST_CHECK(ts_buf_len(captures), 3);
    ratpoison_free_tree(main.root);
    ratpoison_free_tree(external.root);
    table_free(&g_window_manager.window);
    g_window_manager.window = old_windows;
    munmap(g_temp_storage.memory, g_temp_storage.size + getpagesize());
    memset(&g_temp_storage, 0, sizeof(g_temp_storage));
)
