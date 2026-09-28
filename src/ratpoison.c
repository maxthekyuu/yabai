/* Manual tiling uses the same geometry and window stacks as BSP, but only
 * explicit frame commands may change the tree. Frame 0 is the initial root;
 * subsequent frame ids remain stable until removed or the layout is reset. */
struct window_node *view_ratpoison_selected_frame(struct view *view)
{
    return view->selected_frame ? view->selected_frame : window_node_find_first_leaf(view->root);
}

struct window_node *view_ratpoison_find_frame(struct view *view, unsigned frame_id)
{
    if (view->layout != VIEW_RATPOISON) return NULL;
    for (struct window_node *node = window_node_find_first_leaf(view->root); node; node = window_node_find_next_leaf(node)) {
        if (node->frame_id == frame_id) return node;
    }
    return NULL;
}

/* Frame navigation must include empty leaves and must not depend on the
 * window server's stacking order. Prefer the nearest edge, then the nearest
 * centre along the perpendicular axis. Tree order breaks exact ties. */
struct window_node *view_ratpoison_frame_in_direction(struct view *view, int direction)
{
    if (view->layout != VIEW_RATPOISON) return NULL;
    struct window_node *source = view_ratpoison_selected_frame(view);
    struct window_node *best = NULL;
    CGPoint source_max = area_max_point(source->area);
    int best_distance = INT_MAX;
    float best_offset = INFINITY;
    for (struct window_node *node = window_node_find_first_leaf(view->root); node; node = window_node_find_next_leaf(node)) {
        if (node == source) continue;
        CGPoint target_max = area_max_point(node->area);
        if (!area_is_in_direction(&source->area, source_max, &node->area, target_max, direction)) continue;
        int distance = area_distance_in_direction(&source->area, source_max, &node->area, target_max, direction);
        float offset = direction == DIR_EAST || direction == DIR_WEST
                     ? fabsf((source->area.y + source->area.h * 0.5f) - (node->area.y + node->area.h * 0.5f))
                     : fabsf((source->area.x + source->area.w * 0.5f) - (node->area.x + node->area.w * 0.5f));
        if (distance < best_distance || (distance == best_distance && offset < best_offset)) {
            best = node;
            best_distance = distance;
            best_offset = offset;
        }
    }
    return best;
}

void view_ratpoison_select_window(struct view *view, uint32_t window_id, bool focus_changed)
{
    if (view->layout != VIEW_RATPOISON) return;
    struct window_node *node = view_find_window_node(view, window_id);
    // macOS retains keyboard focus when an empty frame is selected. Duplicate
    // AX focus notifications must not move selection back to that old window.
    if (node && (focus_changed || !view->selected_frame || view->selected_frame->window_count)) {
        view->selected_frame = node;
    }
}

bool view_ratpoison_split(struct view *view, enum window_node_split split)
{
    if (view->layout != VIEW_RATPOISON || (split != SPLIT_X && split != SPLIT_Y)) return false;
    struct window_node *node = view_ratpoison_selected_frame(view);
    float extent = split == SPLIT_Y ? node->area.w : node->area.h;
    float ratio = g_space_manager.split_ratio;
    if (!in_range_ii(ratio, 0.1f, 0.9f)) ratio = 0.5f;
    float available = extent - window_node_get_gap(view);
    float minimum = g_space_manager.frame_border.enabled ? 2 * g_space_manager.frame_border.width + 1 : 1;
    float perpendicular = split == SPLIT_Y ? node->area.h : node->area.w;
    if (available * ratio < minimum || available * (1 - ratio) < minimum ||
        perpendicular < minimum || view->next_frame_id == UINT_MAX) return false;

    struct window_node *left = calloc(1, sizeof(struct window_node));
    struct window_node *right = calloc(1, sizeof(struct window_node));
    if (!left || !right) { free(left); free(right); return false; }

    *left = *node;
    left->parent = node;
    left->zoom = NULL;
    right->parent = node;
    right->frame_id = view->next_frame_id++;
    node->left = left;
    node->right = right;
    node->window_count = 0;
    memset(node->window_list, 0, sizeof(node->window_list));
    memset(node->window_order, 0, sizeof(node->window_order));
    node->split = split;
    node->ratio = ratio;
    node->zoom = NULL;
    area_make_pair_for_node(view, node);
    view->selected_frame = left;
    return true;
}

bool view_ratpoison_move_window(struct view *view, struct window *window, struct window_node *target)
{
    if (view->layout != VIEW_RATPOISON || !target) return false;
    struct window_node *source = view_find_window_node(view, window->id);
    if (!source) return false;
    if (source == target) {
        view->selected_frame = target;
        return true;
    }
    if (target->window_count == NODE_MAX_WINDOW_COUNT) return false;
    view_remove_window_node(view, window);
    view_stack_window_node(target, window);
    view->selected_frame = target;
    return true;
}

// Recall only covered stack members; visible windows keep their existing frame.
bool view_ratpoison_recall_window(struct view *view, struct window *window)
{
    if (view->layout != VIEW_RATPOISON) return false;
    struct window_node *target = view_ratpoison_selected_frame(view);
    if (!target || target->window_count) return false;
    struct window_node *source = view_find_window_node(view, window->id);
    if (!source || source->window_order[0] == window->id) return false;
    return view_ratpoison_move_window(view, window, target);
}

bool view_ratpoison_remove_frame(struct view *view)
{
    if (view->layout != VIEW_RATPOISON) return false;
    struct window_node *node = view_ratpoison_selected_frame(view);
    struct window_node *parent = node->parent;
    if (!parent) return false;
    struct window_node *sibling = parent->left == node ? parent->right : parent->left;
    struct window_node *target = window_node_find_first_leaf(sibling);
    if (target->window_count + node->window_count > NODE_MAX_WINDOW_COUNT) return false;

    memcpy(target->window_list + target->window_count, node->window_list, sizeof(uint32_t) * node->window_count);
    memcpy(target->window_order + target->window_count, node->window_order, sizeof(uint32_t) * node->window_count);
    target->window_count += node->window_count;
    struct window_node *grandparent = parent->parent;
    struct area area = parent->area;
    *parent = *sibling;
    parent->parent = grandparent;
    parent->area = area;
    if (parent->left) parent->left->parent = parent;
    if (parent->right) parent->right->parent = parent;
    view->selected_frame = target == sibling ? parent : target;
    free(node);
    free(sibling);
    window_node_clear_zoom(view->root);
    window_node_update(view, parent);
    return true;
}

/* Free only the containers: windows remain managed by this view. */
static void ratpoison_free_tree(struct window_node *node)
{
    if (node->left) ratpoison_free_tree(node->left);
    if (node->right) ratpoison_free_tree(node->right);
    free(node);
}

bool view_ratpoison_only_frame(struct view *view)
{
    if (view->layout != VIEW_RATPOISON) return false;
    struct window_node *selected = view_ratpoison_selected_frame(view);
    struct window_node merged = *selected;
    for (struct window_node *node = window_node_find_first_leaf(view->root); node; node = window_node_find_next_leaf(node)) {
        if (node == selected) continue;
        if (merged.window_count + node->window_count > NODE_MAX_WINDOW_COUNT) return false;
        memcpy(merged.window_list + merged.window_count, node->window_list, sizeof(uint32_t) * node->window_count);
        memcpy(merged.window_order + merged.window_count, node->window_order, sizeof(uint32_t) * node->window_count);
        merged.window_count += node->window_count;
    }
    merged.parent = merged.left = merged.right = merged.zoom = NULL;
    merged.area = view->root->area;
    if (view->root->left) ratpoison_free_tree(view->root->left);
    if (view->root->right) ratpoison_free_tree(view->root->right);
    *view->root = merged;
    window_node_update(view, view->root);
    view->selected_frame = view->root;
    return true;
}

// Count parallel slots along one axis. Perpendicular branches share the same
// extent, whereas parallel splits consume separate slots and intervening gaps.
static unsigned ratpoison_axis_slots(struct window_node *node, enum window_node_split axis)
{
    if (window_node_is_leaf(node)) return 1;
    unsigned left = ratpoison_axis_slots(node->left, axis);
    unsigned right = ratpoison_axis_slots(node->right, axis);
    return node->split == axis ? left + right : (left > right ? left : right);
}

// Plan once without mutation, then commit. Failed changes preserve all ratios,
// selection, frame identities and window stacks.
static bool ratpoison_plan_geometry(struct view *view, struct window_node *node, struct area area,
                                   uint32_t axes, struct window_node *resized, float resize_ratio, bool commit)
{
    float minimum = g_space_manager.frame_border.enabled ? 2 * g_space_manager.frame_border.width + 1 : 1;
    if (window_node_is_leaf(node)) return area.w >= minimum && area.h >= minimum;
    float ratio = node == resized ? resize_ratio : node->ratio;
    int gap = window_node_get_gap(view);
    float extent = (node->split == SPLIT_Y ? area.w : area.h) - gap;
    if (extent <= 0) return false;
    if (axes & node->split) {
        unsigned left = ratpoison_axis_slots(node->left, node->split);
        unsigned right = ratpoison_axis_slots(node->right, node->split);
        float unit = (extent - gap * (left + right - 2)) / (left + right);
        ratio = (unit * left + gap * (left - 1)) / extent;
    }
    if (!isfinite(ratio) || ratio <= 0 || ratio >= 1) return false;
    struct area left, right;
    area_make_pair(node->split, gap, ratio, &area, &left, &right);
    if (!ratpoison_plan_geometry(view, node->left, left, axes, resized, resize_ratio, commit) ||
        !ratpoison_plan_geometry(view, node->right, right, axes, resized, resize_ratio, commit)) return false;
    if (commit) node->ratio = ratio;
    return true;
}

bool view_ratpoison_resize_frame(struct view *view, enum window_node_split axis, float delta)
{
    if (view->layout != VIEW_RATPOISON || (axis != SPLIT_X && axis != SPLIT_Y) || !isfinite(delta)) return false;
    struct window_node *child = view_ratpoison_selected_frame(view);
    while (child->parent && child->parent->split != axis) child = child->parent;
    struct window_node *parent = child->parent;
    if (!parent) return false;
    float extent = (axis == SPLIT_Y ? parent->area.w : parent->area.h) - window_node_get_gap(view);
    if (extent <= 0) return false;
    float ratio = parent->ratio + (child == parent->left ? delta : -delta) / extent;
    if (!ratpoison_plan_geometry(view, view->root, view->root->area, 0, parent, ratio, false)) return false;
    ratpoison_plan_geometry(view, view->root, view->root->area, 0, parent, ratio, true);
    window_node_update(view, view->root);
    return true;
}

// Ratios always describe left:right (or top:bottom), independent of selection.
bool view_ratpoison_set_frame_ratio(struct view *view, enum window_node_split axis, float ratio)
{
    if (view->layout != VIEW_RATPOISON || (axis != SPLIT_X && axis != SPLIT_Y) ||
        !isfinite(ratio) || ratio <= 0 || ratio >= 1) return false;
    struct window_node *child = view_ratpoison_selected_frame(view);
    while (child->parent && child->parent->split != axis) child = child->parent;
    struct window_node *parent = child->parent;
    if (!parent || !ratpoison_plan_geometry(view, view->root, view->root->area, 0, parent, ratio, false)) return false;
    ratpoison_plan_geometry(view, view->root, view->root->area, 0, parent, ratio, true);
    window_node_update(view, view->root);
    return true;
}

bool view_ratpoison_equalize_frames(struct view *view, uint32_t axes)
{
    if (view->layout != VIEW_RATPOISON || !axes || (axes & ~(SPLIT_X | SPLIT_Y))) return false;
    if (!ratpoison_plan_geometry(view, view->root, view->root->area, axes, NULL, 0, false)) return false;
    ratpoison_plan_geometry(view, view->root, view->root->area, axes, NULL, 0, true);
    window_node_update(view, view->root);
    return true;
}
