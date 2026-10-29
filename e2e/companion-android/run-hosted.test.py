"""Fake-device controls only; importing the runner cannot start an ADB server/guest."""
import importlib.util,unittest,subprocess
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('hosted',Path(__file__).with_name('run-hosted.py'));h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
RUN='a'*32;UID=10123;DATA='/data/user/0/'+h.PKG

def row():return dict(hps_phase='seed_ready',hps_run=RUN,hps_pid='1234',hps_uid=str(UID),hps_package=h.PKG,hps_process=h.PKG,hps_data_dir=DATA,hps_namespace=DATA+'/no_backup/hosted-draft-'+RUN,hps_scope='target_uid_private_native_store_only')
def identity(pid=1234,start=100):return dict(pid=pid,startTicks=start,uid=UID,dataDir=DATA)
class Child:
 def __init__(self,alive=True):self.alive=alive;self.communicated=False
 def poll(self):return None if self.alive else 0
 def communicate(self,timeout):self.communicated=True;self.alive=False
class Device:
 env={}
 def __init__(self,value=None):self.events=[];self.value=value or identity()
 def args(self,*args):self.events.append(('instrument',args));return ['FAKE']
 def identity(self,*_):self.events.append(('live_identity',));return self.value
 def stop(self,value,before_stop=None):
  if before_stop:before_stop()
  self.events.append(('external_stop',value));self.stopped=True
class Controls(unittest.TestCase):
 def test_ack_exact_owner_and_namespace(self):
  self.assertEqual(h.validate_ack(row(),'seed_ready',RUN,UID,DATA),1234)
  for key,value in [('hps_package','foreign'),('hps_process','foreign'),('hps_uid','999'),('hps_run','b'*32),('hps_namespace',DATA+'/no_backup/foreign'),('hps_data_dir','/data/foreign'),('hps_pid','1')]:
   with self.subTest(key=key),self.assertRaises(RuntimeError):h.validate_ack({**row(),key:value},'seed_ready',RUN,UID,DATA)
  missing=row();del missing['hps_scope']
  with self.assertRaises(RuntimeError):h.validate_ack(missing,'seed_ready',RUN,UID,DATA)
 def test_status_duplicate_refused(self):
  with self.assertRaises(RuntimeError):h.status_blocks('INSTRUMENTATION_STATUS: hps_pid=1234\nINSTRUMENTATION_STATUS: hps_pid=5678\nINSTRUMENTATION_STATUS_CODE: 0')
 def test_cold_requires_new_pid_start_same_owner(self):
  old=identity();h.validate_cold(old,identity(2345,200))
  for change in [dict(pid=1234),dict(startTicks=100),dict(uid=999),dict(dataDir='/foreign')]:
   with self.subTest(change=change),self.assertRaises(RuntimeError):h.validate_cold(old,{**identity(2345,200),**change})
 def test_checkpoint_external_stop_after_live_ack(self):
  device=Device();child=Child();clients=[]
  with patch.object(h.subprocess,'Popen',return_value=child),patch.object(h,'read_ack',return_value=(1234,b'')),patch.object(h,'finish_stream',return_value=b''):
   ident,receipt=h.checkpoint(device,'seed','seed_ready',RUN,UID,DATA,None,clients)
  self.assertEqual([e[0]for e in device.events],['instrument','live_identity','external_stop']);self.assertEqual(clients,[child]);self.assertEqual(ident,identity());self.assertTrue(receipt['ackObservedWhileAlive']);self.assertTrue(receipt['forceStopCommandAfterLiveObservation']);self.assertIn('NO;',receipt['junitCompleted'])
 def test_missing_ack_or_exited_runner_never_stop(self):
  for failure,alive in [(RuntimeError('checkpoint_deadline'),True),(None,False)]:
   device=Device();child=Child(alive)
   with patch.object(h.subprocess,'Popen',return_value=child),patch.object(h,'read_ack',side_effect=failure,return_value=(1234,b'')),self.assertRaises(RuntimeError):h.checkpoint(device,'seed','seed_ready',RUN,UID,DATA,None,[])
   self.assertNotIn('external_stop',[e[0]for e in device.events])
 def test_changed_cold_owner_never_stop(self):
  device=Device({**identity(2345,200),'uid':999})
  with patch.object(h.subprocess,'Popen',return_value=Child()),patch.object(h,'read_ack',return_value=(2345,b'')),self.assertRaises(RuntimeError):h.checkpoint(device,'recoverErase','erased_ready',RUN,UID,DATA,identity(),[])
  self.assertNotIn('external_stop',[e[0]for e in device.events])
 def test_closed_guest_fence_prevents_adb(self):
  for server,guest in [(Child(False),Child()),(Child(),Child(False))]:
   d=h.Device('NEVER',{},server,guest)
   with patch.object(h.subprocess,'run')as run,self.assertRaises(RuntimeError):d.call('shell','true')
   run.assert_not_called()
 def test_pid_failure_is_not_absence(self):
  d=h.Device('NEVER',{},Child(),Child())
  for result in [subprocess.CompletedProcess([],1,b'',b'adb offline'),subprocess.CompletedProcess([],0,b'foreign',b'')]:
   with patch.object(d,'call',return_value=result),self.assertRaises(RuntimeError):d.pids()
  with patch.object(d,'call',return_value=subprocess.CompletedProcess([],1,b'',b'')):self.assertEqual(d.pids(),[])
 def test_stop_rechecks_identity_no_replaced_target(self):
  d=h.Device('NEVER',{},Child(),Child())
  with patch.object(d,'identity',return_value=identity(2345,200)),patch.object(d,'call')as call,self.assertRaises(RuntimeError):d.stop(identity())
  call.assert_not_called()
 def test_stop_one_command_observed_absence(self):
  d=h.Device('NEVER',{},Child(),Child())
  with patch.object(d,'identity',return_value=identity()),patch.object(d,'call')as call,patch.object(d,'pids',return_value=[]):d.stop(identity())
  self.assertEqual(call.call_count,1);self.assertEqual(call.call_args.args,('shell','am','force-stop','--user','0',h.PKG))
 def test_terminal_classification_refuses_natural_completion_before_or_after_ack(self):
  expected=b'INSTRUMENTATION_RESULT: shortMsg=Process crashed.\nINSTRUMENTATION_CODE: 0\n'
  self.assertEqual(h.classify_stream(expected,True),'expected_process_crashed_after_observed_force_stop')
  with self.assertRaises(RuntimeError):h.classify_stream(expected,False)
  for value in [b'INSTRUMENTATION_RESULT: stream=\nOK (1 test)\nINSTRUMENTATION_CODE: -1',b'INSTRUMENTATION_STATUS: stack=java.lang.AssertionError',b'INSTRUMENTATION_STATUS_CODE: -2',expected+expected,b'x'*65537]:
   for after in [False,True]:
    with self.subTest(value=value[:60],after=after),self.assertRaises(RuntimeError):h.classify_stream(value,after)
 def test_checkpoint_rejects_terminal_in_initial_or_final_stream(self):
  for initial,remainder in [(b'INSTRUMENTATION_CODE: -1',b''),(b'',b'INSTRUMENTATION_CODE: -1')]:
   device=Device()
   with patch.object(h.subprocess,'Popen',return_value=Child()),patch.object(h,'read_ack',return_value=(1234,initial)),patch.object(h,'finish_stream',return_value=remainder),self.assertRaises(RuntimeError):h.checkpoint(device,'seed','seed_ready',RUN,UID,DATA,None,[])
   if initial:self.assertNotIn('external_stop',[e[0]for e in device.events])
 def test_cleanup_terminate_kill_and_failure_truth(self):
  from unittest.mock import Mock
  child=Mock();child.poll.side_effect=[None,0];child.wait.side_effect=[subprocess.TimeoutExpired('owned',1),0]
  self.assertEqual(h.close_child(child,1),{'closed':True,'errors':[]});child.terminate.assert_called_once();child.kill.assert_called_once()
  failed=Mock();failed.poll.return_value=None;failed.terminate.side_effect=OSError('secret must not escape')
  self.assertEqual(h.close_child(failed,1),{'closed':False,'errors':['OSError']})
 def test_unknown_ack_field_refused(self):
  with self.assertRaises(RuntimeError):h.status_blocks('INSTRUMENTATION_STATUS: hps_secret=untrusted')
 def test_radio_transition_observes_once_commands_then_waits_for_exact_off(self):
  from unittest.mock import Mock
  for initial in [('1','0'),('0','1')]:
   clock=[0.0];device=Mock();device.text.side_effect=[*initial,'0','0'];diagnostics={}
   h.disable_and_observe_radios(device,diagnostics,now=lambda:clock[0],sleep=lambda seconds:clock.__setitem__(0,clock[0]+seconds))
   self.assertEqual(device.call.call_count,2);self.assertEqual(device.call.call_args_list[0].args,('shell','svc','wifi','disable'));self.assertEqual(device.call.call_args_list[1].args,('shell','svc','data','disable'))
   self.assertEqual(diagnostics['first'],dict(zip(['wifi','mobile'],map(int,initial))));self.assertEqual(diagnostics['last'],{'wifi':0,'mobile':0});self.assertEqual(diagnostics['status'],'disabled');self.assertEqual(diagnostics['polls'],2)
 def test_radios_on_unset_or_untrusted_values_refuse_with_bounded_safe_diagnostics(self):
  from unittest.mock import Mock
  for value in ['1','null','','secret-token-private-url']:
   clock=[0.0];device=Mock();device.text.return_value=value;diagnostics={}
   with self.subTest(value=value),self.assertRaisesRegex(RuntimeError,'guest_radios_not_disabled'):
    h.disable_and_observe_radios(device,diagnostics,now=lambda:clock[0],sleep=lambda seconds:clock.__setitem__(0,clock[0]+seconds))
   self.assertEqual(clock[0],10);self.assertLessEqual(diagnostics['polls'],40);self.assertEqual(diagnostics['status'],'refused');self.assertEqual(device.call.call_count,2);self.assertNotIn('secret-token',str(diagnostics))
 def test_radio_observation_owner_error_not_retried(self):
  from unittest.mock import Mock
  for error in [RuntimeError('owned_guest_closed'),subprocess.TimeoutExpired('private command',1)]:
   device=Mock();device.text.side_effect=error;diagnostics={}
   with self.assertRaises(type(error)):h.disable_and_observe_radios(device,diagnostics)
   self.assertEqual(device.text.call_count,1);self.assertEqual(device.call.call_count,2);self.assertEqual(diagnostics['status'],'refused');self.assertNotIn('private command',str(diagnostics))
 def test_radio_read_deadline_clips_remaining_command_budget(self):
  from unittest.mock import Mock
  clock=[0.0];device=Mock();diagnostics={}
  def read(*args,**kw):
   self.assertLessEqual(kw['timeout'],5);clock[0]+=kw['timeout'];return '1'
  device.text.side_effect=read
  with self.assertRaisesRegex(RuntimeError,'guest_radios_not_disabled'):h.disable_and_observe_radios(device,diagnostics,now=lambda:clock[0],sleep=lambda seconds:clock.__setitem__(0,clock[0]+seconds))
  self.assertEqual(clock[0],10);self.assertEqual(device.text.call_count,2);self.assertEqual(diagnostics['status'],'refused')
 def test_radio_disabled_observation_after_deadline_refuses(self):
  from unittest.mock import Mock
  clock=[0.0];device=Mock();diagnostics={}
  def late_read(*args,**kw):clock[0]+=6;return '0'
  device.text.side_effect=late_read
  with self.assertRaisesRegex(RuntimeError,'guest_radios_not_disabled'):h.disable_and_observe_radios(device,diagnostics,now=lambda:clock[0],sleep=lambda seconds:None)
  self.assertEqual(diagnostics['status'],'refused');self.assertEqual(diagnostics['last'],{'wifi':0,'mobile':0})
 def test_exact_process_name_accepts_only_nonempty_all_nul_padding(self):
  for count in [1,2,16,512]:
   raw=h.PKG.encode()+b'\0'*count;diagnostics={};h.validate_target_cmdline(raw,diagnostics)
   self.assertEqual(diagnostics,{'bytes':len(raw),'sha256':h.hashlib.sha256(raw).hexdigest(),'firstNameMatches':True,'tailNonzero':False,'nulTailBytes':count})
 def test_cmdline_extra_arguments_prefix_and_malformed_bytes_refuse_without_raw_diagnostics(self):
  name=h.PKG.encode()
  for raw in [b'',name,name+b'.foreign\0',name[:-1]+b'\0',name+b'\0secret-argument\0',name+b'\0\0 \0',b'\xff'+name+b'\0',name+b'\0'*1048576]:
   diagnostics={}
   with self.subTest(length=len(raw)),self.assertRaisesRegex(RuntimeError,'target_process_changed'):h.validate_target_cmdline(raw,diagnostics)
   self.assertEqual(set(diagnostics),{'bytes','sha256','firstNameMatches','tailNonzero','nulTailBytes'});self.assertNotIn('secret-argument',str(diagnostics));self.assertNotIn(h.PKG,str(diagnostics))
 def test_identity_padding_preserves_exact_uid_start_and_data_checks(self):
  from unittest.mock import Mock
  observations=[];d=h.Device('NEVER',{},Child(),Child(),observations)
  stat='1234 ('+h.PKG+') S '+'0 '*18+'100'
  for uid,path,ok in [(UID,DATA,True),(999,DATA,False),(UID,'/foreign',False)]:
   status='Uid: '+' '.join([str(uid)]*4)
   with patch.object(d,'pids',return_value=[1234]),patch.object(d,'call',return_value=subprocess.CompletedProcess([],0,h.PKG.encode()+b'\0'*16,b'')),patch.object(d,'text',side_effect=[status,stat,path]):
    if ok:self.assertEqual(d.identity(1234,UID,DATA),identity())
    else:
     with self.assertRaises(RuntimeError):d.identity(1234,UID,DATA)
  self.assertEqual(len(observations),3);self.assertTrue(all(o['firstNameMatches']and not o['tailNonzero']for o in observations))
 def test_identity_bad_cmdline_records_metadata_then_refuses_before_other_checks(self):
  observations=[];d=h.Device('NEVER',{},Child(),Child(),observations)
  with patch.object(d,'pids',return_value=[1234]),patch.object(d,'call',return_value=subprocess.CompletedProcess([],0,h.PKG.encode()+b'\0extra-secret',b'')),patch.object(d,'text')as text,self.assertRaises(RuntimeError):d.identity(1234,UID,DATA)
  text.assert_not_called();self.assertEqual(len(observations),1);self.assertTrue(observations[0]['tailNonzero']);self.assertNotIn('extra-secret',str(observations))

 def test_namespace_alias_needs_live_physical_proof_not_string_normalization(self):
  legacy='/data/data/'+h.PKG;candidate={**row(),'hps_data_dir':legacy,'hps_namespace':legacy+'/no_backup/hosted-draft-'+RUN}
  with self.assertRaisesRegex(RuntimeError,'wrong_private_namespace'):h.validate_ack(candidate,'seed_ready',RUN,UID,DATA)
  with self.assertRaisesRegex(RuntimeError,'private_namespace_unproved'):h.validate_ack(candidate,'seed_ready',RUN,UID,DATA,namespace_proof=lambda *_:False)
  diagnostics={};seen=[]
  self.assertEqual(h.validate_ack(candidate,'seed_ready',RUN,UID,DATA,namespace_proof=lambda record,pid:seen.append((record,pid))or True,diagnostics=diagnostics),1234)
  self.assertEqual(seen,[(candidate,1234)]);self.assertFalse(diagnostics['dataDirExact']);self.assertEqual(diagnostics['dataDir']['form'],'legacy_data');self.assertNotIn(legacy,str(diagnostics))
 def test_namespace_shape_refuses_other_packages_runs_traversal_and_suffix_before_io(self):
  from unittest.mock import Mock
  d=h.Device('NEVER',{},Child(),Child())
  cases=[{**row(),'hps_data_dir':DATA+'.other'},{**row(),'hps_namespace':DATA+'/no_backup/hosted-draft-'+RUN+'/extra'},
   {**row(),'hps_namespace':DATA+'/no_backup/../hosted-draft-'+RUN},{**row(),'hps_namespace':DATA+'/no_backup/hosted-draft-'+'b'*32},
   {**row(),'hps_data_dir':DATA+'/.'},{**row(),'hps_namespace':'/data/user/1/'+h.PKG+'/no_backup/hosted-draft-'+RUN}]
  for candidate in cases:
   diagnostics={}
   with patch.object(d,'identity')as live,patch.object(d,'text')as read,self.assertRaisesRegex(RuntimeError,'wrong_private_namespace'):d.private_namespace(candidate,RUN,UID,DATA,diagnostics)
   live.assert_not_called();read.assert_not_called()
  with patch.object(d,'identity')as live,self.assertRaisesRegex(RuntimeError,'wrong_private_namespace'):d.private_namespace(row(),'../foreign',UID,DATA,{})
  live.assert_not_called()
 def test_device_namespace_proves_root_and_namespace_aliases_by_canonical_and_inode(self):
  legacy='/data/data/'+h.PKG;expected=DATA+'/no_backup/hosted-draft-'+RUN
  stat=f'7:22:{UID}:41c0\n7:22:{UID}:41c0\n7:33:{UID}:41c0\n7:33:{UID}:41c0'
  for root in [DATA,legacy]:
   for namespace_root in [DATA,legacy]:
    candidate={**row(),'hps_data_dir':root,'hps_namespace':namespace_root+'/no_backup/hosted-draft-'+RUN};diagnostics={};d=h.Device('NEVER',{},Child(),Child())
    with patch.object(d,'identity',side_effect=[identity(),identity()])as live,patch.object(d,'text',side_effect=[DATA,expected,stat])as read:
     self.assertEqual(d.private_namespace(candidate,RUN,UID,DATA,diagnostics),identity())
    self.assertEqual(live.call_count,2);self.assertEqual(read.call_count,3)
    self.assertEqual(read.call_args_list[0].args,('shell','run-as',h.PKG,'readlink','-f',root))
    self.assertEqual(read.call_args_list[1].args,('shell','run-as',h.PKG,'readlink','-f',candidate['hps_namespace']))
    self.assertEqual(read.call_args_list[2].args,('shell','run-as',h.PKG,'stat','-L','-c','%d:%i:%u:%f',DATA,root,expected,candidate['hps_namespace']))
    self.assertTrue(diagnostics['physicalProof']);self.assertTrue(diagnostics['liveIdentityStable']);self.assertNotIn(DATA,str(diagnostics));self.assertNotIn(RUN,str(diagnostics))
 def test_namespace_canonical_escape_refuses_before_stat_and_never_reports_raw_path(self):
  expected=DATA+'/no_backup/hosted-draft-'+RUN
  for canonical in [('private-secret-path',expected),(DATA,expected+'/escape')]:
   d=h.Device('NEVER',{},Child(),Child());diagnostics={}
   with patch.object(d,'identity',return_value=identity())as live,patch.object(d,'text',side_effect=canonical)as read,self.assertRaisesRegex(RuntimeError,'private_canonical_mismatch'):d.private_namespace(row(),RUN,UID,DATA,diagnostics)
   self.assertEqual(live.call_count,1);self.assertEqual(read.call_count,2);self.assertNotIn('private-secret',str(diagnostics));self.assertNotIn('physicalProof',diagnostics)
 def test_private_stat_rejects_other_inode_device_uid_kind_and_malformed_output(self):
  base=[f'7:22:{UID}:41c0',f'7:22:{UID}:41c0',f'7:33:{UID}:41c0',f'7:33:{UID}:41c0']
  for bad in ['8:33:'+str(UID)+':41c0','7:34:'+str(UID)+':41c0','7:33:999:41c0','7:33:'+str(UID)+':81c0','secret OS output','7:0:'+str(UID)+':41c0','18446744073709551616:33:'+str(UID)+':41c0']:
   with self.subTest(bad=bad),self.assertRaises(RuntimeError):h.private_stat_rows('\n'.join(base[:3]+[bad]),UID)
  for text in ['', '\n'.join(base[:3]),'\n'.join(base+base), '\n'.join(base)+'\nextra']:
   with self.assertRaises(RuntimeError):h.private_stat_rows(text,UID)
 def test_namespace_target_change_or_io_failure_never_proves_identity(self):
  expected=DATA+'/no_backup/hosted-draft-'+RUN;stat=f'7:22:{UID}:41c0\n7:22:{UID}:41c0\n7:33:{UID}:41c0\n7:33:{UID}:41c0'
  for change in [identity(9999,100),identity(1234,200),{**identity(),'uid':999},{**identity(),'dataDir':'foreign'}]:
   d=h.Device('NEVER',{},Child(),Child());diagnostics={}
   with patch.object(d,'identity',side_effect=[identity(),change]),patch.object(d,'text',side_effect=[DATA,expected,stat]),self.assertRaisesRegex(RuntimeError,'target_changed_during_namespace_proof'):d.private_namespace(row(),RUN,UID,DATA,diagnostics)
   self.assertNotIn('physicalProof',diagnostics)
  d=h.Device('NEVER',{},Child(),Child())
  with patch.object(d,'identity',return_value=identity()),patch.object(d,'text',side_effect=RuntimeError('owned_adb_command_failed'))as read,self.assertRaises(RuntimeError):d.private_namespace(row(),RUN,UID,DATA,{})
  self.assertEqual(read.call_count,1)
 def test_checkpoint_proof_failure_or_expired_held_runner_never_force_stops(self):
  from unittest.mock import Mock
  for failed in [True,False]:
   device=Device();child=Child();observations=[]
   def prove(*_):
    if failed:raise RuntimeError('private_inode_mismatch')
    child.alive=False;return identity()
   device.private_namespace=Mock(side_effect=prove)
   def read(proc,phase,run,uid,data_dir,**kw):return h.validate_ack(row(),phase,run,uid,data_dir,kw['namespace_proof'],kw['diagnostics']),b''
   with patch.object(h.subprocess,'Popen',return_value=child),patch.object(h,'read_ack',side_effect=read),self.assertRaisesRegex(RuntimeError,'private_inode_mismatch'if failed else'runner_exited_before_external_kill'):
    h.checkpoint(device,'seed','seed_ready',RUN,UID,DATA,None,[],observations)
   self.assertEqual(len(observations),1);self.assertNotIn('external_stop',[e[0]for e in device.events])

 def test_default_no_launch(self):
  with patch.object(h.subprocess,'Popen')as popen:self.assertEqual(h.main([]),0)
  popen.assert_not_called()
if __name__=='__main__':unittest.main()
