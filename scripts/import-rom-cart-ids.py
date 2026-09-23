"""Merge cartridge IDs calculated from local, unmodified ROM collections.
Reads only 8 KiB per ROM; never copies ROM data. Pass retail/revision directories,
not hacks/translations (their first 8 KiB can match the original game).
Usage: python3 scripts/import-rom-cart-ids.py DIRECTORY [DIRECTORY ...] [--write]
"""
import argparse
import json
from pathlib import Path
import re
import zlib

ROOT = Path(__file__).resolve().parents[1]
REGIONS = {'E': ('USA', 'NTSC'), 'J': ('Japan', 'NTSC'), 'P': ('Europe', 'PAL'),
           'U': ('Australia', 'PAL'), 'D': ('Germany', 'PAL'), 'F': ('France', 'PAL'),
           'I': ('Italy', 'PAL'), 'S': ('Spain', 'PAL'), 'X': ('Europe', 'PAL'),
           'Y': ('Europe', 'PAL'), 'B': ('Brazil', 'NTSC'), 'A': ('Asia', 'NTSC')}
LANGUAGES = dict(En='English', Ja='Japanese', Fr='French', De='German', Es='Spanish',
                 It='Italian', Nl='Dutch', Pt='Portuguese', Sv='Swedish', Ko='Korean', Zh='Chinese')


def normalize(data):
    if len(data) != 8192:
        raise ValueError('ROM must contain at least 8192 bytes')
    magic = data[:4]
    if magic == bytes.fromhex('37804012'):
        return b''.join(data[i:i+2][::-1] for i in range(0, len(data), 2))
    if magic == bytes.fromhex('40123780'):
        return b''.join(data[i:i+4][::-1] for i in range(0, len(data), 4))
    if magic != bytes.fromhex('80371240'):
        raise ValueError('Unrecognized ROM byte order')
    return data


def read_cart(filename):
    with filename.open('rb') as rom:
        data = normalize(rom.read(8192))
    code = data[0x3b:0x3f].decode('ascii')
    if not re.fullmatch('[A-Z0-9]{4}', code):
        raise ValueError('Invalid game code')
    name = filename.stem
    region, video = REGIONS.get(code[-1], ('Unknown', 'Unknown'))
    # X/Y are shared PAL destination codes; filenames can identify the market.
    market = re.search(r'\((USA|Japan|Europe|Australia|Germany|France|Italy|Spain|Brazil|Asia)(?:,|\))', name)
    if market:
        region = market[1]
    langs = next((part.split(',') for part in re.findall(r'\(([^)]+)\)', name)
                  if all(word in LANGUAGES for word in part.split(','))), [])
    languages = [LANGUAGES[lang] for lang in langs]
    if not languages:
        languages = {'USA': ['English'], 'Japan': ['Japanese'], 'Australia': ['English']}.get(region, [])
    release = 'official'
    for marker, kind in [('Beta', 'beta'), ('Proto', 'proto'), ('Demo', 'demo'), ('Kiosk', 'demo'), ('Unl', 'unlicensed'), ('Aftermarket', 'aftermarket')]:
        if re.search(r'\(' + marker + r'\b', name, re.I):
            release = kind
            break
    return dict(id=f'{zlib.crc32(data):08x}', gameCode=code, name=name, region=region,
                languages=languages, videoMode=video, releaseType=release,
                revision=data[0x3f] or None)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directories', nargs='+', type=Path)
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    database = ROOT / 'data/cart-names.json'
    carts = json.loads(database.read_text())
    known = {cart['id']: cart for cart in carts}
    added, skipped, duplicates = [], [], []
    scanned = 0
    for directory in args.directories:
        if not directory.is_dir():
            parser.error(f'Not a directory: {directory}')
        for filename in sorted(directory.rglob('*')):
            if filename.suffix.lower() not in {'.z64', '.v64', '.n64'}:
                continue
            if re.search(r'patched|\bT[+-]Eng?\b|\((?:Hack|GameCube|Beta|Proto|Debug|Demo|Kiosk|Aftermarket|Unl)\b', filename.name, re.I):
                continue
            scanned += 1
            try:
                cart = read_cart(filename)
            except (ValueError, OSError) as error:
                skipped.append({'file': filename.name, 'reason': str(error)})
                continue
            if cart['id'] in known:
                duplicates.append({'id': cart['id'], 'file': filename.name})
                continue
            carts.append(cart)
            known[cart['id']] = cart
            added.append(cart)
    report = dict(scanned=scanned, added=len(added), alreadyKnown=len(duplicates), skipped=skipped,
                  newMappings=added)
    if args.write:
        database.write_text(json.dumps(carts, indent=2, ensure_ascii=False) + '\n')
        (ROOT / 'docs/rom-cart-id-import.json').write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps({key: value for key, value in report.items() if key != 'newMappings'}, indent=2))


if __name__ == '__main__':
    main()
