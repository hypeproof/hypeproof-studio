"""One Linux KVM guest; actual target-UID AtomicFile checkpoints across live external kills.
No login/relay/SDK/browser/production endpoint. Import is inert; root-owned hosted opt-in only.
"""
from pathlib import Path
import hashlib,json,os,re,selectors,signal,socket,subprocess,sys,time,uuid
PKG='ai.hypeproof.companion.debug'
TEST_PKG=PKG+'.test'
COMPONENT=PKG+'/ai.hypeproof.companion.DeviceSignInFixtureActivity'
RUNNER=TEST_PKG+'/androidx.test.runner.AndroidJUnitRunner'
CASE='ai.hypeproof.companion.NativeDraftLifecycleTest'
ACK_KEYS={'hps_phase','hps_run','hps_pid','hps_uid','hps_package','hps_process','hps_data_dir','hps_namespace','hps_scope'}

def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def require(value,message):
 if not value:raise RuntimeError(message)
def status_blocks(text):
 block={};rows=[]
 for line in text.splitlines():
  if line.startswith('INSTRUMENTATION_STATUS: '):
   key,sep,value=line[len('INSTRUMENTATION_STATUS: '):].partition('=')
   require(not key.startswith('hps_') or key in ACK_KEYS,'unknown_ack_field')
   if sep and key in ACK_KEYS:
    require(key not in block and len(value)<256,'ambiguous_ack');block[key]=value
  elif line.startswith('INSTRUMENTATION_STATUS_CODE:'):
   if block:rows.append(block);block={}
 return rows

def validate_ack(row,phase,run,uid,data_dir):
 require(set(row)==ACK_KEYS,'incomplete_ack')
 require(row['hps_phase']==phase and row['hps_run']==run,'wrong_checkpoint')
 require(row['hps_package']==PKG and row['hps_process']==PKG and row['hps_scope']=='target_uid_private_native_store_only','wrong_target')
 require(row['hps_pid'].isdigit() and int(row['hps_pid'])>1 and row['hps_uid']==str(uid),'wrong_uid')
 require(row['hps_data_dir']==data_dir and row['hps_namespace']==data_dir+'/no_backup/hosted-draft-'+run,'wrong_private_namespace')
 return int(row['hps_pid'])

def validate_cold(previous,current):
 if previous:require(current['pid']!=previous['pid'] and current['startTicks']!=previous['startTicks'] and current['uid']==previous['uid'] and current['dataDir']==previous['dataDir'],'cold_identity_not_replaced')

class Device:
 def __init__(self,adb,env,server,guest):self.adb=adb;self.env=env;self.server=server;self.guest=guest
 def args(self,*args):return[self.adb,'-H','127.0.0.1','-P','5047','-s','emulator-5578',*args]
 def call(self,*args,timeout=5,check=True):
  require(self.server.poll() is None and self.guest.poll() is None,'owned_guest_closed')
  result=subprocess.run(self.args(*args),env=self.env,capture_output=True,timeout=timeout)
  require(len(result.stdout)<=1048576 and len(result.stderr)<=1048576,'bounded_adb_output')
  if check:require(result.returncode==0,'owned_adb_command_failed')
  return result
 def text(self,*args,**kw):return self.call(*args,**kw).stdout.decode('utf8','strict').strip()
 def pids(self):
  r=self.call('shell','pidof',PKG,check=False)
  if r.returncode==1 and not r.stdout.strip() and not r.stderr.strip():return[]
  require(r.returncode==0 and re.fullmatch(rb'[0-9 ]+\s*',r.stdout) is not None,'pid_observation_failed')
  return[int(x)for x in r.stdout.split()]
 def identity(self,pid,uid,data_dir):
  require(self.pids()==[pid],'owned_target_not_live')
  name=self.call('shell','run-as',PKG,'cat',f'/proc/{pid}/cmdline').stdout
  require(name==PKG.encode()+b'\0','target_process_changed')
  status=self.text('shell','run-as',PKG,'cat',f'/proc/{pid}/status');found=re.search(r'^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)',status,re.M)
  require(found is not None and all(int(x)==uid for x in found.groups()),'target_uid_changed')
  stat=self.text('shell','run-as',PKG,'cat',f'/proc/{pid}/stat');tail=stat.rsplit(')',1)[-1].split();require(len(tail)>19 and tail[19].isdigit(),'target_start_unavailable')
  require(self.text('shell','run-as',PKG,'pwd','-P')==data_dir,'target_data_dir_changed')
  return{'pid':pid,'uid':uid,'startTicks':int(tail[19]),'dataDir':data_dir}
 def stop(self,identity,before_stop=None):
  require(self.identity(identity['pid'],identity['uid'],identity['dataDir'])==identity,'target_replaced_before_stop')
  if before_stop:before_stop()
  self.call('shell','am','force-stop','--user','0',PKG,timeout=10)
  end=time.monotonic()+10
  while time.monotonic()<end:
   pids=self.pids()
   if not pids:return
   require(pids==[identity['pid']],'foreign_process_after_stop');time.sleep(.1)
  raise RuntimeError('target_exit_not_observed')

def disable_and_observe_radios(device,diagnostics,now=time.monotonic,sleep=time.sleep):
 # Commands are issued once. Their return is not a postcondition on asynchronous services.
 diagnostics.update({'budgetMs':10000,'polls':0,'status':'pending','stage':'wifi_disable'})
 device.call('shell','svc','wifi','disable');diagnostics['stage']='mobile_disable';device.call('shell','svc','data','disable')
 start=now();deadline=start+10;diagnostics['stage']='observe'
 def normalized(value):return {'0':0,'1':1,'null':'unset','':'empty'}.get(value,'other')
 try:
  while now()<deadline:
   state={}
   for label,key in [('wifi','wifi_on'),('mobile','mobile_data')]:
    remaining=deadline-now();require(remaining>0,'guest_radios_not_disabled')
    state[label]=normalized(device.text('shell','settings','get','global',key,timeout=min(5,remaining)))
   diagnostics['polls']+=1;diagnostics.setdefault('first',state.copy());diagnostics['last']=state
   diagnostics['elapsedMs']=round((now()-start)*1000);require(now()<=deadline,'guest_radios_not_disabled')
   if state=={'wifi':0,'mobile':0}:diagnostics['status']='disabled';return
   sleep(min(.25,max(0,deadline-now())))
  raise RuntimeError('guest_radios_not_disabled')
 except Exception as error:
  diagnostics['status']='refused';diagnostics['errorType']=type(error).__name__;diagnostics['elapsedMs']=round((now()-start)*1000);raise

def read_ack(proc,phase,run,uid,data_dir,timeout=60):
 selector=selectors.DefaultSelector();selector.register(proc.stdout,selectors.EVENT_READ);end=time.monotonic()+timeout;data=b''
 try:
  while time.monotonic()<end:
   for key,_ in selector.select(min(.25,max(0,end-time.monotonic()))):
    chunk=os.read(key.fileobj.fileno(),8192);require(bool(chunk),'instrumentation_ended_before_ack');data+=chunk;require(len(data)<=65536,'instrumentation_output_bound')
    rows=[r for r in status_blocks(data.decode('utf8','strict'))if r.get('hps_phase')==phase]
    require(len(rows)<=1,'duplicate_checkpoint')
    if rows:
     classify_stream(data,False);return validate_ack(rows[0],phase,run,uid,data_dir),data
   require(proc.poll() is None,'instrumentation_ended_before_ack')
  raise RuntimeError('checkpoint_deadline')
 finally:selector.close()

def classify_stream(data,after_stop):
 require(len(data)<=65536,'instrumentation_output_bound');text=data.decode('utf8','strict')
 require(re.search(r'INSTRUMENTATION_STATUS_CODE: -|INSTRUMENTATION_STATUS: stack=|AssertionError|FAILURES!!!|OK \(\d+ tests?\)',text)is None,'native_test_completed_or_failed')
 terminal=[line.strip()for line in text.splitlines()if line.startswith(('INSTRUMENTATION_RESULT:','INSTRUMENTATION_CODE:','INSTRUMENTATION_ABORTED:'))]
 if not terminal:return 'no_terminal_observed'
 require(after_stop and terminal==['INSTRUMENTATION_RESULT: shortMsg=Process crashed.','INSTRUMENTATION_CODE: 0'],'unexpected_instrumentation_terminal')
 return 'expected_process_crashed_after_observed_force_stop'

def finish_stream(proc,timeout=10):
 selector=selectors.DefaultSelector();selector.register(proc.stdout,selectors.EVENT_READ);end=time.monotonic()+timeout;data=b''
 try:
  while time.monotonic()<end:
   for key,_ in selector.select(min(.25,max(0,end-time.monotonic()))):
    chunk=os.read(key.fileobj.fileno(),8192)
    if not chunk:proc.wait(timeout=max(.001,end-time.monotonic()));return data
    data+=chunk;require(len(data)<=65536,'instrumentation_output_bound')
  raise RuntimeError('instrumentation_close_deadline')
 finally:selector.close()

def checkpoint(device,method,phase,run,uid,data_dir,previous,clients):
 proc=subprocess.Popen(device.args('shell','am','instrument','-w','-r','-e','class',CASE+'#'+method,'-e','hps_run',run,RUNNER),env=device.env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT);clients.append(proc)
 pid,initial=read_ack(proc,phase,run,uid,data_dir);classify_stream(initial,False);identity=device.identity(pid,uid,data_dir);validate_cold(previous,identity)
 def live_client():require(proc.poll() is None,'runner_exited_before_external_kill')
 live_client();device.stop(identity,before_stop=live_client);remainder=finish_stream(proc);classification=classify_stream(initial+remainder,True)
 return identity,{'phase':phase,'identity':identity,'ackObservedWhileAlive':True,'forceStopCommandAfterLiveObservation':True,'targetAbsentAfterStop':True,'instrumentationStreamSha256':hashlib.sha256(initial+remainder).hexdigest(),'terminalClassification':classification,'junitCompleted':'NO; held native checkpoint followed by external force-stop','causalLimit':'spontaneous death in the narrow observation-to-command race cannot be excluded'}

def close_child(child,grace):
 if child is None:return {'closed':True,'errors':[]}
 errors=[]
 try:
  if child.poll()is None:
   child.terminate()
   try:child.wait(timeout=grace)
   except subprocess.TimeoutExpired:child.kill();child.wait(timeout=5)
 except Exception as error:errors.append(type(error).__name__)
 return {'closed':child.poll()is not None,'errors':errors}

def main(argv):
 if argv!=['--run']:print(json.dumps({'status':'NOT_RUN','scope':'explicit hosted --run required'}));return 0
 require(os.environ.get('GITHUB_ACTIONS')=='true' and os.environ.get('RUNNER_OS')=='Linux' and os.environ.get('HPS_ANDROID_OWNED_HOSTED')=='1','owned_hosted_linux_only')
 out=Path(os.environ['HPS_ANDROID_EVIDENCE']).resolve();require(out.is_relative_to(Path(os.environ['RUNNER_TEMP']).resolve()),'owned_evidence_required')
 receipt=json.loads((out/'build-receipt.json').read_text());require(receipt['status']=='PASS_BUILD_ONLY' and receipt['sourceSha']==os.environ['HPS_ANDROID_SOURCE_SHA'],'exact_build_required')
 for row in receipt['apks'].values():require(sha(out/row['file'])==row['sha256'],'apk_drift')
 require(Path('/dev/kvm').is_char_device() and os.access('/dev/kvm',os.R_OK|os.W_OK),'kvm_required_no_fallback')
 state=Path(os.environ['ANDROID_USER_HOME']).resolve();avds=state/'avd';avds.mkdir(parents=True,exist_ok=True)
 require(not (out/'attempt.json').exists(),'single_attempt_only');(out/'attempt.json').write_text(json.dumps({'singleBoot':True,'sourceSha':receipt['sourceSha']}))
 env={**os.environ,'ANDROID_AVD_HOME':str(avds),'ANDROID_EMULATOR_HOME':str(state),'ADB_SERVER_SOCKET':'tcp:127.0.0.1:5047','ANDROID_ADB_SERVER_PORT':'5047'}
 sdk=Path(os.environ['ANDROID_SDK_ROOT']);adb=str(sdk/'platform-tools/adb');emulator=str(sdk/'emulator/emulator');server=guest=None;clients=[];logs=[]
 result={'schema':'hps-hosted-native-draft-lifecycle/1','status':'FAIL','sourceSha':receipt['sourceSha'],'apkIdentities':receipt['apks'],'scope':'actual target-UID native store/AtomicFile cold file lifecycle only','login':'NOT_RUN; disabled unconfigured debug entry','uiRecovery':'NOT_RUN','pairedOrProvider':'NOT_RUN','checks':[]}
 def interrupt(*_):raise KeyboardInterrupt
 signal.signal(signal.SIGTERM,interrupt);signal.signal(signal.SIGINT,interrupt)
 try:
  for port in [5047,5578,5579]:
   with socket.socket()as s:s.bind(('127.0.0.1',port))
  check=subprocess.run([emulator,'-accel-check'],capture_output=True,env=env,timeout=20);require(check.returncode==0 and b'KVM' in check.stdout+check.stderr,'kvm_acceleration_unavailable')
  avdmanager=sdk/'cmdline-tools/latest/bin/avdmanager';subprocess.run([str(avdmanager),'create','avd','-n','HPS_OWNED_DRAFT','-k','system-images;android-35;default;x86_64','-p',str(avds/'HPS_OWNED_DRAFT.avd')],input=b'no\n',capture_output=True,env=env,timeout=60,check=True)
  server=subprocess.Popen([adb,'-L','tcp:5047','--one-device','HPS-owned-no-physical-USB','server','nodaemon'],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  # One boot, CPU acceleration required; no software CPU fallback or snapshot seed.
  guest=subprocess.Popen([emulator,'-avd','HPS_OWNED_DRAFT','-port','5578','-accel','on','-memory','2048','-cores','2','-no-window','-no-audio','-no-snapshot','-no-boot-anim','-gpu','swiftshader_indirect'],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  d=Device(adb,env,server,guest);end=time.monotonic()+240
  while time.monotonic()<end:
   try:
    if d.text('shell','getprop','sys.boot_completed')=='1':break
   except (RuntimeError,subprocess.TimeoutExpired):pass
   time.sleep(.5)
  else:raise RuntimeError('single_boot_deadline')
  require(d.text('shell','getprop','ro.build.version.sdk')=='35','api35_required')
  require(not d.text('shell','pm','list','packages',PKG),'fresh_target_required')
  for name in ['target','test']:d.call('install','--no-streaming',*(['-t']if name=='test'else[]),str(out/receipt['apks'][name]['file']),timeout=60)
  line=d.text('shell','cmd','package','list','packages','-U','--user','0',PKG);matches=[m for text in line.splitlines() if (m:=re.fullmatch(r'package:'+re.escape(PKG)+r' uid:(\d+)',text))];require(len(matches)==1,'exact_package_uid_required');uid=int(matches[0][1]);data_dir=d.text('shell','run-as',PKG,'pwd','-P');canonical=d.text('shell','run-as',PKG,'readlink','-f','/data/user/0/'+PKG);require(data_dir==canonical and canonical in ['/data/user/0/'+PKG,'/data/data/'+PKG],'exact_private_data_dir_required')
  require(d.text('shell','pm','list','instrumentation',PKG)==f'instrumentation:{RUNNER} (target={PKG})','exact_instrumentation_required')
  result['radioReadiness']={};disable_and_observe_radios(d,result['radioReadiness'])
  result['guestNetworkBoundary']={'wifiEnabled':False,'mobileDataEnabled':False,'packetIsolation':'NOT_CLAIMED; unconfigured fixture has no transport target'}
  d.call('shell','am','start','-W','-n',COMPONENT,timeout=15);pids=d.pids();require(len(pids)==1,'single_target_launch_required');launched=d.identity(pids[0],uid,data_dir)
  shot=d.call('exec-out','screencap','-p',timeout=10).stdout;require(shot.startswith(b'\x89PNG\r\n\x1a\n'),'launch_screenshot_required');(out/'unconfigured-launch.png').write_bytes(shot);result['checks'].append({'phase':'unconfigured_debug_activity_launch','identity':launched,'component':COMPONENT,'noIntentExtras':True,'screenshotSha256':hashlib.sha256(shot).hexdigest()});d.stop(launched)
  run=uuid.uuid4().hex;previous=None
  for method,phase in [('seed','seed_ready'),('recoverErase','erased_ready'),('coldAbsence','cold_absence')]:previous,row=checkpoint(d,method,phase,run,uid,data_dir,previous,clients);result['checks'].append(row)
  result['status']='PASS_TARGET_UID_NATIVE_COLD_FILE_LIFECYCLE'
 except BaseException as error:result['failureType']=type(error).__name__;result['failureCode']=str(error) if re.fullmatch('[a-z_]+',str(error))else'bounded_host_or_native_failure'
 finally:
  cleanup_errors=[]
  for p in clients:
   closed=close_child(p,5);cleanup_errors+=closed['errors']
  if guest and guest.poll()is None and server and server.poll()is None:
   try:Device(adb,env,server,guest).call('emu','kill',timeout=10);guest.wait(timeout=15)
   except Exception as error:cleanup_errors.append(type(error).__name__)
  guest_close=close_child(guest,10);server_close=close_child(server,10);cleanup_errors+=guest_close['errors']+server_close['errors']
  result['cleanup']={'guestClosed':guest_close['closed'],'adbClosed':server_close['closed'],'instrumentationClientsClosed':all(p.poll()is not None for p in clients)}
  result['cleanupErrors']=cleanup_errors
  if not all(result['cleanup'].values()) or cleanup_errors:result['status']='FAIL'
  (out/'result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'status':result['status'],'checks':len(result['checks']),'cleanup':result['cleanup']}))
 return 0 if result['status']=='PASS_TARGET_UID_NATIVE_COLD_FILE_LIFECYCLE'else 1
if __name__=='__main__':sys.exit(main(sys.argv[1:]))
