// Owned hosted acceptance helper, not a Studio product command. No activation,
// AppleScript/System Events, permission prompting, or process termination.
#import <Foundation/Foundation.h>
#import <ApplicationServices/ApplicationServices.h>
#include <libproc.h>
#include <unistd.h>
static void fail(NSString *code) { fprintf(stderr,"%s\n",[code UTF8String]); exit(1); }
static id attr(AXUIElementRef element, CFStringRef key) {
  CFTypeRef value=NULL; AXError error=AXUIElementCopyAttributeValue(element,key,&value);
  if(error==kAXErrorAttributeUnsupported || error==kAXErrorNoValue)return nil;
  if(error!=kAXErrorSuccess)fail(@"owned_ax_observation_failed");
  return CFBridgingRelease(value);
}
static NSDictionary *identity(NSDictionary *expected) {
  NSNumber *number=expected[@"pid"]; if(![number isKindOfClass:[NSNumber class]] || number.intValue<=1)fail(@"owned_pid_required");
  pid_t pid=number.intValue; struct proc_bsdinfo info; char executable[PROC_PIDPATHINFO_MAXSIZE];
  if(proc_pidinfo(pid,PROC_PIDTBSDINFO,0,&info,sizeof(info))!=sizeof(info) || proc_pidpath(pid,executable,sizeof(executable))<=0)fail(@"owned_process_missing");
  NSString *path=[NSString stringWithUTF8String:executable]; NSString *start=[NSString stringWithFormat:@"%llu:%llu",(unsigned long long)info.pbi_start_tvsec,(unsigned long long)info.pbi_start_tvusec];
  if(![path isEqual:expected[@"executable"]] || (expected[@"start"] && ![start isEqual:expected[@"start"]]))fail(@"owned_process_changed");
  return @{@"pid":@(pid),@"executable":path,@"start":start};
}
static BOOL ownerElement(AXUIElementRef element,pid_t pid) { pid_t actual=0;return AXUIElementGetPid(element,&actual)==kAXErrorSuccess && actual==pid; }
static BOOL visible(AXUIElementRef element) {
  id hidden=attr(element,kAXHiddenAttribute);if(hidden && [hidden boolValue])return NO;
  AXValueRef size=(__bridge AXValueRef)attr(element,kAXSizeAttribute);CGSize bounds;
  return size && CFGetTypeID(size)==AXValueGetTypeID() && AXValueGetValue(size,kAXValueCGSizeType,&bounds) && bounds.width>0 && bounds.height>0;
}
static NSString *text(id value) { return [value isKindOfClass:[NSString class]]?[value stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet]:@""; }
// Same predicate is exercised in --contract mode; it cannot dispatch native input.
static BOOL contract(NSDictionary *d,pid_t pid) {
  if(![d isKindOfClass:[NSDictionary class]] || [d[@"pid"] intValue]!=pid || [d[@"ownerPid"] intValue]!=pid || ![d[@"visible"] isEqual:@YES])return NO;
  if(![@[@"AXSheet",@"AXDialog"] containsObject:d[@"kind"]])return NO;
  NSArray *texts=d[@"texts"],*buttons=d[@"buttons"];
  if(![texts isKindOfClass:[NSArray class]] || texts.count!=2 || ![buttons isKindOfClass:[NSArray class]] || buttons.count!=2)return NO;
  NSArray *expected=@[@"Studio를 끝낼까요?",@"지금 하고 있는 대답이 멈춰요.\n만든 파일은 그대로 남아요."];
  if(![[NSSet setWithArray:texts] isEqual:[NSSet setWithArray:expected]])return NO;
  NSMutableSet *names=[NSMutableSet set];
  for(NSDictionary *b in buttons) {
    if(![b isKindOfClass:[NSDictionary class]] || ![b[@"enabled"] isEqual:@YES] || ![b[@"visible"] isEqual:@YES] || ![b[@"pressable"] isEqual:@YES] || [b[@"pid"] intValue]!=pid || ![b[@"name"] isKindOfClass:[NSString class]])return NO;
    [names addObject:b[@"name"]];
  }
  return [names isEqual:[NSSet setWithArray:@[@"계속하기",@"끝내기"]]];
}
static NSDictionary *readDialog(AXUIElementRef dialog,AXUIElementRef window,pid_t pid,AXUIElementRef *quitButton) {
  if(!ownerElement(dialog,pid)||!ownerElement(window,pid))fail(@"owned_dialog_changed");
  NSString *role=attr(dialog,kAXRoleAttribute);NSString *subrole=attr(dialog,kAXSubroleAttribute);
  NSString *kind=[role isEqual:(__bridge NSString*)kAXSheetRole]?@"AXSheet":([subrole isEqual:(__bridge NSString*)kAXDialogSubrole]?@"AXDialog":@"");
  if(![attr(window,kAXRoleAttribute) isEqual:(__bridge NSString*)kAXWindowRole])fail(@"owned_window_required");
  if(!visible(window)||[attr(window,kAXMinimizedAttribute) boolValue])fail(@"owned_window_hidden");
  // Verify an actual parent chain to the owning application/window, not a caller label.
  AXUIElementRef parent=dialog;BOOL reached=NO;
  for(int depth=0;depth<12;depth++) {
    if(!ownerElement(parent,pid))fail(@"owned_parent_changed");
    if(CFEqual(parent,window)){reached=YES;break;}
    parent=(__bridge AXUIElementRef)attr(parent,kAXParentAttribute);if(!parent)break;
  }
  if(!reached)fail(@"owned_dialog_parent_required");
  NSMutableArray *queue=[NSMutableArray arrayWithObject:(__bridge id)dialog],*texts=[NSMutableArray array],*buttons=[NSMutableArray array];int seen=0;
  while(queue.count) {
    __attribute__((objc_precise_lifetime)) id retainedElement=queue[0];
    AXUIElementRef element=(__bridge AXUIElementRef)retainedElement;[queue removeObjectAtIndex:0];
    if(++seen>128 || !ownerElement(element,pid))fail(@"owned_dialog_tree_refused");
    NSString *r=attr(element,kAXRoleAttribute),*sr=attr(element,kAXSubroleAttribute);
    if([@[@"AXCloseButton",@"AXMinimizeButton",@"AXZoomButton"] containsObject:sr?:@""])continue;
    if([r isEqual:(__bridge NSString*)kAXStaticTextRole]) {
      NSString *value=text(attr(element,kAXValueAttribute));if(!value.length)value=text(attr(element,kAXTitleAttribute));
      if(value.length)[texts addObject:[value stringByReplacingOccurrencesOfString:@"\r\n" withString:@"\n"]];
    }
    if([r isEqual:(__bridge NSString*)kAXButtonRole]) {
      NSString *name=text(attr(element,kAXTitleAttribute));CFArrayRef actions=NULL;
      if(AXUIElementCopyActionNames(element,&actions)!=kAXErrorSuccess)fail(@"owned_button_actions_unknown");
      BOOL pressable=[(__bridge NSArray*)actions containsObject:(__bridge NSString*)kAXPressAction];CFRelease(actions);
      [buttons addObject:@{@"name":name,@"pid":@(pid),@"enabled":@([attr(element,kAXEnabledAttribute) boolValue]),@"visible":@(visible(element)),@"pressable":@(pressable)}];
      if([name isEqual:@"끝내기"]){if(*quitButton)CFRelease(*quitButton);*quitButton=(AXUIElementRef)CFRetain(element);}
    }
    NSArray *children=attr(element,kAXChildrenAttribute);if(children){if(![children isKindOfClass:[NSArray class]]||children.count>128)fail(@"owned_children_refused");[queue addObjectsFromArray:children];}
  }
  return @{@"pid":@(pid),@"ownerPid":@(pid),@"kind":kind,@"visible":@(visible(dialog)),@"texts":texts,@"buttons":buttons};
}
static NSArray *dialogs(AXUIElementRef application,pid_t pid) {
  NSArray *windows=attr(application,kAXWindowsAttribute);if(![windows isKindOfClass:[NSArray class]]||windows.count>16)fail(@"owned_windows_unknown");
  NSMutableArray *found=[NSMutableArray array];
  for(id item in windows) {
    AXUIElementRef window=(__bridge AXUIElementRef)item;if(!ownerElement(window,pid))fail(@"owned_window_changed");
    if([attr(window,kAXSubroleAttribute) isEqual:(__bridge NSString*)kAXDialogSubrole]){[found addObject:@[item,item]];continue;}
    NSArray *children=attr(window,kAXChildrenAttribute);if(children && (![children isKindOfClass:[NSArray class]]||children.count>64))fail(@"owned_window_children_exceeded");
    for(id child in children)if([attr((__bridge AXUIElementRef)child,kAXRoleAttribute) isEqual:(__bridge NSString*)kAXSheetRole])[found addObject:@[child,item]];
  }
  if(found.count>1)fail(@"owned_dialog_ambiguous");return found;
}
int main(int argc,const char *argv[]) { @autoreleasepool {
  @try {
    NSData *input=[[NSFileHandle fileHandleWithStandardInput] readDataToEndOfFile];if(input.length>32768)fail(@"owned_input_exceeded");
    NSDictionary *request=[NSJSONSerialization JSONObjectWithData:input options:0 error:nil];if(![request isKindOfClass:[NSDictionary class]])fail(@"owned_input_invalid");
    NSString *mode=request[@"mode"];NSDictionary *expected=request[@"owner"];id output;
    if([mode isEqual:@"contract"])output=@{@"accepted":@(contract(request[@"dialog"],[expected[@"pid"] intValue])),@"native_input":@NO};
    else {
      NSDictionary *owner=identity(expected);
      if([mode isEqual:@"capture"] || [mode isEqual:@"identity"]){NSMutableDictionary *captured=[owner mutableCopy];captured[@"accessibilityTrusted"]=(AXIsProcessTrusted()?@YES:@NO);output=captured;}
      else if([mode isEqual:@"confirm"]) {
        // Read-only permission check: never AXIsProcessTrustedWithOptions/prompt.
        if(!AXIsProcessTrusted())fail(@"owned_ax_permission_unavailable");
        pid_t pid=[owner[@"pid"] intValue];AXUIElementRef app=AXUIElementCreateApplication(pid);AXUIElementSetMessagingTimeout(app,1.0);
        double deadline=NSProcessInfo.processInfo.systemUptime+10;NSArray *found=nil;int samples=0;
        while(NSProcessInfo.processInfo.systemUptime<deadline){identity(expected);found=dialogs(app,pid);samples++;if(found.count)break;usleep(150000);}
        if(!found.count)fail(@"owned_quit_dialog_missing");
        AXUIElementRef dialog=(__bridge AXUIElementRef)found[0][0],window=(__bridge AXUIElementRef)found[0][1],button=NULL;
        if(!contract(readDialog(dialog,window,pid,&button),pid)||!button)fail(@"owned_quit_dialog_unknown");
        NSArray *again=dialogs(app,pid);
        if(again.count!=1||!CFEqual(dialog,(__bridge AXUIElementRef)again[0][0])||!CFEqual(window,(__bridge AXUIElementRef)again[0][1]))fail(@"owned_quit_dialog_replaced");
        if(!contract(readDialog(dialog,window,pid,&button),pid))fail(@"owned_quit_dialog_changed");
        identity(expected);if(NSProcessInfo.processInfo.systemUptime>=deadline)fail(@"owned_quit_deadline");
        if(AXUIElementPerformAction(button,kAXPressAction)!=kAXErrorSuccess)fail(@"owned_quit_invocation_unknown");
        CFRelease(button);CFRelease(app);output=@{@"invoked":@YES,@"owner_pid":@(pid),@"choice":@"끝내기",@"samples":@(samples),@"native_dialog_observed":@YES};
      } else fail(@"owned_mode_invalid");
    }
    NSData *json=[NSJSONSerialization dataWithJSONObject:output options:0 error:nil];[[NSFileHandle fileHandleWithStandardOutput] writeData:json];return 0;
  } @catch(NSException *exception) { fail(@"owned_ax_refused"); }
} }
