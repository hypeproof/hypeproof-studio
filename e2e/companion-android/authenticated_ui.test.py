"""No guest is launched. Scope/physical proof, fail-closed ACK and fixture cleanup controls."""
import importlib.util,unittest
from pathlib import Path
from unittest.mock import Mock,patch
spec=importlib.util.spec_from_file_location('hosted',Path(__file__).with_name('run-hosted.py'));h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
import authenticated_ui as ui
UID=10148;RUN='a'*32;ROOT='/data/user/0/'+h.PKG;ALIAS='/data/data/'+h.PKG
IDENTITY={'pid':1234,'uid':UID,'dataDir':ROOT,'startTicks':100}
def ack():return {'hps_phase':'ui_seed_ready','hps_run':RUN,'hps_pid':'1234','hps_uid':str(UID),'hps_package':h.PKG,'hps_process':h.PKG,'hps_data_dir':ALIAS,'hps_namespace':ALIAS+'/no_backup/companion-draft','hps_scope':'authenticated_synthetic_draft_ui_only'}
def device():
 d=Mock();d.identity.return_value=IDENTITY;d.text.side_effect=[ALIAS,ALIAS+'/no_backup/companion-draft','1:20:10148:41c0\n1:20:10148:41c0\n1:30:10148:41c0\n1:30:10148:41c0'];return d
class Controls(unittest.TestCase):
 def test_fixed_alias_requires_same_physical_owner_and_live_identity(self):
  d=device();receipt={};self.assertEqual(ui.validate_ui_ack(ack(),'ui_seed_ready',RUN,UID,ROOT,d,h,receipt),IDENTITY);self.assertTrue(receipt['pairedDirectoryIdentity']);self.assertEqual(d.identity.call_count,2);self.assertNotIn(ALIAS,str(receipt))
 def test_foreign_ack_or_scope_never_reads_private_paths(self):
  for key,value in [('hps_uid','1'),('hps_pid','1'),('hps_run','b'*32),('hps_scope','target_uid_private_native_store_only'),('hps_namespace',ALIAS+'/no_backup/companion-draft/../other'),('hps_data_dir','/foreign'),('hps_process','foreign')]:
   d=device()
   with self.subTest(key=key),self.assertRaises(RuntimeError):ui.validate_ui_ack({**ack(),key:value},'ui_seed_ready',RUN,UID,ROOT,d,h,{})
   d.identity.assert_not_called();d.text.assert_not_called()
 def test_canonical_escape_wrong_inode_owner_and_failed_read_refuse(self):
  for readings in [['/foreign',ALIAS+'/no_backup/companion-draft'],[ALIAS,'/foreign'],[ALIAS,ALIAS+'/no_backup/companion-draft','1:20:10148:41c0\n1:21:10148:41c0\n1:30:10148:41c0\n1:30:10148:41c0'],[ALIAS,ALIAS+'/no_backup/companion-draft','1:20:10000:41c0\n1:20:10000:41c0\n1:30:10000:41c0\n1:30:10000:41c0'],RuntimeError('read_failed')]:
   d=device();d.text.side_effect=readings
   with self.subTest(readings=readings),self.assertRaises(RuntimeError):ui.validate_ui_ack(ack(),'ui_seed_ready',RUN,UID,ROOT,d,h,{})
 def test_replaced_process_after_proof_refuses(self):
  d=device();d.identity.side_effect=[IDENTITY,{**IDENTITY,'startTicks':101}]
  with self.assertRaisesRegex(RuntimeError,'ui_identity_changed'):ui.validate_ui_ack(ack(),'ui_seed_ready',RUN,UID,ROOT,d,h,{})
 def test_fixture_startup_failure_closes_exact_child(self):
  child=Mock();child.poll.return_value=None;d=Mock();d.env={};result={'guestNetworkBoundary':{}}
  with patch.object(ui.subprocess,'Popen',return_value=child),patch.object(ui.Fixture,'read',side_effect=RuntimeError('fixture_closed')),patch.object(h,'close_child',return_value={'closed':True,'errors':[]})as close,self.assertRaisesRegex(RuntimeError,'fixture_closed'):ui.run_authenticated(d,Path('/unused'),UID,ROOT,[],result,h)
  close.assert_called_once_with(child,5);self.assertTrue(result['authFixtureClosed']);self.assertIn('fixture_graceful_close_unconfirmed',result['authCleanupErrors'])
 def test_primary_failure_not_masked_by_reverse_cleanup_failure(self):
  d=Mock();d.env={};d.text.side_effect=['',RuntimeError('cleanup')];fixture=Mock();fixture.ready={'origin':'http://127.0.0.1:12345','account':'synthetic-account','receipt':{}};fixture.call.side_effect=RuntimeError('primary');fixture.close.return_value={'closed':True,'errors':[]}
  result={'guestNetworkBoundary':{}}
  with patch.object(ui,'Fixture',return_value=fixture),self.assertRaisesRegex(RuntimeError,'primary'):ui.run_authenticated(d,Path('/unused'),UID,ROOT,[],result,h)
  self.assertEqual(result['status'],'FAIL');self.assertFalse(result['reverseClosed']);self.assertTrue(result['authFixtureClosed'])
if __name__=='__main__':unittest.main()
