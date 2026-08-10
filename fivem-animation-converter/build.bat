@echo off
REM ============================================================================
REM  FBX -> FiveM Animation Converter - Windows build
REM
REM  Produces dist\FiveMAnimationConverter\FiveMAnimationConverter.exe
REM
REM  Requirements:
REM    * Python 3.10+ on PATH
REM    * (optional) .NET 8 SDK, to build the codewalker-bridge sidecar that
REM      compiles the final binary .ycd. Without it the converter still writes
REM      a complete .ycd.xml.
REM ============================================================================

setlocal
cd /d "%~dp0"

echo.
echo [1/4] Creating the virtual environment...
if not exist .venv (
    python -m venv .venv || goto :error
)
call .venv\Scripts\activate.bat || goto :error

echo.
echo [2/4] Installing dependencies...
python -m pip install --upgrade pip >nul
python -m pip install -r requirements.txt || goto :error
python -m pip install pyinstaller || goto :error

echo.
echo [3/4] Building the CodeWalker bridge sidecar (optional)...
where dotnet >nul 2>nul
if errorlevel 1 (
    echo     dotnet not found - skipping.
    echo     The converter will write .ycd.xml only until the sidecar is built.
) else (
    pushd ..
    call npm run build:sidecar
    if errorlevel 1 (
        echo     Sidecar build failed - continuing without it.
    )
    popd
)

echo.
echo [4/4] Packaging with PyInstaller...
REM blender_scripts and mappings must ship as real files: blender_scripts are
REM handed to a separate Blender process by path, so they cannot live inside
REM the bundled archive.
pyinstaller ^
    --noconfirm ^
    --windowed ^
    --name FiveMAnimationConverter ^
    --add-data "mappings;mappings" ^
    --add-data "blender_scripts;blender_scripts" ^
    app\main.py || goto :error

echo.
echo ============================================================
echo  Build finished.
echo.
echo  dist\FiveMAnimationConverter\FiveMAnimationConverter.exe
echo.
echo  Before the first conversion, load a GTA V ped skeleton once:
echo    see docs\SKELETON_SETUP.md
echo ============================================================
goto :eof

:error
echo.
echo BUILD FAILED (exit code %errorlevel%).
exit /b %errorlevel%
