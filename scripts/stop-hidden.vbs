' Zatrzymuje backend (3001) i frontend (5173) działające w tle – bez okien i bez paska zadań
' Używa PowerShell: Get-NetTCPConnection (po portach) + dodatkowo po CommandLine ("vite" lub ścieżka projektu)

Option Explicit
Dim fso, shell, scriptDir, rootDir, ps, cmd
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
rootDir = fso.GetParentFolderName(scriptDir)

ps = "$ErrorActionPreference='SilentlyContinue'; " & _
     "foreach($p in 3001,5173){ try { Get-NetTCPConnection -LocalPort $p -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } } catch {} }; " & _
     "$root='" & rootDir & "'; " & _
     "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and ($_.CommandLine -match 'vite' -or $_.CommandLine -match [regex]::Escape($root)) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"

cmd = "powershell -NoProfile -ExecutionPolicy Bypass -Command ""& { " & ps & " }"""

' 0 = ukryte okno; False = nie czekaj na zakończenie
shell.Run cmd, 0, False

Set shell = Nothing
Set fso = Nothing
