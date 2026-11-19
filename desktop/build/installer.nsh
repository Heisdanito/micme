; Let phones reach MicMe on hotspot/USB networks, which Windows often marks "Public".
!macro customInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="MicMe"'
  nsExec::Exec 'netsh advfirewall firewall add rule name="MicMe" dir=in action=allow program="$INSTDIR\MicMe.exe" enable=yes profile=private,public'
!macroend

!macro customUnInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="MicMe"'
!macroend
