import SwiftUI

@MainActor final class TeamRelationPresentation:ObservableObject {
    @Published var state=TeamRelationController.View()
    var controller:TeamRelationController?
}
struct TeamRelationScreen:View, Equatable {
    @ObservedObject private var model:TeamRelationPresentation
    @ObservedObject var requests:TeamRequestPresentation
    let router:TeamRouter
    let step:TeamStep
    private let identity:ObjectIdentifier
    @State private var confirmSend=false
    @State private var confirmLeave=false
    @FocusState private var reasonFocused:Bool
    /// The router's store keeps the presentation for this step (#4432 F11-D); pushes and leaving go through the router.
    init(model:TeamRelationPresentation,requests:TeamRequestPresentation,router:TeamRouter,step:TeamStep){self.model=model;self.requests=requests;self.router=router;self.step=step;identity=ObjectIdentifier(model)}
    nonisolated static func == (a: Self, b: Self) -> Bool { teamScreenEqual("relations", (a.step, a.identity), (b.step, b.identity)) }
    private var canManage:Bool{model.state.list?.can_manage==true && model.state.history?.can_manage==true && model.state.history?.target_request_id==model.state.draft?.targetID}
    private var editable:Bool{canManage && !model.state.busy && model.state.storageReady && model.state.draft?.phase == .draft}
    private func label(_ target:String)->String{model.state.targets.first(where:{$0.id==target}).map{String($0.body.prefix(100))} ?? "요청 " + String(target.suffix(8))}
    private func record(_ event:TeamRelationEvent)->some View{
        VStack(alignment:.leading,spacing:6){
            Text(event.action=="link" ? "관련 요청으로 연결됨":"연결 해제됨").font(.headline)
            if let reason=event.reason{Text(reason).textSelection(.enabled)}else{Text("이 변경의 사유는 더 이상 제공되지 않아요.")}
            Text(Date(timeIntervalSince1970:event.created_at/1000).formatted()).font(.caption)
        }
    }
    var body:some View{
        let _=teamRenderCount("body.related")
        let _=teamWhy(Self.self)
        List{
#if DEBUG
            if TeamEntryFixture.enabled{TimelineView(.periodic(from:.now,by:0.25)){_ in Text("Synthetic related trace").font(.caption2).accessibilityIdentifier("teamRelatedTrace").accessibilityValue(TeamEntryFixture.trace)}}
#endif
            if !model.state.message.isEmpty{Text(model.state.message).accessibilityIdentifier("teamRelatedMessage")}
            if let page=model.state.list{
                Section("관련된 요청"){
                    if model.state.items.isEmpty{Text("현재 연결된 관련 요청이 없어요.").accessibilityIdentifier("teamRelatedEmpty")}
                    ForEach(model.state.items){event in
                        TeamPushRow(label(event.other(page.request_id))){router.push(.detail(request:event.other(page.request_id)),above:step)}.disabled(model.state.busy || !model.state.storageReady).accessibilityIdentifier("teamRelatedOriginal-"+event.other(page.request_id))
                        Button("연결 이력 보기"){reasonFocused=false;Task{await model.controller?.inspect(event.other(page.request_id))}}.disabled(model.state.busy)
                    }
                    if page.next_cursor != nil && model.state.items.count<500{Button("관련 요청 더 보기"){Task{await model.controller?.more("list")}}.disabled(model.state.busy)}
                    if !page.can_manage{Text("연결은 조회할 수 있어요. 변경은 권한이 있는 운영자만 할 수 있어요.").accessibilityIdentifier("teamRelatedReadOnly")}
                }
                if page.can_manage,model.state.draft?.phase == .draft{
                    Section("같은 제품의 요청 선택"){
                        ForEach(model.state.targets){target in
                            Button{reasonFocused=false;Task{await model.controller?.select(target.id)}}label:{Text(String(target.body.prefix(100)))}
                                .disabled(model.state.busy || !model.state.storageReady).accessibilityIdentifier("teamRelatedSelect-"+target.id)
                        }
                        if model.state.targetCursor != nil && model.state.targets.count<500{Button("선택할 요청 더 보기"){Task{await model.controller?.more("targets")}}.disabled(model.state.busy)}
                    }
                }
            }
            if let draft=model.state.draft,!draft.targetID.isEmpty{
                Section("선택한 요청"){
                    Text(label(draft.targetID)).accessibilityIdentifier("teamRelatedTarget")
                    Text("요청 번호: "+draft.targetID).font(.caption).textSelection(.enabled)
                    if model.state.history != nil{TeamPushRow("요청 원문 보기"){router.push(.detail(request:draft.targetID),above:step)}.disabled(model.state.busy || !model.state.storageReady).accessibilityIdentifier("teamRelatedSelectedOriginal")}
                    if draft.phase == .received{Text("변경이 저장됐어요.").accessibilityIdentifier("teamRelatedReceipt")}
                    if canManage{
                        if draft.phase == .draft || draft.phase == .uncertain || draft.phase == .conflict{
                            Text(draft.action=="link" ? "관련 요청으로 연결":"관련 요청 연결 해제").accessibilityIdentifier("teamRelatedAction")
                            TextEditor(text:Binding(get:{model.state.draft?.reason ?? ""},set:{model.controller?.editReason($0)})).frame(minHeight:100).focused($reasonFocused).disabled(!editable).accessibilityLabel("연결 변경 사유").accessibilityIdentifier("teamRelatedReason")
                            Button(draft.phase == .draft ? "변경 확인":"같은 내용으로 결과 다시 확인"){reasonFocused=false;confirmSend=true}
                                .disabled(model.state.busy || !model.state.storageReady || (try? draft.payload())==nil).accessibilityIdentifier("teamRelatedSend")
                        }
                        if draft.phase == .received || draft.phase == .conflict{Button("현재 연결 기준으로 새 변경 작성"){reasonFocused=false;model.controller?.newChoice()}.disabled(model.state.busy || !model.state.storageReady).accessibilityIdentifier("teamRelatedNewChoice")}
                    }
                    if draft.phase != .received,!draft.reason.isEmpty{ShareLink("연결 초안 내보내기",item:draft.targetID+"\n"+draft.action+"\n"+draft.reason)}
                }
            }
            if let page=model.state.history{
                Section("현재 연결과 변경 이력"){
                    if let target=page.target_request_id{Text(label(target)+" · "+String(target.suffix(8))).font(.caption)}
                    if let event=page.current{record(event)}else{Text("이 두 요청의 연결 기록이 없어요.")}
                    ForEach(model.state.events.filter{$0.id != page.current?.id}){event in record(event)}
                    if page.next_cursor != nil && model.state.events.count<500{Button("변경 이력 더 보기"){Task{await model.controller?.more("history")}}.disabled(model.state.busy)}
                }
            }
            Text("관련 요청을 연결해도 원문·담당·진행 상태는 바뀌지 않아요. 중복 요청이나 해결된 요청으로 분류하지 않아요.").font(.footnote).foregroundStyle(.secondary)
        }.navigationTitle("관련 요청").navigationBarTitleDisplayMode(.inline)
            .navigationBarBackButtonHidden(model.state.busy || !model.state.storageReady)
            .toolbar{
                ToolbarItem(placement:.topBarTrailing){Button("새로고침"){reasonFocused=false;Task{await model.controller?.open()}}.disabled(model.state.busy || !model.state.storageReady).accessibilityIdentifier("teamRelatedRefresh")}
                ToolbarItem(placement:.topBarLeading){if !model.state.storageReady{Button("뒤로"){confirmLeave=true}}}
            }.interactiveDismissDisabled(model.state.busy || !model.state.storageReady)
            .task{await model.controller?.open()}.onAppear{teamRenderCount("appear.related")}.onDisappear{model.controller?.invalidate()}
            .teamPublishCount(model.objectWillChange,"pub.related").teamPublishCount(requests.objectWillChange,"pub.requests.related").teamChangeCount(reasonFocused,"focus.related")
            .alert("관련 요청 연결을 변경할까요?", isPresented: $confirmSend) {
                Button("취소", role: .cancel) {}
                Button("저장") { Task { await model.controller?.submit() } }
            } message: {
                if let draft = model.state.draft {
                    let title = label(draft.targetID)
                    let action = draft.action == "link" ? "연결" : "연결 해제"
                    Text(verbatim: [title, draft.targetID, action, draft.reason].joined(separator: "\n"))
                }
            }
            .alert("저장되지 않은 변경이 있어요",isPresented:$confirmLeave){Button("계속 작성",role:.cancel){};Button("나가기",role:.destructive){router.pop(step)}}message:{Text("나가기 전에 연결 초안을 내보내 주세요.")}
    }
}
