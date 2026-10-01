/* Super-S (Command-S) prefix. Load through ~/.phoenix.js. The running yabai
 * daemon must support ratpoison frames. Release Command before the next key. */
var yabaiRatpoison = (function () {
    var theme = typeof yabaiRatpoisonConfig === 'object' && yabaiRatpoisonConfig ? yabaiRatpoisonConfig : {};
    var executable = '/opt/homebrew/bin/yabai';
    var renderer = '/Users/jkuhn/Software/yabai/bin/yabai-prefix';
    var settingsBackend = '/Users/jkuhn/Software/yabai/scripts/ratpoison-config.py';
    var themeRevision = 0;
    var baseTheme = theme;
    var savedTheme = {};
    var configTask = null;

    function mergeTheme() {
        theme = Object.assign({}, baseTheme, savedTheme, { colors: Object.assign({}, baseTheme.colors || {}, savedTheme.colors || {}) });
    }
    // r/f/b select layouts; h/j/k/l navigate. Numbers select stable local windows.
    var alphabet = '0123456789acdegimnopqstuvwxyz';
    var keys = [];
    var windowNumbers = {};
    var shortcutSlots = {};
    var transitionTimer = null;
    var modal = null;
    var rendererTask = null;
    var rendererGeneration = 0;
    var rendererSession = null;
    var active = false;
    var searching = false;
    var generation = 0;
    var queuedDirection = null;

    function clearKeys() {
        keys.forEach(function (key) { Key.off(key); });
        keys = [];
    }

    function cancel() {
        active = false;
        searching = false;
        queuedDirection = null;
        generation += 1;
        clearKeys();
        if (transitionTimer !== null) Timer.off(transitionTimer);
        transitionTimer = null;
        closeMenu();
    }

    function closeMenu() {
        rendererGeneration += 1;
        if (rendererTask !== null) Task.terminate(rendererTask);
        rendererTask = null;
        rendererSession = null;
        if (modal) modal.close();
        modal = null;
    }

    function show(text, duration, groups, badges, search, onSelect, selections) {
        var payload = JSON.stringify({ text: text, groups: groups || [], badges: badges || [], search: search || undefined, selections: selections || [], theme: theme, screen: Screen.main().visibleFrame() });
        if (rendererTask !== null && rendererSession !== null && !search && !duration) {
            var updateGeneration = rendererGeneration;
            Task.run('/usr/bin/env', [renderer, '--update', rendererSession, payload], function (task) {
                if (task.status !== 0 && rendererGeneration === updateGeneration) {
                    closeMenu();
                    show(text, duration, groups, badges, search, onSelect, selections);
                }
            });
            return;
        }
        closeMenu();
        var current = rendererGeneration;
        rendererSession = search || duration ? null : String(Date.now()) + '-' + String(Math.random()).slice(2);
        var rendererArgs = rendererSession ? [renderer, '--session', rendererSession, payload] : [renderer, payload];
        // env execs the helper without a shell. A missing helper then produces
        // exit 127 and a callback; Phoenix otherwise only logs launch failures.
        rendererTask = Task.run('/usr/bin/env', rendererArgs, function (task) {
            if (current !== rendererGeneration) return;
            rendererTask = null;
            if (task.status === 0) {
                if (onSelect && active && task.output) {
                    var result;
                    try { result = JSON.parse(task.output); } catch (_) {}
                    if (result && Number.isInteger(result.selection) && result.selection >= 0 && result.selection < search.length) {
                        searching = false;
                        onSelect(result.selection); return;
                    }
                }
                cancel(); return;
            }
            // Report a missing renderer/font through Phoenix rather than
            // leaving invisible bindings enabled. This is an error fallback.
            cancel();
            modal = new Modal();
            modal.font = theme.font || 'GoMono Nerd Font Mono';
            modal.weight = theme.fontSize || 12;
            modal.appearance = 'dark';
            var errorColor = theme.colors && theme.colors.error;
            var rgb = /^#[0-9a-f]{6}$/i.test(errorColor || '') ? parseInt(errorColor.slice(1), 16) : 0xff5555;
            modal.setTextColor((rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255, 1);
            modal.text = 'Prefix renderer: ' + clean(task.error || 'build bin/yabai-prefix and check its path').slice(0, 100);
            modal.duration = 3;
            modal.show();
        });
        if (duration) {
            var errorGeneration = rendererGeneration;
            Timer.after(duration, function () { if (rendererGeneration === errorGeneration) closeMenu(); });
        }
    }

    function error(message) {
        cancel();
        show('yabai: ' + clean(message).slice(0, 100), 3);
    }

    function run(args, callback) {
        var identifier = Task.run(executable, ['-m'].concat(args), function (task) {
            if (callback) callback(task);
            else if (task.status !== 0) error(task.error || task.output || 'command failed');
        });
        if (!identifier) error('could not launch ' + executable);
    }

    function command(args) {
        cancel();
        run(args);
    }

    // Keep the chooser visible while navigating/splitting so empty-frame
    // selection is visible and several moves can follow a single prefix.
    function update(args, complete) {
        var current = ++generation;
        clearKeys();
        bind('escape', [], cancel);
        run(args, function (task) {
            if (!active || generation !== current) return;
            if (task.status !== 0) { error(task.error || task.output || 'command failed'); return; }
            if (complete) complete(); else load('windows');
        });
    }

    function bind(key, modifiers, callback) {
        keys.push(Key.on(key, modifiers, function (_, repeated) {
            if (active && !repeated) {
                callback();
            }
        }));
    }

    function setLayout(space, layout) {
        // Choosing the current mode must not destroy an existing frame tree.
        if (space && space.type === layout) { cancel(); return; }
        command(['space'].concat(space ? [String(space.index)] : []).concat(['--layout', layout]));
    }

    function floatingNeighbour(windows, direction) {
        var source = windows.filter(function (window) { return window['has-focus']; })[0];
        if (!source || !source.frame) return null;
        var horizontal = direction === 'west' || direction === 'east';
        var sign = direction === 'west' || direction === 'north' ? -1 : 1;
        var a = source.frame;
        var best = null, score = Infinity;
        windows.forEach(function (window) {
            if (window.id === source.id || window['is-minimized'] || window['is-hidden'] || !window.frame) return;
            var b = window.frame;
            var dx = b.x + b.w / 2 - a.x - a.w / 2;
            var dy = b.y + b.h / 2 - a.y - a.h / 2;
            if ((horizontal ? dx : dy) * sign <= 0) return;
            var distance = dx * dx + dy * dy;
            if (distance < score) { best = window; score = distance; }
        });
        return best;
    }

    function navigate(space, windows, direction) {
        if (space.type === 'ratpoison') {
            update(['space', String(space.index), '--focus-frame', direction]);
        } else if (space.type === 'float') {
            var target = floatingNeighbour(windows, direction);
            if (!target) return false;
            update(['window', '--focus', String(target.id)]);
        } else {
            update(['window', '--focus', direction]);
        }
        return true;
    }

    function resizeMenu(space) {
        clearKeys();
        bind('escape', [], function () { load('windows'); });
        [['h', 'left', 'horizontal:-40'], ['l', 'right', 'horizontal:40'],
         ['k', 'up', 'vertical:-40'], ['j', 'down', 'vertical:40']].forEach(function (entry) {
            function resize() { update(['space', String(space.index), '--resize-frame', entry[2]], function () { resizeMenu(space); }); }
            bind(entry[0], [], resize); bind(entry[1], [], resize);
        });
        show('Resize frame\nh/l or left/right: width -/+40\nk/j or up/down: height -/+40\nEsc back to chooser');
    }

    function cycleStack(space, direction) {
        var frame = (space.frames || []).filter(function (frame) { return frame.selected; })[0];
        if (!frame || frame.windows.length < 2) return;
        var index = Math.max(0, frame.windows.indexOf(frame['active-window']));
        var target = frame.windows[(index + direction + frame.windows.length) % frame.windows.length];
        update(['window', '--focus', String(target)]);
    }

    function configurationMenu() {
        cancel();
        if (configTask !== null) return;
        configTask = Task.run('/usr/bin/env', [renderer, '--configure', settingsBackend], function (task) {
            configTask = null;
            if (task.status !== 0) { error(task.error || 'configuration menu failed'); return; }
            var result;
            try { result = JSON.parse(task.output); } catch (_) {}
            if (result && result.theme && typeof result.theme === 'object') {
                savedTheme = result.theme;
                mergeTheme();
                ++themeRevision;
            }
        });
    }

    function controls(space, windows) {
        bind('escape', [], cancel);
        bind('c', ['shift'], configurationMenu);
        ['ratpoison', 'float', 'bsp'].forEach(function (layout, index) {
            bind(['r', 'f', 'b'][index], [], function () { setLayout(space, layout); });
        });
        [['left', 'h', 'west'], ['down', 'j', 'south'], ['up', 'k', 'north'], ['right', 'l', 'east']].forEach(function (entry) {
            function move() {
                if (space) navigate(space, windows, entry[2]);
                else queuedDirection = entry[2];
            }
            bind(entry[0], [], move);
            bind(entry[1], [], move);
        });
        if (!space) return;
        bind('t', ['shift'], function () {
            setLayout(space, space.type === 'ratpoison' ? 'float' : 'ratpoison');
        });
        bind('m', ['shift'], function () { load('move'); });
        bind('d', ['shift'], function () { load('displays'); });
        bind('u', ['shift'], function () { load('spaces'); });
        bind('f', ['shift'], function () { load('frames'); });
        bind('z', ['shift'], function () {
            // Keep the frame tree intact: yabai saves/restores this window's
            // rectangle without floating it or entering a native fullscreen Space.
            var focused = windows.filter(function (window) { return window['has-focus']; })[0];
            if (space.type === 'ratpoison') {
                var selected = (space.frames || []).filter(function (frame) { return frame.selected; })[0];
                if (!selected || !selected.windows.length) return;
                focused = { id: selected['active-window'] };
            }
            if (focused && focused.id) command(['window', String(focused.id), '--toggle', 'windowed-fullscreen']);
        });
        if (space.type !== 'ratpoison') return;
        var args = ['space', String(space.index)];
        [['h', 'horizontal:-40'], ['l', 'horizontal:40']].forEach(function (entry) {
            bind(entry[0], ['shift'], function () { update(args.concat(['--resize-frame', entry[1]])); });
        });
        bind('e', ['shift'], function () {
            clearKeys();
            bind('escape', [], function () { load('windows'); });
            [['h', 'horizontal'], ['v', 'vertical'], ['b', 'both']].forEach(function (entry) {
                bind(entry[0], [], function () { update(args.concat(['--equalize-frames', entry[1]])); });
            });
            [['1', '1:2'], ['2', '1:1'], ['3', '2:1']].forEach(function (entry) {
                bind(entry[0], [], function () { update(args.concat(['--frame-ratio', 'horizontal:' + entry[1]])); });
            });
            show('Frame sizes\nh equal widths   v equal heights   b both\nLeft:right widths:  1 = 1:2   2 = 1:1   3 = 2:1\nEsc back');
        });
        bind('s', ['shift'], function () { update(args.concat(['--split', 'horizontal'])); });
        bind('v', ['shift'], function () { update(args.concat(['--split', 'vertical'])); });
        bind('r', ['shift'], function () { resizeMenu(space); });
        bind('w', ['shift'], function () { update(args.concat(['--remove-frame'])); });
        bind('j', ['shift'], function () { cycleStack(space, 1); });
        bind('k', ['shift'], function () { cycleStack(space, -1); });
        bind('o', ['shift'], function () { update(args.concat(['--only-frame'])); });
        bind('tab', [], function () { update(args.concat(['--focus-frame', 'next'])); });
        bind('tab', ['shift'], function () { update(args.concat(['--focus-frame', 'prev'])); });
    }

    function clean(text) {
        return String(text || '').replace(/[\x00-\x1f\x7f]/g, ' ');
    }

    function clip(text, width) {
        var chars = Array.from(clean(text));
        return chars.length <= width ? chars.join('') : chars.slice(0, Math.max(0, width - 1)).join('') + '…';
    }

    // Frame queries expose geometry directly; window/display queries nest it.
    function frameRect(frame) {
        return { x: frame.x, y: frame.y, w: frame.w, h: frame.h };
    }

    function searchWindows(choose, currentSpace) {
        searching = true;
        var current = ++generation;
        clearKeys();
        bind('escape', [], cancel);
        // Snapshot every Space and window once. Typing never re-queries yabai.
        run(['query', '--spaces'], function (spaceTask) {
            if (!active || generation !== current) return;
            var spaces;
            try { spaces = JSON.parse(spaceTask.output); } catch (_) {}
            if (spaceTask.status !== 0 || !Array.isArray(spaces)) { error('search Space query failed'); return; }
            run(['query', '--windows'], function (windowTask) {
                if (!active || generation !== current) return;
                var windows;
                try { windows = JSON.parse(windowTask.output); } catch (_) {}
                if (windowTask.status !== 0 || !Array.isArray(windows)) { error('search window query failed'); return; }
                var results = [], numbersBySpace = {};
                spaces.forEach(function (space) {
                    numbersBySpace[space.id] = numberWindows(space, windows.filter(function (window) { return window.space === space.index; }));
                });
                windows.forEach(function (window) {
                    var space = spaces.filter(function (item) { return item.index === window.space; })[0];
                    if (!space) return;
                    var text = clean(window.app + ': ' + window.title);
                    var owner = (space.frames || []).filter(function (frame) { return frame.windows.indexOf(window.id) !== -1; })[0];
                    var rect = space['is-visible'] && !window['is-minimized'] && !window['is-hidden']
                             ? (owner ? frameRect(owner) : window.frame) : undefined;
                    results.push({ window: window.id, space: space, rect: rect, text: text, pid: window.pid,
                        minimized: window['is-minimized'], hidden: window['is-hidden'], searchable: true,
                        label: 'S' + space.index + ' (' + space.display + ') W' + numbersBySpace[space.id][window.id] + ' ' + text +
                               (window['is-minimized'] ? ' [minimized]' : window['is-hidden'] ? ' [hidden]' : '') });
                });
                var search = results.map(function (entry, index) {
                    return { index: index, label: entry.label, text: entry.text, display: entry.space.display,
                             rect: entry.rect, pid: entry.pid, hidden: entry.hidden };
                });
                show('Window search', null, [], [], search, function (index) {
                    var entry = results[index];
                    if (entry.space.id === currentSpace.id && !entry.minimized && !entry.hidden) choose(entry);
                    else visit(entry, null);
                });
            });
        });
    }

    function spaceIdentity(space) { return space.uuid || String(space.id); }

    // Number windows within a Space without renumbering survivors on focus,
    // stacking, closing or opening another window. Only absent windows free a number.
    function numberWindows(space, windows) {
        var identity = spaceIdentity(space);
        var numbers = windowNumbers[identity] || (windowNumbers[identity] = {});
        var live = {};
        windows.forEach(function (window) { live[window.id] = true; });
        (space.type === 'ratpoison' ? space.frames || [] : []).forEach(function (frame) {
            frame.windows.forEach(function (id) { live[id] = true; });
        });
        Object.keys(numbers).forEach(function (id) { if (!live[id]) delete numbers[id]; });
        Object.keys(live).sort(function (a, b) { return Number(a) - Number(b); }).forEach(function (id) {
            if (numbers[id] !== undefined) return;
            var used = Object.keys(numbers).map(function (key) { return numbers[key]; });
            var number = 0;
            while (used.indexOf(number) !== -1) ++number;
            numbers[id] = number;
        });
        return numbers;
    }

    // A shortcut's bank and key remain fixed while its target exists. Distinct
    // Spaces share this namespace so visible displays never have ambiguous keys.
    function stableShortcuts(entries, spaces, focusedSpace) {
        var scope = spaceIdentity(focusedSpace);
        var slots = shortcutSlots[scope] || (shortcutSlots[scope] = {});
        var observed = {}, live = {};
        spaces.forEach(function (space) { observed[spaceIdentity(space)] = true; });
        entries.forEach(function (entry) {
            entry.identity = spaceIdentity(entry.space) + ':' +
                (entry.window !== undefined ? 'w' + entry.window : entry.frame !== undefined ? 'f' + entry.frame : 'container');
            live[entry.identity] = true;
        });
        Object.keys(slots).forEach(function (id) {
            var match = id.match(/:w(\d+)$/);
            var numbers = windowNumbers[slots[id].space] || {};
            // Minimized/hidden windows keep aliases even when omitted from
            // the visible chooser. Only their complete Space query frees them.
            if (observed[slots[id].space] && !live[id] && (!match || numbers[match[1]] === undefined)) delete slots[id];
        });
        entries.forEach(function (entry) {
            if (entry.space.id === focusedSpace.id && entry.number !== undefined) {
                // Ten local window numbers per bank; letters remain available
                // for other visible Spaces and empty frames on every bank.
                slots[entry.identity] = { space: spaceIdentity(entry.space),
                    slot: Math.floor(entry.number / 10) * alphabet.length + entry.number % 10 };
            } else if (!slots[entry.identity]) {
                var used = Object.keys(slots).map(function (id) { return slots[id].slot; });
                var slot = 10;
                while (slot % alphabet.length < 10 || used.indexOf(slot) !== -1) ++slot;
                slots[entry.identity] = { space: spaceIdentity(entry.space), slot: slot };
            }
            entry.shortcut = slots[entry.identity].slot;
        });
        entries.sort(function (a, b) { return a.shortcut - b.shortcut; });
    }

    function choices(entries, title, space, windows, choose, page) {
        clearKeys();
        controls(space, windows);
        var screen = Screen.main().visibleFrame();
        var columns = screen.width >= 1100 ? 2 : 1;
        // Allow the panel to grow to 90% of the usable height. Reserve text
        // rows for headings, controls and a permanent pagination status line.
        var chromeRows = space.type === 'ratpoison' ? 10 : 7;
        var fontSize = Number(theme.fontSize) || 12;
        var rowHeight = Math.ceil(fontSize * 1.5);
        var cellWidth = fontSize * 2 / 3;
        var lineBudget = Math.floor((Math.min(screen.height * 0.9, screen.height - 32) - 28) / rowHeight);
        var rows = Math.max(1, lineBudget - chromeRows - 2);
        var columnWidth = Math.max(12, Math.min(66, Math.floor((screen.width - 132) / (columns * cellWidth)) - 3));
        var width = columns * (columnWidth + 3) + 1;
        var displays = {};
        entries.forEach(function (entry) {
            var display = entry.space ? entry.space.display : space.display;
            (displays[display] || (displays[display] = [])).push(entry);
        });
        var pages = [];
        // Partition fixed shortcut banks before applying the screen-size pagination.
        var banks = {};
        entries.forEach(function (entry) {
            var bank = entry.shortcut === undefined ? 0 : Math.floor(entry.shortcut / alphabet.length);
            (banks[bank] || (banks[bank] = [])).push(entry);
        });
        var displayIds = Object.keys(displays).sort(function (a, b) { return Number(a) - Number(b); });
        Object.keys(banks).sort(function (a, b) { return Number(a) - Number(b); }).forEach(function (bank) {
        var bankDisplays = {};
        banks[bank].forEach(function (entry) {
            var display = entry.space ? entry.space.display : space.display;
            (bankDisplays[display] || (bankDisplays[display] = [])).push(entry);
        });
        var offsets = {};
        displayIds.forEach(function (display) { offsets[display] = 0; });
        var remaining = displayIds.filter(function (display) { return bankDisplays[display]; });
        while (remaining.length) {
            var chunks = [], used = 0, count = 0;
            remaining.forEach(function (display, index) {
                var available = rows + 2 - used;
                if (available < 3 || count === alphabet.length) return;
                // Reserve a heading, one content row and a bottom border for
                // other displays before filling this display's remaining rows.
                var otherGroups = Math.min(remaining.length - index - 1, Math.floor(available / 3) - 1, alphabet.length - count - 1);
                var reserve = otherGroups * 3;
                var capacity = (available - reserve - 2) * columns;
                var offset = offsets[display], items = bankDisplays[display];
                var take = Math.min(items.length - offset, capacity, alphabet.length - count - otherGroups);
                chunks.push({ display: Number(display), continued: offset > 0 || Number(bank) > 0, entries: items.slice(offset, offset + take) });
                used += Math.ceil(take / columns) + 2;
                count += take; offsets[display] += take;
            });
            pages.push(chunks);
            remaining = remaining.filter(function (display) { return offsets[display] < bankDisplays[display].length; });
        }
        });
        if (!pages.length) pages.push([]);
        page = (page + pages.length) % pages.length;
        var lines = [clip('YABAI  ' + space.type + '  |  ' + title + '  |  ' + (page + 1) + '/' + pages.length, width),
                     clip('r ratpoison   f floating   b bsp   Shift-T toggle', width), ''];
        var groups = [], badges = [], selections = [], hint = 0;
        pages[page].forEach(function (group) {
            var start = lines.length;
            var heading = ' Display ' + group.display + (group.continued ? ' (continued)' : '') + ' ';
            lines.push('┌' + heading + '─'.repeat(Math.max(0, width - heading.length - 2)) + '┐');
            var cells = group.entries.map(function (entry) {
                var key = alphabet[entry.shortcut === undefined ? hint : entry.shortcut % alphabet.length];
                ++hint;
                bind(key, [], function () { choose(entry); });
                if (entry.rect && (!entry.space || entry.space.id === space.id || entry.space['is-visible'])) {
                    badges.push({ key: key, rect: entry.rect, display: group.display });
                }
                return clip((entry.selected ? '> ' : '  ') + key + ' ' + entry.label, columnWidth);
            });
            var usedRows = Math.ceil(cells.length / columns);
            for (var row = 0; row < usedRows; ++row) {
                var line = cells[row];
                if (cells[row + usedRows]) line = line.padEnd(columnWidth + 3, ' ') + cells[row + usedRows];
                if (group.entries[row].selected) selections.push({ line: lines.length, start: 2, length: cells[row].length });
                if (group.entries[row + usedRows] && group.entries[row + usedRows].selected)
                    selections.push({ line: lines.length, start: 2 + columnWidth + 3, length: cells[row + usedRows].length });
                lines.push('│ ' + line.padEnd(width - 4, ' ') + ' │');
            }
            lines.push('└' + '─'.repeat(width - 2) + '┘');
            groups.push({ start: start, end: lines.length - 1, display: group.display });
        });
        if (!hint) lines.push('(no choices)');
        lines.push('Page ' + (page + 1) + '/' + pages.length + ' | ' + hint + '/' + entries.length +
                   ' choices | ' + pages[page].length + '/' + displayIds.length + ' displays');
        lines.push('', '[ / PgUp prev   ] / PgDn / Space next   / search   Esc close', 'hjkl/arrows focus  Shift-F frames  Shift-M move  Shift-C config');
        if (space.type === 'ratpoison') {
            lines.push('Shift-S/V split   Shift-F frames', 'Shift-W remove    Shift-O only     Shift-Z fullscreen',
                       'Shift-R resize   Shift-J/K stack   Shift-E sizes   Shift-C config');
        }
        function previousPage() { choices(entries, title, space, windows, choose, page - 1); }
        function nextPage() { choices(entries, title, space, windows, choose, page + 1); }
        bind('[', [], previousPage);
        bind(']', [], nextPage);
        bind('pageUp', [], previousPage);
        bind('pageDown', [], nextPage);
        bind('space', [], nextPage);
        bind('space', ['shift'], previousPage);
        if (title === 'visible windows / frames') bind('/', [], function () { searchWindows(choose, space); });
        show(lines.map(function (line) { return clip(line, width); }).join('\n'), null, groups, badges, null, null, selections);
    }

    // A display is a container whose destination is its currently visible Space.
    // Neither the source nor destination needs to use ratpoison.
    function destinations(mode, space, windows, current) {
        var source = windows.filter(function (window) { return window['has-focus']; })[0];
        if (mode === 'move' && !source) { error('no focused window to move'); return; }
        run(['query', '--displays'], function (displayTask) {
            if (!active || generation !== current) return;
            var displays;
            try { displays = JSON.parse(displayTask.output); } catch (_) {}
            if (displayTask.status !== 0 || !Array.isArray(displays)) { error('display query failed'); return; }
            run(['query', '--spaces'], function (spaceTask) {
                if (!active || generation !== current) return;
                var spaces;
                try { spaces = JSON.parse(spaceTask.output); } catch (_) {}
                if (spaceTask.status !== 0 || !Array.isArray(spaces)) { error('Space query failed'); return; }
                var entries = [];
                if (mode === 'move' && space.type === 'ratpoison') {
                    (space.frames || []).forEach(function (frame) {
                        entries.push({ frame: frame.id, space: space, rect: frameRect(frame), label: 'S' + space.index + ' (' + space.display + ') ' + (frame.selected ? '*' : ' ') + ' F' + frame.id +
                            (frame.windows.length ? ' [' + frame.windows.length + ' windows]' : ' [empty]') });
                    });
                }
                displays.sort(function (a, b) { return a.index - b.index; }).forEach(function (display) {
                    var desktops = spaces.filter(function (item) { return item.display === display.index; });
                    var visible = desktops.filter(function (item) { return item['is-visible']; })[0];
                    if (mode === 'move') {
                        desktops.filter(function (item) {
                            return item.id !== space.id && item['is-visible'] && item.type === 'ratpoison';
                        }).forEach(function (item) {
                            // Empty destinations come first so a full source display
                            // cannot bury the most useful remote targets on later pages.
                            (item.frames || []).slice().sort(function (a, b) {
                                return Number(a.windows.length > 0) - Number(b.windows.length > 0);
                            }).forEach(function (frame) {
                                entries.push({ frame: frame.id, space: item, visibleOnly: true, rect: frameRect(frame),
                                    label: 'S' + item.index + ' (' + item.display + ') F' + frame.id +
                                        (frame.windows.length ? ' [' + frame.windows.length + ' windows]' : ' [empty]') });
                            });
                        });
                    }
                    if (mode !== 'spaces' && visible && !visible['is-native-fullscreen']) {
                        entries.push({ display: display.index, displayId: display.id, space: visible, rect: display.frame,
                            label: (display['has-focus'] ? '*' : ' ') + ' S' + visible.index + ' (' + display.index + ')' +
                                (display.label ? ' ' + clean(display.label) : '') + ' [' + visible.type + ']' });
                    }
                    if (mode !== 'displays') {
                        desktops.filter(function (item) { return !item['is-native-fullscreen']; })
                            .sort(function (a, b) { return a.index - b.index; }).forEach(function (item) {
                                entries.push({ space: item, rect: item['is-visible'] ? display.frame : null, label: (item['has-focus'] ? '*' : ' ') +
                                    ' S' + item.index + ' (' + display.index + ')' +
                                    (item.label ? ' ' + clean(item.label) : '') + ' [' + item.type + ']' });
                            });
                    }
                });
                choices(entries, mode === 'move' ? 'move + follow' : 'focus ' + mode, space, windows, function (entry) {
                    if (entry.frame !== undefined && entry.space.id === space.id) {
                        update(['window', String(source.id), '--frame', String(entry.frame)]);
                    } else {
                        visit(entry, mode === 'move' ? source : null);
                    }
                }, 0);
            });
        });
    }

    function visit(entry, source) {
        var current = ++generation;
        clearKeys();
        bind('escape', [], cancel);
        show(source ? 'Moving window and following…  |  Esc close' : 'Changing container…  |  Esc close');
        function valid() { return active && generation === current; }
        function request(args, callback) {
            run(args, function (task) {
                if (!valid()) return;
                if (task.status !== 0) { error(task.error || task.output || 'command failed'); return; }
                callback(task);
            });
        }
        // WindowServer moves and gesture-based Space switches are asynchronous.
        // Verify completion before focusing or exposing destination layout keys.
        function waitFor(args, matches, done, attempts) {
            request(args, function (task) {
                var value;
                try { value = JSON.parse(task.output); } catch (_) { error('invalid destination query response'); return; }
                if (matches(value)) { done(value); return; }
                if (attempts <= 1) { error('destination did not become available; check the window and Space'); return; }
                transitionTimer = Timer.after(0.1, function () {
                    transitionTimer = null;
                    if (valid()) waitFor(args, matches, done, attempts - 1);
                });
            });
        }
        // Resolve Space ids again, because Mission Control indices can change
        // while the chooser is open. Displays resolve their visible Space anew.
        function resolveSpace() {
            request(['query', '--spaces'], function (task) {
                var spaces;
                try { spaces = JSON.parse(task.output); } catch (_) {}
                if (!Array.isArray(spaces)) { error('invalid Space list'); return; }
                var target = spaces.filter(function (item) {
                    return entry.display !== undefined ? item.display === entry.display && item['is-visible']
                                                       : item.id === entry.space.id;
                })[0];
                if (!target || (entry.visibleOnly && !target['is-visible']) ||
                    (target['is-native-fullscreen'] && !entry.visibleOnly && !entry.searchable)) { error('destination is no longer available'); return; }
                if (entry.frame !== undefined) {
                    var targetFrame = target.type === 'ratpoison' && (target.frames || []).filter(function (frame) { return frame.id === entry.frame; })[0];
                    if (!targetFrame || (source && targetFrame.windows.length >= 32 && targetFrame.windows.indexOf(source.id) === -1)) {
                        error('destination frame is gone or full'); return;
                    }
                }
                function focusWindow() {
                    if (source) request(['window', '--focus', String(source.id)], function () { load('windows'); });
                    else if (entry.window !== undefined) {
                        request(['query', '--windows', '--window', String(entry.window)], function (task) {
                            var window;
                            try { window = JSON.parse(task.output); } catch (_) {}
                            if (!window || window.space !== target.index) { error('window is no longer in that container'); return; }
                            function selectWindow() {
                                request(['window', '--focus', String(entry.window)], function () { load('windows'); });
                            }
                            // Select its existing frame first: remote selection must
                            // not recall a covered window into a different empty frame.
                            var owner = target.type === 'ratpoison' && (target.frames || []).filter(function (frame) {
                                return frame.windows.indexOf(entry.window) !== -1;
                            })[0];
                            function restoreFocus() {
                                if (owner) request(['space', String(target.index), '--focus-frame', String(owner.id)], selectWindow);
                                else selectWindow();
                            }
                            if (window['is-minimized']) {
                                request(['window', '--deminimize', String(entry.window)], function () {
                                    waitFor(['query', '--windows', '--window', String(entry.window)], function (item) {
                                        return item && !item['is-minimized'];
                                    }, restoreFocus, 30);
                                });
                            } else restoreFocus();
                        });
                    } else if (entry.frame !== undefined) {
                        request(['space', String(target.index), '--focus-frame', String(entry.frame)], function () { load('windows'); });
                    } else load('windows');
                }
                var arrival = focusWindow;
                function focusSpace() {
                    request(['query', '--spaces', '--space'], function (task) {
                        var focused;
                        try { focused = JSON.parse(task.output); } catch (_) { error('invalid focused Space'); return; }
                        if (focused.id === target.id) { arrival(); return; }
                        request(['space', '--focus', String(target.index)], function () {
                            waitFor(['query', '--spaces', '--space'], function (item) { return item && item.id === target.id; }, arrival, 30);
                        });
                    });
                }
                if (!source) { focusSpace(); return; }
                if (entry.frame !== undefined) {
                    // Choose the destination frame before transferring, so tiling
                    // admits the window there even if another frame is full.
                    arrival = function () {
                        request(['space', String(target.index), '--focus-frame', String(entry.frame)], function () {
                            request(['window', String(source.id), '--space', String(target.index)], function () {
                                waitFor(['query', '--windows', '--window', String(source.id)], function (window) {
                                    return window && window.space === target.index;
                                }, function () {
                                    request(['window', String(source.id), '--frame', String(entry.frame)], focusWindow);
                                }, 30);
                            });
                        });
                    };
                    focusSpace(); return;
                }
                request(['window', String(source.id), '--space', String(target.index)], function () {
                    waitFor(['query', '--windows', '--window', String(source.id)], function (window) {
                        return window && window.space === target.index;
                    }, focusSpace, 30);
                });
            });
        }
        if (entry.display === undefined) { resolveSpace(); return; }
        request(['query', '--displays'], function (task) {
            var displays;
            try { displays = JSON.parse(task.output); } catch (_) {}
            var display = Array.isArray(displays) && displays.filter(function (item) { return item.id === entry.displayId; })[0];
            if (!display) { error('display is no longer available'); return; }
            entry.display = display.index;
            resolveSpace();
        });
    }

    function visibleChoices(mode, space, windows, current) {
        run(['query', '--spaces'], function (task) {
            if (!active || generation !== current) return;
            var spaces;
            try { spaces = JSON.parse(task.output); } catch (_) {}
            if (task.status !== 0 || !Array.isArray(spaces)) { error('visible Space query failed'); return; }
            var visible = spaces.filter(function (item) { return item.id !== space.id && item['is-visible']; })
                .sort(function (a, b) { return a.index - b.index; });
            visible.unshift(space);
            var lists = {};
            lists[space.id] = windows;
            var pending = visible.length - 1;
            function render() {
                var entries = [], covered = [];
                visible.forEach(function (item) {
                    var local = item.id === space.id;
                    var prefix = 'S' + item.index + ' (' + item.display + ') ';
                    var numbers = numberWindows(item, lists[item.id]);
                    var byId = {};
                    lists[item.id].forEach(function (window) { byId[window.id] = window; });
                    function name(id) {
                        var window = byId[id];
                        return window ? clean(window.app + ': ' + window.title) : String(id);
                    }
                    function add(entry, background) {
                        entry.space = item;
                        entry.visibleOnly = true;
                        if (entry.window !== undefined) {
                            entry.number = numbers[entry.window];
                            entry.label = 'W' + entry.number + ' ' + entry.label;
                            var owner = (item.frames || []).filter(function (frame) { return frame.windows.indexOf(entry.window) !== -1; })[0];
                            entry.selected = local && (owner ? owner.selected && owner['active-window'] === entry.window : byId[entry.window] && byId[entry.window]['has-focus']);
                        } else if (entry.frame !== undefined) {
                            entry.selected = local && (item.frames || []).some(function (frame) { return frame.id === entry.frame && frame.selected; });
                        }
                        entry.label = prefix + entry.label;
                        (background ? covered : entries).push(entry);
                    }
                    if (item.type === 'ratpoison') {
                        var frames = item.frames;
                        frames.forEach(function (frame) {
                            var label = (local && frame.selected ? '*' : ' ') + ' F' + frame.id;
                            if (mode === 'frames' || !frame.windows.length) {
                                add({ frame: frame.id, rect: frameRect(frame), label: label + (frame.windows.length ? ' ' + name(frame['active-window']) : ' [empty]') });
                            } else {
                                var id = frame['active-window'] || frame.windows[0];
                                add({ window: id, rect: frameRect(frame), label: label + ' ' + name(id) });
                            }
                        });
                        if (mode !== 'frames') frames.forEach(function (frame) {
                            var front = frame['active-window'] || frame.windows[0];
                            frame.windows.forEach(function (id) {
                                if (id !== front) add({ window: id, rect: frameRect(frame), label: '  F' + frame.id + ' ' + name(id) }, true);
                            });
                        });
                        if (mode !== 'frames') {
                            var managed = {};
                            frames.forEach(function (frame) { frame.windows.forEach(function (id) { managed[id] = true; }); });
                            lists[item.id].filter(function (window) {
                                return !managed[window.id] && !window['is-minimized'] && !window['is-hidden'];
                            }).forEach(function (window) { add({ window: window.id, rect: window.frame, label: '  ' + name(window.id) }); });
                        }
                    } else {
                        var available = lists[item.id].filter(function (window) { return !window['is-minimized'] && !window['is-hidden']; });
                        if (mode === 'frames' || !available.length) add({ container: true, label: '[' + item.type + (available.length ? ']' : ', empty]') });
                        else available.sort(function (a, b) { return a.id - b.id; }).forEach(function (window) {
                            add({ window: window.id, rect: window.frame, label: (window['has-focus'] ? '* ' : '  ') + name(window.id) });
                        });
                    }
                });
                function present() {
                    var allEntries = entries.concat(covered);
                    if (mode !== 'frames') stableShortcuts(allEntries, visible, space);
                    choices(allEntries, mode === 'frames' ? 'visible frames / containers' : 'visible windows / frames', space, windows, function (entry) {
                        if (entry.space.id !== space.id) { visit(entry, null); return; }
                        if (entry.frame !== undefined) update(['space', String(space.index), '--focus-frame', String(entry.frame)]);
                        else if (entry.window !== undefined) command(['window', '--focus', String(entry.window)]);
                        else load('windows');
                    }, 0);
                }
                if (!entries.some(function (entry) { return entry.container; })) { present(); return; }
                run(['query', '--displays'], function (task) {
                    if (!active || generation !== current) return;
                    var displays;
                    try { displays = JSON.parse(task.output); } catch (_) {}
                    if (task.status !== 0 || !Array.isArray(displays)) { error('container geometry query failed'); return; }
                    entries.forEach(function (entry) {
                        if (!entry.container) return;
                        var display = displays.filter(function (display) { return display.index === entry.space.display; })[0];
                        if (display) entry.rect = display.frame;
                    });
                    present();
                });
            }
            if (visible.some(function (item) { return item.type === 'ratpoison' && !Array.isArray(item.frames); })) {
                error('visible Space query lacks frame support'); return;
            }
            if (!pending) { render(); return; }
            visible.slice(1).forEach(function (item) {
                run(['query', '--windows', '--space', String(item.index)], function (task) {
                    if (!active || generation !== current) return;
                    var result;
                    try { result = JSON.parse(task.output); } catch (_) {}
                    if (task.status !== 0 || !Array.isArray(result)) { error('visible window query failed'); return; }
                    lists[item.id] = result;
                    if (--pending === 0) render();
                });
            });
        });
    }

    function load(mode) {
        var current = ++generation;
        queuedDirection = null;
        clearKeys();
        controls();
        // Keep the last menu and its native panel visible while refreshing.
        // Keyboard bindings remain guarded until the new query completes.
        focusedSpace(0);
        function focusedSpace(attempt) {
        run(['query', '--spaces', '--space'], function (spaceTask) {
            if (!active || generation !== current) return;
            if (spaceTask.status !== 0) { error(spaceTask.error || 'space query failed'); return; }
            var space;
            try { space = JSON.parse(spaceTask.output); }
            catch (_) {
                // Focus and display transitions can race the query. Retry only
                // malformed successful responses, bounded and generation guarded.
                if (attempt < 3) {
                    transitionTimer = Timer.after(0.05 * (attempt + 1), function () {
                        transitionTimer = null;
                        if (active && generation === current) focusedSpace(attempt + 1);
                    });
                } else error('invalid space query response after 4 attempts; check yabai logs');
                return;
            }
            if (!space || !space.index || (space.type === 'ratpoison' && !Array.isArray(space.frames))) {
                error('space query lacks frame support; restart with the new yabai build'); return;
            }
            run(['query', '--windows', '--space', String(space.index)], function (windowTask) {
                if (!active || generation !== current) return;
                if (windowTask.status !== 0) { error(windowTask.error || 'window query failed'); return; }
                var windows;
                try { windows = JSON.parse(windowTask.output); }
                catch (_) { error('invalid window query response'); return; }
                if (!Array.isArray(windows)) { error('invalid window list'); return; }
                if (queuedDirection) {
                    var direction = queuedDirection;
                    queuedDirection = null;
                    if (navigate(space, windows, direction)) return;
                }
                if (mode === 'move' || mode === 'displays' || mode === 'spaces') {
                    destinations(mode, space, windows, current);
                    return;
                }
                visibleChoices(mode, space, windows, current);
            });
        });
        }
    }

    function start() {
        if (configTask !== null) return;
        if (active) { cancel(); return; }
        if (typeof hintsActive !== 'undefined' && hintsActive && typeof cancelHints === 'function') cancelHints();
        active = true;
        load('windows');
    }

    Task.run('/usr/bin/python3', [settingsBackend, 'theme'], function (task) {
        if (task.status !== 0 || themeRevision !== 0) return;
        var result;
        try { result = JSON.parse(task.output); } catch (_) {}
        if (result && result.theme && typeof result.theme === 'object') { savedTheme = result.theme; mergeTheme(); }
    });

    Key.on('f', ['ctrl'], function (_, repeated) {
        if (!repeated) command(['window', '--toggle', 'windowed-fullscreen']);
    });
    Key.on('s', ['cmd'], function (_, repeated) { if (!repeated) start(); });
    Event.on('mouseDidLeftClick', function () { if (!searching) cancel(); });
    return { cancel: cancel, start: start, configure: function (options) {
        baseTheme = Object.assign({}, baseTheme, options);
        mergeTheme();
        ++themeRevision;
    } };
}());
