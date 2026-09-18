param(
    [string]$GameDir = "",
    [string]$Code = "c01000010",
    [int]$Port = 8790
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$NieCommit = "e946d46aff683ec026beea2b578614e5ec570961"
$ProbeRoot = Join-Path $env:LOCALAPPDATA "Inazuma3DProbe"
$NieRoot = Join-Path $ProbeRoot "nie"
$OutRoot = Join-Path $ProbeRoot "output"
$CacheRoot = Join-Path $ProbeRoot "model-cache"
$LogOut = Join-Path $ProbeRoot "nie-model-serve.out.log"
$LogErr = Join-Path $ProbeRoot "nie-model-serve.err.log"

function Write-Step([string]$Text) {
    Write-Host ""
    Write-Host "== $Text ==" -ForegroundColor Cyan
}

function Test-GameRoot([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) { return $false }
    return (Test-Path (Join-Path $Path "data")) -and
           ((Test-Path (Join-Path $Path "nie.exe")) -or
            (Test-Path (Join-Path $Path "data\cpk_list.cfg.bin")))
}

function Get-SteamLibraries {
    $roots = [System.Collections.Generic.List[string]]::new()
    $pf86 = [Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFilesX86)
    $pf64 = [Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles)
    $steamCandidates = @(
        (Join-Path $pf86 "Steam"),
        (Join-Path $pf64 "Steam")
    ) | Where-Object { $_ -and (Test-Path $_) }

    foreach ($steam in $steamCandidates) {
        if (-not $roots.Contains($steam)) { $roots.Add($steam) }
        $vdf = Join-Path $steam "steamapps\libraryfolders.vdf"
        if (Test-Path $vdf) {
            $text = Get-Content -Raw -LiteralPath $vdf
            foreach ($m in [regex]::Matches($text, '"path"\s+"([^"]+)"')) {
                $lib = $m.Groups[1].Value -replace '\\\\','\'
                if ($lib -and -not $roots.Contains($lib)) { $roots.Add($lib) }
            }
        }
    }
    return $roots
}

function Resolve-GameDir {
    param([string]$Explicit)

    $candidates = [System.Collections.Generic.List[string]]::new()
    foreach ($p in @($Explicit, $env:NIE_GAME_DIR)) {
        if ($p -and -not $candidates.Contains($p)) { $candidates.Add($p) }
    }

    foreach ($steam in Get-SteamLibraries) {
        $p = Join-Path $steam "steamapps\common\INAZUMA ELEVEN Victory Road"
        if (-not $candidates.Contains($p)) { $candidates.Add($p) }
    }

    foreach ($p in $candidates) {
        if (Test-GameRoot $p) {
            return (Resolve-Path -LiteralPath $p).Path
        }
    }

    throw @"
Victory Road non trovato automaticamente.

Apri PowerShell e rilancia specificando la cartella del gioco:
  .\export_mark_real_3d.ps1 -GameDir "D:\SteamLibrary\steamapps\common\INAZUMA ELEVEN Victory Road"

Lo script cerca una cartella che contenga nie.exe oppure data\cpk_list.cfg.bin.
"@
}

function Require-Command([string]$Name, [string]$InstallHint) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Manca '$Name'. $InstallHint"
    }
}

New-Item -ItemType Directory -Force -Path $ProbeRoot, $OutRoot, $CacheRoot | Out-Null

Write-Step "Ricerca installazione Victory Road"
$ResolvedGameDir = Resolve-GameDir -Explicit $GameDir
Write-Host "Gioco: $ResolvedGameDir" -ForegroundColor Green

Write-Step "Controllo strumenti"
Require-Command "git" "Installa Git for Windows e rilancia."
Require-Command "cargo" "Installa Rust da https://rustup.rs/ e rilancia."
Write-Host "Git:   $((git --version) -join ' ')"
Write-Host "Cargo: $((cargo --version) -join ' ')"

Write-Step "Preparazione NIE"
if (-not (Test-Path (Join-Path $NieRoot ".git"))) {
    if (Test-Path $NieRoot) { Remove-Item -Recurse -Force $NieRoot }
    git clone --filter=blob:none --no-checkout https://github.com/aphrody-code/nie.git $NieRoot
    if ($LASTEXITCODE -ne 0) { throw "Clone NIE fallito." }
}

Push-Location $NieRoot
try {
    git fetch origin $NieCommit --depth 1
    if ($LASTEXITCODE -ne 0) { throw "Fetch commit NIE fallito." }
    git checkout --detach $NieCommit
    if ($LASTEXITCODE -ne 0) { throw "Checkout commit NIE fallito." }

    Write-Step "Compilazione assemblatore 3D"
    cargo build --release -p nie-model-serve
    if ($LASTEXITCODE -ne 0) { throw "Compilazione nie-model-serve fallita." }
}
finally {
    Pop-Location
}

$ServerExe = Join-Path $NieRoot "target\release\nie-model-serve.exe"
if (-not (Test-Path $ServerExe)) {
    throw "Binario non trovato dopo la compilazione: $ServerExe"
}

Write-Step "Avvio assemblatore locale"
Remove-Item -Force -ErrorAction SilentlyContinue $LogOut, $LogErr

$args = @(
    "--game-dir", $ResolvedGameDir,
    "--cache-dir", $CacheRoot,
    "--port", "$Port",
    "--memory-cache-mib", "64"
)

$proc = Start-Process -FilePath $ServerExe -ArgumentList $args -PassThru -WindowStyle Hidden -RedirectStandardOutput $LogOut -RedirectStandardError $LogErr

try {
    $base = "http://127.0.0.1:$Port"
    $ready = $false
    for ($i = 0; $i -lt 90; $i++) {
        if ($proc.HasExited) {
            $tail = if (Test-Path $LogErr) { (Get-Content $LogErr -Tail 80) -join [Environment]::NewLine } else { "" }
            throw "nie-model-serve si e' chiuso durante l'avvio.
$tail"
        }
        try {
            $health = Invoke-WebRequest -UseBasicParsing -Uri "$base/health" -TimeoutSec 2
            if ($health.StatusCode -eq 200) {
                $ready = $true
                break
            }
        } catch {}
        Start-Sleep -Seconds 1
    }
    if (-not $ready) {
        throw "Server 3D non pronto sulla porta $Port. Log: $LogErr"
    }

    Write-Host "Server pronto." -ForegroundColor Green

    Write-Step "Esportazione modello reale $Code"
    $GlbPath = Join-Path $OutRoot "$Code.glb"
    $ReportPath = Join-Path $OutRoot "$Code.report.json"
    Remove-Item -Force -ErrorAction SilentlyContinue $GlbPath, $ReportPath

    Invoke-WebRequest -UseBasicParsing -Uri "$base/model-full/$Code.glb" -OutFile $GlbPath -TimeoutSec 180
    Invoke-WebRequest -UseBasicParsing -Uri "$base/model-report/$Code.json" -OutFile $ReportPath -TimeoutSec 180

    $bytes = [System.IO.File]::ReadAllBytes($GlbPath)
    if ($bytes.Length -lt 20) { throw "GLB troppo piccolo: $($bytes.Length) byte." }
    $magic = [System.Text.Encoding]::ASCII.GetString($bytes, 0, 4)
    if ($magic -ne "glTF") { throw "Il file ottenuto non e' un GLB valido (magic='$magic')." }

    $report = Get-Content -Raw -LiteralPath $ReportPath | ConvertFrom-Json
    $sizeMb = [Math]::Round($bytes.Length / 1MB, 2)

    Write-Step "SUCCESSO"
    Write-Host "GLB reale:   $GlbPath" -ForegroundColor Green
    Write-Host "Report:      $ReportPath" -ForegroundColor Green
    Write-Host "Dimensione:  $sizeMb MB"
    Write-Host "Firma:       $magic"
    if ($null -ne $report.uniform) {
        Write-Host "Uniforme:    $($report.uniform.code) / $($report.uniform.crc)"
        Write-Host "Profilo:     $($report.uniform.profile)"
    }
    if ($null -ne $report.skinned_primitives) {
        Write-Host "Skinning:    $($report.skinned_primitives) primitive skinnate"
    }

    Write-Host ""
    Write-Host "Caricami qui questi due file:" -ForegroundColor Yellow
    Write-Host "  $GlbPath"
    Write-Host "  $ReportPath"
}
finally {
    if ($proc -and -not $proc.HasExited) {
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    }
}
