import Foundation

public struct TeamRelationEvent: Codable, Identifiable, Sendable {
    public let id, pair_left, pair_right, client_mutation_id, action: String
    public let actor_account_id, reason: String?
    public let sequence, revision: Int
    public let created_at: Double
    public let redacted_at: Double?
    public let target_request_id: String?
    public func other(_ source: String) -> String { pair_left == source ? pair_right : pair_left }
    public func validate(source: String, target: String? = nil) throws {
        guard id.range(of:"^trl_[a-f0-9]{32}$",options:.regularExpression) != nil, id.count == 36,
              TeamRequestRecord.validID(pair_left),TeamRequestRecord.validID(pair_right),pair_left < pair_right,
              pair_left == source || pair_right == source, target == nil || other(source) == target,
              target_request_id == nil || target_request_id == other(source),
              TeamGitHubDraft.number(sequence),revision > 0,revision < 1_000_000_000,["link","unlink"].contains(action),
              created_at.isFinite,created_at > 0, redacted_at.map({$0.isFinite && $0 >= created_at}) ?? true,
              actor_account_id.map(StoredAccount.validID) ?? true, client_mutation_id.utf16.count <= 64,
              reason.map({ !$0.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty && $0.utf16.count <= 2000 && !$0.contains("\0") }) ?? (redacted_at != nil) else { throw SyncFailure.invalidResponse }
    }
    public func matches(_ draft: TeamRelationDraft) -> Bool {
        other(draft.requestID) == draft.targetID && actor_account_id == draft.accountID && client_mutation_id == draft.key && revision == draft.expectedRevision+1 && action == draft.action && reason == draft.reason
    }
}
public struct TeamRelationPage: Decodable, Sendable {
    public let schema, request_id: String
    public let target_request_id: String?
    public let current: TeamRelationEvent?
    public let can_manage: Bool
    public let items: [TeamRelationEvent]
    public let next_cursor: String?
    public static func historyCursor(_ s: String) -> Int? { guard let n=Int(s),n>0,n<1_000_000_000,String(n)==s else{return nil};return n }
    public func validate(source: String,target: String? = nil,after: String? = nil) throws {
        guard TeamRequestRecord.validID(source),request_id == source,target_request_id == target,items.count <= 50,Set(items.map(\.id)).count == items.count,
              schema == (target == nil ? "hps-team-related-requests/1":"hps-team-relation-history/1") else { throw SyncFailure.invalidResponse }
        if let target {
            guard TeamRequestRecord.validID(target),target != source,after.map({Self.historyCursor($0) != nil}) ?? true else {throw SyncFailure.invalidResponse}
            try current?.validate(source:source,target:target)
            var last=after.flatMap(Self.historyCursor) ?? 0
            for item in items {try item.validate(source:source,target:target);guard item.revision>last,item.revision <= (current?.revision ?? 0) else{throw SyncFailure.invalidResponse};last=item.revision}
            if let next_cursor {guard Self.historyCursor(next_cursor)==items.last?.revision else{throw SyncFailure.invalidResponse}}
        } else {
            guard current == nil,after.map(TeamRequestRecord.validID) ?? true else{throw SyncFailure.invalidResponse}
            var last=after ?? ""
            for item in items {try item.validate(source:source);guard item.target_request_id == item.other(source),item.other(source)>last,item.action == "link",item.redacted_at == nil else{throw SyncFailure.invalidResponse};last=item.other(source)}
            if let next_cursor {guard TeamRequestRecord.validID(next_cursor),next_cursor>=last,next_cursor>(after ?? "") else{throw SyncFailure.invalidResponse}}
        }
    }
}
public struct TeamRelationDraft: Codable, Sendable {
    public enum Phase:String,Codable,Sendable {case draft,uncertain,received,conflict}
    public let accountID,requestID,product,key:String
    public var targetID="",action="link",reason="",expectedRevision=0
    public var phase:Phase = .draft
    public var receiptID:String?
    public init(accountID:String,requestID:String,product:String,key:String=UUID().uuidString.lowercased()){self.accountID=accountID;self.requestID=requestID;self.product=product;self.key=key}
    public func validate(account:String,request:String,product:String)throws{
        guard accountID==account,requestID==request,self.product==product,StoredAccount.validID(account),TeamRequestRecord.validID(request),TeamRequestDraft.products.contains(product),UUID(uuidString:key)?.uuidString.lowercased()==key,
              targetID.isEmpty || (TeamRequestRecord.validID(targetID) && targetID != request),["link","unlink"].contains(action),expectedRevision>=0,expectedRevision<999999999,reason.utf16.count<=2000,!reason.contains("\0"),
              phase == .draft || !targetID.isEmpty, phase != .received || receiptID?.range(of:"^trl_[a-f0-9]{32}$",options:.regularExpression) != nil else{throw SyncFailure.invalidResponse}
    }
    public func payload()throws->[String:Any]{try validate(account:accountID,request:requestID,product:product);guard !targetID.isEmpty,!reason.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty else{throw SyncFailure.invalidResponse};return["schema":"hps-team-relation-change/1","client_mutation_id":key,"target_request_id":targetID,"expected_revision":expectedRevision,"action":action,"reason":reason]}
}

@MainActor public final class TeamRelationController {
    public struct View {
        public var draft:TeamRelationDraft?,list:TeamRelationPage?,history:TeamRelationPage?
        public var items:[TeamRelationEvent]=[],events:[TeamRelationEvent]=[],targets:[TeamRequestRecord]=[]
        public var targetCursor:String?,message="",busy=false,storageReady=true
        public init(){}
    }
    public private(set) var view=View()
    private let requestID,product:String
    private let identity:()async throws->MemberApprovalIdentity?
    private let fetch:(MemberApprovalIdentity,String?,String?)async throws->TeamRelationPage
    private let targets:(MemberApprovalIdentity,String?)async throws->TeamRequestPage
    private let send:(MemberApprovalIdentity,TeamRelationDraft)async throws->TeamRelationEvent
    private let load:(String)throws->TeamRelationDraft?
    private let save:(TeamRelationDraft)throws->Void
    private let changed:(View)->Void
    private var generation=UUID(),binding:MemberApprovalIdentity?
    public init(requestID:String,product:String,identity:@escaping()async throws->MemberApprovalIdentity?,fetch:@escaping(MemberApprovalIdentity,String?,String?)async throws->TeamRelationPage,targets:@escaping(MemberApprovalIdentity,String?)async throws->TeamRequestPage,send:@escaping(MemberApprovalIdentity,TeamRelationDraft)async throws->TeamRelationEvent,load:@escaping(String)throws->TeamRelationDraft?,save:@escaping(TeamRelationDraft)throws->Void,changed:@escaping(View)->Void){self.requestID=requestID;self.product=product;self.identity=identity;self.fetch=fetch;self.targets=targets;self.send=send;self.load=load;self.save=save;self.changed=changed}
    public func invalidate(){generation=UUID();binding=nil;view=View();changed(view)}
    private func current(_ g:UUID,_ account:MemberApprovalIdentity)async->Bool{guard g==generation else{return false};guard (try? await identity())==account,g==generation else{if g==generation{invalidate()};return false};return true}
    private func persist(_ draft:TeamRelationDraft){view.draft=draft;do{try save(draft)}catch{view.storageReady=false;view.message="변경 내용을 기기에 저장하지 못했어요. 내보내 주세요."};changed(view)}
    private func clearRemote(){view.list=nil;view.history=nil;view.items=[];view.events=[];view.targets=[];view.targetCursor=nil}
    private func validateHistory(_ page:TeamRelationPage)throws{
        if let draft=view.draft,draft.phase == .received,page.target_request_id==draft.targetID{
            guard let current=page.current,current.revision>=draft.expectedRevision+1,
                  current.revision != draft.expectedRevision+1 || current.id==draft.receiptID else{throw SyncFailure.invalidResponse}
        }
        if let previous=view.history,previous.target_request_id==page.target_request_id,let old=previous.current{
            guard let current=page.current,current.revision>=old.revision,current.revision != old.revision || current.id==old.id else{throw SyncFailure.invalidResponse}
        }
    }
    private func read(_ account:MemberApprovalIdentity,_ g:UUID)async throws{
        let list=try await fetch(account,nil,nil);try list.validate(source:requestID)
        guard await current(g,account) else{return}
        var history:TeamRelationPage?
        if let target=view.draft?.targetID,!target.isEmpty{history=try await fetch(account,target,nil);try history?.validate(source:requestID,target:target);if let history{try validateHistory(history)}}
        let choices=list.can_manage ? try await targets(account,nil):nil;try choices?.validate(product:product)
        guard await current(g,account) else{return}
        view.list=list;view.items=list.items;view.history=history;view.events=history?.items ?? [];view.targets=choices?.requests.filter{$0.id != requestID} ?? [];view.targetCursor=choices?.next_cursor
    }
    public func open()async{
        guard !view.busy,view.storageReady else{return};let g=UUID();generation=g;view.busy=true;view.message="";clearRemote();changed(view)
        defer{if g==generation{view.busy=false;changed(view)}}
        do{guard let account=try await identity(),g==generation else{if g==generation{invalidate()};return}
            if binding != account{view.draft=nil};binding=account
            if view.draft==nil{do{let local=try load(account.accountID) ?? TeamRelationDraft(accountID:account.accountID,requestID:requestID,product:product);try local.validate(account:account.accountID,request:requestID,product:product);view.draft=local}catch{view.storageReady=false;view.message="저장된 연결 초안을 읽지 못했어요. 원본을 유지했어요.";return}}
            try await read(account,g)
        }catch{guard g==generation else{return};if let binding,!(await current(g,binding)){return};clearRemote();view.message="관련 요청을 불러오지 못했어요. 로그인·제품 권한과 요청의 보관 상태를 확인해 주세요."}
    }
    public func inspect(_ target:String)async{
        guard !view.busy,let account=binding,view.items.contains(where:{$0.other(requestID)==target}) else{return}
        let g=generation;view.busy=true;view.history=nil;view.events=[];changed(view);defer{if g==generation{view.busy=false;changed(view)}}
        do{let page=try await fetch(account,target,nil);try page.validate(source:requestID,target:target);try validateHistory(page);guard await current(g,account) else{return};view.history=page;view.events=page.items}
        catch{guard await current(g,account) else{return};view.message="이 연결의 이력을 불러오지 못했어요."}
    }
    public func select(_ target:String)async{
        guard !view.busy,view.storageReady,var draft=view.draft,draft.phase == .draft,let account=binding,
              view.items.contains(where:{$0.other(requestID)==target}) || (view.list?.can_manage==true && view.targets.contains(where:{$0.id==target})) else{return}
        let g=generation;view.busy=true;view.history=nil;view.events=[];changed(view);defer{if g==generation{view.busy=false;changed(view)}}
        do{let page=try await fetch(account,target,nil);try page.validate(source:requestID,target:target);try validateHistory(page);guard await current(g,account) else{return};draft.targetID=target;draft.expectedRevision=page.current?.revision ?? 0;draft.action=page.current?.action=="link" && page.current?.redacted_at==nil ? "unlink":"link";view.history=page;view.events=page.items;persist(draft)}catch{guard await current(g,account) else{return};view.message="선택한 요청을 확인하지 못했어요. 원래 초안은 유지했어요."}
    }
    public func editReason(_ reason:String){guard !view.busy,view.storageReady,view.list?.can_manage==true,view.history?.can_manage==true,view.history?.target_request_id==view.draft?.targetID,var d=view.draft,d.phase == .draft,reason.utf16.count<=2000 else{return};d.reason=reason;persist(d)}
    public func newChoice(){
        guard !view.busy,view.storageReady,view.list?.can_manage==true,view.history?.can_manage==true,let d=view.draft,d.phase == .received || d.phase == .conflict,view.history?.target_request_id==d.targetID else{return}
        var next=TeamRelationDraft(accountID:d.accountID,requestID:requestID,product:product);next.targetID=d.targetID;next.reason=d.phase == .conflict ? d.reason:"";next.expectedRevision=view.history?.current?.revision ?? 0;next.action=view.history?.current?.action=="link" && view.history?.current?.redacted_at==nil ? "unlink":"link";persist(next)
    }
    public func submit()async{
        guard !view.busy,view.storageReady,view.list?.can_manage==true,view.history?.can_manage==true,view.history?.target_request_id==view.draft?.targetID,var d=view.draft,d.phase == .draft || d.phase == .uncertain || d.phase == .conflict,let account=binding,(try? d.payload()) != nil else{return}
        let g=generation;view.busy=true;view.message="";changed(view);defer{if g==generation{view.busy=false;changed(view)}}
        guard await current(g,account) else{return}
        d.phase = .uncertain;persist(d);guard view.storageReady,await current(g,account) else{return}
        do{let event=try await send(account,d);try event.validate(source:requestID,target:d.targetID);guard event.matches(d) else{throw SyncFailure.invalidResponse};guard await current(g,account) else{return}
            d.phase = .received;d.receiptID=event.id;persist(d);clearRemote();guard view.storageReady else{return};try await read(account,g);if g==generation{view.message="관련 요청 변경이 저장됐어요."}
        }catch SyncFailure.http(409,"team_relation_conflict"){
            guard await current(g,account) else{return};d.phase = .conflict;persist(d);clearRemote();view.message="현재 연결과 충돌했어요. 전송 번호는 유지돼요. 새로고침 후 현재 기록을 확인하고 새 변경을 직접 선택해 주세요."
        }catch{guard await current(g,account) else{return};clearRemote();view.message=d.phase == .received ? "변경은 저장됐지만 현재 연결을 다시 읽지 못했어요. 새로고침해 주세요.":"저장 여부를 확인하지 못했어요. 같은 전송 번호와 내용을 유지했어요. 새로고침 후 다시 확인할 수 있어요."}
    }
    public func more(_ kind:String)async{
        guard !view.busy,let account=binding else{return};let g=generation
        let target=kind=="history" ? view.history?.target_request_id:nil
        let cursor=kind=="history" ? view.history?.next_cursor:kind=="targets" ? view.targetCursor:view.list?.next_cursor
        let count=kind=="history" ? view.events.count:kind=="targets" ? view.targets.count:view.items.count
        guard let cursor,count<500 else{return};view.busy=true;changed(view);defer{if g==generation{view.busy=false;changed(view)}}
        do{if kind=="targets"{guard view.list?.can_manage==true else{return};let page=try await targets(account,cursor);try page.validate(product:product);guard await current(g,account) else{return};let ids=Set(view.targets.map(\.id));view.targets=Array((view.targets+page.requests.filter{$0.id != requestID && !ids.contains($0.id)}).prefix(500));view.targetCursor=page.next_cursor}
            else{let page=try await fetch(account,target,cursor);try page.validate(source:requestID,target:target,after:cursor);guard await current(g,account) else{return}
                if kind=="history"{try validateHistory(page);let ids=Set(view.events.map(\.id));view.events=Array((view.events+page.items.filter{!ids.contains($0.id)}).prefix(500));view.history=page}
                else{let ids=Set(view.items.map(\.id));view.items=Array((view.items+page.items.filter{!ids.contains($0.id)}).prefix(500));view.list=page}}
        }catch{guard await current(g,account) else{return};clearRemote();view.message="추가 기록을 불러오지 못했어요. 새로고침해 주세요."}
    }
}
@MainActor public final class TeamRelationControllers{
    private final class Entry{weak var value:TeamRelationController?;init(_ value:TeamRelationController){self.value=value}}
    private var entries:[Entry]=[]
    public init(){}
    public func register(_ controller:TeamRelationController){entries.removeAll{$0.value==nil};if !entries.contains(where:{$0.value===controller}){entries.append(Entry(controller))}}
    public func invalidate(){entries.removeAll{$0.value==nil};entries.forEach{$0.value?.invalidate()}}
}
