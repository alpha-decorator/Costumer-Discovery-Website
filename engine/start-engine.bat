@echo off
rem Starts the Trata engine. First run creates a private Python environment and installs the packages (several GB, once).
rem Usage: start-engine.bat            start the engine
rem        start-engine.bat selftest   check the setup
rem torch, which the Hindi speech model needs, only supports Python 3.10 to 3.12, so this file picks one of those
rem even when a newer Python is also installed.
setlocal EnableDelayedExpansion
cd /d "%~dp0"

if exist .venv\Scripts\python.exe (
  .venv\Scripts\python.exe -c "import sys; sys.exit(0 if (3,10) <= sys.version_info[:2] <= (3,12) else 1)" >nul 2>nul
  if errorlevel 1 (
    echo The existing .venv was made with an unsupported Python version. Rebuilding it...
    rmdir /s /q .venv
  )
)

if not exist .venv\Scripts\python.exe (
  set "PYCMD="
  for %%V in (3.12 3.11 3.10) do (
    if not defined PYCMD (
      py -%%V -c "import sys" >nul 2>nul && set "PYCMD=py -%%V"
    )
  )
  if not defined PYCMD (
    python -c "import sys; sys.exit(0 if (3,10) <= sys.version_info[:2] <= (3,12) else 1)" >nul 2>nul && set "PYCMD=python"
  )
  if not defined PYCMD (
    for %%P in ("%LocalAppData%\Programs\Python\Python312\python.exe" "%LocalAppData%\Programs\Python\Python311\python.exe" "%LocalAppData%\Programs\Python\Python310\python.exe" "%ProgramFiles%\Python312\python.exe" "%ProgramFiles%\Python311\python.exe" "%ProgramFiles%\Python310\python.exe") do (
      if not defined PYCMD if exist %%P set PYCMD="%%~P"
    )
  )
  if not defined PYCMD (
    echo.
    echo Python 3.10, 3.11 or 3.12 is needed. Newer versions do not work with torch yet.
    echo Install Python 3.12 from https://www.python.org/downloads/ and run this file again.
    echo You can keep your newer Python installed as well.
    echo.
    echo Pythons this computer knows about:
    py -0p 2>nul
    where python 2>nul
    pause
    exit /b 1
  )
  echo Creating the Python environment with !PYCMD! ...
  !PYCMD! -m venv .venv
  if errorlevel 1 (
    echo Could not create the Python environment.
    pause
    exit /b 1
  )
)

call .venv\Scripts\activate.bat
if not exist .venv\installed.flag (
  echo Installing packages - this takes a while the first time...
  python -m pip install --upgrade pip && python -m pip install -r requirements.txt
  if errorlevel 1 (
    echo Installation failed. Fix the error above and run this file again.
    pause
    exit /b 1
  )
  echo ok> .venv\installed.flag
)
python -m trata_engine %*
pause
