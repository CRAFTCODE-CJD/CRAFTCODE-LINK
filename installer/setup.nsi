Unicode true
SetCompressor lzma
ManifestDPIAware true
ManifestSupportedOS all
InstProgressFlags smooth
RequestExecutionLevel user
Name "CRAFTCODE LINK"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\CRAFTCODE LINK"
AllowRootDirInstall true
SetDatablockOptimize on
CRCCheck force
AllowSkipFiles off
ShowInstDetails show
ShowUninstDetails show
BrandingText "CRAFTCODE"
VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=1049 "ProductName" "CRAFTCODE LINK"
VIAddVersionKey /LANG=1049 "CompanyName" "CRAFTCODE"
VIAddVersionKey /LANG=1049 "FileDescription" "Мастер установки CRAFTCODE LINK"
VIAddVersionKey /LANG=1049 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1049 "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=1049 "LegalCopyright" "CRAFTCODE"

!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
!include "nsDialogs.nsh"
!include "WinMessages.nsh"
!include "Win\COM.nsh"
!include "Win\Propkey.nsh"
!define REGKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\CRAFTCODE LINK"
!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"
!define MUI_WELCOMEFINISHPAGE_BITMAP "${SIDEBAR_BITMAP}"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "${SIDEBAR_BITMAP}"
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_RIGHT
!define MUI_HEADERIMAGE_BITMAP "${HEADER_BITMAP}"
!define MUI_HEADERIMAGE_UNBITMAP "${HEADER_BITMAP}"
!define MUI_FINISHPAGE_NOAUTOCLOSE
!define MUI_UNFINISHPAGE_NOAUTOCLOSE
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "CRAFTCODE LINK"
!define MUI_WELCOMEPAGE_TEXT "Звоните друзьям и делитесь экраном со звуком."
!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipInstalled
!insertmacro MUI_PAGE_WELCOME
Page custom AccountPage
Page custom MaintenanceShow MaintenanceLeave
!define MUI_DIRECTORYPAGE_TEXT_TOP "Выберите папку для CRAFTCODE LINK. Другой диск можно выбрать через «Обзор…» или ввести путь, например D:\CRAFTCODE LINK."
!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipInstalled
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE DirectoryLeave
!insertmacro MUI_PAGE_DIRECTORY
Page custom ShortcutsShow ShortcutsLeave
Page custom MaintenanceDetailsShow MaintenanceDetailsLeave
!define MUI_PAGE_CUSTOMFUNCTION_SHOW ProgressShow
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\CRAFTCODE-LINK.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Запустить CRAFTCODE LINK"
!define MUI_PAGE_CUSTOMFUNCTION_SHOW FinishShow
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_WELCOME
UninstPage custom un.ProfileShow un.ProfileLeave
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH
!insertmacro MUI_LANGUAGE "Russian"

Var Stage
Var StartLink
Var DesktopLink
Var StartCheck
Var DesktopCheck
Var PurgeProfile
Var PurgeCheck
Var Mode
Var InstalledDir
Var InstalledVersion
Var MaintenanceAction
Var RepairRadio
Var RemoveRadio
Var ShortcutWarning
Var NewStartHash
Var NewDesktopHash

!macro InitCommon
 SetShellVarContext current
 SetRegView 64
 System::Call 'kernel32::CreateMutexW(p 0, i 0, w "Local\CRAFTCODE-LINK-setup-ac949bb4") p .r0 ?e'
 Pop $1
 ${If} $0 == 0
 ${OrIf} $1 == 183
  MessageBox MB_OK|MB_ICONEXCLAMATION "Уже открыт другой мастер CRAFTCODE LINK. Закройте его и повторите попытку." /SD IDOK
  SetErrorLevel 1
  Abort
 ${EndIf}
 InitPluginsDir
 SetOutPath "$PLUGINSDIR"
 File /oname=care.exe "${HELPER}"
!macroend

Function .onInit
 ${IfNot} ${RunningX64}
  MessageBox MB_OK|MB_ICONSTOP "Для этого установщика нужна 64-разрядная Windows." /SD IDOK
  SetErrorLevel 1
  Abort
 ${EndIf}
 !insertmacro InitCommon
 StrCpy $Mode "install"
 StrCpy $StartLink ${BST_CHECKED}
 StrCpy $DesktopLink ${BST_UNCHECKED}
 StrCpy $PurgeProfile ${BST_UNCHECKED}
 ReadRegStr $InstalledDir HKCU "${REGKEY}" "InstallLocation"
 ${If} $InstalledDir != ""
  ReadRegStr $InstalledVersion HKCU "${REGKEY}" "DisplayVersion"
  nsExec::ExecToStack '"$PLUGINSDIR\care.exe" maintenance-action "${VERSION}" "$InstalledVersion"'
  Pop $0
  Pop $MaintenanceAction
  ${If} $0 == 0
  ${AndIf} $MaintenanceAction == "newer"
   MessageBox MB_OK|MB_ICONEXCLAMATION "У вас уже установлена более новая версия $InstalledVersion. Для её восстановления откройте установщик этой версии." /SD IDOK
   SetErrorLevel 1
   Abort
  ${ElseIf} $0 == 0
  ${AndIf} $MaintenanceAction == "legacy"
   MessageBox MB_OK|MB_ICONEXCLAMATION "Версия $InstalledVersion использует прежний формат установки. Для её обслуживания откройте установщик этой версии." /SD IDOK
   SetErrorLevel 1
   Abort
  ${EndIf}
  ${If} $0 != 0
   StrCpy $MaintenanceAction ""
  ${EndIf}
  ${If} $MaintenanceAction != "update"
  ${AndIf} $MaintenanceAction != "repair"
   MessageBox MB_OK|MB_ICONSTOP "Не удалось проверить версию установленной программы. Установка остановлена. Файлы и профиль сохранены." /SD IDOK
   SetErrorLevel 1
   Abort
  ${EndIf}
  StrCpy $INSTDIR "$InstalledDir"
  StrCpy $Mode "repair"
  ReadRegStr $NewStartHash HKCU "${REGKEY}" "StartLinkSHA256"
  ReadRegStr $NewDesktopHash HKCU "${REGKEY}" "DesktopLinkSHA256"
  StrCpy $StartLink ${BST_UNCHECKED}
  ${If} $NewStartHash != ""
   StrCpy $StartLink ${BST_CHECKED}
  ${EndIf}
  ${If} $NewDesktopHash != ""
   StrCpy $DesktopLink ${BST_CHECKED}
  ${EndIf}
 ${EndIf}
 SectionSetSize 0 ${REQUIRED_KIB}
FunctionEnd

Function AccountPage
 Call SkipInstalled
 !insertmacro MUI_HEADER_TEXT "Первый вход" "Выберите имя или перенесите профиль со своего компьютера."
 nsDialogs::Create 1018
 Pop $0
 ${NSD_CreateLabel} 0 3u 100% 15u "Впервые здесь?"
 Pop $0
 ${NSD_CreateLabel} 0 20u 100% 34u "При первом запуске нажмите «Создать профиль LINK» и введите имя. Затем откройте «Друзья» и отправьте другу свою карточку."
 Pop $0
 ${NSD_CreateLabel} 0 62u 100% 15u "Уже пользовались программой?"
 Pop $0
 ${NSD_CreateLabel} 0 79u 100% 36u "На этом ПК можно вернуться в сохранённый профиль. На другом ПК нажмите «Создать профиль LINK», затем «Перенести профиль с другого ПК» и откройте свой файл переноса."
 Pop $0
 ${NSD_CreateLink} 0 124u 100% 15u "Что хранится на компьютере"
 Pop $0
 ${NSD_OnClick} $0 ExplainAccount
 nsDialogs::Show
FunctionEnd
Function ExplainAccount
 Pop $0
 MessageBox MB_OK|MB_ICONINFORMATION "Локальный профиль и список друзей хранятся на ПК с защитой Windows. Файл переноса создаётся по вашему выбору и защищается отдельным паролем. Профиль можно удалить в настройках или при удалении программы.$\r$\n$\r$\nПриложение получает доступ к микрофону и экрану, когда вы их включаете. Общедоступный поиск друзей через интернет и обнаружение в локальной сети настраиваются в программе. Аккаунт Jabber остаётся у выбранного провайдера."
FunctionEnd

Function SkipInstalled
 ${If} $InstalledDir != ""
  Abort
 ${EndIf}
FunctionEnd

!macro ProfileControls
 !insertmacro MUI_HEADER_TEXT "Удаление CRAFTCODE LINK" "Выберите, какие данные удалить с этого компьютера."
 nsDialogs::Create 1018
 Pop $0
 ${NSD_CreateLabel} 0 0 100% 26u "Мастер завершит текущий звонок, закроет программу и удалит её файлы и ярлыки."
 Pop $0
 ${NSD_CreateCheckbox} 0 32u 100% 16u "Удалить также мой локальный профиль"
 Pop $PurgeCheck
 ${NSD_SetState} $PurgeCheck $PurgeProfile
 ${NSD_CreateLabel} 12u 55u 95% 48u "С отметкой будут удалены профили, ключи, контакты, личная история и данные групп на этом ПК, включая выбранное хранилище на другом диске. Кэш, временные файлы и отчёты очищаются при любом выборе."
 Pop $0
 ${NSD_CreateLabel} 0 108u 100% 44u "Сохранённые вложения в папке загрузок остаются у вас. Перед удалением профиля можно сохранить файл переноса. Аккаунт Jabber остаётся у провайдера."
 Pop $0
!macroend
Function MaintenanceDetailsShow
 ${If} $Mode == "install"
  Abort
 ${EndIf}
 GetDlgItem $1 $HWNDPARENT 1
 ${If} $Mode == "remove"
  !insertmacro ProfileControls
  GetDlgItem $1 $HWNDPARENT 1
  ${NSD_SetText} $1 "Удалить"
 ${Else}
  !insertmacro MUI_HEADER_TEXT "Обслуживание CRAFTCODE LINK" "Проверьте параметры перед продолжением."
  nsDialogs::Create 1018
  Pop $0
  ${NSD_CreateLabel} 0 0 100% 34u "$INSTDIR"
  Pop $0
  ${NSD_CreateLabel} 0 42u 100% 50u "Мастер сам закроет CRAFTCODE LINK. Текущий звонок и показ экрана завершатся. Аккаунт и настройки сохранятся."
  Pop $0
  GetDlgItem $1 $HWNDPARENT 1
  ${If} $MaintenanceAction == "repair"
   ${NSD_SetText} $1 "Восстановить"
  ${Else}
   ${NSD_SetText} $1 "Обновить"
  ${EndIf}
 ${EndIf}
 GetFunctionAddress $0 MaintenanceDetailsLeave
 nsDialogs::OnBack $0
 nsDialogs::Show
FunctionEnd
Function MaintenanceDetailsLeave
 ${If} $Mode == "remove"
  ${NSD_GetState} $PurgeCheck $PurgeProfile
 ${EndIf}
FunctionEnd

Function MaintenanceShow
 ${If} $InstalledDir == ""
  Abort
 ${EndIf}
 !insertmacro MUI_HEADER_TEXT "Обслуживание CRAFTCODE LINK" "Программа уже установлена. Выберите действие."
 nsDialogs::Create 1018
 Pop $0
 ${NSD_CreateLabel} 0 0 100% 24u "Установлена версия $InstalledVersion"
 Pop $0
 StrCpy $1 "Восстановить программу"
 ${If} $MaintenanceAction == "update"
  StrCpy $1 "Обновить до ${VERSION}"
 ${EndIf}
 ${NSD_CreateFirstRadioButton} 0 29u 100% 16u "$1"
 Pop $RepairRadio
 ${NSD_CreateLabel} 12u 48u 96% 31u "Вернуть исправные файлы и выбранные при установке ярлыки. Аккаунт и настройки сохранятся."
 Pop $0
 ${NSD_CreateAdditionalRadioButton} 0 86u 100% 15u "Удалить программу"
 Pop $RemoveRadio
 ${NSD_CreateLabel} 12u 105u 96% 29u "На следующем шаге можно выбрать, оставлять ли данные на этом ПК."
 Pop $0
 ${If} $Mode == "remove"
  ${NSD_Check} $RemoveRadio
 ${Else}
  ${NSD_Check} $RepairRadio
 ${EndIf}
 nsDialogs::Show
FunctionEnd
Function MaintenanceLeave
 ${NSD_GetState} $RemoveRadio $0
 ${If} $0 == ${BST_CHECKED}
  StrCpy $Mode "remove"
 ${Else}
  StrCpy $Mode "repair"
 ${EndIf}
FunctionEnd

Function ProgressShow
 ${If} $Mode == "remove"
  !insertmacro MUI_HEADER_TEXT "Удаление программы" "Мастер удаляет CRAFTCODE LINK."
 ${ElseIf} $Mode == "repair"
  ${If} $MaintenanceAction == "repair"
   !insertmacro MUI_HEADER_TEXT "Восстановление программы" "Мастер заменяет файлы установленной программы."
  ${Else}
   !insertmacro MUI_HEADER_TEXT "Обновление программы" "Ход обновления показан в журнале ниже."
  ${EndIf}
 ${EndIf}
FunctionEnd

Function FinishShow
 ${If} $Mode == "remove"
  ${NSD_SetText} $mui.FinishPage.Title "CRAFTCODE LINK удалён"
  ${NSD_SetText} $mui.FinishPage.Text "Нажмите «Готово», чтобы закрыть мастер."
  ${NSD_Uncheck} $mui.FinishPage.Run
  ShowWindow $mui.FinishPage.Run ${SW_HIDE}
 ${ElseIf} $Mode == "repair"
  ${If} $MaintenanceAction == "repair"
   ${NSD_SetText} $mui.FinishPage.Title "CRAFTCODE LINK восстановлен"
  ${Else}
   ${NSD_SetText} $mui.FinishPage.Title "CRAFTCODE LINK обновлён"
  ${EndIf}
  ${NSD_SetText} $mui.FinishPage.Text "Ваши настройки сохранены. Выберите, запустить ли CRAFTCODE LINK."
 ${EndIf}
 ${If} $ShortcutWarning == 1
  ${NSD_SetText} $mui.FinishPage.Text "Файлы установлены. Не удалось создать один из выбранных ярлыков. Программу можно запустить из папки установки."
 ${EndIf}
FunctionEnd

Function NormalizeFolder
 ${GetRoot} "$INSTDIR" $0
 ${If} $INSTDIR == "$0\"
 ${OrIf} $INSTDIR == "$0"
  StrCpy $INSTDIR "$0\CRAFTCODE LINK"
 ${ElseIf} $INSTDIR == "$DESKTOP"
 ${OrIf} $INSTDIR == "$DOCUMENTS"
 ${OrIf} $INSTDIR == "$SMPROGRAMS"
 ${OrIf} $INSTDIR == "$STARTMENU"
 ${OrIf} $INSTDIR == "$PICTURES"
 ${OrIf} $INSTDIR == "$MUSIC"
 ${OrIf} $INSTDIR == "$VIDEOS"
 ${OrIf} $INSTDIR == "$LOCALAPPDATA\Programs"
  StrCpy $INSTDIR "$INSTDIR\CRAFTCODE LINK"
 ${EndIf}
FunctionEnd
Function DirectoryLeave
 Call NormalizeFolder
 nsExec::ExecToStack '"$PLUGINSDIR\care.exe" validate "$INSTDIR"'
 Pop $0
 Pop $1
 ${If} $0 == 3
  MessageBox MB_OK|MB_ICONEXCLAMATION "На выбранном диске недостаточно свободного места. Выберите другой диск или освободите место."
  Abort
 ${ElseIf} $0 != 0
  MessageBox MB_OK|MB_ICONEXCLAMATION "Выберите новую или пустую папку на локальном диске. Папка с сохранёнными данными LINK также подходит, если программа может подтвердить их принадлежность. Проверьте путь и права доступа. Системные папки и ссылки на другие каталоги использовать нельзя."
  Abort
 ${EndIf}
FunctionEnd

Function ShortcutsShow
 Call SkipInstalled
 !insertmacro MUI_HEADER_TEXT "Ярлыки" "Выберите, откуда вам удобно запускать программу."
 nsDialogs::Create 1018
 Pop $0
 ${NSD_CreateLabel} 0 0 100% 16u "Папка установки:"
 Pop $0
 ${NSD_CreateText} 0 17u 100% 16u "$INSTDIR"
 Pop $0
 SendMessage $0 ${EM_SETREADONLY} 1 0
 ${NSD_CreateCheckbox} 0 50u 100% 15u "Создать ярлык в меню «Пуск»"
 Pop $StartCheck
 ${NSD_SetState} $StartCheck $StartLink
 ${NSD_CreateCheckbox} 0 72u 100% 15u "Создать ярлык на рабочем столе"
 Pop $DesktopCheck
 ${NSD_SetState} $DesktopCheck $DesktopLink
 GetFunctionAddress $0 ShortcutsLeave
 nsDialogs::OnBack $0
 nsDialogs::Show
FunctionEnd
Function ShortcutsLeave
 ${NSD_GetState} $StartCheck $StartLink
 ${NSD_GetState} $DesktopCheck $DesktopLink
FunctionEnd

Function SetLinkIdentity
 ; Only update a shortcut whose target is still this installation. Preserve its other fields.
 Pop $9
 !insertmacro ComHlpr_CreateInProcInstance ${CLSID_ShellLink} ${IID_IShellLink} r0 ""
 ${If} $0 P<> 0
  ${IUnknown::QueryInterface} $0 '("${IID_IPersistFile}",.r1)'
  ${If} $1 P<> 0
   ${IPersistFile::Load} $1 '("$9",${STGM_READWRITE}).r2'
   ${If} $2 = 0
    ${IShellLink::GetPath} $0 '(.r3,${NSIS_MAX_STRLEN},0,4).r2'
   ${EndIf}
   ${If} $2 = 0
   ${AndIf} $3 == "$INSTDIR\CRAFTCODE-LINK.exe"
    ${IUnknown::QueryInterface} $0 '("${IID_IPropertyStore}",.r2)'
    ${If} $2 P<> 0
     System::Call '*${SYSSTRUCT_PROPERTYKEY}(${PKEY_AppUserModel_ID})p.r3'
     System::Call '*( &w32 "CRAFTCODE.Link.Desktop")p.r4'
     System::Call '*${SYSSTRUCT_PROPVARIANT}(${VT_LPWSTR},,p r4)p.r5'
     ${IPropertyStore::SetValue} $2 '($3,$5).r6'
     ${If} $6 = 0
      ${IPropertyStore::Commit} $2 '().r6'
      ${If} $6 = 0
       ${IPersistFile::Save} $1 '("$9",1).r6'
      ${EndIf}
     ${EndIf}
     System::Free $5
     System::Free $4
     System::Free $3
     ${IUnknown::Release} $2 ""
    ${EndIf}
   ${EndIf}
   ${IUnknown::Release} $1 ""
  ${EndIf}
  ${IUnknown::Release} $0 ""
 ${EndIf}
FunctionEnd
!macro MakeLink choice link result
 ${If} ${choice} == ${BST_CHECKED}
  StrCpy $7 1
  ${If} ${FileExists} "${link}"
   StrCpy $7 0
   ${If} ${result} != ""
    nsExec::ExecToStack '"$PLUGINSDIR\care.exe" hash "${link}"'
    Pop $0
    Pop $1
    ${If} $0 == 0
    ${AndIf} $1 == ${result}
     StrCpy $7 1
    ${ElseIf} $0 == 0
     Push "${link}"
     Call SetLinkIdentity
    ${EndIf}
   ${EndIf}
  ${EndIf}
  ${If} $7 == 1
   ClearErrors
   CreateShortcut "${link}" "$INSTDIR\CRAFTCODE-LINK.exe" "" "$INSTDIR\resources\app\src\renderer\assets\craftlink.ico" 0
   ${If} ${Errors}
    StrCpy $ShortcutWarning 1
    DetailPrint "Не удалось создать ярлык: ${link}"
   ${Else}
    Push "${link}"
    Call SetLinkIdentity
    nsExec::ExecToStack '"$PLUGINSDIR\care.exe" hash "${link}"'
    Pop $0
    Pop $1
    ${If} $0 == 0
     StrCpy ${result} $1
    ${Else}
     ; The uninstall target check can still recognize the shortcut we just created.
     StrCpy ${result} "target"
    ${EndIf}
   ${EndIf}
  ${EndIf}
  System::Call 'shell32::SHChangeNotify(i 0x2000, i 0x5, w "${link}", p 0)'
 ${EndIf}
!macroend

!macro RemoveLink link key
 ReadRegStr $0 HKCU "${REGKEY}" "${key}"
 ${If} $0 != ""
 ${AndIf} ${FileExists} "${link}"
  nsExec::ExecToStack '"$PLUGINSDIR\care.exe" hash "${link}"'
  Pop $1
  Pop $2
  ${If} $1 != 0
   Goto removalFailed
  ${EndIf}
  ; Windows can update shortcut tracking metadata after first use.
  StrCpy $3 ""
  ${If} $2 != $0
   !insertmacro ComHlpr_CreateInProcInstance ${CLSID_ShellLink} ${IID_IShellLink} r4 ""
   ${If} $4 P<> 0
    ${IUnknown::QueryInterface} $4 '("${IID_IPersistFile}",.r5)'
    ${If} $5 P<> 0
     ${IPersistFile::Load} $5 '("${link}",0).r6'
     ${If} $6 = 0
      ${IShellLink::GetPath} $4 '(.r3,${NSIS_MAX_STRLEN},0,4).r6'
     ${EndIf}
     ${IUnknown::Release} $5 ""
    ${EndIf}
    ${IUnknown::Release} $4 ""
   ${EndIf}
  ${EndIf}
  ${If} $2 == $0
  ${OrIf} $3 == "$INSTDIR\CRAFTCODE-LINK.exe"
   ClearErrors
   Delete "${link}"
   IfErrors removalFailed
  ${EndIf}
 ${EndIf}
!macroend

!macro CheckClosed
 runningCheck:
 StrCpy $2 0
 closeAttempt:
 DetailPrint "Ожидание выхода CRAFTCODE LINK…"
 nsExec::ExecToStack '"$PLUGINSDIR\care.exe" close-installation "$INSTDIR"'
 Pop $0
 Pop $1
 ${If} $0 != 0
  ${If} $2 == 0
   StrCpy $2 1
   Sleep 750
   Goto closeAttempt
  ${EndIf}
  MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Windows не смогла завершить CRAFTCODE LINK. Сохраните текущую работу и нажмите «Повторить». При отмене мастер остановится." /SD IDCANCEL IDRETRY runningCheck
  SetErrorLevel 1
  Abort
 ${EndIf}
!macroend
!macro RemoveInstalled
 removalRetry:
 !insertmacro CheckClosed
 SetOutPath "$PLUGINSDIR"
 StrCpy $9 "cache"
 ${If} $PurgeProfile == ${BST_CHECKED}
  StrCpy $9 "purge"
 ${EndIf}
 DetailPrint "Очистка локальных данных CRAFTCODE LINK…"
 nsExec::ExecToStack '"$PLUGINSDIR\care.exe" $9 "$APPDATA"'
 Pop $0
 Pop $1
 StrCmp $0 0 +2
 Goto dataRemovalFailed
 DetailPrint "Удаление файлов CRAFTCODE LINK…"
 nsExec::ExecToStack '"$PLUGINSDIR\care.exe" remove "$INSTDIR"'
 Pop $0
 Pop $1
 StrCmp $0 0 +2
 Goto removalFailed
 !insertmacro RemoveLink "$SMPROGRAMS\CRAFTCODE LINK.lnk" "StartLinkSHA256"
 !insertmacro RemoveLink "$DESKTOP\CRAFTCODE LINK.lnk" "DesktopLinkSHA256"
 ClearErrors
 ${If} ${FileExists} "$INSTDIR\Uninstall.exe"
  Delete "$INSTDIR\Uninstall.exe"
  IfErrors removalFailed
 ${EndIf}
 RMDir "$INSTDIR"
 DeleteRegKey HKCU "${REGKEY}"
 Goto removalDone
 dataRemovalFailed:
  MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Не удалось завершить очистку данных. Проверьте доступность диска с хранилищем и закройте приложения, использующие его файлы. Нажмите «Повторить», чтобы продолжить." /SD IDCANCEL IDRETRY removalRetry
  SetErrorLevel 1
  Abort
 removalFailed:
  MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Удаление не завершено. Проверьте доступ к файлам программы и нажмите «Повторить»." /SD IDCANCEL IDRETRY removalRetry
  SetErrorLevel 1
  Abort
 removalDone:
!macroend
Function CheckBeforeRepair
 !insertmacro CheckClosed
FunctionEnd

Section "CRAFTCODE LINK" Main
 SetDetailsPrint both
 ${If} $Mode == "remove"
  !insertmacro RemoveInstalled
  Goto installDone
 ${ElseIf} $Mode == "repair"
  DetailPrint "Подготовка файлов обновления…"
  StrCpy $9 "repair-stage"
 ${Else}
  Call NormalizeFolder
  StrCpy $9 "stage"
 ${EndIf}
 nsExec::ExecToStack '"$PLUGINSDIR\care.exe" $9 "$INSTDIR"'
 Pop $0
 Pop $1
 ${If} $0 != 0
  MessageBox MB_OK|MB_ICONSTOP "Не удалось начать установку. Проверьте свободное место, путь и разрешение на запись." /SD IDOK
  SetErrorLevel 1
  Abort
 ${EndIf}
 StrCpy $Stage $1
 ${GetParent} "$INSTDIR" $0
 StrCpy $R9 "$0\$Stage"
 !include "${PAYLOAD_NSH}"
 SetOutPath "$PLUGINSDIR"
 ClearErrors
 WriteUninstaller "$R9\Uninstall.exe"
 IfErrors installFailed
 StrCpy $9 "commit"
 ${If} $Mode == "repair"
  Call CheckBeforeRepair
  StrCpy $9 "repair"
 ${EndIf}
 nsExec::ExecToStack '"$PLUGINSDIR\care.exe" $9 "$INSTDIR" "$Stage"' 
 Pop $0
 Pop $1
 StrCmp $0 0 +2
 Goto installFailed
 StrCpy $Stage ""
 ClearErrors
 WriteRegStr HKCU "${REGKEY}" "InstallLocation" "$INSTDIR"
 WriteRegStr HKCU "${REGKEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
 WriteRegStr HKCU "${REGKEY}" "DisplayName" "CRAFTCODE LINK"
 WriteRegStr HKCU "${REGKEY}" "DisplayVersion" "${VERSION}"
 WriteRegStr HKCU "${REGKEY}" "Publisher" "CRAFTCODE"
 WriteRegStr HKCU "${REGKEY}" "DisplayIcon" '"$INSTDIR\CRAFTCODE-LINK.exe",0'
 WriteRegDWORD HKCU "${REGKEY}" "EstimatedSize" ${REQUIRED_KIB}
 WriteRegDWORD HKCU "${REGKEY}" "NoModify" 1
 WriteRegDWORD HKCU "${REGKEY}" "NoRepair" 1
 ${If} ${Errors}
  ${If} $Mode == "repair"
   Goto installFailed
  ${EndIf}
  DeleteRegKey HKCU "${REGKEY}"
  nsExec::ExecToLog '"$PLUGINSDIR\care.exe" remove "$INSTDIR"'
  Pop $0
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  Goto installFailed
 ${EndIf}
 SetOutPath "$INSTDIR"
 !insertmacro MakeLink $StartLink "$SMPROGRAMS\CRAFTCODE LINK.lnk" $NewStartHash
 !insertmacro MakeLink $DesktopLink "$DESKTOP\CRAFTCODE LINK.lnk" $NewDesktopHash
 WriteRegStr HKCU "${REGKEY}" "StartLinkSHA256" "$NewStartHash"
 WriteRegStr HKCU "${REGKEY}" "DesktopLinkSHA256" "$NewDesktopHash"
 Goto installDone
 installFailed:
  SetErrorLevel 1
  MessageBox MB_OK|MB_ICONSTOP "Установка не завершена. Проверьте место на диске и право записи в выбранную папку." /SD IDOK
  Abort
 installDone:
 DetailPrint "Готово. Нажмите «Далее», когда закончите просмотр журнала."
SectionEnd

Function .onGUIEnd
 ${If} $Stage != ""
  SetOutPath "$PLUGINSDIR"
  nsExec::ExecToLog '"$PLUGINSDIR\care.exe" discard "$INSTDIR" "$Stage"'
  Pop $0
 ${EndIf}
FunctionEnd

Function un.onInit
 !insertmacro InitCommon
 ReadRegStr $0 HKCU "${REGKEY}" "InstallLocation"
 ${If} $0 != $INSTDIR
  MessageBox MB_OK|MB_ICONSTOP "Эта копия мастера не соответствует зарегистрированной папке установки для текущего пользователя." /SD IDOK
  SetErrorLevel 1
  Abort
 ${EndIf}
 ; Removing user data always requires an explicit choice.
 StrCpy $PurgeProfile ${BST_UNCHECKED}
FunctionEnd
Function un.ProfileShow
 !insertmacro ProfileControls
 GetFunctionAddress $0 un.ProfileLeave
 nsDialogs::OnBack $0
 nsDialogs::Show
FunctionEnd
Function un.ProfileLeave
 ${NSD_GetState} $PurgeCheck $PurgeProfile
FunctionEnd

Section "Uninstall"
 !insertmacro RemoveInstalled
SectionEnd
