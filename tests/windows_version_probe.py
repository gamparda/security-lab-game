"""Exercise a different-version native window against the packaged launcher."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import launcher

launcher.APP_VERSION = '0.0.0'
launcher.main()
