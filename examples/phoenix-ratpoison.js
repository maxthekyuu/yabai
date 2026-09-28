/* Super-S (Command-S) prefix. Load through ~/.phoenix.js. The running yabai
 * daemon must support ratpoison frames. Release Command before the next key. */
var yabaiRatpoison = (function () {
    var executable = '/opt/homebrew/bin/yabai';
    var renderer = '/Users/jkuhn/Software/yabai/bin/yabai-prefix';
    // 1/2/3 select layouts; h/j/k/l navigate. Never reuse command keys as hints.
    var alphabet = '0456789abcdefgimnopqrstuvwxyz';
    var keys = [];
    var timer = null;
    var transitionTimer = null;
    var modal = null;
    var rendererTask = null;
    var rendererGeneration = 0;
    var active = false;
    var generation = 0;
    var queuedDirection = null;

    function clearKeys() {
        keys.forEach(function (key) { Key.off(key); });
        keys = [];
    }

    function cancel() {
        active = false;
        queuedDirection = null;
        generation += 1;
        clearKeys();
        if (timer !== null) Timer.off(timer);
        timer = null;
        if (transitionTimer !== null) Timer.off(transitionTimer);
        transitionTimer = null;
        closeMenu();
    }

    function closeMenu() {
        rendererGeneration += 1;
        if (rendererTask !== null) Task.terminate(rendererTask);
        rendererTask = null;
        if (modal) modal.close();
        modal = null;
    }

    function resetTimeout() {
        if (timer !== null) Timer.off(timer);
        timer = Timer.after(8, cancel);
    }

    function show(text, duration) {
        closeMenu();
        var current = rendererGeneration;
        // env execs the helper without a shell. A missing helper then produces
        // exit 127 and a callback; Phoenix otherwise only logs launch failures.
        rendererTask = Task.run('/usr/bin/env', [renderer, JSON.stringify({ text: text, screen: Screen.main().visibleFrame() })], function (task) {
            if (current !== rendererGeneration) return;
            rendererTask = null;
            if (task.status === 0) { cancel(); return; }
            // Report a missing renderer/font through Phoenix rather than
            // leaving invisible bindings enabled. This is an error fallback.
            cancel();
            modal = new Modal();
            modal.font = 'GoMono Nerd Font Mono';
            modal.weight = 12;
            modal.appearance = 'dark';
            modal.setTextColor(255, 85, 85, 1);
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
    function update(args) {
        var current = ++generation;
        clearKeys();
        bind('escape', [], cancel);
        run(args, function (task) {
            if (!active || generation !== current) return;
            if (task.status !== 0) { error(task.error || task.output || 'command failed'); return; }
            load('windows');
        });
    }

    function bind(key, modifiers, callback) {
        keys.push(Key.on(key, modifiers, function (_, repeated) {
            if (active && !repeated) {
                resetTimeout();
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

    function controls(space, windows) {
        bind('escape', [], cancel);
        ['ratpoison', 'float', 'bsp'].forEach(function (layout, index) {
            bind(String(index + 1), [], function () { setLayout(space, layout); });
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
        if (space.type !== 'ratpoison') return;
        var args = ['space', String(space.index)];
        bind('s', ['shift'], function () { update(args.concat(['--split', 'horizontal'])); });
        bind('v', ['shift'], function () { update(args.concat(['--split', 'vertical'])); });
        bind('r', ['shift'], function () { update(args.concat(['--remove-frame'])); });
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

    function choices(entries, title, space, windows, choose, page) {
        clearKeys();
        controls(space, windows);
        var screen = Screen.main().visibleFrame();
        var columns = screen.width >= 1100 ? 2 : 1;
        var rows = Math.max(1, Math.min(12, Math.floor((screen.height * 0.7 - 160) / 18)));
        var capacity = Math.min(alphabet.length, rows * columns);
        var pages = Math.max(1, Math.ceil(entries.length / capacity));
        page = (page + pages) % pages;
        var visible = entries.slice(page * capacity, (page + 1) * capacity);
        var columnWidth = Math.max(12, Math.min(68, Math.floor((screen.width - 100) / (columns * 8)) - 3));
        var width = columns * (columnWidth + 3) - 3;
        var lines = [clip('YABAI  ' + space.type + '  |  ' + title + '  |  ' + (page + 1) + '/' + pages, width),
                     clip('1 ratpoison   2 floating   3 bsp   Shift-T toggle', width), ''];
        var cells = visible.map(function (entry, index) {
            var key = alphabet[index];
            bind(key, [], function () { choose(entry); });
            return clip(key + ' ' + entry.label, columnWidth);
        });
        // Fill down each column so hint order follows the visible list.
        var usedRows = Math.ceil(cells.length / columns);
        for (var row = 0; row < usedRows; ++row) {
            var line = cells[row];
            if (cells[row + usedRows]) line = line.padEnd(columnWidth + 3, ' ') + cells[row + usedRows];
            lines.push(line);
        }
        if (!cells.length) lines.push('(no choices)');
        lines.push('', 'arrows/hjkl focus   [ ] page   Shift-F containers   Esc close', 'Shift-M move   Shift-D displays   Shift-U Spaces');
        if (space.type === 'ratpoison') {
            lines.push('Shift-S/V split   Shift-F frames', 'Shift-R remove    Shift-O only     Tab next');
        }
        bind('[', [], function () { choices(entries, title, space, windows, choose, page - 1); });
        bind(']', [], function () { choices(entries, title, space, windows, choose, page + 1); });
        show(lines.map(function (line) { return clip(line, width); }).join('\n'));
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
                        entries.push({ frame: frame.id, label: (frame.selected ? '*' : ' ') + ' F' + frame.id +
                            (frame.windows.length ? ' [' + frame.windows.length + ' windows]' : ' [empty]') });
                    });
                }
                displays.sort(function (a, b) { return a.index - b.index; }).forEach(function (display) {
                    var desktops = spaces.filter(function (item) { return item.display === display.index; });
                    var visible = desktops.filter(function (item) { return item['is-visible']; })[0];
                    if (mode !== 'spaces' && visible && !visible['is-native-fullscreen']) {
                        entries.push({ display: display.index, displayId: display.id, space: visible,
                            label: (display['has-focus'] ? '*' : ' ') + ' S' + visible.index + ' (' + display.index + ')' +
                                (display.label ? ' ' + clean(display.label) : '') + ' [' + visible.type + ']' });
                    }
                    if (mode !== 'displays') {
                        desktops.filter(function (item) { return !item['is-native-fullscreen']; })
                            .sort(function (a, b) { return a.index - b.index; }).forEach(function (item) {
                                entries.push({ space: item, label: (item['has-focus'] ? '*' : ' ') +
                                    ' S' + item.index + ' (' + display.index + ')' +
                                    (item.label ? ' ' + clean(item.label) : '') + ' [' + item.type + ']' });
                            });
                    }
                });
                choices(entries, mode === 'move' ? 'move + follow' : 'focus ' + mode, space, windows, function (entry) {
                    if (entry.frame !== undefined) {
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
                    (target['is-native-fullscreen'] && !entry.visibleOnly)) { error('destination is no longer available'); return; }
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
                            if (owner) request(['space', String(target.index), '--focus-frame', String(owner.id)], selectWindow);
                            else selectWindow();
                        });
                    } else if (entry.frame !== undefined) {
                        request(['space', String(target.index), '--focus-frame', String(entry.frame)], function () { load('windows'); });
                    } else load('windows');
                }
                function focusSpace() {
                    request(['query', '--spaces', '--space'], function (task) {
                        var focused;
                        try { focused = JSON.parse(task.output); } catch (_) { error('invalid focused Space'); return; }
                        if (focused.id === target.id) { focusWindow(); return; }
                        request(['space', '--focus', String(target.index)], function () {
                            waitFor(['query', '--spaces', '--space'], function (item) { return item && item.id === target.id; }, focusWindow, 30);
                        });
                    });
                }
                if (!source) { focusSpace(); return; }
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
                    var byId = {};
                    lists[item.id].forEach(function (window) { byId[window.id] = window; });
                    function name(id) {
                        var window = byId[id];
                        return window ? clean(window.app + ': ' + window.title) : String(id);
                    }
                    function add(entry, background) {
                        entry.space = item;
                        entry.visibleOnly = true;
                        entry.label = prefix + entry.label;
                        (background ? covered : entries).push(entry);
                    }
                    if (item.type === 'ratpoison') {
                        var frames = item.frames;
                        frames.forEach(function (frame) {
                            var label = (local && frame.selected ? '*' : ' ') + ' F' + frame.id;
                            if (mode === 'frames' || !frame.windows.length) {
                                add({ frame: frame.id, label: label + (frame.windows.length ? ' ' + name(frame['active-window']) : ' [empty]') });
                            } else {
                                var id = frame['active-window'] || frame.windows[0];
                                add({ window: id, label: label + ' ' + name(id) });
                            }
                        });
                        if (mode !== 'frames') frames.forEach(function (frame) {
                            var front = frame['active-window'] || frame.windows[0];
                            frame.windows.forEach(function (id) {
                                if (id !== front) add({ window: id, label: '  F' + frame.id + ' ' + name(id) }, true);
                            });
                        });
                        if (mode !== 'frames') {
                            var managed = {};
                            frames.forEach(function (frame) { frame.windows.forEach(function (id) { managed[id] = true; }); });
                            lists[item.id].filter(function (window) {
                                return !managed[window.id] && !window['is-minimized'] && !window['is-hidden'];
                            }).forEach(function (window) { add({ window: window.id, label: '  ' + name(window.id) }); });
                        }
                    } else {
                        var available = lists[item.id].filter(function (window) { return !window['is-minimized'] && !window['is-hidden']; });
                        if (mode === 'frames' || !available.length) add({ label: '[' + item.type + (available.length ? ']' : ', empty]') });
                        else available.sort(function (a, b) { return a.id - b.id; }).forEach(function (window) {
                            add({ window: window.id, label: (window['has-focus'] ? '* ' : '  ') + name(window.id) });
                        });
                    }
                });
                choices(entries.concat(covered), mode === 'frames' ? 'visible frames / containers' : 'visible windows / frames', space, windows, function (entry) {
                    if (entry.space.id !== space.id) { visit(entry, null); return; }
                    if (entry.frame !== undefined) update(['space', String(space.index), '--focus-frame', String(entry.frame)]);
                    else if (entry.window !== undefined) command(['window', '--focus', String(entry.window)]);
                    else load('windows');
                }, 0);
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
        show('Loading…  |  1 ratpoison  2 floating  3 bsp  |  Esc close');
        run(['query', '--spaces', '--space'], function (spaceTask) {
            if (!active || generation !== current) return;
            if (spaceTask.status !== 0) { error(spaceTask.error || 'space query failed'); return; }
            var space;
            try { space = JSON.parse(spaceTask.output); }
            catch (_) { error('invalid space query response'); return; }
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

    function start() {
        if (active) { cancel(); return; }
        if (typeof hintsActive !== 'undefined' && hintsActive && typeof cancelHints === 'function') cancelHints();
        active = true;
        resetTimeout();
        load('windows');
    }

    Key.on('s', ['cmd'], function (_, repeated) { if (!repeated) start(); });
    Event.on('mouseDidLeftClick', cancel);
    return { cancel: cancel, start: start };
}());
