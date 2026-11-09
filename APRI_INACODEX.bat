@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title InaCodex - Avvio locale

if not exist "index.html" goto missing_files
if not exist "data\players.js" goto missing_files
if not exist "data\teams.js" goto missing_files
if not exist "app.js" goto missing_files
if not exist "player-ratings.js" goto missing_files

where py >nul 2>nul
if not errorlevel 1 (
  set "PYTHON=py -3"
  goto start
)
where python >nul 2>nul
if not errorlevel 1 (
  set "PYTHON=python"
  goto start
)

echo Python non installato o non trovato nel PATH.
echo Scarica Python da https://www.python.org/downloads/windows/
echo e poi riavvia questo file. Non cancellare la vecchia versione dell'InaCodex.
pause
exit /b 1

:start
echo.
echo ===== INACODEX =====
echo La cartella contiene i file necessari.
echo Avvio su http://127.0.0.1:8765/index.html
echo NON chiudere questa finestra mentre usi InaCodex.
echo.
echo IMPORTANTE: il browser conserva rating e modifiche in base all'indirizzo.
echo Se usavi una vecchia versione, esporta prima i dati da quella versione.
echo.
start "" /min powershell -NoProfile -Command "Start-Sleep -Seconds 3; Start-Process 'http://127.0.0.1:8765/index.html'"
%PYTHON% -m http.server 8765 --bind 127.0.0.1
echo.
echo Il server e' stato chiuso oppure non e' riuscito ad avviarsi.
pause
exit /b 0

:missing_files
echo.
echo ERRORE: alcuni file del gioco mancano.
echo NON aprire index.html direttamente dentro lo ZIP!
echo Clicca con il tasto destro sullo ZIP e scegli "Estrai tutto".
echo Poi apri APRI_INACODEX.bat dalla cartella estratta.
echo.
pause
exit /b 1
