!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    SetShellVarContext current

    ; The uninstaller binary lives inside the install directory, so defer
    ; removing that root until the current process has exited.
    ExecShell "open" "$SYSDIR\cmd.exe" '/C ping 127.0.0.1 -n 2 >NUL & rmdir /S /Q "$INSTDIR"' SW_HIDE

    ${If} $DeleteAppDataCheckboxState = 1
      ; Clear the persisted Whispering app data immediately.
      RmDir /r "$LOCALAPPDATA\com.bradenwong.whispering"
    ${EndIf}
  ${EndIf}
!macroend
