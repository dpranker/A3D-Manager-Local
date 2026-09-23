"""Import search names by exact game code; never turn game codes into Analogue IDs.
Usage: python3 scripts/import-flashcart-metadata.py /path/to/n64-flashcart-menu-metadata
"""
import configparser
import json
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[1]
source = Path(sys.argv[1])
carts_path = root / 'data/cart-names.json'
carts = json.loads(carts_path.read_text())
by_code = {}
for cart in carts:
    cart.pop('flashcartName', None)
    by_code.setdefault(cart['gameCode'], []).append(cart)
missing = []
matched = 0
for filename in sorted(source.glob('metadata/*/*/*/*/metadata.ini')):
    code = ''.join(filename.relative_to(source).parts[1:5])
    parser = configparser.ConfigParser(interpolation=None, strict=False)
    parser.read(filename, encoding='utf-8-sig')
    name = parser.get('meta', 'name', fallback='').strip()
    if not name:
        continue
    if code not in by_code:
        missing.append({'gameCode': code, 'name': name})
        continue
    for cart in by_code[code]:
        cart['flashcartName'] = name
    matched += 1
carts_path.write_text(json.dumps(carts, indent=2, ensure_ascii=False) + '\n')
report = {
    'source': 'https://github.com/n64-tools/n64-flashcart-menu-metadata',
    'commit': subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip(),
    'matchedGameCodes': matched,
    'missingAnalogueIds': missing,
}
(root / 'docs/flashcart-metadata-comparison.json').write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
print(f'Imported names for {matched} game codes; {len(missing)} still need verified Analogue IDs.')
