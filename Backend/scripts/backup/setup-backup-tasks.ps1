# setup-backup-tasks.ps1  (R7hr-253)
# ════════════════════════════════════════════════════════════════════
# Registers two Windows Scheduled Tasks for SphereHealth backups:
#   • "SphereHealth Nightly Backup"  — every day 02:30
#   • "SphereHealth Monthly Backup"  — 1st of each month 03:00 (with a
#                                       restore-drill that proves the
#                                       backup is recoverable)
#
# Task Scheduler runs these even when the app / a user isn't logged in,
# so backups happen regardless of whether the HIS server is up.
#
# RUN THIS ONCE, as Administrator:
#   powershell -ExecutionPolicy Bypass -File .\setup-backup-tasks.ps1
#
# Re-running is safe — it overwrites the existing tasks (-Force).
# To remove:  Unregister-ScheduledTask -TaskName "SphereHealth Nightly Backup","SphereHealth Monthly Backup" -Confirm:$false
# ════════════════════════════════════════════════════════════════════

$ErrorActionPreference = "Stop"

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { Write-Error "node.exe not found on PATH. Install Node.js or add it to PATH, then re-run."; exit 1 }

$dir    = $PSScriptRoot
$script = Join-Path $dir "runBackup.js"
if (-not (Test-Path $script)) { Write-Error "runBackup.js not found next to this script ($script)."; exit 1 }

Write-Host "node   : $node"
Write-Host "script : $script`n"

# ── Nightly (daily 02:30) ──
$nAction  = New-ScheduledTaskAction  -Execute $node -Argument "`"$script`" --mode=nightly" -WorkingDirectory $dir
$nTrigger = New-ScheduledTaskTrigger -Daily -At "02:30"
Register-ScheduledTask -TaskName "SphereHealth Nightly Backup" -Action $nAction -Trigger $nTrigger `
  -Description "SphereHealth HIS nightly MongoDB backup (offline + cloud-synced online copy)." `
  -RunLevel Highest -Force | Out-Null
Write-Host "[OK] Registered 'SphereHealth Nightly Backup'  (daily 02:30)"

# ── Monthly (day 1, 03:00) — built via CIM since New-ScheduledTaskTrigger has no -Monthly ──
$mAction = New-ScheduledTaskAction -Execute $node -Argument "`"$script`" --mode=monthly" -WorkingDirectory $dir
$mClass  = Get-CimClass -Namespace Root/Microsoft/Windows/TaskScheduler -ClassName MSFT_TaskMonthlyTrigger
$mTrig   = New-CimInstance -CimClass $mClass -ClientOnly
$mTrig.DaysOfMonth  = 1
$mTrig.StartBoundary = ([datetime]"03:00").ToString("yyyy-MM-ddTHH:mm:ss")
$mTrig.Enabled = $true
Register-ScheduledTask -TaskName "SphereHealth Monthly Backup" -Action $mAction -Trigger $mTrig `
  -Description "SphereHealth HIS monthly MongoDB backup + restore-drill (offline + cloud-synced online copy)." `
  -RunLevel Highest -Force | Out-Null
Write-Host "[OK] Registered 'SphereHealth Monthly Backup'   (1st of month 03:00, with restore-drill)"

Write-Host "`nDone. Test a run now with:"
Write-Host "    node `"$script`" --mode=nightly"
Write-Host "Check status anytime in:  (BACKUP_OFFLINE_DIR)\last-backup.json  and  \backup.log"
