@echo off
setlocal
set "APP_HOME=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%APP_HOME%gradle\wrapper\bootstrap-wrapper.ps1"
if errorlevel 1 exit /b 1
set "WRAPPER_JAR=%APP_HOME%gradle\wrapper\gradle-wrapper.jar"
java -Xmx512m %JAVA_OPTS% %GRADLE_OPTS% -Dorg.gradle.appname=gradlew -classpath "%WRAPPER_JAR%" org.gradle.wrapper.GradleWrapperMain %*
exit /b %ERRORLEVEL%
