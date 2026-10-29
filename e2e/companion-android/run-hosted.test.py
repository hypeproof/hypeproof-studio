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
 def test_default_no_launch(self):
  with patch.object(h.subprocess,'Popen')as popen:self.assertEqual(h.main([]),0)
  popen.assert_not_called()
if __name__=='__main__':unittest.main()
