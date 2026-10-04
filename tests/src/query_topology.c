static int topology_copies;
static CFArrayRef topology_fixture;
static CFArrayRef topology_test_copy(int connection)
{
    (void)connection;
    ++topology_copies;
    return topology_fixture ? CFRetain(topology_fixture) : NULL;
}

TEST_FUNC(query_topology_lifetime,
    topology_copies = 0;
    topology_fixture = (__bridge CFArrayRef)@[];
    query_topology_begin();
    CFArrayRef a = query_topology_copy_using(topology_test_copy);
    query_topology_begin();
    CFArrayRef b = query_topology_copy_using(topology_test_copy);
    TEST_CHECK(a == b, true);
    TEST_CHECK(topology_copies, 1);
    CFRelease(a); CFRelease(b);
    query_topology_end();
    TEST_CHECK(query_topology.depth, 1);
    query_topology_end();
    TEST_CHECK(query_topology.displays == NULL, true);
    TEST_CHECK(query_topology.fetched, false);
    // Failures are scoped too: do not keep retrying WindowServer in one reply.
    topology_fixture = NULL;
    query_topology_begin();
    TEST_CHECK(query_topology_copy_using(topology_test_copy) == NULL, true);
    TEST_CHECK(query_topology_copy_using(topology_test_copy) == NULL, true);
    TEST_CHECK(topology_copies, 2);
    query_topology_end();
    // A subsequent request must observe new topology after a display change.
    topology_fixture = (__bridge CFArrayRef)@[@{}];
    query_topology_begin();
    a = query_topology_copy_using(topology_test_copy);
    TEST_CHECK(CFArrayGetCount(a), 1);
    CFRelease(a); query_topology_end();
    TEST_CHECK(topology_copies, 3);
    // Mutation/event paths outside queries retain their existing fresh reads.
    a = query_topology_copy_using(topology_test_copy); CFRelease(a);
    a = query_topology_copy_using(topology_test_copy); CFRelease(a);
    TEST_CHECK(topology_copies, 5);
    topology_fixture = NULL;
)

TEST_FUNC(query_topology_selectors,
    topology_fixture = (__bridge CFArrayRef)@[
        @{ @"Spaces":@[@{@"id64":@101}, @{@"id64":@102}] },
        @{ @"Spaces":@[@{@"id64":@201}] }
    ];
    topology_copies = 0;
    query_topology_begin();
    CFArrayRef seed = query_topology_copy_using(topology_test_copy); CFRelease(seed);
    TEST_CHECK(space_manager_mission_control_index(101), 1);
    TEST_CHECK(space_manager_mission_control_index(201), 3);
    TEST_CHECK(space_manager_mission_control_index(999), 0);
    TEST_CHECK(space_manager_mission_control_space(2), 102);
    TEST_CHECK(space_manager_first_space(), 101);
    TEST_CHECK(space_manager_last_space(), 201);
    TEST_CHECK(space_manager_prev_space(201), 102);
    TEST_CHECK(space_manager_next_space(102), 201);
    TEST_CHECK(topology_copies, 1);
    query_topology_end();
    // Even an early query-parser return releases the request scope.
    FILE *output = tmpfile();
    char invalid[] = "query\0--spaces\0invalid-property\0\0";
    handle_message(output, invalid);
    TEST_CHECK(query_topology.depth, 0);
    TEST_CHECK(query_topology.displays == NULL, true);
    fclose(output);
    topology_fixture = NULL;
)

TEST_FUNC(menu_snapshot_rejects_options,
    FILE *output = tmpfile();
    char invalid[] = "query\0--menu-snapshot\0--space\0" "1\0\0";
    handle_message(output, invalid);
    rewind(output);
    char response[256] = {0};
    fread(response, 1, sizeof(response)-1, output);
    TEST_CHECK(strstr(response, "accepts no selectors") != NULL, true);
    TEST_CHECK(query_topology.depth, 0);
    fclose(output);
)
