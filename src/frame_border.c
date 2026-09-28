/* Frame-owned borders, independent of application windows. One transparent
 * overlay per Space avoids copying WindowServer resources during tree edits. */
extern int g_layer_below_window_level;

float frame_border_inset(struct view *view, struct area area)
{
    if (view->layout != VIEW_RATPOISON || !g_space_manager.frame_border.enabled) return 0;
    // A display change or a larger configured width can shrink existing frames.
    // Clamp the inset so even a tiny frame retains at least one content point.
    float maximum = fmaxf(0, floorf((fminf(area.w, area.h) - 1) * 0.5f));
    return fminf(g_space_manager.frame_border.width, maximum);
}

static uint32_t frame_border_color(struct view *view, struct window_node *node)
{
    struct frame_border_config *config = &g_space_manager.frame_border;
    bool selected = view->sid == g_space_manager.current_space_id && node == view_ratpoison_selected_frame(view);
    if (selected && !node->window_count) return config->selected_empty_color.p;
    if (selected && window_node_contains_window(node, g_window_manager.focused_window_id)) return config->active_color.p;
    return config->inactive_color.p;
}

static void frame_border_draw(CGContextRef context, struct view *view)
{
    struct area root = view->root->area;
    CGContextSaveGState(context);
    CGContextClearRect(context, CGRectMake(0, 0, root.w, root.h));
    // Tree geometry is top-left based; CoreGraphics contexts are bottom-left.
    CGContextTranslateCTM(context, 0, root.h);
    CGContextScaleCTM(context, 1, -1);
    CGContextSetShouldAntialias(context, false);
    for (struct window_node *node = window_node_find_first_leaf(view->root); node; node = window_node_find_next_leaf(node)) {
        float width = node->border_width;
        if (width <= 0) continue;
        struct rgba_color color = rgba_color_from_hex(frame_border_color(view, node));
        CGContextSetRGBStrokeColor(context, color.r, color.g, color.b, color.a);
        CGContextSetLineWidth(context, width);
        CGRect frame = CGRectMake(node->area.x - root.x, node->area.y - root.y, node->area.w, node->area.h);
        // The entire stroke lies inside the outer frame. Windows use the same
        // inset, so gap=0 still leaves room for both adjacent frame borders.
        CGContextStrokeRect(context, CGRectInset(frame, width * 0.5f, width * 0.5f));
    }
    CGContextRestoreGState(context);
}

static uint64_t frame_border_hash(uint64_t hash, const void *bytes, size_t size)
{
    const unsigned char *p = bytes;
    while (size--) { hash ^= *p++; hash *= 1099511628211ULL; }
    return hash;
}

static uint64_t frame_border_signature(struct view *view)
{
    uint64_t hash = 14695981039346656037ULL;
    hash = frame_border_hash(hash, &view->sid, sizeof(view->sid));
    hash = frame_border_hash(hash, &view->root->area, sizeof(view->root->area));
    for (struct window_node *node = window_node_find_first_leaf(view->root); node; node = window_node_find_next_leaf(node)) {
        uint32_t color = frame_border_color(view, node);
        hash = frame_border_hash(hash, &node->area, sizeof(node->area));
        hash = frame_border_hash(hash, &node->border_width, sizeof(node->border_width));
        hash = frame_border_hash(hash, &color, sizeof(color));
    }
    return hash;
}

void frame_border_destroy(struct view *view)
{
    if (view->border.id) {
        SLSOrderWindow(g_connection, view->border.id, 0, 0);
        if (view->border.context) CGContextRelease(view->border.context);
        SLSReleaseWindow(g_connection, view->border.id);
    }
    memset(&view->border, 0, sizeof(view->border));
}

static void frame_border_refresh(struct view *view)
{
    struct frame_border_overlay *border = &view->border;
    if (!g_space_manager.frame_border.enabled || view->layout != VIEW_RATPOISON) {
        frame_border_destroy(view);
        return;
    }
    bool visible = !mission_control_is_active() && space_is_visible(view->sid) && space_is_user(view->sid);
    if (visible && view_is_invalid(view)) {
        view_update(view);
        view_flush(view);
    }
    if (!visible || view->root->area.w < 1 || view->root->area.h < 1) {
        if (border->visible) SLSOrderWindow(g_connection, border->id, 0, 0);
        border->visible = false;
        return;
    }
    uint64_t signature = frame_border_signature(view);
    if (border->visible && border->signature == signature) return;
    struct area area = view->root->area;
    CGRect frame = CGRectMake(area.x, area.y, area.w, area.h);
    CFTypeRef region = NULL;
    CGSNewRegionWithRect(&frame, &region);
    if (!region) return;
    if (!border->id) {
        uint64_t tags = (1ULL << 1) | (1ULL << 9) | (1ULL << 18);
        CFTypeRef empty = CGRegionCreateEmptyRegion();
        CGError error = SLSNewWindowWithOpaqueShapeAndContext(g_connection, 2, region, empty,
                                                            13, &tags, 0, 0, 64, &border->id, NULL);
        CFRelease(empty);
        if (error != kCGErrorSuccess || !border->id) {
            debug("%s: could not create frame overlay for space %llu (%d)\n", __FUNCTION__, view->sid, error);
            CFRelease(region);
            frame_border_destroy(view);
            return;
        }
        sls_window_disable_shadow(border->id);
        SLSSetWindowOpacity(g_connection, border->id, false);
        SLSSetWindowResolution(g_connection, border->id, 2.0f);
        // Managed windows occupy this layer. An overlay below normal/floating
        // windows keeps their contents and native dialogs unobstructed.
        SLSSetWindowLevel(g_connection, border->id, g_layer_below_window_level);
        border->context = SLWindowContextCreate(g_connection, border->id, NULL);
        if (!border->context) {
            CFRelease(region);
            frame_border_destroy(view);
            return;
        }
    }
    if (border->sid != view->sid) {
        CFArrayRef windows = cfarray_of_cfnumbers(&border->id, sizeof(border->id), 1, kCFNumberSInt32Type);
        SLSMoveWindowsToManagedSpace(g_connection, windows, view->sid);
        CFRelease(windows);
        border->sid = view->sid;
    }
    SLSDisableUpdate(g_connection);
    if (!CGRectEqualToRect(border->frame, frame)) {
        SLSSetWindowShape(g_connection, border->id, 0, 0, region);
        border->frame = frame;
    }
    frame_border_draw(border->context, view);
    CGContextFlush(border->context);
    SLSOrderWindow(g_connection, border->id, 1, 0);
    SLSReenableUpdate(g_connection);
    CFRelease(region);
    border->signature = signature;
    border->visible = true;
}

void frame_border_refresh_all(void)
{
    table_for (struct view *view, g_space_manager.view, {
        if (view->layout == VIEW_RATPOISON || view->border.id) frame_border_refresh(view);
    })
}

void frame_border_reconfigure(void)
{
    table_for (struct view *view, g_space_manager.view, {
        if (view->layout == VIEW_RATPOISON) {
            view_update(view);
            view_flush(view);
        }
    })
}
