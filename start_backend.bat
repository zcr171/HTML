@echo off
cd %~dp0
:: 设置控制台窗口大小：cols=宽度(字符数), lines=高度(行数)
mode con cols=120 lines=40
echo Starting Industrial Visualization Backend (Modular Version)...
node backend/index.js
pause