$ErrorActionPreference = 'Stop'
$WrapperJar = Join-Path $PSScriptRoot 'gradle-wrapper.jar'
$WrapperSha256 = 'ed2c26eba7cfb93cc2b7785d05e534f07b5b48b5e7fc941921cd098628abca58'
$DistributionSha256 = 'e111cb9948407e26351227dabce49822fb88c37ee72f1d1582a69c68af2e702f'
$DistributionUrl = 'https://services.gradle.org/distributions/gradle-8.1.1-bin.zip'
$GradleHome = $env:GRADLE_USER_HOME
if ([string]::IsNullOrWhiteSpace($GradleHome)) { $GradleHome = Join-Path $env:USERPROFILE '.gradle' }
$BootstrapHome = Join-Path $GradleHome 'synthesisone-wrapper-bootstrap'
$GradleRoot = Join-Path $BootstrapHome 'gradle-8.1.1'
$GradleExe = Join-Path $GradleRoot 'bin\gradle.bat'

function Assert-Sha256([string]$Path, [string]$Expected) {
  if (!(Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Archivo faltante: $Path" }
  $Actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($Actual -ne $Expected) { throw "SHA-256 incorrecto para $Path; archivo rechazado." }
}

if (!(Test-Path -LiteralPath $WrapperJar -PathType Leaf)) {
  New-Item -ItemType Directory -Force -Path $BootstrapHome | Out-Null
  if (!(Test-Path -LiteralPath $GradleExe -PathType Leaf)) {
    $ZipPath = Join-Path $BootstrapHome ('gradle-8.1.1-bin-' + [guid]::NewGuid().ToString('N') + '.zip')
    try {
      Invoke-WebRequest -UseBasicParsing -Uri $DistributionUrl -OutFile $ZipPath
      Assert-Sha256 $ZipPath $DistributionSha256
      Expand-Archive -LiteralPath $ZipPath -DestinationPath $BootstrapHome -Force
    } finally {
      Remove-Item -LiteralPath $ZipPath -Force -ErrorAction SilentlyContinue
    }
  }

  $TempProject = Join-Path $env:TEMP ('so-wrapper-bootstrap-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Force -Path $TempProject | Out-Null
  try {
    Set-Content -Encoding ASCII -Path (Join-Path $TempProject 'settings.gradle') -Value "rootProject.name = 'synthesisone-wrapper-bootstrap'"
    Set-Content -Encoding ASCII -Path (Join-Path $TempProject 'build.gradle') -Value ''
    & $GradleExe --no-daemon -p $TempProject wrapper --gradle-version 8.1.1 --distribution-type bin
    if ($LASTEXITCODE -ne 0) { throw 'Gradle no pudo generar el Wrapper.' }
    $GeneratedJar = Join-Path $TempProject 'gradle\wrapper\gradle-wrapper.jar'
    Assert-Sha256 $GeneratedJar $WrapperSha256
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $WrapperJar) | Out-Null
    Copy-Item -LiteralPath $GeneratedJar -Destination $WrapperJar -Force
  } finally {
    Remove-Item -LiteralPath $TempProject -Recurse -Force -ErrorAction SilentlyContinue
  }
}
Assert-Sha256 $WrapperJar $WrapperSha256
Write-Host 'Gradle Wrapper JAR verificado con el SHA-256 oficial.'
