/* Super-S (Command-S) prefix. Load through ~/.phoenix.js. The running yabai
 * daemon must support ratpoison frames. Release Command before the next key. */
var yabaiRatpoison = (function () {
    var executable = '/opt/homebrew/bin/yabai';
    var renderer = '/Users/jkuhn/Software/yabai/bin/yabai-prefix';
    // 1/2/3 select layouts; h/j/k/l navigate. Never reuse command keys as hints.
    var alphabet = '0456789abcdefgimnopqrstuvwxyz';
    var keys = [];
    var timer = null;
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
        if (space.type !== 'ratpoison') return;
        var args = ['space', String(space.index)];
        bind('s', ['shift'], function () { update(args.concat(['--split', 'horizontal'])); });
        bind('v', ['shift'], function () { update(args.concat(['--split', 'vertical'])); });
        bind('r', ['shift'], function () { update(args.concat(['--remove-frame'])); });
        bind('o', ['shift'], function () { update(args.concat(['--only-frame'])); });
        bind('tab', [], function () { update(args.concat(['--focus-frame', 'next'])); });
        bind('tab', ['shift'], function () { update(args.concat(['--focus-frame', 'prev'])); });
        bind('f', ['shift'], function () { load('frames'); });
        bind('m', ['shift'], function () { load('move'); });
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
                     clip('1 ratpoison   2 floating   3 bsp', width), ''];
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
        if (!cells.length) lines.push('(no windows)');
        lines.push('', 'arrows/hjkl focus   [ ] page   Esc close', 'Shift-T toggle ratpoison / floating');
        if (space.type === 'ratpoison') {
            lines.push('Shift-S/V split   Shift-F frames   Shift-M move', 'Shift-R remove    Shift-O only     Tab next');
        }
        bind('[', [], function () { choices(entries, title, space, windows, choose, page - 1); });
        bind(']', [], function () { choices(entries, title, space, windows, choose, page + 1); });
        show(lines.map(function (line) { return clip(line, width); }).join('\n'));
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
                var byId = {};
                windows.forEach(function (window) { byId[window.id] = window; });
                function name(id) {
                    var window = byId[id];
                    return window ? clean(window.app + ': ' + window.title) : String(id);
                }
                var frames = space.frames || [];
                if (mode === 'windows' || space.type !== 'ratpoison') {
                    var entries = [];
                    if (space.type === 'ratpoison') {
                        frames.forEach(function (frame) {
                            var mark = frame.selected ? '*' : ' ';
                            if (!frame.windows.length) {
                                entries.push({ frame: frame.id, label: mark + ' F' + frame.id + ' [empty]' });
                            } else {
                                var id = frame['active-window'] || frame.windows[0];
                                entries.push({ id: id, label: mark + ' F' + frame.id + ' ' + name(id) });
                            }
                        });
                        // Show one entry per frame first, including empties, so
                        // a large stack cannot bury a newly created container.
                        frames.forEach(function (frame) {
                            var front = frame['active-window'] || frame.windows[0];
                            frame.windows.forEach(function (id) {
                                if (id !== front) entries.push({ id: id, label: '  F' + frame.id + ' ' + name(id) });
                            });
                        });
                    } else {
                        windows.filter(function (window) { return !window['is-minimized'] && !window['is-hidden']; })
                            .sort(function (a, b) { return a.id - b.id; }).forEach(function (window) {
                                entries.push({ id: window.id, label: (window['has-focus'] ? '* ' : '  ') + name(window.id) });
                            });
                    }
                    choices(entries, 'windows / frames', space, windows, function (entry) {
                        if (entry.frame !== undefined) update(['space', String(space.index), '--focus-frame', String(entry.frame)]);
                        else command(['window', '--focus', String(entry.id)]);
                    }, 0);
                } else {
                    var source = windows.filter(function (window) { return window['has-focus']; })[0];
                    if (mode === 'move' && !source) { error('no focused window to move'); return; }
                    choices(frames.map(function (frame) {
                        return { id: frame.id, label: (frame.selected ? '*' : ' ') + ' F' + frame.id +
                            (frame.windows.length ? ' ' + name(frame['active-window']) : ' [empty]') };
                    }), mode === 'move' ? 'move to frame' : 'select frame', space, windows,
                    function (entry) {
                        update(mode === 'move' ? ['window', String(source.id), '--frame', String(entry.id)]
                               : ['space', String(space.index), '--focus-frame', String(entry.id)]);
                    }, 0);
                }
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
