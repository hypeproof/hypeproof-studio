# Windows UI Automation for one exact owned native streaming-quit prompt.
# No generic Enter, window activation, process termination, or security-policy change.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  if ($request.mode -notin @('capture','observe','invoke','census')) { throw 'mode' }
  $ownedPid = [int]$request.owner.pid
  if ($ownedPid -le 0) { throw 'pid' }
  function Read-Owner {
    $process = [Diagnostics.Process]::GetProcessById($ownedPid)
    $identity = @{pid=$process.Id;start=$process.StartTime.ToUniversalTime().Ticks.ToString();executable=$process.MainModule.FileName}
    if (-not [string]::Equals($identity.executable, [string]$request.owner.executable, [StringComparison]::OrdinalIgnoreCase)) { throw 'executable' }
    if ($request.mode -ne 'capture' -and $identity.start -cne [string]$request.owner.start) { throw 'start' }
    return $identity
  }
  $identity = Read-Owner
  if ($request.mode -eq 'capture') { $identity | ConvertTo-Json -Compress; exit 0 }
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Collections.Generic;
using System.Text;
public static class OwnedQuitWindow {
  public delegate bool EnumWindow(IntPtr h,IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindow callback,IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h,StringBuilder text,int count);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int left,top,right,bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out Rect rect);
  public static IntPtr[] OwnedHandles(uint pid) {
    var result=new List<IntPtr>();
    bool finished=EnumWindows((h,l)=>{uint actual;GetWindowThreadProcessId(h,out actual);if(actual==pid)result.Add(h);return result.Count<=16;},IntPtr.Zero);
    if(!finished || result.Count>16)throw new Exception("owned window bound");return result.ToArray();
  }
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr handle, uint command);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr handle, out uint pid);
}
'@
  # Observation only. This path cannot supply Invoke eligibility or read peer content.
  if ($request.mode -eq 'census') {
    $result=@()
    foreach($handle in [OwnedQuitWindow]::OwnedHandles([uint32]$ownedPid)) {
      [uint32]$actualPid=0;[void][OwnedQuitWindow]::GetWindowThreadProcessId($handle,[ref]$actualPid)
      if($actualPid -ne $ownedPid){throw 'window changed'}
      $class=[Text.StringBuilder]::new(128);if([OwnedQuitWindow]::GetClassName($handle,$class,128) -le 0){throw 'class'}
      $className=$class.ToString();if($className -cnotmatch '^[A-Za-z0-9_#.: -]{1,127}$'){$className='other'}
      $parent=[OwnedQuitWindow]::GetWindow($handle,4);[uint32]$parentPid=0
      [void][OwnedQuitWindow]::GetWindowThreadProcessId($parent,[ref]$parentPid)
      $relation=if($parent -eq [IntPtr]::Zero){'none'}elseif($parentPid -eq $ownedPid){'owned'}else{'foreign'}
      $rect=[OwnedQuitWindow+Rect]::new();if(-not [OwnedQuitWindow]::GetWindowRect($handle,[ref]$rect)){throw 'rect'}
      $uia=@{available=$false;ownedNodes=0;skippedForeign=$false;capped=$false;roles=@{};modal=$null;matches=@{message=0;detail=0;continue=0;quit=0}}
      try {
        $root=[Windows.Automation.AutomationElement]::FromHandle($handle)
        $queue=[Collections.Generic.Queue[Windows.Automation.AutomationElement]]::new();$queue.Enqueue($root)
        while($queue.Count -gt 0 -and $uia.ownedNodes -lt 64) {
          $element=$queue.Dequeue()
          if($element.Current.ProcessId -ne $ownedPid){$uia.skippedForeign=$true;continue}
          $uia.ownedNodes++;$role=$element.Current.ControlType.ProgrammaticName
          if($role -cnotmatch '^ControlType\.[A-Za-z]+$'){throw 'role'}
          if(-not $uia.roles.ContainsKey($role)){$uia.roles[$role]=0};$uia.roles[$role]++
          if($element -eq $root){$pattern=$null;if($element.TryGetCurrentPattern([Windows.Automation.WindowPattern]::Pattern,[ref]$pattern)){$uia.modal=$pattern.Current.IsModal}}
          # Never return Name, Value, title, edit text or selection. Only known contract matches.
          if($element.Current.ControlType -eq [Windows.Automation.ControlType]::Text -or $element.Current.ControlType -eq [Windows.Automation.ControlType]::Button){
            $name=$element.Current.Name.Replace("`r`n","`n").Trim()
            if($name -ceq 'Studio를 끝낼까요?'){$uia.matches.message++}
            if($name -ceq "지금 하고 있는 대답이 멈춰요.`n만든 파일은 그대로 남아요."){$uia.matches.detail++}
            if($name -ceq '계속하기'){$uia.matches.continue++};if($name -ceq '끝내기'){$uia.matches.quit++}
          }
          $next=[Windows.Automation.TreeWalker]::ControlViewWalker.GetFirstChild($element);$siblings=0
          while($null -ne $next -and $queue.Count -lt 64 -and $siblings -lt 64){$queue.Enqueue($next);$siblings++;$next=[Windows.Automation.TreeWalker]::ControlViewWalker.GetNextSibling($next)}
          if($null -ne $next){$uia.capped=$true}
        }
        if($queue.Count -gt 0){$uia.capped=$true};$uia.available=$true
      }catch{$uia=@{available=$false;ownedNodes=0;skippedForeign=$false;capped=$false;roles=@{};modal=$null;matches=@{message=0;detail=0;continue=0;quit=0}}}
      [uint32]$finalPid=0;[void][OwnedQuitWindow]::GetWindowThreadProcessId($handle,[ref]$finalPid)
      if($finalPid -ne $ownedPid){throw 'window changed'}
      $result+=@{pid=$ownedPid;handle=$handle.ToInt64().ToString();className=$className;visible=[OwnedQuitWindow]::IsWindowVisible($handle);ownerRelation=$relation;ownerHandle=$(if($relation -eq 'owned'){$parent.ToInt64().ToString()}else{'0'});bounds=@($rect.left,$rect.top,$rect.right,$rect.bottom);uia=$uia}
    }
    $null=Read-Owner # census final identity fence; no action
    @{owner=$identity;windows=@($result)} | ConvertTo-Json -Depth 8 -Compress;exit 0
  }
  function Read-Dialogs {
    $condition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ProcessIdProperty,$ownedPid)
    # Only top-level windows of the known process. No peer tree is inspected/logged.
    $windows = [Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Children,$condition)
    if ($windows.Count -gt 16) { throw 'window count' }
    $dialogs = @()
    foreach ($window in $windows) {
      if ($window.Current.ClassName -cne '#32770') { continue }
      $handle = [IntPtr]::new($window.Current.NativeWindowHandle)
      $owner = [OwnedQuitWindow]::GetWindow($handle,4) # GW_OWNER
      [uint32]$windowOwnerPid = 0
      [void][OwnedQuitWindow]::GetWindowThreadProcessId($owner,[ref]$windowOwnerPid)
      $elements = $window.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.Condition]::TrueCondition)
      if ($elements.Count -gt 128) { throw 'element count' }
      $texts=@();$buttons=@();$quitButton=$null
      foreach($element in $elements) {
        # Title-bar Close is OS chrome, not a content choice. Do not count or invoke it.
        $ancestor=[Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($element)
        $chrome=$false;$depth=0
        while($null -ne $ancestor -and $ancestor.Current.NativeWindowHandle -ne $window.Current.NativeWindowHandle) {
          if($ancestor.Current.ControlType -eq [Windows.Automation.ControlType]::TitleBar) { $chrome=$true;break }
          if(++$depth -gt 16) { throw 'ancestor depth' }
          $ancestor=[Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($ancestor)
        }
        if($chrome) { continue }
        if($element.Current.ControlType -eq [Windows.Automation.ControlType]::Text -and $element.Current.Name.Trim().Length -gt 0) { $texts += $element.Current.Name }
        if($element.Current.ControlType -eq [Windows.Automation.ControlType]::Button) {
          $pattern=$null;$invokable=$element.TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)
          $buttons += @{name=$element.Current.Name;pid=$element.Current.ProcessId;enabled=$element.Current.IsEnabled;visible=(-not $element.Current.IsOffscreen);invokable=$invokable}
          if($element.Current.Name -ceq '끝내기') { $quitButton=$element }
        }
      }
      $data=@{handle=$handle.ToInt64().ToString();ownerHandle=$owner.ToInt64().ToString();pid=$window.Current.ProcessId;ownerPid=[int]$windowOwnerPid;className=$window.Current.ClassName;visible=(-not $window.Current.IsOffscreen);texts=@($texts);buttons=@($buttons)}
      $dialogs += @{data=$data;button=$quitButton}
    }
    return ,$dialogs
  }
  $observed = Read-Dialogs
  if($request.mode -eq 'observe') {
    @{owner=$identity;dialogs=@($observed | ForEach-Object {$_.data})} | ConvertTo-Json -Depth 8 -Compress; exit 0
  }
  # Re-enumerated on this invocation, not a handle retained from the observation process.
  if($observed.Count -ne 1) { throw 'dialog count' }
  $dialog=$observed[0];$data=$dialog.data
  if($data.handle -cne [string]$request.selection.handle -or $data.ownerHandle -cne [string]$request.selection.ownerHandle -or $data.ownerHandle -eq '0') { throw 'dialog replacement' }
  if($data.pid -ne $ownedPid -or $data.ownerPid -ne $ownedPid -or -not $data.visible) { throw 'dialog owner' }
  $expectedTexts=@('Studio를 끝낼까요?',"지금 하고 있는 대답이 멈춰요.`n만든 파일은 그대로 남아요.") | Sort-Object
  $texts=@($data.texts | ForEach-Object { $_.Replace("`r`n","`n").Trim() } | Sort-Object)
  if($texts.Count -ne 2 -or $texts[0] -cne $expectedTexts[0] -or $texts[1] -cne $expectedTexts[1]) { throw 'dialog text' }
  if($data.buttons.Count -ne 2) { throw 'buttons' }
  $names=@($data.buttons | ForEach-Object {$_.name} | Sort-Object)
  $expectedNames=@('계속하기','끝내기') | Sort-Object
  if($names[0] -cne $expectedNames[0] -or $names[1] -cne $expectedNames[1]) { throw 'button names' }
  foreach($button in $data.buttons) { if($button.pid -ne $ownedPid -or -not $button.enabled -or -not $button.visible -or -not $button.invokable) { throw 'button owner' } }
  $null=Read-Owner # final PID/start/executable fence before the single real UI invocation
  $invoke=$dialog.button.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)
  $invoke.Invoke()
  @{invoked=$true;handle=$data.handle} | ConvertTo-Json -Compress
} catch {
  # Do not emit arbitrary native text, process details, stack traces or exception messages.
  [Console]::Error.WriteLine('owned_native_quit_refused')
  exit 1
}
