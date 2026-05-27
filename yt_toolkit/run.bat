@echo off
cd /d "%~dp0"
title YT Toolkit
echo  Starting YT Toolkit...
echo  Installing dependencies (this may take a few minutes on first run)...
echo.

pip install -r requirements.txt

echo.
echo  Starting server — browser will open automatically...
echo.

python app.py

echo.
echo  Server stopped.
pause
