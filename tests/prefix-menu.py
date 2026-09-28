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
    def render(self, name, text, screen):
        OUTPUT.mkdir(exist_ok=True)
        path = OUTPUT / name
        result = subprocess.run(
            [str(BINARY), '--snapshot', str(path), json.dumps({'text': text, 'screen': screen})],
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

    def test_invalid_payload(self):
        for value in ['not json', '{}', '[]', json.dumps({'text': 123}),
                      json.dumps({'text': 'test', 'screen': {'x': 0, 'y': 0, 'width': 'bad', 'height': 800}})]:
            result = subprocess.run([str(BINARY), '--snapshot', str(OUTPUT / 'invalid.png'), value], capture_output=True)
            self.assertNotEqual(result.returncode, 0)


if __name__ == '__main__':
    unittest.main()
