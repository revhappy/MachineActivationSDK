"""`python -m machine_activation [model.gguf] [prompt]`."""

import sys

from . import _main

raise SystemExit(_main(sys.argv[1:]))
