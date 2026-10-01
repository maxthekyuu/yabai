#!/usr/bin/env python3
"""Validated configuration bridge. stdout is JSON; never evaluate .yabairc."""
import argparse
import concurrent.futures
import fcntl
import json
import math
import os
from pathlib import Path
import re
import shlex
import stat
import subprocess
import tempfile

BEGIN = '# BEGIN YABAI RATPOISON MENU CONFIG'
END = '# END YABAI RATPOISON MENU CONFIG'
DATA = '# ratpoison-menu-json: '
COLORS = dict(background='#000000', text='#c0c0c0', title='#55ffff', accent='#ffff55',
              help='#aaaaaa', status='#aaaaaa', activeFrame='#55ff55', emptyFrame='#ffff55',
              frontWindowActive='#55ff55', frontWindowInactive='#55ffff',
              error='#ff5555', selectionText='#ffffff', selectionBackground='#004444',
              hintBackground='#000000', hintText='', hintBorder='', inputText='#c0c0c0',
              inputBackground='#000000', placeholder='#777777', caret='#ffffff',
              inputSelectionText='#ffffff', inputSelectionBackground='#005577')
PALETTE = '#55ffff,#ff55ff,#55ff55,#ffff55,#5555ff,#ff5555'
CATALOG = []

def add(key, kind='enum', choices=None, group='Yabai', default=None, **limits):
    entry = dict(key=key, label=key.removeprefix('prefix.').replace('_', ' '), type=kind, group=group)
    if choices is not None: entry['choices'] = choices.split(',')
    if default is not None: entry['default'] = default
    entry.update(limits)
    CATALOG.append(entry)

for name in ('debug_output', 'mouse_follows_focus', 'window_zoom_persist', 'window_opacity',
             'frame_border', 'skip_window_focus_animation', 'ratpoison_layout_persistence',
             'ratpoison_session_persistence'):
    add(name, choices='on,off')
for name, choices in dict(focus_follows_mouse='off,autofocus,autoraise',
    display_arrangement_order='default,horizontal,vertical', window_origin_display='default,focused,cursor',
    window_placement='first_child,second_child', window_insertion_point='focused,first,last',
    window_shadow='on,off,float', layout='ratpoison,float,bsp,stack', split_type='auto,horizontal,vertical',
    auto_balance='off,on,x-axis,y-axis', mouse_modifier='alt,shift,cmd,ctrl,fn',
    mouse_action1='move,resize', mouse_action2='move,resize', mouse_drop_action='swap,stack').items():
    add(name, choices=choices)
add('window_animation_easing', choices=','.join('ease_' + direction + '_' + curve
    for curve in ('sine','quad','cubic','quart','quint','expo','circ') for direction in ('in','out','in_out')))
for name in ('window_opacity_duration', 'window_animation_duration'):
    add(name, 'number', min=0)
for name in ('menubar_opacity','active_window_opacity','normal_window_opacity'):
    add(name, 'number', min=0, max=1, exclusiveMin=name != 'menubar_opacity')
for name in ('top_padding','bottom_padding','left_padding','right_padding','window_gap'):
    add(name, 'integer', min=0, max=2147483647)
add('frame_border_width', 'integer', min=1, max=64)
add('split_ratio', 'number', min=0.1, max=0.9)
for name in ('active_frame_border_color','inactive_frame_border_color','selected_empty_border_color','insert_feedback_color'):
    add(name, 'argb')
add('external_bar', 'external_bar')
add('prefix.font', 'font', group='Prefix appearance', default='GoMono Nerd Font Mono')
add('prefix.fontSize', 'number', group='Prefix appearance', min=6, max=36, default=12)
add('prefix.selectionWeight', choices='bold,regular', group='Prefix appearance', default='bold')
add('prefix.displayColors', 'palette', group='Prefix appearance', default=PALETTE)
for name, value in COLORS.items():
    add('prefix.colors.' + name, 'color', group='Prefix colors', default=value,
        optional=name in ('hintText','hintBorder'))
BY_KEY = {item['key']: item for item in CATALOG}


def validate(key, value):
    if key not in BY_KEY: raise ValueError('Unknown setting: ' + key)
    spec = BY_KEY[key]
    value = str(value).strip()
    kind = spec['type']
    if kind == 'enum':
        if value not in spec['choices']: raise ValueError('Choose ' + ', '.join(spec['choices']))
    elif kind in ('integer','number'):
        number = float(value)
        if not math.isfinite(number): raise ValueError('Expected a finite number')
        if kind == 'integer' and not re.fullmatch(r'\d+', value): raise ValueError('Expected an integer')
        if number < spec.get('min', -math.inf) or number > spec.get('max', math.inf):
            raise ValueError('Value outside allowed range')
        if spec.get('exclusiveMin') and number == spec['min']: raise ValueError('Value must be greater than zero')
        value = str(int(number)) if kind == 'integer' else str(number)
    elif kind == 'argb':
        if not re.fullmatch(r'0x[0-9a-fA-F]{8}', value): raise ValueError('Use 0xAARRGGBB')
        if key == 'insert_feedback_color' and int(value,16) == 0: raise ValueError('Color must be nonzero')
    elif kind == 'color':
        if not (spec.get('optional') and not value) and not re.fullmatch(r'#[0-9a-fA-F]{6}', value):
            raise ValueError('Use #RRGGBB' + (' or blank for display color' if spec.get('optional') else ''))
    elif kind == 'palette':
        value = ','.join(part.strip() for part in value.split(','))
        if not all(re.fullmatch(r'#[0-9a-fA-F]{6}', part) for part in value.split(',')):
            raise ValueError('Use comma-separated #RRGGBB colors')
    elif kind == 'external_bar':
        if not re.fullmatch(r'(off|main|all):\d{1,6}:\d{1,6}', value): raise ValueError('Use off|main|all:top:bottom')
    elif kind == 'font':
        if not value or len(value) > 200 or any(ord(c) < 32 for c in value): raise ValueError('Expected a font name')
    return value


def split_config(content):
    lines = content.splitlines(keepends=True)
    starts = [i for i,line in enumerate(lines) if line.rstrip('\r\n') == BEGIN]
    ends = [i for i,line in enumerate(lines) if line.rstrip('\r\n') == END]
    if not starts and not ends: return content, '', {}
    if len(starts) != 1 or len(ends) != 1 or starts[0] >= ends[0]:
        raise ValueError('Malformed managed block in .yabairc; refusing to overwrite it')
    block = lines[starts[0]+1:ends[0]]
    records = [line[len(DATA):] for line in block if line.startswith(DATA)]
    if len(records) != 1: raise ValueError('Missing managed configuration metadata')
    settings = json.loads(records[0])
    if not isinstance(settings, dict): raise ValueError('Invalid configuration metadata')
    for key,value in settings.items(): validate(key,value)
    return ''.join(lines[:starts[0]]), ''.join(lines[ends[0]+1:]), settings


def theme_from(settings):
    theme = {}
    for key,value in settings.items():
        if not key.startswith('prefix.'): continue
        field = key[7:]
        if field.startswith('colors.'):
            if value: theme.setdefault('colors', {})[field[7:]] = value
        elif field == 'fontSize': theme[field] = float(value)
        elif field == 'displayColors': theme[field] = value.split(',')
        else: theme[field] = value
    return theme


def read_config(path):
    return path.read_text() if path.exists() else ''


def run_yabai(binary, key, value=None):
    argv = [binary, '-m', 'config', key]
    if value is not None: argv.append(value)
    result = subprocess.run(argv, capture_output=True, text=True, timeout=4)
    if result.returncode: raise ValueError((result.stderr or result.stdout).strip() or 'yabai command failed')
    return result.stdout.strip()


def listing(path, binary):
    _,_,saved = split_config(read_config(path))
    def query(spec):
        item = spec.copy()
        try:
            item['value'] = saved.get(item['key'], item.get('default','')) if item['key'].startswith('prefix.') else run_yabai(binary,item['key'])
            item['supported'] = True
        except (OSError, ValueError, subprocess.TimeoutExpired) as exc:
            item.update(value='', supported=False, error=str(exc))
        return item
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        items = list(executor.map(query,CATALOG))
    return dict(settings=items, theme=theme_from(saved), path=str(path))


def atomic_write(path, content, mode):
    fd, name = tempfile.mkstemp(prefix='.' + path.name + '.', dir=path.parent)
    try:
        with os.fdopen(fd,'w') as stream:
            os.fchmod(stream.fileno(), mode)
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name): os.unlink(name)


def apply(path, binary, key, value):
    value = validate(key,value)
    path = path.expanduser().resolve()
    # A separate lock survives the atomic replacement of the actual configuration.
    with open(str(path) + '.ratpoison.lock','a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        content = read_config(path)
        before,after,saved = split_config(content)
        saved[key] = value
        # Move our overrides to the end, preserving every byte outside the old block.
        base = before + after
        if base and not base.endswith('\n'): base += '\n'
        block = [BEGIN, DATA + json.dumps(saved, sort_keys=True, ensure_ascii=True)]
        for name,val in sorted(saved.items(), key=lambda pair: (pair[0] == 'ratpoison_session_persistence', pair[0])):
            if not name.startswith('prefix.'):
                block.append(' '.join(shlex.quote(arg) for arg in [binary,'-m','config',name,val]))
        block.append(END)
        output = base + '\n'.join(block) + '\n'
        mode = stat.S_IMODE(path.stat().st_mode) if path.exists() else 0o755
        # Establish writability and backup before touching the running daemon.
        atomic_write(Path(str(path) + '.ratpoison-backup'), content, mode)
        old_value = None
        if not key.startswith('prefix.'):
            old_value = run_yabai(binary,key)
            run_yabai(binary,key,value)
        try:
            atomic_write(path,output,mode)
        except OSError as exc:
            if old_value is not None:
                try: run_yabai(binary,key,old_value)
                except Exception as rollback: raise ValueError('Save failed and live rollback failed: ' + str(rollback)) from exc
            raise
    return dict(key=key,value=value,theme=theme_from(saved),path=str(path))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', default=str(Path.home()/'.yabairc'))
    parser.add_argument('--yabai', default='/opt/homebrew/bin/yabai')
    parser.add_argument('operation', choices=['list','theme','apply'])
    parser.add_argument('key', nargs='?')
    parser.add_argument('value', nargs='?')
    args = parser.parse_args()
    try:
        path = Path(args.config).expanduser().resolve()
        if args.operation == 'list': result = listing(path,args.yabai)
        elif args.operation == 'theme': result = dict(theme=theme_from(split_config(read_config(path))[2]))
        else:
            if args.key is None or args.value is None: raise ValueError('apply needs KEY VALUE')
            result = apply(path,args.yabai,args.key,args.value)
        print(json.dumps(result))
        return 0
    except (OSError,ValueError,subprocess.TimeoutExpired) as exc:
        print(json.dumps(dict(error=str(exc))))
        return 1

if __name__ == '__main__':
    raise SystemExit(main())
