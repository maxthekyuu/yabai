/* Additive normal-chooser API. Global search keeps the existing --windows query.
 * Called inside the same request-local topology scope as other query commands. */
static bool menu_snapshot_query(FILE *rsp)
{
    int count = 0;
    uint32_t *displays = display_manager_active_display_list(&count);
    if (!displays || count <= 0) return false;
    struct menu_space { uint64_t sid; struct view *view; };
    struct menu_space *spaces = calloc((size_t)count, sizeof(*spaces));
    if (!spaces) return false;
    uint64_t focused = g_space_manager.current_space_id;
    bool has_focus = false;
    for (int i = 0; i < count; ++i) {
        spaces[i].sid = display_space_id(displays[i]);
        spaces[i].view = spaces[i].sid ? space_manager_query_view(&g_space_manager, spaces[i].sid) : NULL;
        if (!spaces[i].view) { free(spaces); return false; }
        if (spaces[i].sid == focused) has_focus = true;
    }
    // A dock/Space transition can briefly leave the focused Space outside the
    // visible set. Return a retriable error rather than a misleading snapshot.
    if (!has_focus) { free(spaces); return false; }
    uint64_t space_flags = SPACE_PROPERTY_ID | SPACE_PROPERTY_UUID | SPACE_PROPERTY_INDEX |
        SPACE_PROPERTY_DISPLAY | SPACE_PROPERTY_TYPE | SPACE_PROPERTY_HAS_FOCUS |
        SPACE_PROPERTY_IS_VISIBLE | SPACE_PROPERTY_FRAMES;
    uint64_t window_flags = WINDOW_PROPERTY_ID | WINDOW_PROPERTY_PID | WINDOW_PROPERTY_APP |
        WINDOW_PROPERTY_TITLE | WINDOW_PROPERTY_FRAME | WINDOW_PROPERTY_HAS_FOCUS |
        WINDOW_PROPERTY_IS_MINIMIZED | WINDOW_PROPERTY_IS_HIDDEN;
    fprintf(rsp, "{\"version\":1,\"focused-space\":%llu,\"focused-window\":%u,\"displays\":[",
            focused, g_window_manager.focused_window_id);
    for (int i = 0; i < count; ++i) {
        if (i) fprintf(rsp, ",");
        display_serialize(rsp, displays[i], DISPLAY_PROPERTY_ID | DISPLAY_PROPERTY_INDEX | DISPLAY_PROPERTY_FRAME);
    }
    fprintf(rsp, "],\"spaces\":[");
    for (int i = 0; i < count; ++i) {
        if (i) fprintf(rsp, ",");
        view_serialize(rsp, spaces[i].view, space_flags);
    }
    fprintf(rsp, "],\"windows\":{");
    for (int i = 0; i < count; ++i) {
        if (i) fprintf(rsp, ",");
        fprintf(rsp, "\"%llu\":", spaces[i].sid);
        window_manager_query_windows_for_spaces(rsp, &spaces[i].sid, 1, window_flags);
    }
    fprintf(rsp, "}}\n");
    free(spaces);
    return true;
}
