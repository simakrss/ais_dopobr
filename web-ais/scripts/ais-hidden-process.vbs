Option Explicit

Const ForAppending = 8
Const TristateTrue = -1

Dim arguments
Dim notifyErrors
Dim argumentOffset
Dim workingDirectory
Dim executablePath
Dim commandLine
Dim argumentIndex
Dim fileSystem
Dim shell
Dim logDirectory
Dim logPath
Dim exitCode
Dim launchError

Set arguments = WScript.Arguments
Set fileSystem = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

notifyErrors = False
argumentOffset = 0
If arguments.Count > 0 Then
  If LCase(Trim(CStr(arguments(0)))) = "--notify-errors" Then
    notifyErrors = True
    argumentOffset = 1
  End If
End If

If arguments.Count < argumentOffset + 2 Then
  WScript.Quit 64
End If

workingDirectory = CStr(arguments(argumentOffset))
executablePath = CStr(arguments(argumentOffset + 1))
If Not fileSystem.FolderExists(workingDirectory) Then
  logDirectory = fileSystem.BuildPath(shell.ExpandEnvironmentStrings("%TEMP%"), "AisDopobrWeb")
  logPath = fileSystem.BuildPath(logDirectory, "hidden-process.log")
  EnsureFolder logDirectory
  AppendLog "error: working directory was not found: " & workingDirectory
  If notifyErrors Then
    shell.Popup _
      "Working directory was not found: " & workingDirectory & " See " & logPath, _
      0, _
      "AIS Dopobrazovanie", _
      16
  End If
  WScript.Quit 3
End If

logDirectory = fileSystem.BuildPath(fileSystem.BuildPath(workingDirectory, "tmp"), "lan-system")
logPath = fileSystem.BuildPath(logDirectory, "hidden-process.log")
EnsureFolder logDirectory

If Not fileSystem.FileExists(executablePath) Then
  FailLaunch "Executable was not found: " & executablePath, 2
End If

commandLine = QuoteWindowsArgument(executablePath)
For argumentIndex = argumentOffset + 2 To arguments.Count - 1
  commandLine = commandLine & " " & QuoteWindowsArgument(CStr(arguments(argumentIndex)))
Next

AppendLog "started: " & executablePath
On Error Resume Next
shell.CurrentDirectory = workingDirectory
launchError = Err.Description
If Err.Number <> 0 Then
  Err.Clear
  On Error GoTo 0
  FailLaunch "Working directory could not be activated: " & launchError, 3
End If
Err.Clear
exitCode = shell.Run(commandLine, 0, True)
launchError = Err.Description
If Err.Number <> 0 Then
  Err.Clear
  On Error GoTo 0
  FailLaunch "Process could not be started: " & launchError, 1
End If
On Error GoTo 0

AppendLog "finished: exit=" & CStr(exitCode)
If exitCode <> 0 And notifyErrors Then
  shell.Popup _
    "AIS command failed (code " & CStr(exitCode) & "). See " & logPath, _
    0, _
    "AIS Dopobrazovanie", _
    16
End If

If exitCode < 0 Or exitCode > 255 Then
  WScript.Quit 1
End If
WScript.Quit exitCode

Function QuoteWindowsArgument(ByVal value)
  Dim text
  Dim result
  Dim slashCount
  Dim character
  Dim index

  text = CStr(value)
  result = Chr(34)
  slashCount = 0
  For index = 1 To Len(text)
    character = Mid(text, index, 1)
    If character = "\" Then
      slashCount = slashCount + 1
    ElseIf character = Chr(34) Then
      result = result & String(slashCount * 2 + 1, "\") & Chr(34)
      slashCount = 0
    Else
      If slashCount > 0 Then
        result = result & String(slashCount, "\")
        slashCount = 0
      End If
      result = result & character
    End If
  Next
  If slashCount > 0 Then
    result = result & String(slashCount * 2, "\")
  End If
  QuoteWindowsArgument = result & Chr(34)
End Function

Sub EnsureFolder(ByVal folderPath)
  Dim parentPath
  On Error Resume Next
  If fileSystem.FolderExists(folderPath) Then
    On Error GoTo 0
    Exit Sub
  End If
  parentPath = fileSystem.GetParentFolderName(folderPath)
  If Len(parentPath) > 0 And Not fileSystem.FolderExists(parentPath) Then
    EnsureFolder parentPath
  End If
  fileSystem.CreateFolder folderPath
  Err.Clear
  On Error GoTo 0
End Sub

Sub AppendLog(ByVal message)
  Dim stream
  On Error Resume Next
  Set stream = fileSystem.OpenTextFile(logPath, ForAppending, True, TristateTrue)
  If Err.Number = 0 Then
    stream.WriteLine CStr(Now) & " | " & CStr(message)
    stream.Close
  End If
  Err.Clear
  On Error GoTo 0
End Sub

Sub FailLaunch(ByVal message, ByVal code)
  AppendLog "error: " & message
  If notifyErrors Then
    shell.Popup message & " See " & logPath, 0, "AIS Dopobrazovanie", 16
  End If
  WScript.Quit code
End Sub
