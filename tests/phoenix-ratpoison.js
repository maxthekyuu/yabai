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
        after(seconds, callback) { const id = nextId++; timers.set(id, callback); return id; },
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
const space = { index: 2, type: 'ratpoison', frames: [
    { id: 0, selected: true, windows: [10, 20], 'active-window': 10 },
    { id: 7, selected: false, windows: [], 'active-window': 0 }
] };
const windows = [{ id: 10, app: 'Terminal', title: 'One', 'has-focus': true, frame: { x: 0, y: 0, w: 100, h: 100 } },
                 { id: 20, app: 'Editor', title: 'Two', 'has-focus': false, frame: { x: 200, y: 0, w: 100, h: 100 } }];
function refresh(currentSpace = space, currentWindows = windows) { reply(currentSpace); reply(currentWindows); }
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
open(); press('m', ['shift']); refresh(); press('4');
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
assert.ok(lastMenu.text.split('\n').length <= 20);
assert.ok(!lastMenu.text.includes('\t'));
press(']'); press('0'); expectCommand(['window', '--focus', '25']); reply(null); idle();
screen = { x: -800, y: 200, width: 800, height: 500 };
open(manySpace(), many);
assert.ok(lastMenu.text.split('\n').length <= 20);
assert.deepEqual(lastMenu.screen, screen);
assert.ok(lastMenu.text.split('\n').every(line => line.length <= 68));
press(']'); press('0'); expectCommand(['window', '--focus', '11']); reply(null); idle();
// Native rendering failure closes the session, with an explicit fallback error.
open(); const [badId, badCallback] = [...renderers.entries()][0];
renderers.delete(badId); badCallback({ status: 1, error: 'missing font' }); idle();
// Retain the actual compact-menu payload for native rendering verification.
fs.writeFileSync('/tmp/yabai-prefix-test-menu.json', JSON.stringify(lastMenu));
console.log('Phoenix navigation, layout, pagination, and renderer lifecycle tests passed');
