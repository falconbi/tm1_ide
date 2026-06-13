# provision-tm1-server.ps1
# Creates a new TM1 server instance directory structure and tm1s.cfg
# from a template cfg file. After running this script, open Cognos
# Configuration, point it at the new root directory, and start the instance.
#
# Usage:
#   .\provision-tm1-server.ps1
#   .\provision-tm1-server.ps1 -TemplateCfg "C:\TM1Servers\Prod\tm1s.cfg"

param(
    [string]$TemplateCfg = ""
)

# Helper -- prompt and require a non-empty value
function Prompt-Required($message) {
    while ($true) {
        $val = Read-Host $message
        if ($val.Trim()) { return $val.Trim() }
        Write-Host "  This field is required." -ForegroundColor Red
    }
}

# Helper -- prompt with a pre-filled default (Enter accepts it)
function Prompt-WithDefault($message, $default) {
    $val = Read-Host "$message`n  [Enter] to accept: $default"
    if ($val.Trim()) { return $val.Trim() }
    return $default
}

# Helper -- prompt for optional value
function Prompt-Optional($message) {
    $val = Read-Host $message
    return $val.Trim()
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  TM1 Server Instance Provisioner" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# --- Step 1: Template cfg ---

if (-not $TemplateCfg) {
    $TemplateCfg = Prompt-Required "Path to template tm1s.cfg (e.g. C:\TM1Admin\tm1s.cfg)"
}

if (-not (Test-Path $TemplateCfg -PathType Leaf)) {
    Write-Host "ERROR: File not found: $TemplateCfg" -ForegroundColor Red
    exit 1
}

$templateContent = Get-Content $TemplateCfg -Raw
Write-Host "Template loaded: $TemplateCfg" -ForegroundColor Green
Write-Host ""

# --- Step 2: Server name ---

Write-Host "Enter the settings for the new TM1 instance:" -ForegroundColor Yellow
Write-Host ""

$ServerName = Prompt-Required "Server name (e.g. TM1_Test)"

# --- Clone source (existing server Data folder) ---

Write-Host ""
Write-Host "  CLONE SOURCE:" -ForegroundColor Cyan
Write-Host "  The Data folder of your EXISTING server to copy from." -ForegroundColor Cyan
Write-Host "  This is the \Data subfolder inside your existing server root." -ForegroundColor Cyan
Write-Host "  Example: C:\TM1Admin\Data   or   C:\TM1Servers\TM1_Prod\Data" -ForegroundColor Cyan
Write-Host ""

$SourceDataDir = Prompt-Required "Source Data folder"

if (-not (Test-Path $SourceDataDir -PathType Container)) {
    Write-Host "ERROR: Source Data folder not found: $SourceDataDir" -ForegroundColor Red
    exit 1
}
Write-Host "  Found: $SourceDataDir" -ForegroundColor Green

# --- New server root ---

Write-Host ""
Write-Host "  NEW SERVER ROOT:" -ForegroundColor Cyan
Write-Host "  The top-level folder for the new instance." -ForegroundColor Cyan
Write-Host "  The tm1s.cfg will be written here. Data, Logs and Files sit inside it." -ForegroundColor Cyan
Write-Host "  Example: C:\TM1Servers\TM1_Test" -ForegroundColor Cyan
Write-Host ""

$RootDir = Prompt-Required "New server root folder"

# --- Sub-directories (pre-populated from root) ---

Write-Host ""
Write-Host "  Sub-folders -- press Enter to accept each default:" -ForegroundColor Yellow
Write-Host ""

$DataDir  = Prompt-WithDefault "  Data folder " (Join-Path $RootDir "Data")
$LogDir   = Prompt-WithDefault "  Log folder  " (Join-Path $RootDir "Logs")
Write-Host "  (type - to skip Files folder)" -ForegroundColor DarkGray
$FilesDir = Prompt-WithDefault "  Files folder" (Join-Path $RootDir "Files")
if ($FilesDir -eq '-') { $FilesDir = "" }

# --- Ports ---

Write-Host ""
$PortNumber    = Prompt-Required "PortNumber              (e.g. 50912)"
$ClientMsgPort = Prompt-Required "ClientMessagePortNumber (e.g. 17412)"
$HttpPort      = Prompt-Required "HTTPPortNumber          (e.g. 52612)"
$AdminHost     = Prompt-Optional "AdminHost               (press Enter for localhost)"
$IPAddress     = Prompt-Optional "IPAddress               (press Enter to keep template value)"

if (-not $AdminHost) { $AdminHost = "localhost" }

Write-Host ""

# --- Step 3: Validate ports are unique ---

$ports = @($PortNumber, $ClientMsgPort, $HttpPort)
if ($ports | Group-Object | Where-Object { $_.Count -gt 1 }) {
    Write-Host "ERROR: PortNumber, ClientMessagePortNumber and HTTPPortNumber must all be unique." -ForegroundColor Red
    exit 1
}

# --- Step 4: Create directories ---

Write-Host "Creating directories..." -ForegroundColor Yellow

$dirs = @($RootDir, $DataDir, $LogDir)
if ($FilesDir) {
    $dirs += $FilesDir
    $dirs += Join-Path $FilesDir "Scripts"
    $dirs += Join-Path $FilesDir "Import"
    $dirs += Join-Path $FilesDir "Export"
}

foreach ($dir in $dirs) {
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
        Write-Host "  Created: $dir" -ForegroundColor Green
    } else {
        Write-Host "  Exists:  $dir" -ForegroundColor Gray
    }
}

Write-Host ""

# --- Step 4b: Copy source Data directory ---

$existingFiles = Get-ChildItem -Path $DataDir -Recurse -ErrorAction SilentlyContinue
if ($existingFiles) {
    Write-Host ""
    Write-Host "  WARNING: Target Data directory is not empty ($($existingFiles.Count) items)." -ForegroundColor Yellow
    Write-Host "  This will CLEAR and replace all contents with data from the source." -ForegroundColor Yellow
    Write-Host ""
    $confirm = Read-Host "  Continue and overwrite? (y/N)"
    if ($confirm -ne 'y' -and $confirm -ne 'Y') {
        Write-Host "Aborted." -ForegroundColor Red
        exit 1
    }
    Write-Host "  Clearing target Data directory..." -ForegroundColor Yellow
    Remove-Item -Path "$DataDir\*" -Recurse -Force
    Write-Host "  Cleared." -ForegroundColor Green
}

Write-Host "Copying data from $SourceDataDir..." -ForegroundColor Yellow
try {
    $srcBase = $SourceDataDir.TrimEnd('\')
    Get-ChildItem -Path $SourceDataDir -Recurse -Force | Where-Object {
        -not $_.PSIsContainer -and $_.Extension -ne '.log'
    } | ForEach-Object {
        $relPath = $_.FullName.Substring($srcBase.Length).TrimStart('\')
        $dest = Join-Path $DataDir $relPath
        $destDir = Split-Path $dest -Parent
        if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }
        Copy-Item -Path $_.FullName -Destination $dest -Force
    }
    Write-Host "  Copied: $SourceDataDir -> $DataDir (skipped .log files)" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Failed to copy data directory: $_" -ForegroundColor Red
    exit 1
}

Write-Host ""

# --- Step 5: Build tm1s.cfg ---

Write-Host "Writing tm1s.cfg..." -ForegroundColor Yellow

function ReplaceParam($content, $key, $value) {
    return $content -replace "(?m)^(\s*$key\s*=).*$", "`${1}$value"
}

$cfg = $templateContent
$cfg = ReplaceParam $cfg "ServerName"              $ServerName
$cfg = ReplaceParam $cfg "DataBaseDirectory"       $DataDir
$cfg = ReplaceParam $cfg "LoggingDirectory"        $LogDir
$cfg = ReplaceParam $cfg "PortNumber"              $PortNumber
$cfg = ReplaceParam $cfg "ClientMessagePortNumber" $ClientMsgPort
$cfg = ReplaceParam $cfg "HTTPPortNumber"          $HttpPort
$cfg = ReplaceParam $cfg "AdminHost"               $AdminHost

if ($IPAddress) {
    $cfg = ReplaceParam $cfg "IPAddress" $IPAddress
}

$cfgPath = Join-Path $RootDir "tm1s.cfg"
Set-Content -Path $cfgPath -Value $cfg -Encoding ASCII

Write-Host "  Written: $cfgPath" -ForegroundColor Green
Write-Host ""

# --- Step 6: Summary ---

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Done" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Instance:    $ServerName"
Write-Host "Cloned from: $SourceDataDir"
Write-Host "Root:        $RootDir"
Write-Host "Data:        $DataDir"
Write-Host "Logs:        $LogDir"
if ($FilesDir) {
    Write-Host "Files:       $FilesDir"
    Write-Host "  Scripts:   $(Join-Path $FilesDir 'Scripts')"
    Write-Host "  Import:    $(Join-Path $FilesDir 'Import')"
    Write-Host "  Export:    $(Join-Path $FilesDir 'Export')"
}
Write-Host "Port:        $PortNumber"
Write-Host "HTTP Port:   $HttpPort"
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Open Cognos Configuration on the Windows server"
Write-Host "  2. Add a new TM1 instance pointing at: $RootDir"
Write-Host "  3. Start the instance"
Write-Host "  4. Register the server in PAW"
Write-Host "  5. Add '$ServerName' to config/servers.json in the IDE"
Write-Host ""
