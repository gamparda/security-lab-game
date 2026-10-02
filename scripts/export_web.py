"""Export the same game assets for later static HTTPS hosting."""

from pathlib import Path
import sys
from zipfile import ZIP_DEFLATED, ZipFile

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root))
from run import PUBLIC_FILES

output = root / 'dist' / 'security-lab-web.zip'
output.parent.mkdir(exist_ok=True)
with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
    for name in PUBLIC_FILES:
        archive.write(root / name, name)
print(output)
