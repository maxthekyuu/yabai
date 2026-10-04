"""Read-only integration check against a running build with --menu-snapshot.
Run on a settled desktop: python3 tests/menu-snapshot.py
"""
import json
import os
import subprocess

YABAI = os.environ.get('YABAI', '/opt/homebrew/bin/yabai')
SPACE_FIELDS = 'id,uuid,index,display,type,has-focus,is-visible,frames'
WINDOW_FIELDS = 'id,pid,app,title,frame,has-focus,is-minimized,is-hidden'

def query(*args):
    return json.loads(subprocess.check_output([YABAI, '-m', 'query', *args], text=True))

snapshot = query('--menu-snapshot')
assert snapshot['version'] == 1
spaces = snapshot['spaces']
assert snapshot['focused-space'] in {s['id'] for s in spaces}
assert set(snapshot['windows']) == {str(s['id']) for s in spaces}
assert all(s['is-visible'] for s in spaces)
existing_spaces = query('--spaces', SPACE_FIELDS)
assert {s['id'] for s in spaces} == {s['id'] for s in existing_spaces if s['is-visible']}
for space in spaces:
    expected = next(s for s in existing_spaces if s['id'] == space['id'])
    assert space == expected, 'Space changed during test, or snapshot differs from existing query'
    windows = snapshot['windows'][str(space['id'])]
    expected = query('--windows', WINDOW_FIELDS, '--space', str(space['index']))
    assert sorted(windows, key=lambda w:w['id']) == sorted(expected, key=lambda w:w['id']), 'Windows changed during test, or snapshot differs'
    assert all(set(w) == set(WINDOW_FIELDS.split(',')) for w in windows)
assert snapshot['displays'] == query('--displays', 'id,index,frame')
invalid = subprocess.run([YABAI, '-m', 'query', '--menu-snapshot', '--space', '1'], capture_output=True)
assert invalid.returncode != 0
# The existing global query remains available and retains hidden-Space windows.
assert isinstance(query('--windows', 'id,space'), list)
print('Compact snapshot matches existing scoped queries on %d visible Spaces' % len(spaces))
