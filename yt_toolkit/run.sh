#!/bin/bash
echo " Starting YT Toolkit..."
echo " Your browser will open automatically."
echo

cd "$(dirname "$0")"

pip3 install -r requirements.txt --quiet 2>/dev/null || pip install -r requirements.txt --quiet

python3 app.py || python app.py
