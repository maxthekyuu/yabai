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

## Implemented optimizations and follow-up measurements

All five priorities above are implemented in the normal chooser path:

- Resident Cocoa renderer, parent-lifetime and config-reload cleanup, hidden panel reuse.
- A framework-free C client and private Unix socket; bounded messages/timeouts,
  same-user validation, revisions and coalesced updates.
- Event-triggered background preparation, cached first display, fresh-query
  validation of buffered selection keys, immediate invalidation on topology changes.
- One minimal all-Spaces query followed by concurrent minimal queries for visible
  Spaces. Window `space` is omitted because the containing Space is already known.
- Cached fonts, regexes, attributed overlay labels and hint views; equal prepared
  payloads bypass reconstruction entirely.

The normal prefix binding still belongs to Phoenix. Search and configuration
keep their separate process lifecycle. No yabai daemon replacement was needed.

### Results

A repeatable synthetic native fixture has eight keys, four overlay centers and
roughly the same menu size as the original test. It exercises real native socket
requests, drawing and acknowledgments with off-screen panels.

| Component | Samples | Median ms | p95 ms |
|---|---:|---:|---:|
| Cached show, including C client launch and acknowledgment | 100 | 7.22 | 9.84 |
| Changed-content update, including client and acknowledgment | 100 | 7.38 | 10.84 |
| Changed-content render handler only | 100 | 0.38 | 1.10 |
| New JS live data preparation (12 keys, 2 visible Spaces) | 25 | 21.27 | 33.44 |
| Old JS replay on comparable live setup (12 keys, same visible Spaces) | 25 | 58.99 | 90.78 |

Focus changed between live batches, so these are not perfectly paired trials.
An earlier new-path batch on eight keys measured 25.5 ms before removing the
redundant window-Space property. The opening-cache path no longer waits for this
query work; buffered selection actions do. The first prepare on the synthetic server took
98 ms, now paid when prewarming rather than on every prefix invocation.

A separate live-payload native run measured 7.12 ms median / 10.01 ms p95 for
cached show, and 8.37 / 21.45 ms for changed updates. Its maximum changed update
was 112 ms, so occasional system scheduling outliers remain. Do not interpret
medians as hard latency guarantees.

After 100 show/hide cycles and 100 updates, the synthetic renderer used 49,952 KB
RSS. CPU time and RSS remained unchanged across a two-second hidden idle check.
The installed renderer was approximately 53 MB while hidden. This is a short
idle observation, not a long-duration leak or energy test.

Run `python3 tests/profile-prefix.py` after building both helpers to reproduce
native lifecycle timings and direct-socket versus CLI yabai measurements. It
uses off-screen synthetic labels and prints no user window titles. The JS query
harness for this session remains `/tmp/profile-prefix.js`; its private payload
and timing JSON files remain outside the repository.

### Yabai's remaining contribution

Direct socket measurements omit CLI spawning but include daemon queueing, macOS
calls, serialization and socket transfer. They do not isolate pure daemon CPU.
Twenty-five samples per operation, on two visible Spaces:

| Query | Direct socket median ms | CLI median ms |
|---|---:|---:|
| All Spaces, full fields | 11.13 | 22.19 |
| All Spaces, minimal chooser fields | 7.06 | 10.83 |
| All windows, full fields | 28.21 | 38.97 |
| Visible Space 1 windows, including Space field | 6.62 | 17.43 |
| Visible Space 15 windows, including Space field | 5.93 | 10.95 |

A separate 40-sample field-level experiment found:

- Spaces `id`: 0.37 ms; `id,frames`: 0.41 ms. Frame serialization is not a bottleneck.
- Spaces `id,index`: 1.78 ms. Index lookup repeatedly calls
  `SLSCopyManagedDisplaySpaces` through `space_manager_mission_control_index`.
- Focused-Space windows `id`: 0.54 ms; `id,title`: 0.56 ms. Titles are already cached
  in this branch (`window_title_ts`); title serialization is not an AX round-trip.
- Windows `id,space`: 2.86 ms. `window_space` calls `SLSCopySpacesForWindows`, with
  further work to translate Space identity to index. This prompted removing that
  unused field from the normal chooser query.

The next daemon optimization, if needed, should reuse one topology/index map per
query and avoid repeating WindowServer lookups. A compact snapshot/subscription
API could reduce both query count and redundant work. Rewriting ratpoison tree
serialization is not justified by these measurements.

### Reassessment of native keyboard capture

A resident UI owning Cmd-S could remove the approximately 7 ms helper path plus
Phoenix scheduling overhead. It would not remove the remaining data-validation
queries. With warm native show p95 below 10 ms, migration is no longer the first
performance priority on the measured components.

Keep Phoenix for now and use opt-in real-prefix timestamps (`profileLatency`)
to distinguish its callback/Task scheduling from native acknowledgment. If real
warm opens still miss the 50 ms target, capture physical key-to-presentation
latency and consider moving only the ratpoison bindings into the UI. The current
benchmarks do not include actual key dispatch or physical screen presentation,
so the end-to-end target has not yet been proven.

Validation: Phoenix navigation/stack/search/move regressions, cache/stale-binding/
topology tests, 16 native renderer/socket tests, and 9 configuration tests passed.
Dock reconnect with actual hardware and high-speed key-to-screen capture were
not performed. Changes are installed locally; nothing has been pushed.

## Request-local topology reuse

The follow-up daemon change reuses the result of `SLSCopyManagedDisplaySpaces`
within a single `query` request. Eight existing call sites in display enumeration
and Space selectors use a small internal wrapper. Copy/retain ownership remains
unchanged for callers. The cache is lazy and thread-local, supports nested scopes,
and is released after the query, including early parser returns. A failed fetch
is remembered only for that request. Commands and event handlers outside queries
still fetch fresh topology. There is no cross-request cache to invalidate after
display disconnects, and no public command, field or selector was changed.

Tests cover one fetch per scope, retained references, nested scopes, failed
fetches, topology changes between requests, uncached non-query access, existing
Space-selector numbering/order, and early parser exits. All 21 core tests pass.
The universal release was signed with the existing certificate and installed;
Accessibility permission was retained and six saved ratpoison layouts restored.

Sixty live direct-socket samples per query before and after installation:

| Query | Before median / p95 ms | After median / p95 ms |
|---|---:|---:|
| Space IDs and indices | 2.226 / 5.558 | 0.400 / 0.628 |
| Minimal chooser Space data | 3.060 / 10.161 | 1.119 / 3.310 |
| Full Space data | 3.662 / 9.109 | 1.910 / 2.490 |
| Full window data | 10.716 / 18.421 | 5.725 / 6.684 |

These are separate live batches around a daemon restart, not controlled paired
microbenchmarks. They exclude CLI process startup and UI rendering. Raw results
are `/tmp/topology-before.json` and `/tmp/topology-after.json`; the harness is
`/tmp/profile-topology.py`. This optimization is isolated from the UI changes to
keep future upstream merges straightforward.

### Compact menu snapshot: proposed next step, not implemented

An additive query could return, in one response, the focused Space/window,
visible displays and Spaces, ratpoison frames and stack membership, and the
minimal window metadata needed by the normal chooser. Phoenix would still assign
shortcut keys and render the menu. Hidden-Space search could keep its existing
separate query.

The benefit would be replacing one Space request plus a window request per
visible Space (and sometimes a display request) with a single CLI launch/socket
round trip. Collection would run in one daemon event-loop handler using one
request-local topology snapshot. This gives a more coherent in-memory result;
it would not make macOS window state atomic against external changes.

It should remain an optional new query, with existing query commands and JSON
schemas preserved. No implementation or latency claim is made for this proposal.
Measure the remaining process/IPC overhead before deciding whether the additional
API surface is worthwhile.
