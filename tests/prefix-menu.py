"""Native prefix renderer checks. Requires macOS and GoMono Nerd Font Mono.
Run after make: python3 tests/prefix-menu.py
Snapshots are generated off-screen, without showing or focusing a window.
"""
import json
from pathlib import Path
import struct
import subprocess
import time
import uuid
import unittest
import zlib

ROOT = Path(__file__).resolve().parents[1]
BINARY = ROOT / 'bin/yabai-prefix'
OUTPUT = ROOT / 'tests/bin'


class PrefixMenuTests(unittest.TestCase):
    def render(self, name, text, screen, groups=None, badges=None, theme=None, selections=None, highlights=None):
        OUTPUT.mkdir(exist_ok=True)
        path = OUTPUT / name
        result = subprocess.run(
            [str(BINARY), '--snapshot', str(path), json.dumps({'text': text, 'screen': screen, 'groups': groups or [], 'badges': badges or [], 'theme': theme or {}, 'selections': selections or [], 'highlights': highlights or []})],
            capture_output=True, text=True, check=True,
        )
        metrics = json.loads(result.stdout)
        self.assertIn((theme or {}).get('font', 'GoMono').split()[0], metrics['font'])
        self.assertEqual(metrics['size'], (theme or {}).get('fontSize', 12))
        self.assertLessEqual(metrics['width'], screen['width'] - 32)
        self.assertLessEqual(metrics['height'], screen['height'] - 32)
        image = path.read_bytes()
        self.assertEqual(image[:8], b'\x89PNG\r\n\x1a\n')
        chunks = {}
        offset = 8
        while offset < len(image):
            length = struct.unpack('>I', image[offset:offset + 4])[0]
            kind = image[offset + 4:offset + 8]
            chunks[kind] = chunks.get(kind, b'') + image[offset + 8:offset + 8 + length]
            offset += 12 + length
        width, height, depth, color, _, _, interlace = struct.unpack('>IIBBBBB', chunks[b'IHDR'])
        self.assertGreater(width, 0)
        self.assertGreater(height, 0)
        self.assertEqual(depth, 8)
        self.assertEqual(interlace, 0)
        self.assertIn(color, (2, 6))  # RGB or RGBA
        # All PNG predictors are zero at the first pixel of the first row.
        row = zlib.decompress(chunks[b'IDAT'])
        expected = (theme or {}).get('colors', {}).get('background', '#000000')
        if expected == '#000000':
            self.assertEqual(row[1:4], b'\x00\x00\x00', 'default background must be black')
        else:
            # Snapshot RGB channels are transformed by the display color profile.
            self.assertNotEqual(row[1:4], b'\x00\x00\x00', 'custom background must be applied')
        if color == 6:
            self.assertEqual(row[4], 255, 'background must be fully opaque')
        return metrics

    def test_persistent_session_updates(self):
        # Off-screen panel: exercise real IPC without stealing focus or flashing a HUD.
        token = str(uuid.uuid4())
        payload = {'text': 'YABAI first', 'search': None, 'screen': {'x': -20000, 'y': -20000, 'width': 1000, 'height': 800}}
        process = subprocess.Popen([str(BINARY), '--session', token, json.dumps(payload)])
        try:
            time.sleep(0.3)
            for text in ['YABAI second', 'YABAI third\n0 window']:
                payload['text'] = text
                result = subprocess.run([str(BINARY), '--update', token, json.dumps(payload)], timeout=3)
                self.assertEqual(result.returncode, 0)
                self.assertIsNone(process.poll(), 'updates must retain the native renderer process')
            invalid = subprocess.run([str(BINARY), '--update', token, '[]'], timeout=3)
            self.assertNotEqual(invalid.returncode, 0)
            self.assertIsNone(process.poll(), 'invalid updates must not kill a live menu')
        finally:
            process.terminate()
            process.wait(timeout=3)

    def test_resident_socket_lifecycle(self):
        token = str(uuid.uuid4())
        process = subprocess.Popen([str(BINARY), '--serve', token])
        client = ROOT / 'bin/yabai-prefix-client'
        payload = {'text':'YABAI resident', 'screen':{'x':-20000,'y':-20000,'width':1000,'height':800},
                   'badges':[{'key':'0','display':1,'state':'focused','rect':{'x':-20000,'y':-20000,'w':400,'h':300}}]}
        def request(action, revision, data=None):
            message = dict(action=action,revision=revision)
            if data is not None: message['payload'] = data
            result = subprocess.run([str(client),token,json.dumps(message)],capture_output=True,text=True,timeout=3)
            return result, json.loads(result.stdout)
        try:
            result, state = request('prepare',1,payload)
            self.assertEqual(result.returncode,0)
            self.assertFalse(state['visible'])
            import os, stat
            path = Path('/tmp') / ('yabai-prefix-%s-%s.sock' % (os.getuid(),token))
            self.assertEqual(stat.S_IMODE(path.stat().st_mode),0o600)
            _, state = request('show',2)
            self.assertTrue(state['visible']); self.assertTrue(state['reused'])
            _, state = request('hide',4)
            self.assertFalse(state['visible'])
            result, state = request('show',3)
            self.assertNotEqual(result.returncode,0); self.assertFalse(state['visible'])
            result, state = request('update',5,{'text':123})
            self.assertNotEqual(result.returncode,0)
            self.assertIsNone(process.poll())
            _, state = request('show',6)
            self.assertTrue(state['visible']); self.assertTrue(state['reused'])
            for revision in range(7,27):
                _, state = request('hide' if revision % 2 else 'show',revision)
                self.assertEqual(state['visible'],revision % 2 == 0)
            _, state = request('stats',27)
            self.assertTrue(state['visible'])
            result, _ = request('quit',0)
            self.assertEqual(result.returncode,0)
            process.wait(timeout=3)
        finally:
            process.terminate(); process.wait(timeout=3)
        self.assertFalse(path.exists())

    def test_terminal_menu(self):
        text = '\n'.join([
            'YABAI  ratpoison  |  windows / frames  |  1/3',
            '1 ratpoison   2 floating   3 bsp', '',
            '0 * F0 Terminal: ~/Software/yabai      b   F1 Firefox: Project docs',
            '4   F2 [empty]                        c   F3 Preview: Design notes',
            '5   F0 Emacs: init.el                  d   F3 Terminal: build log', '',
            'arrows/hjkl focus   [ ] page   Esc close',
            'Shift-T toggle ratpoison / floating',
            'Shift-S/V split   Shift-F frames   Shift-M move',
            'Shift-R remove    Shift-O only     Tab next',
        ])
        metrics = self.render('prefix-wide.png', text, {'x': 0, 'y': 0, 'width': 1440, 'height': 900})
        self.assertLess(metrics['height'], 300)

    def test_negative_origin_small_screen(self):
        self.render('prefix-small.png', 'YABAI  ratpoison\n1 ratpoison  2 floating  3 bsp\n\n0 * F1 [empty]\nEsc close',
                    {'x': -800, 'y': 200, 'width': 800, 'height': 500})

    def test_display_groups(self):
        text = '\n'.join([
            'YABAI  ratpoison  |  visible windows / frames  |  1/1',
            '1 ratpoison   2 floating   3 bsp', '',
            '┌ Display 1 ──────────────────────────────────────────┐',
            '│ 0 S1 (1) * F0 Terminal: build                        │',
            '│ 4 S1 (1)   F1 [empty]                               │',
            '└─────────────────────────────────────────────────────┘',
            '┌ Display 2 ──────────────────────────────────────────┐',
            '│ 5 S3 (2)   Browser: Project docs                     │',
            '│ 6 S3 (2)   Editor: notes                             │',
            '└─────────────────────────────────────────────────────┘', '',
            'arrows/hjkl focus   [ ] page   Esc close',
        ])
        text = '\n'.join(line[:-1].ljust(54) + '│' if line.startswith('│') else line for line in text.split('\n'))
        self.render('prefix-groups.png', text, {'x': 0, 'y': 0, 'width': 1440, 'height': 900},
                    [{'start': 3, 'end': 6, 'display': 1}, {'start': 7, 'end': 10, 'display': 2}])

    def test_hint_coordinates_and_stacks(self):
        badges = [
            {'key': '0', 'state':'focused', 'display': 1, 'rect': {'x': 0, 'y': 0, 'w': 200, 'h': 100}},
            {'key': '4', 'display': 1, 'rect': {'x': 0, 'y': 0, 'w': 200, 'h': 100}},
            {'key': '5', 'display': 2, 'rect': {'x': -1000, 'y': -300, 'w': 400, 'h': 200}},
        ]
        metrics = self.render('prefix-hints.png', 'YABAI\n0 4 5',
                              {'x': 0, 'y': 0, 'width': 1440, 'height': 900}, badges=badges)
        first, second = metrics['badges']
        self.assertEqual(first['keys'], '0 4')
        self.assertEqual(first['states'], ['focused', 'normal'])
        self.assertEqual(first['cx'], 100)
        self.assertEqual(second['cx'], -800)
        self.assertEqual(second['cy'] - first['cy'], 250)
        self.assertEqual(first['x'] + first['width'] / 2, first['cx'])
        self.assertEqual(first['y'] + first['height'] / 2, first['cy'])
        self.assertTrue((OUTPUT / 'prefix-hints.png.hint.png').exists())
        self.assertLess(first['width'], 100)
        self.assertLess(first['height'], 40)

    def test_transient_hint_geometry(self):
        good = {'x': 0, 'y': 0, 'w': 200, 'h': 100}
        stale = [dict(good, w=0), dict(good, h=-1), dict(good, x=None),
                 dict(good, y=1000001), {}, None]
        for rect in stale:
            metrics = self.render('prefix-transient.png', 'YABAI\n0 good 4 transitioning',
                                  {'x': 0, 'y': 0, 'width': 1440, 'height': 900}, badges=[
                                      {'key': '0', 'display': 1, 'rect': good},
                                      {'key': '4', 'display': 2, 'rect': rect}])
            self.assertEqual([b['keys'] for b in metrics['badges']], ['0'])
        # A bad rectangle must not prevent searching or selecting that window.
        state = self.search([{'index': 0, 'display': 1, 'label': 'Editor',
                              'text': 'Editor', 'rect': dict(good, w=0)}])
        self.assertEqual(state['indices'], [0])

    def search(self, entries, query='', selected=0):
        OUTPUT.mkdir(exist_ok=True)
        payload = {'text': 'Window search', 'search': entries, 'query': query, 'selected': selected,
                   'screen': {'x': 0, 'y': 0, 'width': 1400, 'height': 1000}}
        result = subprocess.run([str(BINARY), '--snapshot', str(OUTPUT / 'prefix-search.png'), json.dumps(payload)],
                                capture_output=True, text=True, check=True)
        return json.loads(result.stdout)['search']

    def test_incremental_search_groups_and_unicode(self):
        entries = [
            {'index': 0, 'display': 2, 'label': 'S3 (2) Editor: Café notes', 'text': 'Editor: Café notes',
             'rect': {'x': -1000, 'y': 0, 'w': 600, 'h': 800}},
            {'index': 1, 'display': 1, 'label': 'S1 (1) Terminal: build', 'text': 'Terminal: build'},
            {'index': 2, 'display': 1, 'label': 'S1 (1) Editor: README', 'text': 'Editor: README'},
        ]
        all_results = self.search(entries)
        self.assertEqual([g['display'] for g in all_results['groups']], [1, 2])
        filtered = self.search(entries, 'EDITOR')
        self.assertEqual(filtered['indices'], [2, 0])
        self.assertEqual([g['display'] for g in filtered['groups']], [1, 2])
        narrowed = self.search(entries, 'editor cafe')
        self.assertEqual(narrowed['indices'], [0])
        self.assertEqual(narrowed['badges'][0]['rect']['x'], -1000)
        self.assertEqual(self.search(entries, 'no such window')['indices'], [])
        self.assertEqual(len(self.search(entries, '')['matches']), 3)
        self.search(entries, 'editor') # Keep a grouped snapshot for visual inspection.

    def test_search_pages_and_selection(self):
        entries = [{'index': i, 'display': i % 3 + 1, 'label': f'Window {i}', 'text': f'Window {i}'} for i in range(80)]
        state = self.search(entries, selected=79)
        self.assertGreater(len(state['pages']), 1)
        self.assertIn(state['matches'][79]['index'], state['indices'])
        self.assertLessEqual(len(state['indices']), 29)
        self.assertEqual(self.search(entries, 'Window 79')['indices'], [79])

    def test_search_keyboard_controller(self):
        OUTPUT.mkdir(exist_ok=True)
        binary = OUTPUT / 'prefix-search-test'
        subprocess.run(['xcrun', 'clang', str(ROOT / 'tests/prefix-search.m'), '-fobjc-arc',
                        '-Wno-unused-parameter', '-framework', 'Cocoa', '-o', str(binary)], check=True, capture_output=True)
        subprocess.run([str(binary)], check=True, capture_output=True)

    def test_configuration_controller(self):
        OUTPUT.mkdir(exist_ok=True)
        binary = OUTPUT / 'prefix-config-test'
        subprocess.run(['xcrun', 'clang', str(ROOT / 'tests/prefix-config.m'), '-fobjc-arc',
                        '-Wno-unused-parameter', '-framework', 'Cocoa', '-o', str(binary)], check=True, capture_output=True)
        subprocess.run([str(binary)], check=True, capture_output=True)

    def test_theme_font_size_and_colors(self):
        theme = {'font': 'Menlo', 'fontSize': 18, 'selectionWeight': 'bold',
                 'displayColors': ['#ff8800', '#88ff00'],
                 'colors': {'background': '#112233', 'text': '#dddddd', 'title': '#ff8800',
                            'selectionText': '#ffffff', 'selectionBackground': '#554400'}}
        self.render('prefix-themed.png', 'Window search\n/ editor\n\n│ > 0 Editor: notes │\nPage 1/1',
                    {'x': 0, 'y': 0, 'width': 1400, 'height': 1000}, theme=theme)

    def test_sparse_row_highlight_stays_in_selected_column(self):
        OUTPUT.mkdir(exist_ok=True)
        binary = OUTPUT / 'prefix-selection-test'
        subprocess.run(['xcrun', 'clang', str(ROOT / 'tests/prefix-selection.m'), '-fobjc-arc',
                        '-Wno-unused-parameter', '-framework', 'Cocoa', '-o', str(binary)], check=True, capture_output=True)
        subprocess.run([str(binary)], check=True, capture_output=True)

    def test_selected_cell_range(self):
        text = 'YABAI  ratpoison\nr ratpoison f floating b bsp\n\n│ 0 S1 (1) W0 Terminal    > 4 S1 (1) W1 Editor    │'
        row = text.split('\n')[-1]
        selections = [{'line': 3, 'start': row.index('>'), 'length': 24}]
        metrics = self.render('prefix-selected-cell.png', text,
                              {'x': 0, 'y': 0, 'width': 1400, 'height': 1000}, selections=selections)
        self.assertEqual(metrics['selections'], selections)

    def test_display_and_visible_window_highlights(self):
        text = 'YABAI  ratpoison\nr ratpoison f floating b bsp\n\n┌ Display 1 * ──────────────────────────────────────────┐\n│ > 0 * F0 Focused       1 F1 Visible                    │\n│   2 F2 [empty]                                        │\n└──────────────────────────────────────────────────────┘'
        lines = text.split('\n')
        highlights = [dict(line=4, start=2, length=20, state='focused'),
                      dict(line=4, start=24, length=20, state='front'),
                      dict(line=5, start=2, length=14, state='empty')]
        groups = [dict(start=3, end=6, display=1, selected=True)]
        badges = [dict(key='0',display=1,state='focused',rect=dict(x=0,y=0,w=300,h=200)),
                  dict(key='1',display=1,state='front',rect=dict(x=300,y=0,w=300,h=200)),
                  dict(key='2',display=1,state='empty',rect=dict(x=600,y=0,w=300,h=200))]
        metrics = self.render('prefix-visual-step1.png', text,
                              dict(x=0,y=0,width=1400,height=1000), groups=groups,
                              badges=badges, highlights=highlights, selections=[dict(line=4,start=2,length=20)])
        self.assertEqual(metrics['groups'],groups)
        self.assertEqual(metrics['highlights'],highlights)
        self.assertEqual([b['states'] for b in metrics['badges']],[['focused'],['front'],['empty']])

    def test_covered_and_minimized_colors(self):
        text = '\n'.join(['YABAI  ratpoison','r ratpoison f floating b bsp','',
                         '┌ Display 1 * ──────────────────────────────┐',
                         '│ > 0 * F0 Focused       1 F1 Visible         │',
                         '│   2 F0 Covered A      3 F0 Covered B       │',
                         '│   4 F2 [empty]        5 Editor [minimized]  │',
                         '└───────────────────────────────────────────┘'])
        groups = [dict(start=3,end=7,display=1,selected=True)]
        highlights = [dict(line=4,start=2,length=20,state='focused'),dict(line=4,start=24,length=20,state='front'),
                      dict(line=5,start=2,length=18,state='covered',color='#966454'),
                      dict(line=5,start=24,length=18,state='covered',color='#54967a'),
                      dict(line=6,start=2,length=14,state='empty'),dict(line=6,start=24,length=20,state='minimized')]
        rect=dict(x=0,y=0,w=400,h=300)
        badges=[dict(key='0',display=1,rect=rect,state='focused'),
                dict(key='2',display=1,rect=rect,state='covered',color='#966454'),
                dict(key='3',display=1,rect=rect,state='covered',color='#54967a')]
        metrics=self.render('prefix-visual-final.png',text,dict(x=0,y=0,width=1400,height=1000),
                            groups=groups,highlights=highlights,badges=badges,
                            selections=[dict(line=4,start=2,length=20)])
        self.assertEqual(metrics['highlights'],highlights)
        self.assertEqual(metrics['badges'][0]['colors'],[None,'#966454','#54967a'])
        self.assertEqual(metrics['badges'][0]['states'],['focused','covered','covered'])
        # Native search must preserve a covered window's color in both places.
        entries=[dict(index=0,display=1,label='Covered A',text='Covered A',rect=rect,state='covered',color='#966454'),
                 dict(index=1,display=1,label='Editor [minimized]',text='Editor',state='minimized')]
        result=self.search(entries)
        self.assertEqual(result['highlights'][0]['color'],'#966454')
        self.assertEqual(result['badges'][0]['color'],'#966454')
        self.assertEqual(result['highlights'][1]['state'],'minimized')

    def test_normal_menu_null_search_and_phoenix_payload(self):
        OUTPUT.mkdir(exist_ok=True)
        subprocess.run(['node', str(ROOT / 'tests/phoenix-ratpoison.js')], cwd=ROOT,
                       check=True, capture_output=True)
        payload = json.loads(Path('/tmp/yabai-prefix-test-menu.json').read_text())
        self.assertNotIn('search', payload)
        for explicit_null in (False, True):
            if explicit_null:
                payload['search'] = None
            result = subprocess.run([str(BINARY), '--snapshot', str(OUTPUT / 'prefix-phoenix.png'),
                                     json.dumps(payload)], check=True, capture_output=True, text=True)
            self.assertEqual(json.loads(result.stdout)['search'], {})

    def test_invalid_payload(self):
        for value in [json.dumps({'text':'test','highlights':[{'line':0,'start':0,'length':1,'state':'covered','color':'red'}]}),
                      json.dumps({'text':'test','badges':[{'key':'0','display':1,'state':'covered','color':'red','rect':{'x':0,'y':0,'w':100,'h':100}}]}),
                      json.dumps({'text':'test','highlights':[{'line':0,'start':0,'length':99,'state':'front'}]}),
                      json.dumps({'text':'test','highlights':[{'line':0,'start':0,'length':1,'state':'invalid'}]}),
                      json.dumps({'text':'test','selections':[{'line':0,'start':0,'length':99}]}),
                      json.dumps({'text':'test','selections':[{'line':0,'start':-1,'length':1}]}),
                      json.dumps({'text':'test','theme':{'fontSize':0}}),
                      json.dumps({'text':'test','theme':{'colors':{'text':'red'}}}),
                      json.dumps({'text':'test','theme':{'displayColors':[]}}),
                      json.dumps({'text':'test','theme':{'font':'DefinitelyNotInstalledFont'}}),
                      json.dumps({'text': 'test', 'search': [None]}), json.dumps({'text': 'test', 'badges': [{'key': '0', 'rect': {}}]}),
                      json.dumps({'text': 'test', 'badges': [None] * 33}), 'not json', '{}', '[]', json.dumps({'text': 123}), json.dumps({'text': 'test', 'groups': [1]}),
                      json.dumps({'text': 'test', 'groups': [{'start': 0, 'end': 5, 'display': 1}]}),
                      json.dumps({'text': 'test', 'screen': {'x': 0, 'y': 0, 'width': 'bad', 'height': 800}})]:
            result = subprocess.run([str(BINARY), '--snapshot', str(OUTPUT / 'invalid.png'), value], capture_output=True)
            self.assertNotEqual(result.returncode, 0)


if __name__ == '__main__':
    unittest.main()
