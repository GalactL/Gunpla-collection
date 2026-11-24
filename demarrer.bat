@echo off
rem ATTENTION : ce fichier est enregistre en Windows-1252 (pas en UTF-8) : en UTF-8, cmd ne retrouve plus les etiquettes apres chcp 65001.
rem Lanceur Windows : choisit un Node >= 24 (celui du systeme, sinon une copie locale dans .node\),
rem puis execute scripts\lancer.mjs. Rien n'est installe dans le systeme (pas de droits administrateur, ni registre, ni PATH permanent).
setlocal EnableExtensions
chcp 1252 >nul
cd /d "%~dp0"

rem VERSION DE NODE EPINGLEE : c'est la seule ligne a modifier pour changer la version telechargee
rem (une version 24.x.y publiee sur https://nodejs.org/dist/ ; voir le README, "Changer la version de Node").
set "NODE_VERSION=v24.19.0"

set "NODE_REL=.node\node-%NODE_VERSION%-win-x64"

rem 1) Node du systeme, 2) copie locale deja telechargee, 3) telechargement apres consentement.
set "NODE_EXE=node"
call :verifier node
if not errorlevel 1 goto lancer
set "NODE_EXE=%NODE_REL%\node.exe"
if exist "%NODE_EXE%" call :verifier "%NODE_EXE%"
if exist "%NODE_EXE%" if not errorlevel 1 goto lancer

rem Seul Windows 64 bits x64 est gere (Windows arm64 : hors perimetre).
if /i "%PROCESSOR_ARCHITECTURE%"=="AMD64" goto arch_ok
if /i "%PROCESSOR_ARCHITEW6432%"=="AMD64" goto arch_ok
echo Architecture non gérée : seul Windows 64 bits (x64) est pris en charge.
goto echec
:arch_ok

set "REP="
set /p "REP=Node.js 24 est nécessaire. Le télécharger dans le dossier du site (environ 30 Mo, aucun droit administrateur) ? [o/N] "
if /i "%REP%"=="o" goto telecharger
if /i "%REP%"=="oui" goto telecharger
echo Téléchargement refusé : le site ne peut pas démarrer sans Node.js 24.
goto echec

:telecharger
rem L'URL ne vient que de la version epinglee ci-dessus.
set "ZIPNAME=node-%NODE_VERSION%-win-x64.zip"
set "BASE=https://nodejs.org/dist/%NODE_VERSION%"
set "DL=%TEMP%\gunpla-node-%RANDOM%%RANDOM%"
mkdir "%DL%" || goto echec
set "URL=%BASE%/%ZIPNAME%"
set "ZIP=%DL%\%ZIPNAME%"
set "OUT=%ZIP%"
call :obtenir || goto reseau
set "URL=%BASE%/SHASUMS256.txt"
set "OUT=%DL%\SHASUMS256.txt"
call :obtenir || goto reseau

rem Verification SHA-256 contre le SHASUMS256.txt de la meme version : rien n'est extrait ni execute avant.
set "ATTENDU="
for /f "tokens=1,2" %%h in ('findstr /c:"%ZIPNAME%" "%DL%\SHASUMS256.txt"') do if "%%i"=="%ZIPNAME%" set "ATTENDU=%%h"
set "OBTENU="
for /f "skip=1 tokens=*" %%h in ('certutil -hashfile "%ZIP%" SHA256') do if not defined OBTENU set "OBTENU=%%h"
if not defined ATTENDU goto somme
if not defined OBTENU goto somme
set "ATTENDU=%ATTENDU:"=%"
set "OBTENU=%OBTENU: =%"
if /i not "%ATTENDU%"=="%OBTENU%" goto somme

if exist ".node" rmdir /s /q ".node"
set "DEST=%CD%\.node"
call powershell -NoProfile -Command "$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath $env:ZIP -DestinationPath $env:DEST -Force"
if errorlevel 1 goto extraction
rmdir /s /q "%DL%"
set "NODE_EXE=%NODE_REL%\node.exe"
call :verifier "%NODE_EXE%"
if errorlevel 1 goto extraction
goto lancer

:somme
echo Somme de contrôle SHA-256 incorrecte : archive rejetée, rien n'a été extrait ni exécuté.
if exist "%DL%" rmdir /s /q "%DL%"
goto echec

:reseau
echo Le téléchargement a échoué (connexion internet ?).
if exist "%DL%" rmdir /s /q "%DL%"
goto echec

:extraction
echo L'extraction de Node.js a échoué.
if exist "%DL%" rmdir /s /q "%DL%"
if exist ".node" rmdir /s /q ".node"
goto echec

:echec
echo Vous pouvez installer Node.js vous-même : https://nodejs.org
pause
exit /b 1

:lancer
rem Le dossier de ce Node passe en tete du PATH de ce processus seulement (npm doit y trouver "node").
if /i not "%NODE_EXE%"=="node" set "PATH=%CD%\%NODE_REL%;%PATH%"
"%NODE_EXE%" scripts\lancer.mjs %*
set "CODE=%ERRORLEVEL%"
if not "%CODE%"=="0" pause
exit /b %CODE%

:obtenir
rem URL et OUT passent par l'environnement (jamais concatenes dans la commande PowerShell).
call powershell -NoProfile -Command "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing -Uri $env:URL -OutFile $env:OUT"
exit /b %ERRORLEVEL%

:verifier
rem Reussit si "%~1 --version" affiche vX.Y.Z avec X >= 24 (commande absente ou sortie invalide : echec).
set "V="
set "MAJ="
set "MIN="
set "PAT="
for /f "delims=" %%v in ('%~1 --version 2^>nul') do set "V=%%v"
if not defined V exit /b 1
if /i "%V:~0,1%"=="v" set "V=%V:~1%"
for /f "tokens=1,2,3 delims=." %%a in ("%V%") do set "MAJ=%%a" & set "MIN=%%b" & set "PAT=%%c"
if not defined PAT exit /b 1
for /f "delims=0123456789" %%x in ("%MAJ%%MIN%%PAT%") do exit /b 1
if %MAJ% LSS 24 exit /b 1
exit /b 0
