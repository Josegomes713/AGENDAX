@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (echo Instale o Node.js 22 ou mais novo em https://nodejs.org e rode este arquivo de novo. & pause & exit /b)
set /p ADMIN_EMAILS=Digite o seu e-mail (ele recebe o acesso total): 
set PORT=3000
echo.
echo AGENDA X abrindo em http://localhost:3000  (feche esta janela para desligar)
start "" http://localhost:3000
node --disable-warning=ExperimentalWarning server.js
pause
