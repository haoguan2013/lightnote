@echo off
setlocal enabledelayedexpansion
title 轻记 · 一键打包 exe 安装包
cd /d "%~dp0"

echo ==========================================
echo   轻记 (Light Notes) 一键打包
echo   产物: src-tauri\target\release\bundle\nsis
echo ==========================================
echo.

rem ---- 0) 前置检查：node 是否可用 ----
where node >nul 2>nul
if errorlevel 1 (
    echo [错误] 未找到 node.exe，请先安装 Node.js（^>= 18）并加入 PATH。
    goto :fail
)

if not exist "notes.html" (
    echo [错误] 未找到 notes.html，请在项目根目录运行本脚本。
    goto :fail
)

rem ---- 1) 读取当前版本号（唯一事实来源: src-tauri/tauri.conf.json）----
call :pkg_version APP_VER
if not defined APP_VER (
    echo [错误] 无法读取 src-tauri/tauri.conf.json 的 version。
    goto :fail
)
echo  当前版本: %APP_VER%

rem 顺带校验 5 处版本号是否一致（tauri.conf.json / package.json / package-lock.json / Cargo.toml / Cargo.lock）
call node scripts\bump-version.mjs check >nul 2>nul <nul
if errorlevel 1 (
    echo  [警告] 五处版本号不一致！可执行下面任一操作修复：
    echo         node scripts\bump-version.mjs patch      ^(统一升一位 patch^)
    echo         node scripts\bump-version.mjs check      ^(查看具体差异^)
)
echo.

rem ---- 2) 版本号升级（可选，同步 5 处后再打包）----
call :bump_preview patch NEXT_PATCH
call :bump_preview minor NEXT_MINOR
call :bump_preview major NEXT_MAJOR

echo  是否升级版本号？^（会同步 tauri.conf.json / package.json / package-lock.json / Cargo.toml / Cargo.lock^）
echo    [0] 不升级，直接打包 %APP_VER%    ^(默认^)
echo    [1] patch  -^> %NEXT_PATCH%    ^(修 bug^)
echo    [2] minor  -^> %NEXT_MINOR%    ^(加功能，推荐^)
echo    [3] major  -^> %NEXT_MAJOR%    ^(大版本^)
echo.
set "BUMP_MODE="
set /p "BUMP_MODE=  请输入 0/1/2/3（直接回车 = 0）: "
if not defined BUMP_MODE set "BUMP_MODE=0"

set "BUMP_PART="
if "%BUMP_MODE%"=="1" set "BUMP_PART=patch"
if "%BUMP_MODE%"=="2" set "BUMP_PART=minor"
if "%BUMP_MODE%"=="3" set "BUMP_PART=major"
if defined BUMP_PART (
    echo.
    call node scripts\bump-version.mjs %BUMP_PART% <nul
    if errorlevel 1 (
        echo [错误] 版本号升级失败。
        goto :fail
    )
    call :pkg_version APP_VER
    echo  本次打包版本: !APP_VER!
) else (
    echo  保持当前版本: %APP_VER%
)
echo.

rem ---- 3) 依赖检查（缺失时自动安装）----
if not exist "node_modules\" (
    echo [提示] 未检测到 node_modules，先执行 npm install ...
    call npm install
    if errorlevel 1 (
        echo [错误] npm install 失败。
        goto :fail
    )
)

rem ---- 4) NSIS 工具链：未缓存且未设镜像时，询问是否走 GitHub 镜像 ----
if defined TAURI_BUNDLER_TOOLS_GITHUB_MIRROR goto :skip_mirror
if exist "%LOCALAPPDATA%\tauri\NSIS\makensis.exe" goto :skip_mirror
echo.
echo [提示] 尚未缓存 NSIS 工具链，首次打包需要从 GitHub 下载。
echo        若网络无法直连 GitHub（国内网络常见），建议走镜像下载。
echo        实测可用镜像：gh-proxy.com / ghfast.top / ghproxy.net
echo.
set "USE_MIRROR="
set /p "USE_MIRROR=  是否使用镜像 https://gh-proxy.com 下载工具链? (Y/N，回车=否): "
if /i "%USE_MIRROR%"=="Y" (
    set "TAURI_BUNDLER_TOOLS_GITHUB_MIRROR=https://gh-proxy.com"
    echo  已启用镜像: https://gh-proxy.com
    echo.
) else (
    echo  使用 GitHub 直连下载。
    echo.
)
:skip_mirror

rem ---- 5) 选择打包模式 ----
echo  请选择打包类型：
echo    [1] 仅 NSIS（推荐，默认）—— 单文件 exe 安装包
echo    [2] NSIS + MSI —— 额外生成 msi 安装包
echo.
set "BUILD_MODE="
set /p "BUILD_MODE=  请输入 1 或 2（直接回车 = 1）: "
if not defined BUILD_MODE set "BUILD_MODE=1"

rem ---- 6) 执行打包（beforeBuildCommand 会自动生成 dist/）----
echo.
if "%BUILD_MODE%"=="2" (
    echo 正在打包 NSIS + MSI，首次运行需下载 NSIS/WiX 工具链，耗时较长...
    echo.
    call npm run tauri -- build --bundles nsis msi
) else (
    echo 正在打包 NSIS 安装包，首次运行需下载 NSIS 工具链，耗时较长...
    echo.
    call npm run build
)
if errorlevel 1 goto :fail

rem ---- 7) 成功：清理旧版本安装包，再定位「本次版本」的安装包并打开所在目录 ----
echo.
echo [成功] 打包完成！版本 %APP_VER%
set "BUNDLE_DIR=%~dp0src-tauri\target\release\bundle\nsis"

rem 每次打包后删除旧版本安装包：只保留本次版本；exe 与 msi 一起清理，文件名里没有版本号的一律不动
call node scripts\clean-old-bundles.mjs --keep %APP_VER% <nul
set "INSTALLER="
for %%F in ("%BUNDLE_DIR%\*_%APP_VER%_x64-setup.exe") do set "INSTALLER=%%~fF"
if defined INSTALLER (
    echo  安装包: !INSTALLER!
    explorer /select,"!INSTALLER!"
) else (
    rem 命名规则若变化，不猜「最新的那个」以免发错版本：列出目录内容让人工确认
    echo  [警告] 未找到与当前版本 %APP_VER% 匹配的安装包，目录内 exe 如下：
    for %%F in ("%BUNDLE_DIR%\*.exe") do echo         %%~nxF
    echo  请手动打开目录查看：%BUNDLE_DIR%\
)

echo.
pause
exit /b 0

:fail
echo.
echo [错误] 打包失败，请查看上方日志。常见原因：
echo   - 版本号问题：先执行 node scripts\bump-version.mjs check 查看 5 处版本号差异；
echo   - 网络问题导致 NSIS/WiX 工具链下载失败：
echo      方法一：重跑本脚本，出现询问时输入 Y 走 GitHub 镜像下载；
echo      方法二：先执行  set TAURI_BUNDLER_TOOLS_GITHUB_MIRROR=https://gh-proxy.com  再运行本脚本；
echo      工具链缓存于 %LOCALAPPDATA%\tauri\NSIS，成功下载一次后不再需要网络。
echo   - Rust 编译报错（日志中会有具体信息）
echo.
pause
exit /b 1

rem ================= 工具子程序 =================
rem 取版本号 / 预演下一个版本号：node 输出写临时文件再用 set /p 读回
rem （用文件回传而不是 for /f 管道捕获，在包装过 node 启动器或受限环境下更稳）
:pkg_version
set "LN_TMP=%TEMP%\lightnotes_ver.tmp"
call node -p "require('./src-tauri/tauri.conf.json').version" > "%LN_TMP%" 2>nul <nul
set "%1="
if exist "%LN_TMP%" set /p %1=<"%LN_TMP%"
del "%LN_TMP%" >nul 2>nul
exit /b 0

rem %1=patch|minor|major（只计算不写文件），%2=目标变量名
:bump_preview
set "LN_TMP=%TEMP%\lightnotes_ver.tmp"
call node scripts\bump-version.mjs %1 --dry-run > "%LN_TMP%" 2>nul <nul
set "%2="
if exist "%LN_TMP%" set /p %2=<"%LN_TMP%"
del "%LN_TMP%" >nul 2>nul
exit /b 0
