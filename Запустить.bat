@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" "Урок-Zoom.py"
) else (
  py -3 "Урок-Zoom.py"
)
if errorlevel 1 pause
