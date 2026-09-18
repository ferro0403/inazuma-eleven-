@echo off
setlocal
cd /d "%~dp0"
echo.
echo ===============================================
echo   INAZUMA - PROVA VERO MODELLO 3D DI MARK
echo ===============================================
echo.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0export_mark_real_3d.ps1"
set ERR=%ERRORLEVEL%
echo.
if not "%ERR%"=="0" (
  echo [ERRORE] La prova non e' riuscita. Leggi il messaggio sopra.
) else (
  echo [OK] Prova completata.
)
echo.
pause
exit /b %ERR%
