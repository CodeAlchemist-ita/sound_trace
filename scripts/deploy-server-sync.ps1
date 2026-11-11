# Enables server-side sync on the linked Supabase project (see README, "Sincronizzazione sul server").
# Run from the project folder:  powershell -ExecutionPolicy Bypass -File scripts\deploy-server-sync.ps1
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

$clientId = (Get-Content .env.local | Where-Object { $_ -match '^EXPO_PUBLIC_SPOTIFY_CLIENT_ID=' }) -replace '^[^=]+=', ''
$syncUrl = (Get-Content .env.local | Where-Object { $_ -match '^EXPO_PUBLIC_SYNC_URL=' }) -replace '^[^=]+=', ''
if (-not $clientId -or -not $syncUrl) { throw 'EXPO_PUBLIC_SPOTIFY_CLIENT_ID / EXPO_PUBLIC_SYNC_URL missing in .env.local' }
$tokenUrl = $syncUrl -replace '/sync/?$', '/token'

# Random 64-hex secret shared by the cron job and the function.
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$secret = -join ($bytes | ForEach-Object { $_.ToString('x2') })

Write-Host '1/3 Database (tables + pg_cron/pg_net)...' -ForegroundColor Cyan
npx supabase db push --remote --yes
if ($LASTEXITCODE) { throw 'db push failed' }

Write-Host '2/3 Function secrets...' -ForegroundColor Cyan
npx supabase secrets set "SPOTIFY_CLIENT_ID=$clientId" "CRON_SECRET=$secret"
if ($LASTEXITCODE) { throw 'secrets set failed' }

Write-Host '3/3 Deploy "token" function...' -ForegroundColor Cyan
npx supabase functions deploy token --no-verify-jwt --use-api --yes
if ($LASTEXITCODE) { throw 'deploy failed' }

$sql = @"
select vault.create_secret('$secret', 'cron_secret');
select cron.schedule('spotify-poll', '*/15 * * * *', `$`$
  select net.http_post(
    url := '$tokenUrl',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := '{"action":"poll"}'::jsonb)
`$`$);
"@
$sql | Set-Clipboard
Write-Host ''
Write-Host 'Fatto. Ultimo passo: incolla nel SQL Editor di Supabase (gia copiato negli appunti) e premi Run:' -ForegroundColor Green
Write-Host $sql
