@echo off
title 轻记 · 开发环境停止
cd /d "%~dp0"

echo ==========================================
echo   轻记 (Light Notes) 开发环境停止
echo ==========================================
echo.

rem ---- 1. 停止前端静态服务（占用 1420 端口的 node/serve 进程）----
echo [1/2] 停止前端服务（端口 1420）...
netstat -ano > "%TEMP%\ln_1420.txt" 2>nul
findstr /r ":1420.*LISTENING" "%TEMP%\ln_1420.txt" > "%TEMP%\ln_1420_pid.txt" 2>nul
set FOUND=0
for /f "usebackq tokens=5" %%p in ("%TEMP%\ln_1420_pid.txt") do (
    taskkill /F /PID %%p >nul 2>&1
    echo      已终止 PID %%p
    set FOUND=1
)
del "%TEMP%\ln_1420.txt" "%TEMP%\ln_1420_pid.txt" >nul 2>&1
if "%FOUND%"=="0" echo      未发现占用 1420 端口的服务（可能已停止）。

rem ---- 2. 停止 Tauri 桌面应用进程 ----
echo [2/2] 停止 Tauri 应用进程...
taskkill /F /IM "light-notes.exe" >nul 2>&1 && echo      已终止 light-notes.exe（dev 二进制）
taskkill /F /IM "轻记.exe" >nul 2>&1 && echo      已终止 轻记.exe（发布版）

echo.
echo 开发实例已停止。
pause