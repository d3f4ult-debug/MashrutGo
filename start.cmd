@echo off
rem
rem MashrutGo - bitta buyruq bilan ishga tushirish (Windows).
rem
rem   start.cmd                  backend + frontend
rem   start.cmd --backend-only   faqat API
rem   start.cmd --help           barcha bayroqlar
rem
rem .cmd fayl ataylab tanlangan: PowerShell skriptlari (.ps1) ko'pchilik Windows mashinalarida
rem ExecutionPolicy tufayli ishlamaydi, .cmd esa har doim ishlaydi (ikki marta bosish ham mumkin).
rem
rem Bu fayl faqat Python topib beradi; qolgan hamma ish scripts\dev.py da.
setlocal
cd /d "%~dp0"

rem py launcher birinchi navbatda: u PATH da bo'lmagan interpretatorlarni ham topadi.
where py >nul 2>nul
if %ERRORLEVEL% equ 0 (
    py -3 scripts\dev.py %*
    goto :done
)

where python >nul 2>nul
if %ERRORLEVEL% equ 0 (
    python scripts\dev.py %*
    goto :done
)

echo.
echo   Python topilmadi.
echo   https://www.python.org/downloads/ dan o'rnating.
echo   O'rnatishda "Add python.exe to PATH" katagini belgilang.
echo.
endlocal
exit /b 1

:done
set EXITCODE=%ERRORLEVEL%
rem Ikki marta bosib ishga tushirilgan bo'lsa, oyna xatoni ko'rsatib yopilib ketmasin.
if not "%EXITCODE%"=="0" (
    echo.
    echo   Xatolik bilan tugadi ^(kod %EXITCODE%^).
    if /i "%~1"=="" pause
)
endlocal & exit /b %EXITCODE%
