"""Native prefix renderer checks. Requires macOS and GoMono Nerd Font Mono.
Run after make: python3 tests/prefix-menu.py
Snapshots are generated off-screen, without showing or focusing a window.
"""
import json
from pathlib import Path
import struct
import subprocess
import unittest
import zlib

ROOT = Path(__file__).resolve().parents[1]
BINARY = ROOT / 'bin/yabai-prefix'
OUTPUT = ROOT / 'tests/bin'


class PrefixMenuTests(unittest.TestCase):
    def render(self, name, text, screen, groups=None, badges=None):
        OUTPUT.mkdir(exist_ok=True)
        path = OUTPUT / name
        result = subprocess.run(
            [str(BINARY), '--snapshot', str(path), json.dumps({'text': text, 'screen': screen, 'groups': groups or [], 'badges': badges or []})],
            capture_output=True, text=True, check=True,
        )
        metrics = json.loads(result.stdout)
        self.assertIn('GoMono', metrics['font'])
        self.assertEqual(metrics['size'], 12)
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
        self.assertEqual(row[1:4], b'\x00\x00\x00', 'background must be solid black')
        if color == 6:
            self.assertEqual(row[4], 255, 'background must be fully opaque')
        return metrics

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
            {'key': '0', 'display': 1, 'rect': {'x': 0, 'y': 0, 'w': 200, 'h': 100}},
            {'key': '4', 'display': 1, 'rect': {'x': 0, 'y': 0, 'w': 200, 'h': 100}},
            {'key': '5', 'display': 2, 'rect': {'x': -1000, 'y': -300, 'w': 400, 'h': 200}},
        ]
        metrics = self.render('prefix-hints.png', 'YABAI\n0 4 5',
                              {'x': 0, 'y': 0, 'width': 1440, 'height': 900}, badges=badges)
        first, second = metrics['badges']
        self.assertEqual(first['keys'], '0 4')
        self.assertEqual(first['cx'], 100)
        self.assertEqual(second['cx'], -800)
        self.assertEqual(second['cy'] - first['cy'], 250)
        self.assertEqual(first['x'] + first['width'] / 2, first['cx'])
        self.assertEqual(first['y'] + first['height'] / 2, first['cy'])
        self.assertTrue((OUTPUT / 'prefix-hints.png.hint.png').exists())
        self.assertLess(first['width'], 100)
        self.assertLess(first['height'], 40)

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

    def test_invalid_payload(self):
        for value in [json.dumps({'text': 'test', 'search': [None]}), json.dumps({'text': 'test', 'badges': [{'key': '0', 'rect': {}}]}),
                      json.dumps({'text': 'test', 'badges': [None] * 33}), 'not json', '{}', '[]', json.dumps({'text': 123}), json.dumps({'text': 'test', 'groups': [1]}),
                      json.dumps({'text': 'test', 'groups': [{'start': 0, 'end': 5, 'display': 1}]}),
                      json.dumps({'text': 'test', 'screen': {'x': 0, 'y': 0, 'width': 'bad', 'height': 800}})]:
            result = subprocess.run([str(BINARY), '--snapshot', str(OUTPUT / 'invalid.png'), value], capture_output=True)
            self.assertNotEqual(result.returncode, 0)


if __name__ == '__main__':
    unittest.main()
