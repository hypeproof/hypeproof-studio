"""Separate hosted UI scenario. Imported only by explicit mode; no device/bootstrap effects at import."""
from pathlib import Path
import hashlib,json,os,re,selectors,subprocess,time,uuid

class Fixture:
 def __init__(self,env,helpers):
  self.helpers=helpers;self.proc=subprocess.Popen(['node',str(Path(__file__).with_name('auth-service.mjs')),'--run'],env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL);self.pending=b''
 def start(self):self.ready=self.read('ready',60);return self.ready
 def read(self,kind,timeout=15):
  selector=selectors.DefaultSelector();selector.register(self.proc.stdout,selectors.EVENT_READ);end=time.monotonic()+timeout
  try:
   while time.monotonic()<end:
    if b'\n'in self.pending:
     line,self.pending=self.pending.split(b'\n',1);value=json.loads(line);self.helpers.require(value.get('kind')==kind,'fixture_response_kind');return value
    for key,_ in selector.select(min(.1,max(0,end-time.monotonic()))):
     raw=os.read(key.fileobj.fileno(),8192);self.helpers.require(bool(raw),'fixture_closed');self.pending+=raw;self.helpers.require(len(self.pending)<=65536,'fixture_output_bound')
    self.helpers.require(self.proc.poll()is None,'fixture_exited')
   raise RuntimeError('fixture_response_deadline')
  finally:selector.close()
 def call(self,value,kind):self.proc.stdin.write((json.dumps(value)+'\n').encode());self.proc.stdin.flush();return self.read(kind)
 def close(self):
  if self.proc.poll()is None:
   try:self.call({'kind':'stop'},'closed');self.close_ack=True;self.proc.wait(timeout=10)
   except Exception:
    closed=self.helpers.close_child(self.proc,5);closed['errors'].append('fixture_graceful_close_unconfirmed');return closed
  return {'closed':self.proc.poll()is not None,'errors':([] if getattr(self,'close_ack',False) and self.proc.returncode==0 else ['fixture_closed_without_ack'])}

def validate_ui_ack(row,phase,run,uid,data_dir,device,h,diagnostics):
 h.require(set(row)==h.ACK_KEYS and row['hps_phase']==phase and row['hps_run']==run,'ui_ack_shape')
 h.require(row['hps_package']==h.PKG and row['hps_process']==h.PKG and row['hps_scope']=='authenticated_synthetic_draft_ui_only','ui_ack_target')
 h.require(row['hps_pid'].isdigit()and int(row['hps_pid'])>1 and row['hps_uid']==str(uid),'ui_ack_uid')
 roots=['/data/user/0/'+h.PKG,'/data/data/'+h.PKG];suffix='/no_backup/companion-draft';names=[r+suffix for r in roots]
 h.require(data_dir in roots and row['hps_data_dir']in roots and row['hps_namespace']in names,'ui_ack_namespace')
 pid=int(row['hps_pid']);before=device.identity(pid,uid,data_dir)
 canonical_root=device.text('shell','run-as',h.PKG,'readlink','-f',row['hps_data_dir']);canonical_namespace=device.text('shell','run-as',h.PKG,'readlink','-f',row['hps_namespace'])
 h.require(canonical_root in roots and canonical_namespace in names,'ui_canonical_namespace')
 h.private_stat_rows(device.text('shell','run-as',h.PKG,'stat','-L','-c','%d:%i:%u:%f',data_dir,row['hps_data_dir'],data_dir+suffix,row['hps_namespace']),uid)
 h.require(device.identity(pid,uid,data_dir)==before,'ui_identity_changed')
 diagnostics.update({'canonicalRoot':h.namespace_metadata(canonical_root,roots),'canonicalNamespace':h.namespace_metadata(canonical_namespace,names),'pairedDirectoryIdentity':True,'liveIdentityStable':True})
 return before

def run_authenticated(device,out,uid,data_dir,clients,result,h):
 result.update({'schema':'hps-hosted-authenticated-draft-ui/1','scope':'native verified sign-in; synthetic broker seed; cold UI readback/cancel/erase and cold absence only','login':'actual native device start/poll/me; synthetic runner-side Lab approval, not browser-human approval','uiRecovery':'detached readback and explicit erase; reattachment NOT_RUN without verified selection','pairedOrProvider':'NOT_RUN; fixture rejects these routes','checks':[]})
 result['guestNetworkBoundary']['packetIsolation']='NOT_CLAIMED; radios off; one exact owned adb reverse to loopback auth fixture'
 fixture=None;reverse=None;cleanup_errors=[]
 try:
  fixture=Fixture(device.env,h);fixture.start();origin=fixture.ready['origin'];match=re.fullmatch(r'http://127\.0\.0\.1:([1-9][0-9]{0,4})',origin);h.require(match is not None and int(match[1])<=65535,'ui_fixture_origin');account=fixture.ready['account'];h.require(re.fullmatch('[A-Za-z0-9_-]{1,128}',account)is not None,'ui_fixture_account')
  endpoint='tcp:'+match[1];existing=device.text('reverse','--list');h.require(not any(endpoint in line.split()[1:2]for line in existing.splitlines()),'owned_reverse_conflict');device.call('reverse',endpoint,endpoint);reverse=endpoint
  run=uuid.uuid4().hex;previous=None;result['serviceReceipt']=fixture.ready['receipt'];result['namespaceObservations']=[]
  for method,phase in [('seed','ui_seed_ready'),('erase','ui_erased_ready'),('absence','ui_cold_absence')]:
   fixture.call({'kind':'arm','phase':method},'armed');h.require(not device.pids(),'ui_cold_target_required')
   proc=subprocess.Popen(device.args('shell','am','instrument','-w','-r','-e','class','ai.hypeproof.companion.AuthenticatedDraftUiTest#'+method,'-e','hps_run',run,'-e','hps_service',origin+'/v1','-e','hps_account',account,h.RUNNER),env=device.env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT);clients.append(proc)
   diagnostic={'phase':phase};proof={};result['namespaceObservations'].append(diagnostic)
   def validate(row):proof['identity']=validate_ui_ack(row,phase,run,uid,data_dir,device,h,diagnostic);return proof['identity']['pid']
   pid,initial=h.read_ack(proc,phase,run,uid,data_dir,timeout=120,validator=validate);identity=proof['identity'];h.require(identity['pid']==pid,'ui_pid_changed');h.validate_cold(previous,identity)
   if method=='erase':
    for label in ['readback','cancel']:
     image=device.call('exec-out','run-as',h.PKG,'cat','files/hosted-ui-'+run+'/'+label+'.png',timeout=10).stdout;h.require(image.startswith(b'\x89PNG\r\n\x1a\n'),'ui_readback_screenshot');(out/('ui_'+label+'.png')).write_bytes(image)
   shot=device.call('exec-out','screencap','-p',timeout=10).stdout;h.require(shot.startswith(b'\x89PNG\r\n\x1a\n'),'ui_screenshot');(out/(phase+'.png')).write_bytes(shot)
   def live():h.require(proc.poll()is None,'ui_runner_closed_before_stop')
   device.stop(identity,before_stop=live);tail=h.finish_stream(proc);classification=h.classify_stream(initial+tail,True)
   result['checks'].append({'phase':phase,'identity':identity,'heldAck':True,'coldReplaced':previous is not None,'targetAbsentAfterStop':True,'terminal':classification,'streamSha256':hashlib.sha256(initial+tail).hexdigest(),'screenshotSha256':hashlib.sha256(shot).hexdigest()});previous=identity
  result['authEvidence']=fixture.call({'kind':'snapshot','complete':True},'snapshot')['value'];evidence=result['authEvidence']
  counts={key:sum(row['path']==path and row['status']==status for row in evidence['requests'])for key,path,status in [('start','/v1/auth/device/start',200),('pending','/v1/auth/device/poll',202),('consumed','/v1/auth/device/poll',200),('me','/v1/me',200)]}
  h.require(counts=={'start':3,'pending':3,'consumed':3,'me':6},'native_auth_phase_counts')
  h.require(evidence['outbound']==0 and evidence['purchaseOrders']==0,'unexpected_fixture_effect');h.require(not any(row['method']!='GET' or row['category']!='other' for row in evidence['denied']),'unexpected_non_auth_request')
  result['effectAssertions']={'expectedPublicAuthPhases':counts,'companionRouteAttempts':0,'modelRouteAttempts':0,'workerOutboundAttempts':0,'paidOrders':0,'syntheticApprovals':len(evidence['approvals'])};result['status']='PASS_AUTHENTICATED_SYNTHETIC_DRAFT_UI'
 finally:
  if reverse:
   try:
    rows=[line.split()for line in device.text('reverse','--list').splitlines()if len(line.split())==3 and line.split()[1]==reverse];h.require(len(rows)==1 and rows[0][2]==reverse,'owned_reverse_changed');device.call('reverse','--remove',reverse);h.require(not any(reverse in line.split()[1:2]for line in device.text('reverse','--list').splitlines()),'reverse_removal_unconfirmed');result['reverseClosed']=True
   except Exception as error:cleanup_errors.append(type(error).__name__);result['reverseClosed']=False
  if fixture:
   try:
    if 'authEvidence'not in result:result['authEvidence']=fixture.call({'kind':'snapshot','complete':False},'snapshot')['value']
   except Exception:result['authEvidenceUnavailable']=True
   closed=fixture.close();result['authFixtureClosed']=closed['closed'];cleanup_errors+=closed['errors']
  result['authCleanupErrors']=cleanup_errors
  if cleanup_errors or result.get('authFixtureClosed')is False:result['status']='FAIL'
