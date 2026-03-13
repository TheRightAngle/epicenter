Function WhisperingRunDeferredCleanup
  SetShellVarContext current

  RMDir /r /REBOOTOK "$APPDATA\${BUNDLEID}"
  RMDir /r /REBOOTOK "$LOCALAPPDATA\${BUNDLEID}"
  RMDir /r /REBOOTOK "$LOCALAPPDATA\Whispering"

  Exec '"$SYSDIR\cmd.exe" /C ping 127.0.0.1 -n 3 >NUL & if exist "$APPDATA\${BUNDLEID}" rmdir /S /Q "$APPDATA\${BUNDLEID}" & if exist "$LOCALAPPDATA\${BUNDLEID}" rmdir /S /Q "$LOCALAPPDATA\${BUNDLEID}" & if exist "$LOCALAPPDATA\Whispering" rmdir /S /Q "$LOCALAPPDATA\Whispering"'
FunctionEnd

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    Call WhisperingRunDeferredCleanup
  ${EndIf}
!macroend
