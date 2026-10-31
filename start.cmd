@echo off
setlocal
cd /d "%~dp0"
rem Read-only fallback to an existing Codex portable runtime; this only changes this process PATH.
set "ROCKET_RUNTIME=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies"
if exist "%ROCKET_RUNTIME%\node\bin\node.exe" set "PATH=%PATH%;%ROCKET_RUNTIME%\node\bin"
if exist "%ROCKET_RUNTIME%\bin\fallback\pnpm.cmd" set "PATH=%PATH%;%ROCKET_RUNTIME%\bin\fallback"
where node >nul 2>nul
if errorlevel 1 goto missing_node
where pnpm >nul 2>nul
if errorlevel 1 goto missing_pnpm
node -e "const [major,minor]=process.versions.node.split('.').map(Number);if(major<22||(major===22&&minor<12))process.exit(1)"
if errorlevel 1 goto old_node
set "TEMP=%~dp0work"
set "TMP=%TEMP%"
set "PNPM_HOME=%~dp0.cache\pnpm-home"
set "PNPM_STORE_DIR=%~dp0.pnpm-store"
set "XDG_CACHE_HOME=%~dp0.cache"
set "XDG_DATA_HOME=%~dp0.cache\data"
set "XDG_STATE_HOME=%~dp0.cache\state"
set "XDG_CONFIG_HOME=%~dp0.cache\config"
set "npm_config_cache=%~dp0.cache\npm"
if not exist "%TEMP%" mkdir "%TEMP%"
if not exist "node_modules\.modules.yaml" (
  call pnpm install --frozen-lockfile --store-dir .pnpm-store --cache-dir .cache/pnpm --config.state-dir=.cache/state
  if errorlevel 1 goto install_failed
)
echo Starting ORBITAL at http://127.0.0.1:5173/
echo Press Ctrl+C to stop the local server.
call pnpm dev
exit /b %ERRORLEVEL%
:missing_node
echo ERROR: Node.js was not found on PATH. Use an existing Node.js 22.12+ or 24.x installation.
exit /b 1
:missing_pnpm
echo ERROR: pnpm was not found on PATH. Make your existing pnpm installation available, then retry.
echo No system tool will be installed automatically.
exit /b 1
:old_node
echo ERROR: This project requires Node.js 22.12+ or 24.x.
exit /b 1
:install_failed
echo ERROR: Dependency installation failed. Check the error above and network access.
exit /b 1

