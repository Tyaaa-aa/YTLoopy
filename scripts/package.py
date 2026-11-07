"""Builds dist/ytloopy-<version>.zip with only the files the extension needs."""
import json
import pathlib
import zipfile

root = pathlib.Path(__file__).resolve().parent.parent
version = json.loads((root / 'manifest.json').read_text())['version']
out = root / 'dist' / f'ytloopy-{version}.zip'
out.parent.mkdir(exist_ok=True)

files = [root / 'manifest.json', *sorted((root / 'src').rglob('*')), *sorted((root / 'icons').glob('icon*.png'))]
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for f in files:
        if f.is_file():
            z.write(f, f.relative_to(root))
print(out)
