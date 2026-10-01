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
