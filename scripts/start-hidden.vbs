' Uruchamia backend (server) i frontend (Vite) w tle, bez okien konsoli
' Działa niezależnie od położenia projektu (ścieżki liczone względem tego pliku)

Option Explicit
Dim fso, shell, scriptDir, rootDir, cmdBackend, cmdFrontend
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
rootDir = fso.GetParentFolderName(scriptDir)

' Backend: npm start w folderze /server
cmdBackend = "cmd /c cd /d """ & rootDir & "\server""" & " && npm start"
' Frontend: npm run dev w katalogu głównym
cmdFrontend = "cmd /c cd /d """ & rootDir & """ && npm run dev"

' 0 = ukryte okno; False = nie czekaj na zakończenie
shell.Run cmdBackend, 0, False
shell.Run cmdFrontend, 0, False

' Krótkie opóźnienie, aby Vite się uruchomił, następnie otwórz domyślną przeglądarkę
WScript.Sleep 3000
shell.Run "http://localhost:5173", 1, False

Set shell = Nothing
Set fso = Nothing
