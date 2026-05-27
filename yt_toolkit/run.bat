@echo off
cd /d "%~dp0"
title YT Toolkit
echo  Starting YT Toolkit...
echo  Your browser will open automatically.
echo.

pip install -r requirements.txt --quiet

python app.py

echo.
echo  Server stopped.
pause
