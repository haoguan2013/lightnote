@echo off
title 轻记 · 开发环境启动
cd /d "%~dp0"

echo ==========================================
echo   轻记 (Light Notes) 开发环境启动
echo ==========================================
echo.

rem ---- 检查端口 1420 是否已被占用 ----
netstat -ano > "%TEMP%\ln_1420.txt" 2>nul
findstr /r ":1420.*LISTENING" "%TEMP%\ln_1420.txt" >nul 2>&1
if not errorlevel 1 (
    echo [警告] 端口 1420 已被占用，可能已有开发实例在运行。
    echo        如需重启，请先运行 dev-stop.bat 停止旧实例。
    echo        5 秒后仍将尝试启动...
    timeout /t 5 /nobreak >nul 2>&1
)
del "%TEMP%\ln_1420.txt" >nul 2>&1

echo.
echo 正在启动 tauri dev（首次运行需编译 Rust，请耐心等待）...
echo 提示: 关闭此窗口或运行 dev-stop.bat 即可停止实例。
echo.
npm run dev

echo.
echo 开发实例已退出。
pause