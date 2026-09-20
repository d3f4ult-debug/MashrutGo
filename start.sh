#!/usr/bin/env bash
#
# MashrutGo — bitta buyruq bilan ishga tushirish (macOS / Linux).
#
#   ./start.sh                  backend + frontend
#   ./start.sh --backend-only   faqat API
#   ./start.sh --help           barcha bayroqlar
#
# Bu fayl faqat mos Python topib beradi; qolgan hamma ish scripts/dev.py da.
set -euo pipefail

cd "$(dirname "$0")"

# dev.py Python 3.8 sintaksisida yozilgan, shuning uchun tizimdagi istalgan python3 uni
# ishga tushira oladi. U keyin backend uchun 3.10+ interpretatorni o'zi qidiradi.
for candidate in python3 python3.12 python3.13 python3.11 python3.10 python; do
  if command -v "$candidate" >/dev/null 2>&1; then
    exec "$candidate" scripts/dev.py "$@"
  fi
done

echo "Python topilmadi. O'rnating va qayta urinib ko'ring:" >&2
echo "  macOS:  brew install python@3.12" >&2
echo "  Ubuntu: sudo apt install python3.12 python3.12-venv" >&2
exit 1
