# Ratpoison mode

Ratpoison is a manual layout: windows share persistent frames, and only explicit
commands split or remove frames. Closing, hiding, minimizing, or floating a window
leaves its frame in place. New windows stack in the selected frame. Selecting an
empty frame sets the destination for the next window; macOS focus stays on the
previous window until an occupied frame/window is selected.

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
| `Shift-F`, then a label | Select a frame, including empty frames |
| `Shift-M`, then a label | Move the focused window to a frame |
| `Tab` / `Shift-Tab` | Next / previous frame |
| `Shift-R` | Remove selected frame |
| `Shift-O` | Keep only selected frame, collecting its windows |
| `Shift-T` | Toggle ratpoison; leaving it always chooses floating |
| `[` / `]` | Previous / next page of choices |
| Escape, Super-S again, click, or 8 idle seconds | Close the menu |

Navigation, splitting, and empty-frame selection keep the menu open and refresh
its contents. `* F<id>` marks the selected frame; `[empty]` entries are directly
selectable from the initial menu. Occupied-window choices and mode changes close
the menu. Choosing the already-active mode leaves its layout intact. Mode keys
work in floating and BSP as well; the menu continues to list their windows.
Floating-mode directional navigation chooses the nearest window centre in that
direction; BSP uses yabai's existing managed-window navigation.

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
