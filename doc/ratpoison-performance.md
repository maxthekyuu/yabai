# Prefix dialog latency profile and improvement plan

Profiled 2026-10-04 on the live local ratpoison installation, revision 11621e4.
No production behavior changed during profiling.

## Measurements

The fixture had two visible Spaces (S5 and S15), four ratpoison frames, seven
shortcut keys, and an 18-line menu. The chooser harness used a 1728×1080 screen.
Times are milliseconds. p95 is nearest-rank; small sample sizes limit tail estimates.

| Component | Samples | Median | p95 |
|---|---:|---:|---:|
| Existing JS orchestration through completed menu payload | 25 | 61.30 | 91.55 |
| Fresh renderer through panels ordered and explicitly drawn | 20 | 179.57 | 223.54 |
| Cocoa application initialization, within renderer total | 20 | 104.11 | 120.81 |
| Initial menu/hint construction and drawing, within renderer total | 20 | 59.42 | 97.42 |
| Existing helper/notification update, including acknowledgment | 20 | 75.56 | 77.59 |
| Repeat update experiment | 10 | 39.77 | 72.91 |
| View reconstruction inside repeat update handler | 10 | 5.77 | 6.50 |
| Minimal fields: all Spaces, then parallel visible-window queries | 25 | 40.75 | 64.75 |
| All-Spaces and all-windows queries in parallel | 25 | 58.10 | 71.72 |
| All-windows query alone | 25 | 51.19 | 73.53 |
| Empty process launch baseline | 25 | 6.01 | 8.22 |

The first instrumented renderer launch took 458 ms; the first launch after
recompiling the instrumented binary took 563 ms. These include effects associated
with first execution of a newly built binary; they do not establish reboot-cold
latency. A second batch had a lower renderer median of 140 ms, so machine/cache
state materially affects these measurements.

Adding the first batch's component medians suggests about 241 ms before the
menu is ready to display. This is an estimate, not a measured end-to-end median.
Neither Phoenix key-event dispatch nor final WindowServer/display presentation
was measured. Off-screen panels exercise native construction/drawing without
interrupting the user's windows, but do not measure physical screen latency.

## Method and findings

The actual Phoenix module ran in a Node VM with its Task calls backed by real
subprocesses querying the running yabai daemon. Only its UI/key APIs were stubbed;
the native-launch boundary captured the real menu payload. This measures the
query dependency chain and JS work, not Phoenix's Task callback scheduling.
The theme was loaded before timing, matching normal operation.

A temporary copy of the native renderer was compiled with timestamps around
NSApplication initialization and render_menu, and explicit displayIfNeeded calls
after initial rendering. Its panels and hint rectangles were moved off-screen.
Updates used the installed --update helper and its normal acknowledgment. The
second experiment additionally timed render_menu inside the update handler;
that handler measurement excludes final asynchronous presentation.

The current critical path is:

1. Query focused Space.
2. Query that Space's windows.
3. Query all Spaces, repeating information from step 1.
4. Query other visible Spaces' windows concurrently.
5. Build text, key bindings, groups and hint payload.
6. Launch a new renderer, initialize Cocoa, create/draw panels.

An extra display query is needed for some empty non-ratpoison containers.
Closing the menu terminates the renderer, so the next invocation repeats native
startup. Reuse currently lasts only while the menu remains open. Each refresh
also launches a Cocoa-linked helper and waits for a distributed notification
acknowledgment. The measured view work is a small fraction of that update path.

Simply querying every window is not an effective latency fix: it includes hidden
Spaces that the normal chooser does not need. Full global queries remain
appropriate for search, outside the ordinary prefix-opening critical path.

## Implementation priorities

1. **Keep the renderer alive across close/open.** Start it when Phoenix starts;
   hide panels on Escape or an action, rather than terminate. Reuse panels, font
   objects, text layout and hint views. Keep search/configuration transitions
   explicit. Use session ownership, crash recovery, and shutdown cleanup to avoid
   orphan overlays. This removes the largest measured repeated cost.

2. **Replace the process-plus-distributed-notification update path.** Give the
   resident renderer a private local socket and a lightweight client for show,
   hide and update. Avoid initializing Cocoa in that client. Initially a tiny
   client process is reasonable (baseline launch about 6 ms); direct persistent
   communication can follow if measurements justify it. Coalesce superseded
   updates; acknowledge only valid current generations. Do not assume keeping
   the renderer alive alone will yield an instant response: current update
   transport still costs tens of milliseconds.

3. **Show prepared state immediately and refresh asynchronously.** Maintain a
   chooser snapshot keyed by Space UUID, display topology and stable window IDs.
   Refresh it on relevant window/focus/layout/display events, with a short
   coalescing interval instead of continuous polling. Prebuild text/hint layout
   while hidden. On Cmd-S, show the prepared menu and reconcile fresh state.
   Preserve shortcut assignments during reconciliation. Validate stale targets
   before actions; discard old replies and cancel pending actions on Escape.
   Dock changes invalidate geometry immediately. An unknown topology gets a
   neutral loading panel until validated geometry is available, never stale
   overlays on disconnected displays.

4. **Simplify fresh data collection.** Fetch minimal Space fields once, derive
   the focused/visible Spaces, then query only those Spaces' window fields in
   parallel. The prototype reduced median preparation by about 20 ms. Confirm
   every field needed by navigation, moves and search before changing queries.
   Consider one daemon snapshot command if this path still misses the target;
   avoid a new core API until simpler changes have been measured.

5. **Avoid unnecessary redraw work.** Cache regexes, theme/font objects and
   attributed labels; update only changed entries and rectangles. Preserve
   independent styles for grouped overlay keys. At 5.8 ms measured view work,
   this is secondary to lifecycle/transport, not the first optimization.

## Acceptance measurements

Targets, not yet achieved:

- Warm Cmd-S to first visible menu: median at most 25 ms, p95 at most 50 ms.
- Correct freshly reconciled menu: p95 at most 100 ms in the ordinary setup.
- Warm focus/stack changes: p95 at most 50 ms, without hiding the panel.
- Idle: no polling loop or recurring process spawning; bounded memory after
  repeated open/close cycles.

Add opt-in timestamps at the real Phoenix key callback, query dispatch/completion,
renderer message receipt, show and draw. Correlate generations and record no
window titles. Confirm physical presentation with a screen recording/high-speed
capture if necessary; ordering a panel is not proof a frame has reached the screen.

Collect at least 100 warm invocations plus separate cold-start trials. Test one,
two and three displays; many windows and pages; search; rapid Escape/reopen;
focus changes; renderer crashes; and dock unplug/replug. Measure time to first
feedback separately from time to correct usable choices. Compare idle CPU and
memory as well as latency. Keep the existing navigation and renderer regressions.

Temporary raw results and harnesses for this profiling session are under /tmp:
profile-prefix.js, profile-renderer.py, profile-query-options.py, profile-slim.py,
prefix-query-profile.json, prefix-render-profile.json, prefix-update-profile.json.
The captured payload is mode 0600 and remains outside the repository because it
contains window titles. Production binaries and configuration were not replaced.
