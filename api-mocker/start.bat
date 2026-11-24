@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js 18 or later is required: https://nodejs.org & pause & exit /b 1)
echo API Mocker - admin UI: http://localhost:4001   mock API: http://localhost:4000
start "" cmd /c "timeout /t 2 >nul & start http://localhost:4001"
node mocker.js
pause
