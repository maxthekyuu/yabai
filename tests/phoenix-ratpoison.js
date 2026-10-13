// Run with: node tests/phoenix-ratpoison.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const keys = new Map();
const tasks = [];
const renderers = new Map();
const timers = new Map();
const events = new Map();
const residentMessages = [];
let nextId = 1;
let hintCancellations = 0;
let screen = { x: 0, y: 0, width: 1400, height: 1000 };
let lastMenu;
let resident = null;
const residentCallbacks = new Map();
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
    Event: { on(name, callback) { events.set(name, callback); } },
    Task: {
        run(path, args, callback) {
            const id = nextId++;
            if (path === '/usr/bin/python3' && args[1] === 'theme') { callback({status:0,output:'{\"theme\":{}}'}); return id; }
            if (path.endsWith('yabai-prefix-client')) {
                const message = JSON.parse(args[1]); residentMessages.push(message);
                if (message.action === 'hide' || message.action === 'prepare') renderers.delete(resident);
                if (message.payload) lastMenu = message.payload;
                if (message.action === 'show' || message.action === 'update') renderers.set(resident, residentCallbacks.get(resident));
                callback({status:0}); return id;
            }
            if (path === '/usr/bin/env' && args[0].endsWith('yabai-prefix')) {
                if (args[1] === '--serve') { resident = id; residentCallbacks.set(id, callback); return id; }
                if (args[1] === '--configure') { tasks.push({path,args,callback}); return id; }
                lastMenu = JSON.parse(args[args.length - 1]);
                if (args[1] === '--update') { callback({ status: 0 }); return id; }
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
    if (task.args[1] === 'query' && task.args[2] === '--spaces' && task.args[3] && !task.args[3].startsWith('--') && !Array.isArray(value) && value && value.id) value = [{...value, 'has-focus':true}];
    task.callback({ status, output: JSON.stringify(value), error: status ? 'failure' : '' });
}
function expectCommand(args) { assert.deepEqual(Array.from(tasks[0].args), ['-m', ...args]); }
function idle() { assert.equal(keys.size, 6); assert.equal(renderers.size, 0); }
const space = { id: 102, display: 1, 'is-visible': true, 'has-focus': true, index: 2, type: 'ratpoison', frames: [
    { id: 0, x: 0, y: 38, w: 500, h: 800, selected: true, windows: [10, 20], 'active-window': 10 },
    { id: 7, x: 500, y: 38, w: 500, h: 800, selected: false, windows: [], 'active-window': 0 }
] };
const windows = [{ id: 10, app: 'Terminal', title: 'One', 'has-focus': true, frame: { x: 0, y: 0, w: 100, h: 100 } },
                 { id: 20, app: 'Editor', title: 'Two', 'has-focus': false, frame: { x: 200, y: 0, w: 100, h: 100 } }];
const displays = [{ id: 501, index: 1, 'has-focus': true }, { id: 502, index: 2, label: 'External' }];
const remote = { id: 103, index: 3, display: 2, type: 'float', 'is-visible': true };
const desktop = { id: 104, index: 4, display: 2, type: 'bsp', 'is-visible': false };
const fullscreen = { id: 105, index: 5, display: 2, type: 'float', 'is-visible': false, 'is-native-fullscreen': true };
const desktops = [space, remote, desktop, fullscreen];
function snapshot(currentSpace = space, currentWindows = windows, otherSpaces = [], otherLists = {}) {
    return {version:1, 'focused-space':currentSpace.id, 'focused-window':(currentWindows.find(w => w['has-focus']) || {}).id || 0,
        spaces:[currentSpace, ...otherSpaces], windows:{[currentSpace.id]:currentWindows,...otherLists}, displays};
}
function refresh(currentSpace = space, currentWindows = windows) {
    if (tasks[0] && tasks[0].args.includes('--menu-snapshot')) { reply(snapshot(currentSpace,currentWindows)); return; }
    reply(currentSpace); reply(currentWindows);
    if (tasks[0] && tasks[0].args.join(' ') === '-m query --spaces') reply([currentSpace]);
}
// Existing independent scenarios use fresh Phoenix sessions. Stability regressions
// below reopen with press/refresh so they deliberately retain the same session.
function resetShortcuts() {
    context.yabaiRatpoison.cancel();
    keys.clear(); timers.clear();
    vm.runInNewContext(fs.readFileSync('examples/phoenix-ratpoison.js', 'utf8'), context);
}
function open(currentSpace = space, currentWindows = windows) { resetShortcuts(); press('s', ['cmd']); refresh(currentSpace, currentWindows); }
idle();
open();
assert.equal(hintCancellations, 1);
assert.ok(lastMenu.text.includes('F7 [empty]'));
assert.ok(lastMenu.badges.some(b=>b.state==='empty'));
assert.ok(lastMenu.highlights.some(h=>h.state==='empty'));

assert.ok(lastMenu.text.includes('r ratpoison   f floating   b bsp'));
assert.equal(renderers.size, 1);
press('1'); expectCommand(['window', '--focus', '20']); reply(null); idle();
// Empty frames are directly selectable without first entering a sub-menu.
open(); press('a'); expectCommand(['space', '2', '--focus-frame', '7']); reply(null);
refresh({ ...space, frames: space.frames.map(f => ({ ...f, selected: f.id === 7 })) });
assert.ok(lastMenu.text.includes('* F7 [empty]'));
press('escape'); idle();
// Arrows and vim keys are reserved, not stolen by window hint labels.
for (const [key, direction] of [['left', 'west'], ['h', 'west'], ['down', 'south'], ['j', 'south'],
                                ['up', 'north'], ['k', 'north'], ['right', 'east'], ['l', 'east']]) {
    open(); press(key); expectCommand(['space', '2', '--focus-frame', direction]); reply(null); refresh();
    press('escape'); idle();
}
// Both arrow bindings move the actual focused window, even with an empty
// frame selected. The menu stays open; global moves leave it closed.
const moveFrames = {...space, frames:[
    {id:0, selected:false, x:500,y:500,w:500,h:500,windows:[10,20],'active-window':20},
    {id:1, selected:true, x:0,y:500,w:500,h:500,windows:[],'active-window':0},
    {id:2, selected:false, x:1000,y:500,w:500,h:500,windows:[30],'active-window':30},
    {id:3, selected:false, x:500,y:0,w:500,h:500,windows:[],'active-window':0},
    {id:4, selected:false, x:500,y:1000,w:500,h:500,windows:[],'active-window':0}
]};
for (const [key,target] of [['left',1],['right',2],['up',3],['down',4]]) {
    for (const menu of [false,true]) {
        if (menu) open(moveFrames); else resetShortcuts();
        press(key,menu ? ['shift'] : ['cmd','shift']); refresh(moveFrames);
        expectCommand(['window','10','--frame',String(target)]); reply(null);
        if (menu) { refresh(moveFrames); assert.equal(renderers.size,1); press('escape'); }
        idle();
    }
}
// At an edge, do nothing; missing focus and unmanaged windows are also ignored.
for (const currentWindows of [windows, windows.map(w=>({...w,'has-focus':false})),
                              [{id:99,'has-focus':true}]]) {
    open(); press('left',['shift']); refresh(space,currentWindows);
    assert.equal(tasks.length,0); assert.equal(renderers.size,1); press('escape'); idle();
}
// Cancellation during the fresh-focus query prevents a late move.
open(moveFrames); press('right',['shift']); press('escape'); refresh(moveFrames);
assert.equal(tasks.length,0); idle();
// BSP retains directional warp; floating windows move in logical points.
for (const [type,arg] of [['bsp','--warp'],['float','--move']]) {
    open({...space,type}); press('right',['shift']); refresh({...space,type});
    expectCommand(['window','10',arg,type==='bsp'?'east':'rel:40:0']); reply(null);
    refresh({...space,type}); press('escape'); idle();
}
// Fast prefix + direction is buffered while asynchronous queries load.
press('s', ['cmd']); press('l'); refresh();
expectCommand(['space', '2', '--focus-frame', 'east']); reply(null); refresh(); press('escape'); idle();
open(); press('f', ['shift']); refresh(); press('1');
expectCommand(['space', '2', '--focus-frame', '7']); reply(null); refresh(); press('escape');
open(); press('m', ['shift']); refresh(); reply(displays); reply(desktops); press('1');
expectCommand(['window', '10', '--frame', '7']); reply(null); refresh(); press('escape');
open(); press('v', ['shift']); expectCommand(['space', '2', '--split', 'vertical']); reply(null); refresh();
assert.ok(lastMenu.text.includes('[empty]')); press('escape'); idle();
// Letter mode selection works from all layouts; reselecting ratpoison is safe.
for (const type of ['ratpoison', 'float', 'bsp']) {
    for (const [key, layout] of [['r', 'ratpoison'], ['f', 'float'], ['b', 'bsp']]) {
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
open(); assert.ok([...timers.values()].every(timer => timer.delay === 0.08)); press('escape'); idle();
// Unexpected renderer exit must also disable invisible shortcuts.
open(); const [rendererId, rendererCallback] = [...renderers.entries()][0];
renderers.delete(rendererId); rendererCallback({ status: 0 }); idle();
// Lots of windows, long titles and small/negative-origin screens remain paged.
const many = Array.from({ length: 80 }, (_, i) => ({ id: i + 1, app: 'App', title: 'Long\tTitle\n'.repeat(25) }));
function manySpace() { return { ...space, frames: [{ id: 0, windows: many.map(w => w.id) }] }; }
open(manySpace(), many);
assert.ok(lastMenu.text.includes('1/8'));
assert.ok(lastMenu.text.split('\n').length * 18 + 28 <= screen.height * 0.9);
assert.ok(!lastMenu.text.includes('\t'));
press(']'); assert.ok(lastMenu.text.includes('Display 1 (continued)')); press('0'); expectCommand(['window', '--focus', '11']); reply(null); idle();
screen = { x: -800, y: 200, width: 800, height: 500 };
open(manySpace(), many);
assert.ok(lastMenu.text.split('\n').length * 18 + 28 <= screen.height * 0.9);
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
    press('1'); resolveDestination();
    expectCommand(['query', '--spaces', '--space']); reply(space);
    expectCommand(['space', '--focus', '3']); reply(null);
    expectCommand(['query', '--spaces', '--space']); reply(remote);
    refresh(remote); press('r'); expectCommand(['space', '3', '--layout', 'ratpoison']); reply(null); idle();
}
for (const type of ['ratpoison', 'float', 'bsp']) {
    destinations('m', { ...space, type });
    assert.ok(!lastMenu.text.includes('S5'));
    assert.ok(lastMenu.text.includes('S2 (1)'));
    assert.ok(lastMenu.text.includes('S4 (2) [bsp]'));
    // Frames precede D1, S2, D2, S3, S4 in ratpoison; other layouts start at D1.
    press(type === 'ratpoison' ? '4' : '2');
    resolveDestination();
    expectCommand(['window', '10', '--space', '3']); reply(null);
    expectCommand(['query', '--windows', '--window', '10']); reply({ id: 10, space: 3 });
    expectCommand(['window', '--focus', '10']); reply(null);
    refresh(remote); press('b'); expectCommand(['space', '3', '--layout', 'bsp']); reply(null); idle();
}
// Physical display identities survive arrangement-index changes; unplugged
// displays stop the operation rather than targeting a newly numbered monitor.
destinations('d'); press('1');
const movedDisplay = { ...remote, display: 3, index: 6 };
resolveDestination([space, movedDisplay], [displays[0], { ...displays[1], index: 3 }]);
reply(space); expectCommand(['space', '--focus', '6']); reply(null); reply(movedDisplay);
refresh(movedDisplay); press('escape'); idle();
destinations('d'); press('1'); expectCommand(['query', '--displays']); reply([displays[0]]);
assert.equal(tasks.length, 0); context.yabaiRatpoison.cancel(); idle();
// Space identity survives index changes while the chooser is open.
destinations('u'); press('2');
const renumbered = { ...desktop, index: 6 };
reply([space, remote, renumbered]); reply(space);
expectCommand(['space', '--focus', '6']); reply(null); reply(renumbered);
refresh(renumbered); press('escape'); idle();
// Move to a hidden virtual desktop; do not focus before asynchronous movement completes.
destinations('m', { ...space, type: 'float' }); press('4'); resolveDestination();
expectCommand(['window', '10', '--space', '4']); reply(null);
reply({ id: 10, space: 2 });
assert.equal(tasks.length, 0);
const retry = [...timers.entries()].find(([id, callback]) => callback.delay === 0.1);
assert.ok(retry); timers.delete(retry[0]); retry[1]();
expectCommand(['query', '--windows', '--window', '10']); reply({ id: 10, space: 4 });
reply(space); expectCommand(['space', '--focus', '4']); reply(null); reply(desktop);
expectCommand(['window', '--focus', '10']); reply(null); refresh(desktop); press('escape'); idle();
// An empty desktop can be selected, then its tiling mode changed without a window.
destinations('u'); press('2'); resolveDestination(); reply(space); reply(null); reply(desktop);
refresh(desktop, []); press('f'); expectCommand(['space', '4', '--layout', 'float']); reply(null); idle();
// Moving within the current Space must skip the failing already-focused-space command.
destinations('m', { ...space, type: 'float' }); press('0'); resolveDestination(); reply(null);
reply({ id: 10, space: 2 });
expectCommand(['window', '--focus', '10']); reply(null); refresh(); press('escape'); idle();
// A removed destination, command failure or cancellation stops the chain.
destinations('u'); press('2'); reply([space, remote]); assert.equal(tasks.length, 0);
context.yabaiRatpoison.cancel(); idle();
destinations('m', { ...space, type: 'float' }); press('2'); resolveDestination(); reply(null, 1);
assert.equal(tasks.length, 0); context.yabaiRatpoison.cancel(); idle();
destinations('m'); press('4'); press('escape'); reply(displays); assert.equal(tasks.length, 0); idle();
// Cancelling a pending completion poll prevents a later timer from focusing anything.
destinations('m', { ...space, type: 'float' }); press('2'); resolveDestination(); reply(null); reply({ space: 2 });
press('escape'); for (const callback of [...timers.values()].filter(t => t.delay !== 0.08)) callback(); timers.clear();
assert.equal(tasks.length, 0); idle();
// Completion polling is bounded and never follows a move that did not happen.
destinations('m', { ...space, type: 'float' }); press('2'); resolveDestination(); reply(null);
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
    else { resetShortcuts(); press('s', ['cmd']); }
    expectCommand(['query', '--menu-snapshot']);
    reply(snapshot(single,[windows[0]],[other],{[other.id]:otherWindows}));
    assert.equal(tasks.length, 0); // The hidden S4 was never queried.
}
visibleMenu();
assert.ok(lastMenu.text.includes('S3 (2)   F7 [empty]'));
assert.ok(!lastMenu.text.includes('S4 (2)'));
assert.deepEqual(Array.from(lastMenu.groups, g => g.display), [1, 2]);
assert.ok(lastMenu.text.includes('┌ Display 1 '));
assert.ok(lastMenu.text.includes('┌ Display 2 '));
fs.writeFileSync('/tmp/yabai-prefix-group-menu.json', JSON.stringify(lastMenu));
press('c'); reply([single, remoteFrames]); reply(single);
expectCommand(['space', '--focus', '3']); reply(null); reply(remoteFrames);
expectCommand(['space', '3', '--focus-frame', '7']); reply(null); refresh(remoteFrames, remoteWindows);
press('f'); expectCommand(['space', '3', '--layout', 'float']); reply(null); idle();
// Covered remote windows are focused in their original frame, never moved.
visibleMenu(); press('d'); reply([single, remoteFrames]); reply(single); reply(null); reply(remoteFrames);
expectCommand(['query', '--windows', '--window', '40']); reply({ id: 40, space: 3 });
expectCommand(['space', '3', '--focus-frame', '0']); reply(null);
expectCommand(['window', '--focus', '40']); reply(null); refresh(remoteFrames, remoteWindows); press('escape'); idle();
// Floating windows and empty containers are reachable from the same main menu.
visibleMenu(remote, [remoteWindows[0]]); press('a'); reply([single, remote]); reply(single); reply(null); reply(remote);
expectCommand(['query', '--windows', '--window', '30']); reply({ id: 30, space: 3 });
expectCommand(['window', '--focus', '30']); reply(null); refresh(remote, [remoteWindows[0]]); press('escape'); idle();
visibleMenu(remote, []); assert.ok(lastMenu.text.includes('S3 (2) [float, empty]'));
press('a'); reply([single, remote]); reply(single); reply(null); reply(remote); refresh(remote, []);
press('r'); expectCommand(['space', '3', '--layout', 'ratpoison']); reply(null); idle();
visibleMenu(remoteFrames, remoteWindows, 'f'); press('2'); reply([single, remoteFrames]); reply(single); reply(null); reply(remoteFrames);
expectCommand(['space', '3', '--focus-frame', '7']); reply(null); refresh(remoteFrames, remoteWindows); press('escape'); idle();
// A Space that became hidden must not be activated from the visible-only list.
visibleMenu(); press('c'); reply([single, { ...remoteFrames, 'is-visible': false }]);
assert.equal(tasks.length, 0); context.yabaiRatpoison.cancel(); idle();
// Late remote queries cannot reopen a cancelled chooser.
press('s', ['cmd']);
press('escape'); reply(snapshot(single,[windows[0]],[remoteFrames],{[remoteFrames.id]:remoteWindows})); idle();
// Display order is physical-index order even when display 2 has focus.
press('s', ['cmd']); reply(snapshot({...remote,'has-focus':true},[remoteWindows[0]],[{...single,'has-focus':false}],{[single.id]:[windows[0]]}));
assert.deepEqual(Array.from(lastMenu.groups, g => g.display), [1, 2]);
press('0'); expectCommand(['window', '--focus', '30']); reply(null); idle();
// Labels use existing frame/window geometry and exactly the current page's keys.
const badgeRect = { x: -900, y: -100, w: 400, h: 300 };
const badgeSpace = { ...space, frames: [
    { id: 0, x: 0, y: 38, w: 500, h: 800, selected: true, windows: [10, 20], 'active-window': 10, ...badgeRect },
    { id: 7, windows: [], x: -500, y: -100, w: 400, h: 300 }
] };
open(badgeSpace);
assert.deepEqual(Array.from(lastMenu.badges, b => b.key), ['0', '1', 'a']);
assert.deepEqual(JSON.parse(JSON.stringify(lastMenu.badges[0].rect)), badgeRect);
assert.equal(lastMenu.badges[1].rect.x, -900); // Covered window shares the frame center.
assert.equal(lastMenu.badges[2].rect.x, -500);
assert.equal(tasks.length, 0); // No additional geometry query for frames.
assert.equal(renderers.size, 1); // Menu and all badges share one process.
press('escape'); idle();
open(badgeSpace); press('f', ['shift']); refresh(badgeSpace);
assert.deepEqual(Array.from(lastMenu.badges, b => b.rect.x), [-900, -500]);
press('escape'); idle();
open(badgeSpace); press('m', ['shift']); refresh(badgeSpace); reply(displays); reply(desktops);
assert.deepEqual(Array.from(lastMenu.badges.slice(0, 2), b => b.rect.x), [-900, -500]);
press('escape'); idle();
open({ ...space, type: 'float' });
assert.equal(lastMenu.badges[0].rect.x, windows[0].frame.x); press('escape'); idle();
const withRects = many.map((w, i) => ({ ...w, frame: { x: i * 10, y: 0, w: 200, h: 100 } }));
open({ ...space, type: 'float' }, withRects);
assert.equal(lastMenu.badges.length, 10);
press(']'); assert.equal(lastMenu.badges[0].key, '0'); assert.equal(lastMenu.badges[0].rect.x, 100);
assert.equal(renderers.size, 1); press('escape'); idle();
fs.writeFileSync('/tmp/yabai-prefix-hint-menu.json', JSON.stringify(lastMenu));
// Empty visible containers get a single display-bounds query; hidden Spaces
// never receive badges on the currently visible desktop.
displays[0].frame = { x: 0, y: 0, w: 1400, h: 1000 };
displays[1].frame = { x: -1000, y: 0, w: 1000, h: 800 };
open({ ...space, type: 'float' }, []);
assert.equal(lastMenu.badges.length, 1);
assert.equal(lastMenu.badges[0].rect.w, 1400); press('escape'); idle();
destinations('u');
assert.equal(lastMenu.badges.length, 2);
assert.deepEqual(Array.from(lastMenu.badges, b => b.key), ['0', '1']);
press('escape'); idle();
// A display with many Spaces must not bury the other displays on page one.
const threeDisplays = [...displays, { id: 503, index: 3, frame: { x: 1400, y: 0, w: 1000, h: 800 } }];
const lotsOfSpaces = Array.from({ length: 14 }, (_, i) => ({
    id: 1000 + i, index: i + 1, display: 1, type: 'float', 'is-visible': i === 1
}));
const thirdSpace = { id: 1016, index: 16, display: 3, type: 'float', 'is-visible': true };
const allTargets = [...lotsOfSpaces, { ...remote, index: 15 }, thirdSpace];
open(); press('m', ['shift']); refresh(); reply(threeDisplays); reply(allTargets);
assert.deepEqual(Array.from(lastMenu.groups, g => g.display), [1, 2, 3]);
assert.ok(lastMenu.text.includes('S16 (3)'));
assert.ok(lastMenu.text.split('\n').length * 18 + 28 <= screen.height * 0.9);
const seen = new Set();
const pages = Number(lastMenu.text.split('\n')[0].match(/1\/(\d+)/)[1]);
for (let page = 0; page < pages; ++page) {
    for (const match of lastMenu.text.matchAll(/S(\d+) \(/g)) seen.add(Number(match[1]));
    if (page + 1 < pages) press(']');
}
assert.deepEqual([...seen].sort((a, b) => a - b), Array.from({ length: 16 }, (_, i) => i + 1));
press(']'); assert.deepEqual(Array.from(lastMenu.groups, g => g.display), [1, 2, 3]);
press(lastMenu.badges.find(b => b.display === 3).key);
resolveDestination(allTargets, threeDisplays);
expectCommand(['window', '10', '--space', '16']);
press('escape'); reply(null); idle();
// All paging aliases update the same page, hints and count indicator, without
// querying yabai again. Reverse paging wraps as well.
open({ ...space, type: 'float' }, withRects);
assert.ok(lastMenu.text.includes('Page 1/8 | 10/80 choices'));
for (const [forward, reverse] of [['pageDown', 'pageUp'], ['space', 'space']]) {
    press(forward); assert.ok(lastMenu.text.includes('Page 2/8')); assert.equal(lastMenu.badges[0].rect.x, 100);
    press(reverse, reverse === 'space' ? ['shift'] : []);
    assert.ok(lastMenu.text.includes('Page 1/8'));
    assert.equal(tasks.length, 0);
}
press('pageUp'); assert.ok(lastMenu.text.includes('Page 8/8 | 10/80 choices'));
press('escape'); idle();
// Many physical displays paginate without exceeding the height/key budget.
const screens40 = Array.from({length: 40}, (_, i) => ({id: 500+i, index: i+1}));
const spaces40 = screens40.map(d => ({id: 1000+d.index, index: d.index, display: d.index, type: 'float', 'is-visible': true}));
open(); press('d', ['shift']); refresh(); reply(screens40); reply(spaces40);
fs.writeFileSync('/tmp/yabai-prefix-tall-menu.json', JSON.stringify(lastMenu));
const screenPages = Number(lastMenu.text.split('\n')[0].match(/1\/(\d+)/)[1]);
const visitedDisplays = new Set();
for (let page = 0; page < screenPages; ++page) {
    for (const group of lastMenu.groups) visitedDisplays.add(group.display);
    assert.ok(lastMenu.text.split('\n').length * 18 + 28 <= screen.height * 0.9);
    press('pageDown');
}
assert.equal(visitedDisplays.size, 40); press('escape'); idle();
// Growing taller must still reserve selection keys for the other displays.
const crowded = Array.from({length: 60}, (_, i) => ({id: 2000+i,index: i+1,display:1,type:'float','is-visible':i===0}));
open(); press('m', ['shift']); refresh(); reply(threeDisplays); reply([...crowded, remote, thirdSpace]);
assert.deepEqual(Array.from(lastMenu.groups, g => g.display), [1,2,3]);
press('escape'); idle();
// Resize the selected frame without depending on a focused application window.
for (const [key, amount] of [['h','horizontal:-40'],['l','horizontal:40'],['k','vertical:-40'],['j','vertical:40']]) {
    open(space, []); press('r', ['shift']); press(key); expectCommand(['space','2','--resize-frame',amount]);
    reply(null); assert.ok(lastMenu.text.includes('Resize frame')); press('escape'); refresh(); press('escape'); idle();
}
for (const [key, axis] of [['h','horizontal'],['v','vertical'],['b','both']]) {
    open(); press('e', ['shift']); press(key); expectCommand(['space','2','--equalize-frames',axis]);
    reply(null); refresh(); press('escape'); idle();
}
open(); press('e', ['shift']); press('escape'); refresh(); press('escape'); idle();
// Fixed ratios describe left:right regardless of the selected side; numbers
// in the sizes submenu do not trigger the main menu's layout shortcuts.
for (const [key, ratio] of [['1','1:2'],['2','1:1'],['3','2:1']]) {
    open(space, []); press('e', ['shift']); press(key);
    expectCommand(['space','2','--frame-ratio','horizontal:' + ratio]);
    reply(null); refresh(); press('escape'); idle();
}
// Search sends the complete window snapshot (including later pages), and text
// entry stays native: no window hint or layout keys intercept the query.
open(badgeSpace); press('/'); reply([badgeSpace]); reply(windows.map(w => ({...w, space: 2})));
assert.equal(lastMenu.search.length, 2); // Empty frame is not a window match.
assert.equal(lastMenu.search[0].text, 'Terminal: One');
assert.equal(keys.size, 7); // Six global shortcuts and Escape remain.
assert.equal(tasks.length, 0);
const [searchId, searchCallback] = [...renderers.entries()][0];
renderers.delete(searchId); searchCallback({status:0, output:JSON.stringify({selection:1})});
expectCommand(['window','--focus','20']); reply(null); idle();
open({ ...space, type:'float' }, withRects); press('/'); reply([space]); reply(withRects.map(w => ({...w, space: 2})));
assert.equal(lastMenu.search.length, 80);
const [cancelSearchId, cancelSearch] = [...renderers.entries()][0];
press('escape'); cancelSearch({status:0,output:'{"selection":0}'});
assert.equal(tasks.length, 0); idle();
// Malformed/out-of-range native selections never execute a window command.
open(); press('/'); reply([space]); reply(windows.map(w => ({...w, space:2}))); const [invalidSearchId, invalidSearch] = [...renderers.entries()][0];
renderers.delete(invalidSearchId); invalidSearch({status:0,output:'{"selection":999}'});
assert.equal(tasks.length,0); idle();
// Search spans hidden desktops and includes minimized windows, without adding
// their stale coordinates as on-screen badges. Selecting restores and follows.
open(); press('/'); expectCommand(['query','--spaces']); reply(desktops);
expectCommand(['query','--windows']); reply([
    {...windows[0], space:2},
    {id:99,space:4,app:'Editor',title:'Hidden desktop',frame:{x:0,y:0,w:500,h:400},'is-minimized':true},
    {id:100,space:3,app:'Browser',title:'Other screen',frame:{x:-800,y:0,w:500,h:400}}
]);
assert.equal(lastMenu.search.length,3);
assert.equal(lastMenu.search[1].rect,undefined);
assert.ok(lastMenu.search[1].label.includes('S4 (2)'));
const [globalSearchId, globalSearch] = [...renderers.entries()][0]; renderers.delete(globalSearchId);
globalSearch({status:0,output:'{"selection":1}'});
reply(desktops); reply(space); expectCommand(['space','--focus','4']); reply(null); reply(desktop);
expectCommand(['query','--windows','--window','99']); reply({id:99,space:4,'is-minimized':true});
expectCommand(['window','--deminimize','99']); reply(null); reply({id:99,space:4,'is-minimized':false});
expectCommand(['window','--focus','99']); reply(null); refresh(desktop); press('escape'); idle();
open(); press('/'); press('escape'); reply(desktops); assert.equal(tasks.length,0); idle();
// The move chooser must include a remote empty frame, even when its source
// is on another display or uses a different layout.
const moveTargetSpace = { ...remote, type:'ratpoison', frames:[
    {id:0,selected:true,windows:Array.from({length:32},(_,i)=>200+i),x:-1000,y:0,w:500,h:700},
    {id:4,selected:false,windows:[300],x:-500,y:0,w:500,h:350},
    {id:3,selected:false,windows:[],x:-500,y:350,w:500,h:350}
]};
const moveSpaces = [space, moveTargetSpace, desktop];
function openRemoteMove(type = 'ratpoison') {
    const sourceSpace = {...space,type};
    open(sourceSpace); press('m',['shift']); refresh(sourceSpace); reply(displays); reply(moveSpaces);
    assert.ok(lastMenu.text.includes('S3 (2) F3 [empty]'));
    const target = lastMenu.badges.find(b=>b.display===2 && b.rect.y===350);
    assert.ok(target, 'Remote empty frame must have a matching centered label');
    press(target.key); expectCommand(['query','--spaces']);
}
for (const type of ['ratpoison','float','bsp']) {
    openRemoteMove(type); reply(moveSpaces);
    expectCommand(['space','3','--select-frame','3']); reply(null);
    expectCommand(['window','10','--space','3']); reply(null);
    expectCommand(['query','--windows','--window','10']); reply({id:10,space:3});
    expectCommand(['window','10','--frame','3']); reply(null);
    expectCommand(['window','--focus','10']); reply(null);
    refresh(moveTargetSpace); press('escape'); idle();
}
// Stale or full frame targets fail before switching or moving anything.
for (const frames of [moveTargetSpace.frames.filter(f=>f.id!==3),
                      moveTargetSpace.frames.map(f=>f.id===3?{...f,windows:Array.from({length:32},(_,i)=>400+i)}:f)]) {
    openRemoteMove(); reply([space,{...moveTargetSpace,frames}]);
    assert.equal(tasks.length,0); context.yabaiRatpoison.cancel(); idle();
}
// Cancellation while selecting the remote frame must not subsequently transfer.
openRemoteMove(); reply(moveSpaces);
expectCommand(['space','3','--select-frame','3']); press('escape'); reply(null);
assert.equal(tasks.length,0); idle();
// A rejected transfer stops before any Space/window focus or frame placement.
openRemoteMove(); reply(moveSpaces);
expectCommand(['space','3','--select-frame','3']); reply(null);
expectCommand(['window','10','--space','3']); reply(null, 1);
assert.equal(tasks.length, 0); context.yabaiRatpoison.cancel(); idle();
// Temporary fullscreen addresses the selected frame's front window and closes
// the menu. Repeating sends the same native toggle; no layout mutation occurs.
for (let i = 0; i < 2; ++i) {
    open(); press('z', ['shift']);
    expectCommand(['window', '10', '--toggle', 'windowed-fullscreen']);
    reply(null); idle();
}
open({...space, frames: space.frames.map(f => ({...f, selected: f.id === 7}))});
press('z', ['shift']); assert.equal(tasks.length, 0); press('escape'); idle();
open({...space, type: 'float'}); press('z', ['shift']);
expectCommand(['window', '10', '--toggle', 'windowed-fullscreen']); reply(null); idle();
// Shift-W removes; Shift-R never accidentally removes a frame.
open(); press('w',['shift']); expectCommand(['space','2','--remove-frame']); reply(null); refresh(); press('escape'); idle();
const stacked = {...space,frames:[{...space.frames[0],windows:[10,20,30],'active-window':10}]};
for (const [key,id] of [['j','20'],['k','30']]) {
    open(stacked); press(key,['shift']); expectCommand(['window','--focus',id]); reply(null); refresh(stacked); press('escape'); idle();
}
open({...space,frames:space.frames.map(f=>({...f,selected:f.id===7}))});
press('j',['shift']); press('k',['shift']); assert.equal(tasks.length,0); press('escape'); idle();
context.yabaiRatpoison.configure({font:'Menlo',fontSize:18,selectionWeight:'bold',colors:{title:'#abcdef'},displayColors:['#ff8800']});
press('s', ['cmd']); refresh(); assert.equal(lastMenu.theme.font,'Menlo'); assert.equal(lastMenu.theme.fontSize,18);
assert.equal(lastMenu.theme.colors.title,'#abcdef'); press('escape'); idle();
context.yabaiRatpoison.configure({font:'GoMono Nerd Font Mono',fontSize:12,colors:{},displayColors:['#55ffff','#ff55ff']});
// Native rendering failure closes the session, with an explicit fallback error.
open(); const [badId, badCallback] = [...renderers.entries()][0];
renderers.delete(badId); badCallback({ status: 1, error: 'missing font' }); idle();
// Retain the actual compact-menu payload for native rendering verification.
fs.writeFileSync('/tmp/yabai-prefix-test-menu.json', JSON.stringify(lastMenu));
console.log('Phoenix navigation, layout, display/Space moves, pagination, and renderer lifecycle tests passed');

press('f', ['ctrl']); expectCommand(['window', '--toggle', 'windowed-fullscreen']); reply(null); idle();
open();
const retainedRenderer = [...renderers.keys()][0];
press('j', ['shift']); reply(null);
const malformed = tasks.shift(); malformed.callback({ status: 0, output: '{', error: '' });
assert.equal([...renderers.keys()][0], retainedRenderer);
const queryRetry = [...timers.entries()].find(([, timer]) => timer.delay === 0.05);
assert.ok(queryRetry); timers.delete(queryRetry[0]); queryRetry[1](); refresh();
assert.equal([...renderers.keys()][0], retainedRenderer);
press('escape'); idle();

// Keep identifiers and real shortcuts when the front of a stack changes.
open();
function selectedCell() {
    assert.equal(lastMenu.selections.length, 1);
    const span = lastMenu.selections[0];
    return lastMenu.text.split('\n')[span.line].slice(span.start, span.start + span.length);
}
assert.match(selectedCell(), /^> 0 S2 \(1\) W0 .*Terminal/);
press('j', ['shift']); expectCommand(['window', '--focus', '20']); reply(null);
const editorFront = {...space, frames: space.frames.map(f => f.id === 0 ? {...f, 'active-window': 20} : f)};
refresh(editorFront, windows.map(w => ({...w, 'has-focus': w.id === 20})));
assert.match(selectedCell(), /^> 1 S2 \(1\) W1 .*Editor/);
press('0'); expectCommand(['window', '--focus', '10']); reply(null); idle();
// Closing W0 frees exactly W0, leaving W1 unchanged; the new window gets W0.
const replacement = {id:30,app:'Browser',title:'New',frame:windows[0].frame};
const replacementSpace = {...space, frames:[{...space.frames[0],windows:[20,30],'active-window':20}]};
press('s',['cmd']); refresh(replacementSpace,[windows[1],replacement]);
assert.match(selectedCell(), /^> 1 S2 \(1\) W1 .*Editor/);
press('0'); expectCommand(['window','--focus','30']); reply(null); idle();
// Space UUID, rather than changeable Mission Control index, scopes numbers.
open({...space,uuid:'stable-space'});
press('escape');
press('s',['cmd']); refresh({...editorFront,id:909,index:8,uuid:'stable-space'});
assert.match(selectedCell(), /^> 1 S8 \(1\) W1 .*Editor/);
press('escape'); idle();
// Selected empty frames also carry an explicit selected cell span.
open({...space,frames:space.frames.map(f=>({...f,selected:f.id===7}))});
assert.match(selectedCell(), /^> a .*F7 \[empty\]/); press('escape'); idle();
// Configuration runs separately from prefix rendering, ignores duplicate opens,
// and replaces its saved theme layer so resetting an optional color takes effect.
open(); press('c',['shift']);
assert.equal(tasks[0].args[1], '--configure');
assert.equal(renderers.size,0);
press('s',['cmd']); assert.equal(tasks.length,1);
reply({theme:{colors:{hintText:'#112233'}}});
press('s',['cmd']); refresh(); assert.equal(lastMenu.theme.colors.hintText,'#112233');
press('c',['shift']); reply({theme:{}});
press('s',['cmd']); refresh(); assert.equal(lastMenu.theme.colors.hintText,undefined);
press('escape'); idle();
console.log('Stable per-Space window numbers, selected cells, and configuration integration tests passed');

// Overlay keys distinguish the actual focused window, each frame's front,
// and covered stack entries, even when their labels share one rectangle.
const overlaySpace = {...space, frames:[space.frames[0], {...space.frames[1], windows:[30], 'active-window':30}]};
const overlayWindows = windows.concat([{id:30, app:'Browser',title:'Front','has-focus':false,frame:windows[0].frame}]);
open(overlaySpace, overlayWindows);
assert.equal(lastMenu.badges.find(b => b.key === '0').state, 'focused');
assert.equal(lastMenu.badges.find(b => b.key === '1').state, 'covered');
assert.equal(lastMenu.badges.find(b => b.key === '2').state, 'front');
assert.equal(lastMenu.groups.filter(g=>g.selected).length,1);
assert.equal(lastMenu.groups.find(g=>g.selected).display,space.display);
assert.equal(lastMenu.highlights.filter(h=>h.state==='front').length,1);
const frontHighlight=lastMenu.highlights.find(h=>h.state==='front');
assert.ok(lastMenu.text.split('\n')[frontHighlight.line].slice(frontHighlight.start,frontHighlight.start+frontHighlight.length).includes('Browser: Front'));

press('escape'); idle();

// Covered windows have distinct stable colors shared by menu cells and
// frame index labels. Focus/stack ordering must not recolor their identities.
const colorSpace = {...space,frames:[{...space.frames[0],windows:[10,20,30,40]},space.frames[1]]};
const colorWindows = windows.concat([{id:30,app:'Editor',title:'Covered Three','has-focus':false},
                                    {id:40,app:'Editor',title:'Covered Four','has-focus':false}]);
open(colorSpace,colorWindows);
const faint = lastMenu.badges.filter(b=>b.state==='covered');
assert.equal(faint.length,3);
assert.equal(new Set(faint.map(b=>b.color)).size,3);
const originalFaint = Object.fromEntries(faint.map(b=>[b.key,b.color]));
for (const badge of faint) {
    assert.match(badge.color,/^#[0-9a-f]{6}$/);
    const highlight=lastMenu.highlights.find(h=>h.color===badge.color);
    assert.ok(highlight);
    assert.equal(highlight.state,'covered');
    assert.ok(lastMenu.text.split('\n')[highlight.line].slice(highlight.start,highlight.start+highlight.length).includes('W'+badge.key));
}
press('escape'); idle();
press('s',['cmd']); refresh({...colorSpace,frames:[{...colorSpace.frames[0],'active-window':20},space.frames[1]]},
                            colorWindows.map(w=>({...w,'has-focus':w.id===20})));
for (const key of ['2','3']) assert.equal(lastMenu.badges.find(b=>b.key===key).color,originalFaint[key]);
press('escape'); idle();
press('s',['cmd']); refresh(colorSpace,colorWindows);
assert.equal(lastMenu.badges.find(b=>b.key==='1').color,originalFaint['1']);
press('escape'); idle();
// Minimized windows are visible in the overview, gray, and have no index
// overlay at their old location. Choosing one restores it before focusing.
const minimizedWindow = {id:50,app:'Editor',title:'Minimized',frame:{x:0,y:0,w:500,h:400},'is-minimized':true,'has-focus':false};
const minSpace = {...space,type:'float'};
open(minSpace,windows.concat([minimizedWindow]));
assert.ok(lastMenu.text.includes('[minimized]'));
assert.equal(lastMenu.highlights.filter(h=>h.state==='minimized').length,1);
assert.ok(!lastMenu.badges.some(b=>b.key==='2'));
press('2'); expectCommand(['query','--spaces']); reply([minSpace]);
expectCommand(['query','--spaces','--space']); reply(minSpace);
expectCommand(['query','--windows','--window','50']); reply({...minimizedWindow,space:2});
expectCommand(['window','--deminimize','50']); reply(null);
expectCommand(['query','--windows','--window','50']); reply({...minimizedWindow,space:2,'is-minimized':false});
expectCommand(['window','--focus','50']); reply(null); refresh(minSpace); press('escape'); idle();
open(space,windows.concat([minimizedWindow]));
assert.ok(lastMenu.highlights.some(h=>h.state==='minimized'));
assert.ok(!lastMenu.badges.some(b=>b.key==='2')); press('escape'); idle();
// Warm cached display is immediate, but stale digit bindings never execute.
open();
const residentBefore = resident;
press('escape');
const background = [...timers.entries()].find(([, timer]) => timer.delay === 0.08);
assert.ok(background); timers.delete(background[0]); background[1](); refresh();
assert.equal(renderers.size, 0);
assert.equal(keys.size, 6);
press('s', ['cmd']);
assert.ok(lastMenu.groups.length > 0);
assert.equal(resident, residentBefore);
assert.ok([...keys.values()].some(k => k.key === '0' && !k.mods.length));
press('0');
assert.ok(tasks.every(t => t.args[1] === 'query'), 'cached input waits for validation');
refresh();
expectCommand(['window','--focus','10']); reply(null); idle();
// Display invalidation discards geometry before another open.
events.get('screensDidChange')();
press('s', ['cmd']); assert.ok(lastMenu.text.includes('Loading windows'));
press('escape'); reply(space); idle();
console.log('Resident reuse, background preparation, stale-key guards and topology invalidation passed');

// A Phoenix config reload explicitly retires the preceding renderer.
const saved = new Map();
context.Storage = {get:key => saved.get(key),set:(key,value) => saved.set(key,value)};
resetShortcuts();
const firstToken = saved.get('yabaiRatpoisonRenderer');
assert.ok(firstToken);
const countBeforeReload = residentMessages.filter(m => m.action === 'quit').length;
resetShortcuts();
assert.equal(residentMessages.filter(m => m.action === 'quit').length, countBeforeReload + 1);
assert.notEqual(saved.get('yabaiRatpoisonRenderer'), firstToken);

// Reusing a digit for a different window must not redirect buffered input.
open(); press('escape'); press('s',['cmd']); press('0');
const withoutTerminal = {...space,frames:space.frames.map(f => f.id === 0 ? {...f,windows:[20],'active-window':20} : f)};
refresh(withoutTerminal,[windows[1]]);
assert.equal(tasks.length,0);
assert.equal(renderers.size,1);
press('escape'); idle();

// A partial or unknown schema cannot enable cached selection bindings.
for (const bad of [{version:2}, {...snapshot(),windows:{}}, {...snapshot(),displays:null}]) {
    resetShortcuts(); press('s',['cmd']); reply(bad);
    assert.ok(![...keys.values()].some(k => k.key === '0' && !k.mods.length));
    press('escape'); idle();
}
console.log('Compact snapshot schema validation and single-request chooser passed');
