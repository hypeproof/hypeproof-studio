import Foundation
import CryptoKit

public struct IntakeProposal: Codable, Equatable, Sendable {
    public var kind:String, title:String, intent:String, requested_change:String, acceptance:[String], target_repo:String, references:[String]
    public init(kind:String="REQ",title:String="",intent:String="",requestedChange:String="",acceptance:[String]=[],targetRepository:String="",references:[String]=[]){self.kind=kind;self.title=title;self.intent=intent;requested_change=requestedChange;self.acceptance=acceptance;target_repo=targetRepository;self.references=references}
    public func validate()throws {
        func text(_ s:String,_ max:Int,_ nonempty:Bool=false)->Bool {s==s.trimmingCharacters(in:.whitespacesAndNewlines) && s.utf16.count<=max && !s.contains("\0") && (!nonempty || !s.isEmpty)}
        guard ["PHILOSOPHY","MISSION","INTENT","REQ","DESIGN","TEST_REQ"].contains(kind),text(title,180,true),text(intent,4000),text(requested_change,8000),acceptance.count<=12,acceptance.allSatisfy({text($0,1000,true)}),Self.repository(target_repo),references.count<=12,references.allSatisfy({text($0,500,true) && URL(string:$0)?.scheme=="https" && URL(string:$0)?.host != nil && URL(string:$0)?.user==nil && URL(string:$0)?.password==nil}) else{throw IntakeFailure.invalidInput}
    }
    public static func repository(_ s:String)->Bool{s.utf16.count<=120 && IntakeWire.matches(s,"^hypeproof/[a-z0-9][a-z0-9._-]*$")}
    public var json:IntakeJSON {get throws {try JSONDecoder().decode(IntakeJSON.self,from:IntakeWire.encode(self))}}
}
public struct IntakeBinding: Codable, Equatable, Sendable {
    public let studioAccountID:String, studioSessionEpoch:String, intakePrincipalID:String, endpoint:String, requestID:String, sourceRevision:Int, sourceTextRevision:Int
    public init(studioAccountID:String,studioSessionEpoch:String,principal:IntakePrincipal,requestID:String,sourceRevision:Int,sourceTextRevision:Int){self.studioAccountID=studioAccountID;self.studioSessionEpoch=studioSessionEpoch;intakePrincipalID=principal.id;endpoint=principal.endpoint;self.requestID=requestID;self.sourceRevision=sourceRevision;self.sourceTextRevision=sourceTextRevision}
    public func sameRecoveryOwner(as other:Self)->Bool {studioAccountID==other.studioAccountID && intakePrincipalID==other.intakePrincipalID && endpoint==other.endpoint && requestID==other.requestID}
    public func validate()throws {guard StoredAccount.validID(studioAccountID),!studioSessionEpoch.isEmpty,studioSessionEpoch.utf16.count<=200,TeamRequestRecord.validID(requestID),sourceRevision>0,sourceRevision<1_000_000_000,sourceTextRevision>0,sourceTextRevision<1_000_000_000,let url=URL(string:endpoint),url.path=="/mcp",url.query==nil,url.fragment==nil,IntakeWire.matches(intakePrincipalID,"^lab-[a-fA-F0-9-]{36}$") else{throw IntakeFailure.invalidInput};_ = try IntakeWire.origin(String(endpoint.dropLast(4)))}
}
public struct IntakeRoute: Equatable, Sendable {
    /// Current authenticated Service596 configured_repository, never historic association.repo.
    public let configuredRepository:String?, repositories:[String], policyRevision:String
    public init(configuredRepository:String?,repositories:[String],policyRevision:String){self.configuredRepository=configuredRepository;self.repositories=repositories;self.policyRevision=policyRevision}
    public func validate(proposal:IntakeProposal)throws {guard let configuredRepository,IntakeProposal.repository(configuredRepository),repositories.count<=30,!repositories.isEmpty,repositories.allSatisfy(IntakeProposal.repository),!policyRevision.isEmpty,policyRevision.utf16.count<=160,configuredRepository==proposal.target_repo,repositories.contains(configuredRepository) else{throw IntakeFailure.routing}}
}
public struct IntakeReceipt: Codable, Equatable, Sendable {
    public let proposal_id:String, revision:Int, owner_id:String, state:String, draft:IntakeProposal
    public let feedback:Feedback, publication:Publication?
    public struct Feedback:Codable,Equatable,Sendable {public let outcome:String, reason:String, questions:[String], next_action:String, policy_revision:String}
    public struct Publication:Codable,Equatable,Sendable {public let state:String, issue_url:String?, issue_number:Int?, project_item_id:String?, project_url:String?, problem:String?, next_action:String}
    public func validate(binding:IntakeBinding)throws {
        try draft.validate()
        guard IntakeWire.matches(proposal_id,"^HP-[a-f0-9-]{36}$"),revision>0,revision<1_000_000_000,owner_id==binding.intakePrincipalID,["reviewed","held","approved","publishing","issued","withdrawn"].contains(state),["answer","clarification","duplicate","new_work","decision_required","hold"].contains(feedback.outcome),feedback.questions.count<=12,feedback.reason.utf16.count<=16000,feedback.next_action.utf16.count<=16000,!feedback.policy_revision.isEmpty else{throw IntakeFailure.invalidResponse}
        if let p=publication {
            guard ["pending","creating","ambiguous","retryable","issue_created","complete"].contains(p.state),p.next_action.utf16.count<=16000 else{throw IntakeFailure.invalidResponse}
            if let number=p.issue_number {guard number>0,number<=9_007_199_254_740_991,p.issue_url=="https://github.com/"+draft.target_repo+"/issues/"+String(number) else{throw IntakeFailure.invalidResponse}} else if p.issue_url != nil {throw IntakeFailure.invalidResponse}
            if ["issue_created","complete"].contains(p.state){guard p.issue_number != nil else{throw IntakeFailure.invalidResponse}}
            if p.state=="complete" {guard let item=p.project_item_id,!item.isEmpty,let url=p.project_url,IntakeWire.matches(url,"^https://github.com/orgs/hypeproof/projects/[1-9][0-9]*$") else{throw IntakeFailure.invalidResponse}}
        }
    }
    public var issueURL:URL? {publication?.issue_url.flatMap(URL.init(string:))}
    public var boardComplete:Bool {publication?.state=="complete"}
}
public struct IntakeOperation: Codable, Equatable, Sendable {
    public enum Action:String,Codable,Sendable {case submit, revise, retryPublication}
    public enum Phase:String,Codable,Sendable {case preview, confirmed, uncertain, received, conflict}
    public let binding:IntakeBinding, key:String
    public var proposal:IntakeProposal, action:Action, proposalID:String?, expectedRevision:Int?, policyRevision:String?, approvalDigest:String?, phase:Phase, receipt:IntakeReceipt?
    public init(binding:IntakeBinding,proposal:IntakeProposal,key:String=UUID().uuidString.lowercased()){self.binding=binding;self.proposal=proposal;self.key=key;action = .submit;phase = .preview}
    public func digest()throws->String {
        struct Approval:Encodable {let binding:IntakeBinding,key:String,proposal:IntakeProposal,action:Action,proposalID:String?,expectedRevision:Int?,policyRevision:String?}
        return SHA256.hash(data:try IntakeWire.encode(Approval(binding:binding,key:key,proposal:proposal,action:action,proposalID:proposalID,expectedRevision:expectedRevision,policyRevision:policyRevision))).map{String(format:"%02x",$0)}.joined()
    }
    public func validate()throws {
        try binding.validate();try proposal.validate();guard IntakeWire.matches(key,"^[a-zA-Z0-9._:-]{8,120}$") else{throw IntakeFailure.invalidInput}
        if action != .submit {guard let id=proposalID,IntakeWire.matches(id,"^HP-[a-f0-9-]{36}$"),let rev=expectedRevision,rev>0 else{throw IntakeFailure.invalidInput}}
        if phase == .confirmed || phase == .uncertain {guard approvalDigest == (try digest()) else{throw IntakeFailure.confirmationRequired}}
        if let receipt {try receipt.validate(binding:binding)}
        if phase == .received {guard receipt != nil else{throw IntakeFailure.invalidResponse}}
    }
    /// Only structured, explicitly entered summary and recovery metadata. No auth credentials.
    public var exportData:Data? {try? IntakeWire.encode(self)}
}

/// App injects current authenticated context/routing and the separate existing MCP client.
/// Association is intentionally external: an issued proposal is retained even if association fails.
@MainActor public final class IntakeProposalController {
    public struct View {public var operation:IntakeOperation?;public var busy=false,storageReady=true;public var failure:IntakeFailure?}
    public private(set) var view=View()
    private let context:()async throws->IntakeBinding?, route:(IntakeBinding)async throws->IntakeRoute, call:(String,IntakeJSON)async throws->IntakeJSON
    private let save:(IntakeOperation)throws->Void, load:(IntakeBinding)throws->IntakeOperation?, changed:(View)->Void
    private var generation=0
    private var executionBinding:IntakeBinding?
    public init(context:@escaping ()async throws->IntakeBinding?,route:@escaping (IntakeBinding)async throws->IntakeRoute,call:@escaping (String,IntakeJSON)async throws->IntakeJSON,load:@escaping (IntakeBinding)throws->IntakeOperation?,save:@escaping (IntakeOperation)throws->Void,changed:@escaping (View)->Void){self.context=context;self.route=route;self.call=call;self.load=load;self.save=save;self.changed=changed}
    public func invalidate(){generation+=1;executionBinding=nil;view=View();changed(view)}
    private func admit(_ binding:IntakeBinding,_ g:Int)async throws {let current=try await context();guard generation==g,current==(executionBinding ?? binding),current?.sameRecoveryOwner(as:binding)==true else{if generation==g{invalidate()};throw IntakeFailure.identityChanged}}
    @discardableResult private func persist(_ op:IntakeOperation)->Bool {view.operation=op;do{try op.validate();try save(op);view.storageReady=true;changed(view);return true}catch{view.storageReady=false;view.failure = .storage;changed(view);return false}}
    public func open()async {
        guard !view.busy,view.storageReady else{return};let g=generation;view.busy=true;changed(view)
        do {guard let b=try await context() else{throw IntakeFailure.identityChanged};try b.validate();try await admit(b,g);let old=try load(b);if let old{try old.validate();guard old.binding==b else{throw IntakeFailure.identityChanged}};executionBinding=b;view.operation=old;view.busy=false;changed(view)}catch{await finishChecked(error,g)}
    }
    /// Explicit recovery action after reauthentication. Load must be keyed by stable account,
    /// Lab principal, endpoint and request, not by ephemeral Studio session epoch.
    /// Retains the ORIGINAL approval/source digest and exact payload/key; only the execution
    /// fence attaches to the new session. This is not confirmation of a changed summary.
    public func recoverForCurrentSession()async {
        guard !view.busy,view.storageReady else{return};let g=generation;view.busy=true;changed(view)
        do {
            guard let b=try await context() else{throw IntakeFailure.identityChanged};try b.validate()
            let current=try await context();guard generation==g,current==b else{throw IntakeFailure.identityChanged}
            guard let old=try load(b),old.binding.sameRecoveryOwner(as:b),[.uncertain,.received,.conflict].contains(old.phase) else{throw IntakeFailure.identityChanged}
            try old.validate();executionBinding=b;view.operation=old;view.busy=false;view.failure=nil;changed(view)
        }catch{await finishChecked(error,g)}
    }
    /// Explicit user edit. Unknown submissions cannot be replaced with a fresh key.
    public func preview(_ proposal:IntakeProposal)async {
        guard !view.busy,view.storageReady,view.operation?.phase != .uncertain else{return};let g=generation
        do {guard let b=try await context() else{throw IntakeFailure.identityChanged};try proposal.validate();try await admit(b,g)
            if let old=view.operation,old.receipt != nil {throw IntakeFailure.conflict}
            executionBinding=b;_ = persist(IntakeOperation(binding:b,proposal:proposal))
        }catch{await finishChecked(error,g)}
    }
    /// Must be called only by the explicit public-summary confirmation action, not sheet appearance.
    public func confirm()async {
        guard !view.busy,view.storageReady,var op=view.operation,op.phase == .preview else{return};let g=generation;view.busy=true;changed(view)
        do {try await admit(op.binding,g);let r=try await route(executionBinding ?? op.binding);try await admit(op.binding,g);try r.validate(proposal:op.proposal);op.policyRevision=r.policyRevision;op.approvalDigest=try op.digest();op.phase = .confirmed;view.busy=false;_ = persist(op)}catch{await finishChecked(error,g)}
    }
    public func cancelConfirmation(){guard !view.busy,var op=view.operation,op.phase == .confirmed else{return};op.phase = .preview;op.approvalDigest=nil;_ = persist(op)}
    private func decode(_ json:IntakeJSON,_ op:IntakeOperation)throws->IntakeReceipt {let r=try JSONDecoder().decode(IntakeReceipt.self,from:IntakeWire.encode(json));try r.validate(binding:op.binding);if let id=op.proposalID{guard r.proposal_id==id else{throw IntakeFailure.invalidResponse}};return r}
    public func send()async {
        guard !view.busy,view.storageReady,var op=view.operation,[.confirmed,.uncertain].contains(op.phase) else{return}
        let g=generation;view.busy=true;view.failure=nil;changed(view)
        do {
            try op.validate();try await admit(op.binding,g);let r=try await route(executionBinding ?? op.binding);try await admit(op.binding,g);try r.validate(proposal:op.proposal)
            guard r.policyRevision==op.policyRevision else{throw IntakeFailure.confirmationRequired}
            // Revise has no request key. Reconcile an uncertain CAS before any further mutation.
            if op.phase == .uncertain,op.action == .revise {
                let value=try await call("get_proposal",.object(["proposal_id":.string(op.proposalID!)]));try await admit(op.binding,g)
                let receipt=try decode(value,op)
                if receipt.revision==op.expectedRevision!+1,receipt.draft==op.proposal {op.receipt=receipt;op.phase = .received;view.busy=false;_ = persist(op);return}
                guard receipt.revision==op.expectedRevision else{throw IntakeFailure.conflict}
            }
            op.phase = .uncertain;guard persist(op) else{view.busy=false;changed(view);return}
            var args:[String:IntakeJSON];let tool:String
            switch op.action {case .submit:tool="submit_proposal";args=["request_key":.string(op.key),"proposal":try op.proposal.json]
            case .revise:tool="revise_proposal";args=["proposal_id":.string(op.proposalID!),"expected_revision":.number(op.expectedRevision!),"proposal":try op.proposal.json]
            case .retryPublication:tool="retry_publication";args=["proposal_id":.string(op.proposalID!)]}
            let value=try await call(tool,.object(args));try await admit(op.binding,g);let receipt=try decode(value,op)
            guard receipt.draft==op.proposal else{throw IntakeFailure.invalidResponse}
            if op.action == .revise {guard receipt.revision==op.expectedRevision!+1 else{throw IntakeFailure.invalidResponse}}
            if op.action == .retryPublication {guard receipt.revision==op.expectedRevision else{throw IntakeFailure.invalidResponse}}
            op.receipt=receipt;op.proposalID=receipt.proposal_id;op.phase = .received;view.busy=false;_ = persist(op)
        }catch {guard generation==g else{return};let current=try? await context();guard generation==g else{return};guard current == (executionBinding ?? op.binding),current?.sameRecoveryOwner(as:op.binding)==true else{invalidate();return};if error as? IntakeFailure == .tool("revision_conflict") || error as? IntakeFailure == .conflict {op.phase = .conflict;view.busy=false;_ = persist(op)};finish(error,g)}
    }
    /// Re-fetch the existing proposal before an explicit revise/retry preview. Does not publish.
    public func prepareExisting(proposal:IntakeProposal? = nil,retryPublication:Bool=false)async {
        guard !view.busy,view.storageReady,let old=view.operation,old.phase != .uncertain,let id=old.receipt?.proposal_id else{return};let g=generation;view.busy=true;changed(view)
        do {try await admit(old.binding,g);let result=try await call("get_proposal",.object(["proposal_id":.string(id)]));try await admit(old.binding,g);let current=try decode(result,old)
            var op=IntakeOperation(binding:executionBinding ?? old.binding,proposal:proposal ?? current.draft);op.receipt=current;op.proposalID=id;op.expectedRevision=current.revision
            if retryPublication {guard ["approved","publishing","issued"].contains(current.state) else{throw IntakeFailure.conflict};op.action = .retryPublication;op.proposal=current.draft}
            else {guard ["reviewed","held"].contains(current.state),current.publication?.issue_number==nil else{throw IntakeFailure.conflict};op.action = .revise}
            view.busy=false;_ = persist(op)
        }catch{await finishChecked(error,g)}
    }
    private func finishChecked(_ error:Error,_ g:Int)async {guard generation==g else{return};if let op=view.operation{let current=try? await context();guard generation==g else{return};if current != (executionBinding ?? op.binding) || current?.sameRecoveryOwner(as:op.binding) != true{invalidate();return}};finish(error,g)}
    private func finish(_ error:Error,_ g:Int){guard generation==g else{return};view.busy=false;view.failure=(error as? IntakeFailure) ?? .invalidResponse;changed(view)}
}
