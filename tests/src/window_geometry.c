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
