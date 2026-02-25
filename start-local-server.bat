@echo off
echo Starting local HTTP server...
echo.
echo Access on your computer: http://localhost:8888
echo.
echo To access from mobile device:
echo   1. Make sure your phone is on the same WiFi network
echo   2. Your computer IP: 
ipconfig | findstr IPv4
echo   3. Open http://YOUR_IP:8888 on your phone
echo.
echo Press Ctrl+C to stop the server
echo.

REM Try Python first (most common)
python --version >nul 2>&1
if %errorlevel% == 0 (
    echo Using Python HTTP server...
    python -m http.server 8888
    goto :end
)

REM Try Node.js http-server
where http-server >nul 2>&1
if %errorlevel% == 0 (
    echo Using http-server...
    http-server -p 8888
    goto :end
)

REM Try Node.js local-server.js
where node >nul 2>&1
if %errorlevel% == 0 (
    echo Using Node.js local-server.js...
    node local-server.js
    goto :end
)

echo ERROR: No suitable server found!
echo Please install one of:
echo   - Python 3 (python -m http.server)
echo   - http-server (npm install -g http-server)
echo   - Node.js (node local-server.js)
pause

:end
