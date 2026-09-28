# Ratpoison mode

Ratpoison is a manual layout: windows share persistent frames, and only explicit
commands split or remove frames. Closing, hiding, minimizing, or floating a window
leaves its frame in place. New windows stack in the selected frame. Selecting an
empty frame sets the destination for the next window; macOS focus stays on the
previous window until an occupied frame/window is selected. With an empty frame
selected, choosing a covered window from another frame's stack (through the
prefix menu or `window --focus`) moves it into the empty frame. Choosing an
already visible window focuses its existing frame. This recall applies within
the active Space; minimized, hidden, and other-Space windows are not recalled.

```sh
yabai -m space --layout ratpoison
yabai -m space --split vertical       # left/right; current windows stay left
yabai -m space --focus-frame east     # select the empty right frame
yabai -m window --frame 1             # move the still-focused window there
yabai -m space --split horizontal     # top/bottom; new empty frame is 2
yabai -m space --focus-frame next     # includes empty frames, wraps
yabai -m window --focus frame.0       # focus active window in frame 0
yabai -m window --focus stack.next    # cycle windows in the focused stack
yabai -m window --ratio rel:0.05      # resize the parent split
yabai -m space --remove-frame        # merge selected frame into its sibling
yabai -m space --only-frame          # collect all windows into one frame
yabai -m query --spaces frames --space
```

Enable by default with `yabai -m config layout ratpoison` in yabairc. All three
layout entry points work: global config, `config --space … layout`, and
`space --layout`. Other layouts retain their existing behavior. Changing layouts
resets frames; frame trees are not persisted across daemon restarts.

Frame 0 is the initial frame. Splitting retains its id in the left/top child and
assigns a new id to the right/bottom child. Surviving ids do not change when other
frames are removed. `first`, `last`, `next`, and `prev` follow tree order. `north`, `east`,
`south`, and `west` choose the nearest frame in that direction, including empty
frames. Directional movement stops at the edge; next/prev wrap. Repeated macOS
focus notifications for the old window do not cancel an empty-frame selection.

Frames use yabai's existing overlapping window stacks; background windows are
not minimized or hidden. Each frame holds at most 32 windows. New windows arriving
at a full frame stay unmanaged; a later reconciliation can admit them after room
becomes available. Move/remove/only commands reject capacity overflow without
changing the tree. Split commands reject geometry too small for two nonempty
regions. `auto_balance` does not rearrange frames on window arrival or departure.
Use the existing window ratio/resize commands to adjust splits. BSP insertion,
warp, swap, zoom, and mouse-drop tree editing remain restricted to BSP.

## Resizing frames

Frame resizing acts on the selected frame, including an empty frame, and moves
its nearest divider on the chosen axis. Sizes are relative logical points:

```sh
yabai -m space --resize-frame horizontal:40   # grow selected frame width
yabai -m space --resize-frame horizontal:-40  # shrink width
yabai -m space --resize-frame vertical:40     # grow height
yabai -m space --equalize-frames horizontal   # equalize widths
yabai -m space --equalize-frames vertical     # equalize heights
yabai -m space --equalize-frames both
```

`horizontal` means width and `vertical` means height for these commands.
Equalization distributes space evenly among parallel slots within the existing
tree, accounting for gaps; it does not rearrange frames or move windows between
frames. For three nested columns this produces three equal widths (within pixel
rounding), rather than making every divider 50/50. Perpendicular branches share
space, so mixed trees retain their existing partition structure. Only the chosen
axis changes. Frame ids, stacks, and selection remain intact.

Resizing a single root frame, or an axis without a divider, is rejected.
Changes that cannot fit every frame's borders plus at least one content point
are rejected without partial changes. Applications can still enforce their own
minimum window sizes.

Within the prefix menu, **Shift-H/L** shrinks/grows width by 40 points and
**Shift-R** opens resize mode, where h/l or Left/Right changes width and
k/j or Up/Down changes height by 40 points. Resize mode stays open for repeated
adjustments; Escape returns to the chooser. **Shift-E** opens equalization:
`h` for equal widths, `v` for equal heights, `b` for both. The same size menu
has left:right width presets: `1` = **1:2**, `2` = **1:1**, `3` = **2:1**.
Escape returns to the chooser. These numbers select ratios only inside the size
menu; the main menu still uses them for layouts. These controls refresh the menu and centered labels after each change.

Fixed ratios also work through the CLI:

```sh
yabai -m space --frame-ratio horizontal:1:2 # left third, right two-thirds
yabai -m space --frame-ratio horizontal:2:1 # left two-thirds, right third
yabai -m space --frame-ratio horizontal:1:1 # equal left/right split
yabai -m space --frame-ratio vertical:1:2   # top third, bottom two-thirds
```

Ratios divide the space remaining after the gap, and always mean left:right
(horizontal) or top:bottom (vertical), regardless of which side is selected.
With more than two frames, they apply to the selected frame's nearest divider
on that axis; sibling subtrees resize with it. Positive numeric weights are
supported. Border/content minimums still apply, with invalid changes rejected.

## Frame borders

Native borders outline every ratpoison frame, including empty frames. They are
on by default. Add these global settings to yabairc to customize them:

```sh
yabai -m config frame_border on
yabai -m config frame_border_width 3
yabai -m config active_frame_border_color 0xff55ff55
yabai -m config inactive_frame_border_color 0xff555555
yabai -m config selected_empty_border_color 0xff5555ff
```

Colors use `0xAARRGGBB`. The selected empty frame is blue; the selected frame
containing the focused window is green; other frames are gray. Width is 1–64
logical points. Windows are inset by the border width on every side, including
when `window_gap` is zero. Turning borders off restores the full frame area.
Very small existing frames clamp the width to preserve at least one content
point; new splits must have room for both borders and content.

Borders follow Spaces and disappear in Mission Control and other layouts.
Frame queries include the outer `frame`, inset `content` rectangle, and effective
`border-width`. External window-border tools are unnecessary for ratpoison
frames and may draw additional borders if left running.

## Phoenix: Super-S prefix

Phoenix supports temporary key handlers, so no skhd migration is required.
The module preserves existing Phoenix shortcuts outside its prefix session.
After building and starting this version of yabai, add this line to your
`~/.phoenix.js` (adjust the repository path):

```js
require('/Users/jkuhn/Software/yabai/examples/phoenix-ratpoison.js');
```

`make` builds both `bin/yabai` and the native `bin/yabai-prefix` renderer.
The module uses `/opt/homebrew/bin/yabai` as its client executable and
`/Users/jkuhn/Software/yabai/bin/yabai-prefix` as its renderer; adjust the
`executable` and `renderer` paths at the top of the module for other installations.
The native renderer uses an opaque black, non-activating panel: it never takes
keyboard focus. Install **GoMono Nerd Font Mono**; the renderer uses it at
**12 points**. Window titles use terminal gray (`#c0c0c0`), headings cyan,
mode choices yellow, and selected-frame markers green. The menu adapts to the
screen with one or two columns, shortened titles, and at most 24 entries per page.
One entry per frame (including empty frames) comes before additional stacked
windows, making newly split containers easy to select. The running daemon must be the new build;
a new client talking to an old daemon cannot enable the new layout.

Press **Super-S (Command-S)**, release it, then choose:

| Key | Action |
| --- | --- |
| `1` / `2` / `3` | Ratpoison / floating / BSP on the current space |
| Other displayed digits/letters | Select that window or empty frame |
| Arrows or `h/j/k/l` | Focus west/south/north/east, including empty frames |
| `Shift-S` | Split horizontally (top/bottom) |
| `Shift-V` | Split vertically (left/right) |
| `Shift-F`, then a label | Select a frame or container on any visible Space |
| `Shift-M`, then a label | Move to a frame, display, or Space; follow cross-Space moves |
| `Shift-D`, then a label | Focus a physical display's visible Space |
| `Shift-U`, then a label | Focus a virtual desktop (Space) |
| `Tab` / `Shift-Tab` | Next / previous frame |
| `Shift-R` | Resize selected frame with arrows/hjkl; Escape returns |
| `Shift-W` | Remove selected frame |
| `Shift-Z` | Toggle temporary fullscreen for the selected frame’s front window |
| `Shift-J` / `Shift-K` | Next / previous window in the selected frame’s stack |
| `Shift-O` | Keep only selected frame, collecting its windows |
| `Shift-T` | Toggle ratpoison; leaving it always chooses floating |
| `[` / `]`, Page Up / Page Down | Previous / next page of choices |
| Space / Shift-Space | Next / previous page of choices |
| Escape, Super-S again, or click | Close the menu |

The menu has no idle timeout. Navigation, splitting, and empty-frame selection keep the menu open and refresh
its contents. `* F<id>` marks the selected frame; `[empty]` entries are directly
selectable from the initial menu. Occupied-window choices and mode changes close
the menu. Choosing the already-active mode leaves its layout intact. Mode keys
work in floating and BSP as well; the menu continues to list their windows.
Floating-mode directional navigation chooses the nearest window centre in that
direction; BSP uses yabai's existing managed-window navigation.

### Temporary fullscreen

Press **Super-S, Shift-Z** to expand the selected frame's front window across
its display. Repeat the shortcut on that window to restore its saved size and
position. The menu closes after the toggle. Empty selected frames do nothing.
This uses `yabai -m window <id> --toggle windowed-fullscreen`, which leaves the
ratpoison tree, split ratios, stacks, and empty frames intact; it does not create
a macOS fullscreen Space. The same shortcut works on focused floating and BSP
windows. Display constraints such as the menu bar and Dock still apply.

The saved rectangle is temporary: manually moving/resizing the window or
changing the layout while expanded can supersede it. Restore before editing the
layout when you want to return to the exact previous arrangement.

### Appearance configuration

Set a global configuration **before** loading the Phoenix module, or call
`yabaiRatpoison.configure({...})` afterward. Changes apply the next time the menu
is rendered. Use an installed monospaced font to keep boxes and columns aligned.
Font size is 6–36 points; colors are opaque `#RRGGBB` strings.

```js
var yabaiRatpoisonConfig = {
    font: 'GoMono Nerd Font Mono',
    fontSize: 12,
    selectionWeight: 'bold', // 'bold' or 'regular'
    displayColors: ['#55ffff', '#ff55ff', '#55ff55', '#ffff55', '#5555ff', '#ff5555'],
    colors: {
        background: '#000000', text: '#c0c0c0',
        title: '#55ffff', accent: '#ffff55', help: '#aaaaaa', status: '#aaaaaa',
        activeFrame: '#55ff55', emptyFrame: '#ffff55', error: '#ff5555',
        selectionText: '#ffffff', selectionBackground: '#004444',
        hintBackground: '#000000',
        // Optional hintText/hintBorder override the corresponding display color.
        inputText: '#c0c0c0', inputBackground: '#000000', placeholder: '#777777',
        caret: '#ffffff', inputSelectionText: '#ffffff', inputSelectionBackground: '#005577'
    }
};
require('/Users/jkuhn/Software/yabai/examples/phoenix-ratpoison.js');
```

Unspecified settings retain their defaults. `displayColors` cycles by physical
display number and controls headings, outlines, and default label colors.
`selectionText`, `selectionBackground`, and `selectionWeight` style the selected
search row in addition to its `>` marker. Font and size apply to menu text,
search input, and centered labels. Window-frame borders retain their existing
yabai configuration described above. Invalid colors, sizes, or unavailable fonts
produce a visible configuration error.

Shift-J/K wraps within the selected frame's stable window list; empty and
single-window frames do nothing. It does not accidentally cycle the old focused
window when an empty frame is selected.

### Search windows

Press `/` in the main chooser to search all windows across **every Space and physical display**, including hidden
desktops, minimized windows, and hidden applications. Search takes a fresh global
snapshot when opened, including entries beyond the main menu’s pages. Type an application name or window
title; matches narrow immediately. Matching ignores case and accents, and each
space-separated search term must match. Clear the text to restore all windows.
Empty frames and containers are omitted from window search.

Display boxes, `Sx (display)` labels, and centered selection hints remain visible
for matching windows on visible Spaces. Hidden/minimized windows have no on-screen
label until restored; selecting them switches Space and restores focus. Up/Down selects a result and Enter focuses it. Page Up/Down
moves between result pages. Tab switches between typing and label selection;
in label mode, press a displayed key to focus its window. Escape closes search.
Normal layout and frame command shortcuts are suspended while typing.

Search uses a native text field, including Unicode and normal text editing.
Filtering uses the existing snapshot in a single renderer process; it neither
queries yabai nor launches processes as you type, and it reuses hint panels.
Reopen the chooser to refresh windows that opened or changed after the snapshot.
Search does not change the existing local recall or cross-display focus behavior.

### Displays and virtual desktops

The main `Super-S` chooser lists windows and frames on **all currently visible
Spaces across physical displays**, grouped in physical display number order.
The current page's selection keys also appear at the centers of its windows,
frames, and visible Space containers. Labels use the corresponding display color.
Stacked windows sharing a center show their keys together; the menu identifies
which key belongs to each window. Paging replaces the labels, and closing the
menu removes all of them. Hidden Spaces have no on-screen label.

The native menu and labels share one helper process. Labels are small,
nonactivating, click-through panels with no animation or recurring polling.
Window/frame positions reuse the menu's query results; whole-Space containers
need one display-geometry query per refresh. At most one page of labels is drawn. The dialog grows with its contents up to
90% of the available screen height, with at most 29 distinct selection keys per
page. A permanent page/count indicator shows how many choices and displays are
on the current page. Page keys wrap and reuse the loaded choices without
querying yabai again.

Each display has a labeled box with its own terminal color. Pagination reserves room for each display before filling extra rows from a large
group, so a display with many Spaces does not hide the other displays when they
fit on the page. Large groups repeat
their heading with `(continued)` on subsequent pages. Every entry
starts with `Sx (display number)`. Empty ratpoison frames are selectable directly;
an empty floating/BSP Space appears as an empty container. Hidden virtual
desktops remain available through `Shift-U`.

Selecting a remote entry activates its Space, then focuses its window or selects
its empty frame. The menu stays open on that destination so layout keys and frame
commands apply there. Covered stack windows stay in their existing remote frame;
local empty-frame recall behavior is unchanged. `Shift-F` lists frames and Space
containers across the same visible Spaces, from any layout. Arrow/hjkl navigation
continues to operate within the active Space. Use selection labels to cross displays.


Display and Space containers are available in every layout. `Super-S`, then
`Shift-M`, opens a destination list: ratpoison frames from every currently visible Space, plus
physical display shortcuts and their virtual desktops. Each display entry
represents its currently visible Space. Space entries also include desktops
that are not currently visible; native fullscreen Spaces are excluded.
Labels lead with the virtual desktop number and the physical display number in
parentheses: `S1 (1)` means Space 1 on display 1. The current layout and any
configured display/Space label follow. Use `[` and `]` to page through long destination lists.

For example, to send a window to a floating external display and start tiling:

1. Focus the window, press `Super-S`, then `Shift-M`.
2. Choose the external display's visible Space, shown as `Sx (display number)`.
3. After the window moves and receives focus there, press `1` for ratpoison,
   `2` for floating, or `3` for BSP. The menu stays open after arrival.

Choosing a specific remote frame activates that Space and selects the frame
before moving the window there. Empty frames are listed first within remote
frame targets. Missing or full targets are rejected before moving.
Moving to a ratpoison Space without choosing a frame uses its selected frame; the source frame remains
in place even when empty. Moving to another layout uses yabai's normal placement.
`Shift-D` and `Shift-U` let you visit containers without moving a window, including
empty desktops, then change their layout with the same number keys.

Moves and Space switches use existing yabai commands and require the same macOS
permissions as those commands. The menu waits for asynchronous completion before
following focus or enabling destination layout controls. A failure stops the
sequence and displays an error. Escape stops subsequent steps; a move already
sent to yabai is not undone. Space and display indices are resolved again from their ids
before acting; destination lists are refreshed each time the chooser opens.

**Exiting ratpoison with Shift-T defaults to floating**, even if it was entered
from BSP. Selecting `3` explicitly chooses BSP instead. Closing the prefix menu
with Escape does not change the tiling mode.

Window choices are a snapshot; labels can change after windows open/close or
frame focus changes. `1/2/3` and `h/j/k/l` are reserved for commands. Unbound keys
pass through to applications. Command-S is reserved globally by the module.
The module cooperates with the existing `hintsActive`/`cancelHints` Phoenix hint
module when opening the prefix menu. Native renderer failure closes the session
and shows a short Phoenix error popup; no invisible command bindings remain.

The repository build does not install the binary, restart your daemon, or edit
your live Phoenix/yabai configuration.

## Verification

```sh
make
make -C tests
node tests/phoenix-ratpoison.js
python3 tests/prefix-menu.py
```

After installing the build, check with real application windows: split an occupied
frame, select an empty frame and launch a window, move a window, minimize/restore
and close the last window in a frame, switch Spaces/displays, and switch back to
BSP/float. Applications can enforce minimum window sizes, as with existing yabai
layouts.
