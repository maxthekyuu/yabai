/* Request-local WindowServer topology reuse. Copy ownership is unchanged for
 * callers, and non-query operations continue to fetch fresh topology. */
extern int g_connection;
static _Thread_local struct {
    unsigned depth;
    bool fetched;
    CFArrayRef displays;
} query_topology;

static void query_topology_begin(void)
{
    ++query_topology.depth;
}

static void query_topology_end(void)
{
    assert(query_topology.depth);
    if (--query_topology.depth) return;
    if (query_topology.displays) CFRelease(query_topology.displays);
    query_topology.displays = NULL;
    query_topology.fetched = false;
}

static CFArrayRef query_topology_copy_using(CFArrayRef (*copy)(int))
{
    if (!query_topology.depth) return copy(g_connection);
    if (!query_topology.fetched) {
        query_topology.displays = copy(g_connection);
        query_topology.fetched = true;
    }
    return query_topology.displays ? CFRetain(query_topology.displays) : NULL;
}

static CFArrayRef query_topology_copy(void)
{
    return query_topology_copy_using(SLSCopyManagedDisplaySpaces);
}
