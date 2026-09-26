# spacehog: push the CI fix and tag v0.1.0.
# Runs entirely on this machine; the token never goes into a chat or a command line.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File D:\dsh\spacehog\push-fix.ps1

$ErrorActionPreference = 'Stop'
$projectRoot = 'D:\dsh\spacehog'
$tokenFile = Join-Path $projectRoot '.github-token'

'=== spacehog push helper ==='
''

# 1. open GitHub's token creation page (repo scope pre-selected)
$tokenUrl = 'https://github.com/settings/tokens/new?description=spacehog+push&scopes=repo'
'If you do not have a usable token yet, the creation page is opening now:'
'  ' + $tokenUrl
Start-Process 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe' -ArgumentList $tokenUrl
''

# 2. read the token without echoing it and without touching shell history
$secure = Read-Host -Prompt 'Paste the token here and press Enter (input is hidden)' -AsSecureString
$plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
if ([string]::IsNullOrWhiteSpace($plain)) {
  'No token read. Exiting.'
  exit 1
}

# 3. stash it in the git-ignored file; it is deleted again in the finally block
Set-Content -Path $tokenFile -Value $plain.Trim() -NoNewline -Encoding ascii
'Token received (length ' + $plain.Trim().Length + '), pushing...'
''

# 4. publish every file, then create the v0.1.0 tag
Push-Location $projectRoot
try {
  node --use-system-ca scripts/publish-and-release.js
  $code = $LASTEXITCODE
} finally {
  Pop-Location
  Remove-Item $tokenFile -Force -ErrorAction SilentlyContinue
  $plain = $null
}
''
'Local token file removed: ' + (-not (Test-Path $tokenFile))
'publish-and-release exit code: ' + $code
''
'IMPORTANT: delete this token at https://github.com/settings/tokens when you are done.'
exit $code
