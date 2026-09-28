// Run with: node tests/phoenix-ratpoison.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const keys = new Map();
const tasks = [];
const renderers = new Map();
const timers = new Map();
let nextId = 1;
let hintCancellations = 0;
let screen = { x: 0, y: 0, width: 1400, height: 1000 };
let lastMenu;
const context = {
    Key: {
        on(key, mods, callback) {
            assert.ok(![...keys.values()].some(k => k.key === key && k.mods.join() === mods.join()), `Duplicate binding: ${mods} ${key}`);
            const id = nextId++; keys.set(id, { key, mods, callback }); return id;
        },
        off(id) { keys.delete(id); }
    },
    Timer: {
        after(seconds, callback) { const id = nextId++; callback.delay = seconds; timers.set(id, callback); return id; },
        off(id) { timers.delete(id); }
    },
    Event: { on() {} },
    Task: {
        run(path, args, callback) {
            const id = nextId++;
            if (path === '/usr/bin/env' && args[0].endsWith('yabai-prefix')) {
                lastMenu = JSON.parse(args[1]);
                renderers.set(id, callback);
            } else tasks.push({ path, args, callback });
            return id;
        },
        terminate(id) {
            const callback = renderers.get(id);
            renderers.delete(id);
            if (callback) callback({ status: 15, error: 'terminated' });
        }
    },
    Screen: { main() { return { visibleFrame() { return screen; } }; } },
    Modal: class { setTextColor() {} show() {} close() {} },
    hintsActive: true,
    cancelHints() { hintCancellations++; context.hintsActive = false; }
};
vm.runInNewContext(fs.readFileSync('examples/phoenix-ratpoison.js', 'utf8'), context);
function press(key, mods = []) {
    const binding = [...keys.values()].find(k => k.key === key && k.mods.join() === mods.join());
    assert.ok(binding, `Missing binding: ${mods} ${key}`);
    binding.callback(null, false);
}
function reply(value, status = 0) {
    const task = tasks.shift();
    assert.ok(task);
    task.callback({ status, output: JSON.stringify(value), error: status ? 'failure' : '' });
}
function expectCommand(args) { assert.deepEqual(Array.from(tasks[0].args), ['-m', ...args]); }
function idle() { assert.equal(keys.size, 1); assert.equal(renderers.size, 0); }
const space = { id: 102, display: 1, 'is-visible': true, 'has-focus': true, index: 2, type: 'ratpoison', frames: [
    { id: 0, selected: true, windows: [10, 20], 'active-window': 10 },
    { id: 7, selected: false, windows: [], 'active-window': 0 }
] };
const windows = [{ id: 10, app: 'Terminal', title: 'One', 'has-focus': true, frame: { x: 0, y: 0, w: 100, h: 100 } },
                 { id: 20, app: 'Editor', title: 'Two', 'has-focus': false, frame: { x: 200, y: 0, w: 100, h: 100 } }];
const displays = [{ id: 501, index: 1, 'has-focus': true }, { id: 502, index: 2, label: 'External' }];
const remote = { id: 103, index: 3, display: 2, type: 'float', 'is-visible': true };
const desktop = { id: 104, index: 4, display: 2, type: 'bsp', 'is-visible': false };
const fullscreen = { id: 105, index: 5, display: 2, type: 'float', 'is-visible': false, 'is-native-fullscreen': true };
const desktops = [space, remote, desktop, fullscreen];
function refresh(currentSpace = space, currentWindows = windows) {
    reply(currentSpace); reply(currentWindows);
    if (tasks[0] && tasks[0].args.join(' ') === '-m query --spaces') reply([currentSpace]);
}
function open(currentSpace = space, currentWindows = windows) { press('s', ['cmd']); refresh(currentSpace, currentWindows); }
idle();
open();
assert.equal(hintCancellations, 1);
assert.ok(lastMenu.text.includes('F7 [empty]'));
assert.ok(lastMenu.text.includes('1 ratpoison   2 floating   3 bsp'));
assert.equal(renderers.size, 1);
press('5'); expectCommand(['window', '--focus', '20']); reply(null); idle();
// Empty frames are directly selectable without first entering a sub-menu.
open(); press('4'); expectCommand(['space', '2', '--focus-frame', '7']); reply(null);
refresh({ ...space, frames: space.frames.map(f => ({ ...f, selected: f.id === 7 })) });
assert.ok(lastMenu.text.includes('* F7 [empty]'));
press('escape'); idle();
// Arrows and vim keys are reserved, not stolen by window hint labels.
for (const [key, direction] of [['left', 'west'], ['h', 'west'], ['down', 'south'], ['j', 'south'],
                                ['up', 'north'], ['k', 'north'], ['right', 'east'], ['l', 'east']]) {
    open(); press(key); expectCommand(['space', '2', '--focus-frame', direction]); reply(null); refresh();
    press('escape'); idle();
}
// Fast prefix + direction is buffered while asynchronous queries load.
press('s', ['cmd']); press('l'); refresh();
expectCommand(['space', '2', '--focus-frame', 'east']); reply(null); refresh(); press('escape'); idle();
open(); press('f', ['shift']); refresh(); press('4');
expectCommand(['space', '2', '--focus-frame', '7']); reply(null); refresh(); press('escape');
open(); press('m', ['shift']); refresh(); reply(displays); reply(desktops); press('4');
expectCommand(['window', '10', '--frame', '7']); reply(null); refresh(); press('escape');
open(); press('v', ['shift']); expectCommand(['space', '2', '--split', 'vertical']); reply(null); refresh();
assert.ok(lastMenu.text.includes('[empty]')); press('escape'); idle();
// Numeric mode selection works from all layouts; reselecting ratpoison is safe.
for (const type of ['ratpoison', 'float', 'bsp']) {
    for (const [key, layout] of [['1', 'ratpoison'], ['2', 'float'], ['3', 'bsp']]) {
        open({ ...space, type }); press(key);
        if (type !== layout) { expectCommand(['space', '2', '--layout', layout]); reply(null); }
        else assert.equal(tasks.length, 0);
        idle();
    }
}
open({ ...space, type: 'bsp' }); press('t', ['shift']);
expectCommand(['space', '2', '--layout', 'ratpoison']); reply(null);
open(); press('t', ['shift']); expectCommand(['space', '2', '--layout', 'float']); reply(null); idle();
open({ ...space, type: 'float' }); press('l'); expectCommand(['window', '--focus', '20']); reply(null); refresh(); press('escape');
// Cancelling a menu never exits ratpoison or changes layouts.
open(); press('escape'); assert.equal(tasks.length, 0); idle();
press('s', ['cmd']); press('escape'); reply(space); assert.equal(tasks.length, 0); idle();
press('s', ['cmd']); press('s', ['cmd']); reply(space); idle();
open(); [...timers.values()][0](); idle(); assert.equal(timers.size, 0);
// The native renderer's own timeout must also disable invisible shortcuts.
open(); const [rendererId, rendererCallback] = [...renderers.entries()][0];
renderers.delete(rendererId); rendererCallback({ status: 0 }); idle();
// Lots of windows, long titles and small/negative-origin screens remain paged.
const many = Array.from({ length: 80 }, (_, i) => ({ id: i + 1, app: 'App', title: 'Long\tTitle\n'.repeat(25) }));
function manySpace() { return { ...space, frames: [{ id: 0, windows: many.map(w => w.id) }] }; }
open(manySpace(), many);
assert.ok(lastMenu.text.includes('1/4'));
assert.ok(lastMenu.text.split('\n').length <= 22);
assert.ok(!lastMenu.text.includes('\t'));
press(']'); assert.ok(lastMenu.text.includes('Display 1 (continued)')); press('0'); expectCommand(['window', '--focus', '25']); reply(null); idle();
screen = { x: -800, y: 200, width: 800, height: 500 };
open(manySpace(), many);
assert.ok(lastMenu.text.split('\n').length <= 22);
assert.deepEqual(lastMenu.screen, screen);
assert.ok(lastMenu.text.split('\n').every(line => line.length <= 70));
press(']'); press('0'); expectCommand(['window', '--focus', '11']); reply(null); idle();
// Display and Space containers are available in every layout. Move + follow
// waits for WindowServer completion and keeps layout controls on the destination.
screen = { x: 0, y: 0, width: 1400, height: 1000 };
function destinations(mode, currentSpace = space) {
    open(currentSpace); press(mode, ['shift']); refresh(currentSpace);
    expectCommand(['query', '--displays']); reply(displays);
    expectCommand(['query', '--spaces']); reply(desktops);
}
function resolveDestination(spaces = desktops, screens = displays) {
    if (tasks[0].args.includes('--displays')) { expectCommand(['query', '--displays']); reply(screens); }
    expectCommand(['query', '--spaces']); reply(spaces);
}
for (const type of ['ratpoison', 'float', 'bsp']) {
    destinations('d', { ...space, type });
    assert.ok(lastMenu.text.includes('S3 (2) External [float]'));
    press('4'); resolveDestination();
    expectCommand(['query', '--spaces', '--space']); reply(space);
    expectCommand(['space', '--focus', '3']); reply(null);
    expectCommand(['query', '--spaces', '--space']); reply(remote);
    refresh(remote); press('1'); expectCommand(['space', '3', '--layout', 'ratpoison']); reply(null); idle();
}
for (const type of ['ratpoison', 'float', 'bsp']) {
    destinations('m', { ...space, type });
    assert.ok(!lastMenu.text.includes('S5'));
    assert.ok(lastMenu.text.includes('S2 (1)'));
    assert.ok(lastMenu.text.includes('S4 (2) [bsp]'));
    // Frames precede D1, S2, D2, S3, S4 in ratpoison; other layouts start at D1.
    press(type === 'ratpoison' ? '7' : '5');
    resolveDestination();
    expectCommand(['window', '10', '--space', '3']); reply(null);
    expectCommand(['query', '--windows', '--window', '10']); reply({ id: 10, space: 3 });
    expectCommand(['query', '--spaces', '--space']); reply(space);
    expectCommand(['space', '--focus', '3']); reply(null);
    expectCommand(['query', '--spaces', '--space']); reply(remote);
    expectCommand(['window', '--focus', '10']); reply(null);
    refresh(remote); press('3'); expectCommand(['space', '3', '--layout', 'bsp']); reply(null); idle();
}
// Physical display identities survive arrangement-index changes; unplugged
// displays stop the operation rather than targeting a newly numbered monitor.
destinations('d'); press('4');
const movedDisplay = { ...remote, display: 3, index: 6 };
resolveDestination([space, movedDisplay], [displays[0], { ...displays[1], index: 3 }]);
reply(space); expectCommand(['space', '--focus', '6']); reply(null); reply(movedDisplay);
refresh(movedDisplay); press('escape'); idle();
destinations('d'); press('4'); expectCommand(['query', '--displays']); reply([displays[0]]);
assert.equal(tasks.length, 0); context.yabaiRatpoison.cancel(); idle();
// Space identity survives index changes while the chooser is open.
destinations('u'); press('5');
const renumbered = { ...desktop, index: 6 };
reply([space, remote, renumbered]); reply(space);
expectCommand(['space', '--focus', '6']); reply(null); reply(renumbered);
refresh(renumbered); press('escape'); idle();
// Move to a hidden virtual desktop; do not focus before asynchronous movement completes.
destinations('m', { ...space, type: 'float' }); press('7'); resolveDestination();
expectCommand(['window', '10', '--space', '4']); reply(null);
reply({ id: 10, space: 2 });
assert.equal(tasks.length, 0);
const retry = [...timers.entries()].find(([id, callback]) => callback.delay === 0.1);
assert.ok(retry); timers.delete(retry[0]); retry[1]();
expectCommand(['query', '--windows', '--window', '10']); reply({ id: 10, space: 4 });
reply(space); expectCommand(['space', '--focus', '4']); reply(null); reply(desktop);
expectCommand(['window', '--focus', '10']); reply(null); refresh(desktop); press('escape'); idle();
// An empty desktop can be selected, then its tiling mode changed without a window.
destinations('u'); press('5'); resolveDestination(); reply(space); reply(null); reply(desktop);
refresh(desktop, []); press('2'); expectCommand(['space', '4', '--layout', 'float']); reply(null); idle();
// Moving within the current Space must skip the failing already-focused-space command.
destinations('m', { ...space, type: 'float' }); press('0'); resolveDestination(); reply(null);
reply({ id: 10, space: 2 }); reply(space);
expectCommand(['window', '--focus', '10']); reply(null); refresh(); press('escape'); idle();
// A removed destination, command failure or cancellation stops the chain.
destinations('u'); press('5'); reply([space, remote]); assert.equal(tasks.length, 0);
context.yabaiRatpoison.cancel(); idle();
destinations('m', { ...space, type: 'float' }); press('5'); resolveDestination(); reply(null, 1);
assert.equal(tasks.length, 0); context.yabaiRatpoison.cancel(); idle();
destinations('m'); press('7'); press('escape'); reply(displays); assert.equal(tasks.length, 0); idle();
// Cancelling a pending completion poll prevents a later timer from focusing anything.
destinations('m', { ...space, type: 'float' }); press('5'); resolveDestination(); reply(null); reply({ space: 2 });
press('escape'); for (const callback of [...timers.values()]) callback(); timers.clear();
assert.equal(tasks.length, 0); idle();
// Completion polling is bounded and never follows a move that did not happen.
destinations('m', { ...space, type: 'float' }); press('5'); resolveDestination(); reply(null);
for (let attempt = 0; attempt < 30; ++attempt) {
    expectCommand(['query', '--windows', '--window', '10']); reply({ id: 10, space: 2 });
    if (attempt < 29) {
        const id = Math.max(...timers.keys());
        const callback = timers.get(id); timers.delete(id); callback();
    }
}
assert.equal(tasks.length, 0); context.yabaiRatpoison.cancel(); idle();
open({ ...space, type: 'float' }, []); press('m', ['shift']); refresh({ ...space, type: 'float' }, []);
assert.equal(tasks.length, 0); context.yabaiRatpoison.cancel(); idle();
// The main chooser and Shift-F see only currently visible Spaces, across layouts.
const single = { ...space, frames: [{ id: 0, selected: true, windows: [10], 'active-window': 10 }] };
const remoteFrames = { ...remote, type: 'ratpoison', frames: [
    { id: 0, selected: false, windows: [30, 40], 'active-window': 30 },
    { id: 7, selected: true, windows: [], 'active-window': 0 }
] };
const remoteWindows = [{ id: 30, app: 'Browser', title: 'Remote' }, { id: 40, app: 'Editor', title: 'Covered' }];
function visibleMenu(other = remoteFrames, otherWindows = remoteWindows, mode) {
    if (mode) { open(single, [windows[0]]); press(mode, ['shift']); }
    else press('s', ['cmd']);
    reply(single); reply([windows[0]]);
    expectCommand(['query', '--spaces']); reply([single, other, desktop]);
    expectCommand(['query', '--windows', '--space', '3']); reply(otherWindows);
    assert.equal(tasks.length, 0); // The hidden S4 was never queried.
}
visibleMenu();
assert.ok(lastMenu.text.includes('S3 (2)   F7 [empty]'));
assert.ok(!lastMenu.text.includes('S4 (2)'));
assert.deepEqual(Array.from(lastMenu.groups, g => g.display), [1, 2]);
assert.ok(lastMenu.text.includes('┌ Display 1 '));
assert.ok(lastMenu.text.includes('┌ Display 2 '));
fs.writeFileSync('/tmp/yabai-prefix-group-menu.json', JSON.stringify(lastMenu));
press('5'); reply([single, remoteFrames]); reply(single);
expectCommand(['space', '--focus', '3']); reply(null); reply(remoteFrames);
expectCommand(['space', '3', '--focus-frame', '7']); reply(null); refresh(remoteFrames, remoteWindows);
press('2'); expectCommand(['space', '3', '--layout', 'float']); reply(null); idle();
// Covered remote windows are focused in their original frame, never moved.
visibleMenu(); press('6'); reply([single, remoteFrames]); reply(single); reply(null); reply(remoteFrames);
expectCommand(['query', '--windows', '--window', '40']); reply({ id: 40, space: 3 });
expectCommand(['space', '3', '--focus-frame', '0']); reply(null);
expectCommand(['window', '--focus', '40']); reply(null); refresh(remoteFrames, remoteWindows); press('escape'); idle();
// Floating windows and empty containers are reachable from the same main menu.
visibleMenu(remote, [remoteWindows[0]]); press('4'); reply([single, remote]); reply(single); reply(null); reply(remote);
expectCommand(['query', '--windows', '--window', '30']); reply({ id: 30, space: 3 });
expectCommand(['window', '--focus', '30']); reply(null); refresh(remote, [remoteWindows[0]]); press('escape'); idle();
visibleMenu(remote, []); assert.ok(lastMenu.text.includes('S3 (2) [float, empty]'));
press('4'); reply([single, remote]); reply(single); reply(null); reply(remote); refresh(remote, []);
press('1'); expectCommand(['space', '3', '--layout', 'ratpoison']); reply(null); idle();
visibleMenu(remoteFrames, remoteWindows, 'f'); press('5'); reply([single, remoteFrames]); reply(single); reply(null); reply(remoteFrames);
expectCommand(['space', '3', '--focus-frame', '7']); reply(null); refresh(remoteFrames, remoteWindows); press('escape'); idle();
// A Space that became hidden must not be activated from the visible-only list.
visibleMenu(); press('5'); reply([single, { ...remoteFrames, 'is-visible': false }]);
assert.equal(tasks.length, 0); context.yabaiRatpoison.cancel(); idle();
// Late remote queries cannot reopen a cancelled chooser.
press('s', ['cmd']); reply(single); reply([windows[0]]); reply([single, remoteFrames]);
press('escape'); reply(remoteWindows); idle();
// Display order is physical-index order even when display 2 has focus.
press('s', ['cmd']); reply(remote); reply([remoteWindows[0]]); reply([remote, single]); reply([windows[0]]);
assert.deepEqual(Array.from(lastMenu.groups, g => g.display), [1, 2]);
press('4'); expectCommand(['window', '--focus', '30']); reply(null); idle();
// Native rendering failure closes the session, with an explicit fallback error.
open(); const [badId, badCallback] = [...renderers.entries()][0];
renderers.delete(badId); badCallback({ status: 1, error: 'missing font' }); idle();
// Retain the actual compact-menu payload for native rendering verification.
fs.writeFileSync('/tmp/yabai-prefix-test-menu.json', JSON.stringify(lastMenu));
console.log('Phoenix navigation, layout, display/Space moves, pagination, and renderer lifecycle tests passed');
