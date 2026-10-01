#!/usr/bin/env python3
"""Configuration bridge tests; never reads or modifies the user's config."""
import sys
sys.dont_write_bytecode = True
import importlib.util
from pathlib import Path
import re
import stat
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('config',ROOT/'scripts/ratpoison-config.py')
config = importlib.util.module_from_spec(spec)
spec.loader.exec_module(config)

class ConfigurationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name).resolve()/'yabairc'
        self.original = '#!/bin/sh\n# user comment\nyabai -m config window_gap 5\n'
        self.path.write_text(self.original)
        self.path.chmod(0o751)
        self.calls = []
        def run(binary,key,value=None):
            self.calls.append((key,value))
            return '5' if value is None else ''
        self.runner = patch.object(config,'run_yabai',side_effect=run)
        self.runner.start()
        self.addCleanup(self.runner.stop)

    def test_catalog_covers_all_native_settings(self):
        source = (ROOT/'src/message.c').read_text()
        names = re.findall(r'#define COMMAND_CONFIG_\w+\s+"([^"]+)"',source)
        self.assertTrue(set(names).issubset(config.BY_KEY))
        self.assertIn('ratpoison_session_persistence',config.BY_KEY)
        self.assertIn('ratpoison_layout_persistence',config.BY_KEY)

    def test_idempotent_preserving_symlink_mode_and_backup(self):
        link = Path(self.tmp.name)/'link'
        link.symlink_to(self.path)
        config.apply(link,'/opt/homebrew/bin/yabai','window_gap','9')
        first = self.path.read_text()
        config.apply(link,'/opt/homebrew/bin/yabai','window_gap','9')
        self.assertEqual(first,self.path.read_text())
        self.assertTrue(first.startswith(self.original))
        self.assertTrue(link.is_symlink())
        self.assertEqual(stat.S_IMODE(self.path.stat().st_mode),0o751)
        self.assertEqual(first.count(config.BEGIN),1)
        self.assertEqual(Path(str(self.path)+'.ratpoison-backup').read_text(),first)
        self.assertEqual(self.calls,[('window_gap',None),('window_gap','9')]*2)

    def test_theme_roundtrip_is_comment_only(self):
        name = 'Font $(touch /tmp/never-execute) `echo bad`'
        config.apply(self.path,'yabai','prefix.font',name)
        config.apply(self.path,'yabai','prefix.colors.title','#123456')
        config.apply(self.path,'yabai','prefix.displayColors','#112233, #445566')
        settings = config.split_config(self.path.read_text())[2]
        theme = config.theme_from(settings)
        self.assertEqual(theme['font'],name)
        self.assertEqual(theme['colors']['title'],'#123456')
        self.assertEqual(theme['displayColors'],['#112233','#445566'])
        for line in self.path.read_text().splitlines():
            if 'touch' in line: self.assertTrue(line.startswith('#'))
        self.assertEqual(self.calls,[])

    def test_invalid_values_do_not_touch_config_or_daemon(self):
        for key,value in [('no_such_setting','on'),('window_gap','5;echo bad'),
                          ('prefix.fontSize','nan'),('prefix.fontSize','40'),
                          ('frame_border_width','0'),('prefix.colors.text','red'),
                          ('external_bar','main:0:0;false'),('active_window_opacity','0')]:
            with self.subTest(key=key,value=value), self.assertRaises(ValueError):
                config.apply(self.path,'yabai',key,value)
        self.assertEqual(self.original,self.path.read_text())
        self.assertEqual(self.calls,[])

    def test_malformed_block_is_not_overwritten(self):
        self.path.write_text(self.original+config.BEGIN+'\n')
        with self.assertRaises(ValueError): config.apply(self.path,'yabai','frame_border','on')
        self.assertEqual(self.path.read_text(),self.original+config.BEGIN+'\n')

    def test_live_failure_does_not_persist(self):
        with patch.object(config,'run_yabai',side_effect=ValueError('daemon rejected setting')):
            with self.assertRaisesRegex(ValueError,'rejected'):
                config.apply(self.path,'yabai','frame_border','on')
        self.assertEqual(self.path.read_text(),self.original)

    def test_save_failure_rolls_back_live_value(self):
        real = config.atomic_write
        def fail(path,content,mode):
            if path == self.path: raise OSError('disk full')
            real(path,content,mode)
        with patch.object(config,'atomic_write',side_effect=fail):
            with self.assertRaises(OSError): config.apply(self.path,'yabai','window_gap','9')
        self.assertEqual(self.calls,[('window_gap',None),('window_gap','9'),('window_gap','5')])
        self.assertEqual(self.path.read_text(),self.original)

    def test_session_enable_is_last(self):
        config.apply(self.path,'yabai','ratpoison_session_persistence','on')
        config.apply(self.path,'yabai','window_gap','9')
        lines = self.path.read_text().splitlines()
        self.assertIn('ratpoison_session_persistence on',lines[-2])

    def test_listing_marks_unavailable_without_failing(self):
        with patch.object(config,'run_yabai',side_effect=ValueError('not supported')):
            result = config.listing(self.path,'yabai')
        native = next(s for s in result['settings'] if s['key']=='layout')
        theme = next(s for s in result['settings'] if s['key']=='prefix.fontSize')
        self.assertFalse(native['supported'])
        self.assertTrue(theme['supported'])
        self.assertEqual(theme['value'],12)

if __name__ == '__main__': unittest.main()
