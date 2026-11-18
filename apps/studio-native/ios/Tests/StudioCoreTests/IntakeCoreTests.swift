import XCTest
@testable import StudioCore

final class IntakeCoreTests:XCTestCase {
    let origin="https://service.example", principalID="lab-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    func binding(_ account:String="A")->IntakeBinding {IntakeBinding(studioAccountID:account,studioSessionEpoch:"session-1",principal:IntakePrincipal(id:principalID,endpoint:origin+"/mcp",expiresAt:Date().addingTimeInterval(1000)),requestID:"trq_"+String(repeating:"a",count:32),sourceRevision:1,sourceTextRevision:1)}
    func proposal()->IntakeProposal {IntakeProposal(title:"Explicit public summary",intent:"User-approved intent",requestedChange:"Requested public behavior",acceptance:["Observed result"],targetRepository:"hypeproof/hypeproof-studio")}
    func route()->IntakeRoute {IntakeRoute(configuredRepository:"hypeproof/hypeproof-studio",repositories:["hypeproof/hypeproof-studio"],policyRevision:"p1")}
    func receipt(_ proposal:IntakeProposal,state:String="held",revision:Int=1)->IntakeJSON {.object(["proposal_id":.string("HP-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),"revision":.number(revision),"owner_id":.string(principalID),"state":.string(state),"draft":try! proposal.json,"feedback":.object(["outcome":.string("new_work"),"reason":.string("Structured summary"),"questions":.array([]),"next_action":.string("Wait for decision"),"policy_revision":.string("p1")]),"publication":.null,"ai_review":.object(["minimum_selected_probability":.decimal(0.9)])])}
    @MainActor func testExplicitConfirmationUnknownRecoveryAndStorageFailure()async throws {
        let b=binding();var stored:IntakeOperation?,posts:[IntakeJSON]=[];var failSave=false
        let c=IntakeProposalController(context:{b},route:{_ in self.route()},call:{name,args in XCTAssertEqual(name,"submit_proposal");posts.append(args);if posts.count==1{throw URLError(.timedOut)};return self.receipt(self.proposal())},load:{_ in stored},save:{if failSave{throw IntakeFailure.storage};stored=$0},changed:{_ in})
        await c.preview(proposal());await c.send();XCTAssertTrue(posts.isEmpty)
        await c.confirm();c.cancelConfirmation();await c.send();XCTAssertTrue(posts.isEmpty)
        await c.confirm();await c.send();XCTAssertEqual(c.view.operation?.phase,.uncertain);let key=stored?.key
        var changed=proposal();changed.title="Not approved";await c.preview(changed);XCTAssertEqual(c.view.operation?.proposal,proposal())
        c.invalidate();await c.open();await c.send();XCTAssertEqual(posts.count,2);XCTAssertEqual(posts[0],posts[1]);XCTAssertEqual(c.view.operation?.phase,.received);XCTAssertEqual(stored?.key,key)
        XCTAssertFalse(String(data:stored!.exportData!,encoding:.utf8)!.contains("token"))
        let d=IntakeProposalController(context:{b},route:{_ in self.route()},call:{_,_ in XCTFail("Save failure must prevent sending");throw IntakeFailure.invalidResponse},load:{_ in nil},save:{_ in if failSave{throw IntakeFailure.storage}},changed:{_ in})
        await d.preview(proposal());await d.confirm();failSave=true;await d.send();XCTAssertFalse(d.view.storageReady);XCTAssertEqual(d.view.operation?.proposal,proposal());XCTAssertNotNil(d.view.operation?.exportData);await d.open();XCTAssertEqual(d.view.operation?.proposal,proposal())
    }
    @MainActor func testRoutingAndLateThrowingAccountSwitchDenyWritesAndCopies()async throws {
        var current:IntakeBinding?=binding();var repo:String?=nil;var calls=0
        let c=IntakeProposalController(context:{current},route:{_ in IntakeRoute(configuredRepository:repo,repositories:["hypeproof/hypeproof-studio"],policyRevision:"p1")},call:{_,_ in calls+=1;current=self.binding("B");throw URLError(.timedOut)},load:{_ in nil},save:{_ in},changed:{_ in})
        await c.preview(proposal());await c.confirm();await c.send();XCTAssertEqual(calls,0);XCTAssertEqual(c.view.failure,.routing)
        repo="hypeproof/hypeproof-studio";await c.confirm();await c.send();XCTAssertEqual(calls,1);XCTAssertNil(c.view.operation)
    }
    @MainActor func testMCPNegotiationFractionalPolicyAndHTTP200ToolFailure()async throws {
        var methods:[String]=[];var toolError=false
        let client=try IntakeClient(origin:origin,token:{String(repeating:"t",count:43)},transport:{url,headers,data in
            let v=try JSONDecoder().decode(IntakeJSON.self,from:data),method=v["method"]!.string!;methods.append(method)
            XCTAssertEqual(headers["Authorization"],"Bearer "+String(repeating:"t",count:43))
            if method=="notifications/initialized" {return IntakeHTTPResponse(status:202,url:url,body:Data())}
            let result:IntakeJSON
            if method=="initialize" {result = .object(["protocolVersion":.string("2025-03-26"),"capabilities":.object(["tools":.object([:])])])}
            else {let value:IntakeJSON=toolError ? .object(["error":.string("intake_unavailable"),"message":.string("Do not print arbitrary text")]):.object(["policy":.object(["repositories":.array([.string("hypeproof/hypeproof-studio")])]),"ai_review":.object(["minimum_probability":.decimal(0.9)])]);result = .object(["content":.array([.object(["type":.string("text"),"text":.string(String(data:try IntakeWire.encode(value),encoding:.utf8)!)])]),"isError":.bool(toolError)])}
            return IntakeHTTPResponse(status:200,url:url,body:try IntakeWire.encode(IntakeJSON.object(["jsonrpc":.string("2.0"),"id":v["id"]!,"result":result])))
        })
        let policy=try await client.call("get_intake_policy");XCTAssertEqual(policy["ai_review"]?["minimum_probability"],.decimal(0.9));XCTAssertEqual(methods,["initialize","notifications/initialized","tools/call"])
        toolError=true;do{_ = try await client.call("submit_proposal");XCTFail()}catch{XCTAssertEqual(error as? IntakeFailure,.tool("intake_unavailable"))}
        do{_ = try await client.call("decide_proposal");XCTFail()}catch{XCTAssertEqual(error as? IntakeFailure,.invalidInput)}
    }
    @MainActor func testDevicePollingIntervalCancellationAndLostClaimRequiresFreshLogin()async throws {
        var now=Date(timeIntervalSince1970:1_800_000_000);var requests=0;var clear=0;var saved=0
        let auth=try IntakeDeviceAuth(origin:origin,studioIdentity:{"A:session1"},transport:{url,_,data in
            requests+=1;let body=try JSONDecoder().decode(IntakeJSON.self,from:data)
            if url.path.hasSuffix("start") {XCTAssertEqual(body["remember_device"],.bool(false));XCTAssertEqual(body["code_challenge"]?.string?.count,64);return IntakeHTTPResponse(status:200,url:url,body:try IntakeWire.encode(IntakeJSON.object(["device_code":.string(String(repeating:"d",count:43)),"user_code":.string("ABCD-1234"),"verification_uri":.string("https://hypeproof-ai.xyz/members/mcp?code=ABCD-1234"),"expires_in":.number(600),"interval":.number(5)])))}
            XCTAssertEqual(body["code_verifier"]?.string?.count,43);throw URLError(.networkConnectionLost)
        },now:{now},saveSecret:{_,_ in saved+=1},clearSecret:{clear+=1},changed:{_ in})
        try await auth.start();do{try await auth.poll();XCTFail()}catch{XCTAssertEqual(error as? IntakeFailure,.tooEarly)};XCTAssertEqual(requests,1)
        now=now.addingTimeInterval(5);do{try await auth.poll();XCTFail()}catch{};XCTAssertTrue(auth.view.needsFreshLogin);XCTAssertEqual(saved,0)
        do{try await auth.poll();XCTFail()}catch{XCTAssertEqual(error as? IntakeFailure,.cancelled)};XCTAssertEqual(requests,2)
        try await auth.start();try auth.cancel();XCTAssertNil(auth.view.verificationURL);XCTAssertGreaterThan(clear,1)
    }
    @MainActor func testReviseUnknownUsesReadBeforeCASAndKeepsExistingProposal()async throws {
        let b=binding();var old=IntakeOperation(binding:b,proposal:proposal());old.receipt=try JSONDecoder().decode(IntakeReceipt.self,from:IntakeWire.encode(receipt(proposal())));old.proposalID=old.receipt?.proposal_id;old.phase = .received
        var current=proposal(),revision=1,tools:[String]=[];var stored=old
        let c=IntakeProposalController(context:{b},route:{_ in self.route()},call:{name,_ in tools.append(name);if name=="revise_proposal"{current.title="Confirmed revision";revision=2;throw URLError(.timedOut)};return self.receipt(current,revision:revision)},load:{_ in stored},save:{stored=$0},changed:{_ in})
        await c.open();var next=proposal();next.title="Confirmed revision";await c.prepareExisting(proposal:next);await c.confirm();await c.send();XCTAssertEqual(c.view.operation?.phase,.uncertain)
        await c.send();XCTAssertEqual(tools,["get_proposal","revise_proposal","get_proposal"]);XCTAssertEqual(c.view.operation?.receipt?.revision,2);XCTAssertEqual(c.view.operation?.phase,.received)
    }
    @MainActor func testCancelledGenerationCannotRestoreOperationAfterSuspendedIdentity()async throws {
        let b=binding();var wait=false;var continuation:CheckedContinuation<IntakeBinding?,Never>?
        let c=IntakeProposalController(context:{if wait{return await withCheckedContinuation{continuation=$0}};return b},route:{_ in self.route()},call:{_,_ in XCTFail("Cancelled must not publish");throw IntakeFailure.invalidResponse},load:{_ in nil},save:{_ in},changed:{_ in})
        await c.preview(proposal());wait=true
        let task=Task {await c.confirm()}
        while continuation==nil {await Task.yield()}
        c.invalidate();continuation?.resume(returning:b);await task.value
        XCTAssertNil(c.view.operation);XCTAssertFalse(c.view.busy)
    }
    @MainActor func testDeviceURLAndExpiryValidationAndSeparateSecretReceipt()async throws {
        var now=Date(timeIntervalSince1970:1_800_000_000),identity="A";var invalidURL=true;var storedToken:String?,storedPrincipal:IntakePrincipal?
        let auth=try IntakeDeviceAuth(origin:origin,studioIdentity:{identity},transport:{url,_,_ in
            if url.path.hasSuffix("start") {return IntakeHTTPResponse(status:200,url:url,body:try IntakeWire.encode(IntakeJSON.object(["device_code":.string(String(repeating:"d",count:43)),"user_code":.string("ABCD-1234"),"verification_uri":.string(invalidURL ? "https://attacker.example/members/mcp?code=ABCD-1234":"https://hypeproof-ai.xyz/members/mcp?code=ABCD-1234"),"expires_in":.number(600),"interval":.number(5)])))}
            return IntakeHTTPResponse(status:200,url:url,body:try IntakeWire.encode(IntakeJSON.object(["status":.string("approved"),"token":.string(String(repeating:"s",count:43)),"member":.object(["id":.string(self.principalID),"endpoint":.string(self.origin+"/mcp"),"expires_at":.string(ISO8601DateFormatter().string(from:now.addingTimeInterval(28800)))])])))
        },now:{now},saveSecret:{storedPrincipal=$0;storedToken=$1},clearSecret:{storedToken=nil;storedPrincipal=nil},changed:{_ in})
        do{try await auth.start();XCTFail()}catch{XCTAssertEqual(error as? IntakeFailure,.invalidResponse)};XCTAssertNil(auth.view.verificationURL)
        invalidURL=false;try await auth.start();now=now.addingTimeInterval(601)
        do{try await auth.poll();XCTFail()}catch{XCTAssertEqual(error as? IntakeFailure,.expired)};XCTAssertNil(storedToken)
        try await auth.start();now=now.addingTimeInterval(5);try await auth.poll();XCTAssertEqual(storedToken,String(repeating:"s",count:43));XCTAssertEqual(storedPrincipal?.id,principalID)
        XCTAssertFalse(String(data:try IntakeWire.encode(storedPrincipal!),encoding:.utf8)!.contains(String(repeating:"s",count:43)))
        try await auth.start();identity="B";now=now.addingTimeInterval(5)
        do{try await auth.poll();XCTFail()}catch{XCTAssertEqual(error as? IntakeFailure,.identityChanged)};XCTAssertNil(auth.view.code);XCTAssertNil(storedToken)
    }
    @MainActor func testPublishedReceiptRetryKeepsIssueAndRejectsForeignRepository()async throws {
        let b=binding();var data=receipt(proposal(),state:"issued")
        guard case .object(var object)=data else{return}
        object["publication"] = .object(["state":.string("issue_created"),"issue_url":.string("https://github.com/hypeproof/hypeproof-studio/issues/123"),"issue_number":.number(123),"project_item_id":.null,"project_url":.string("https://github.com/orgs/hypeproof/projects/4"),"problem":.string("Board pending"),"next_action":.string("Reconcile board")]);data = .object(object)
        let r=try JSONDecoder().decode(IntakeReceipt.self,from:IntakeWire.encode(data));try r.validate(binding:b);XCTAssertNotNil(r.issueURL);XCTAssertFalse(r.boardComplete)
        var old=IntakeOperation(binding:b,proposal:proposal());old.phase = .received;old.receipt=r;old.proposalID=r.proposal_id;var calls:[String]=[]
        let c=IntakeProposalController(context:{b},route:{_ in self.route()},call:{name,_ in calls.append(name);return data},load:{_ in old},save:{_ in},changed:{_ in})
        await c.open();await c.prepareExisting(retryPublication:true);await c.confirm();await c.send();XCTAssertEqual(calls,["get_proposal","retry_publication"]);XCTAssertEqual(c.view.operation?.receipt?.issueURL,r.issueURL)
        object["publication"] = .object(["state":.string("issue_created"),"issue_url":.string("https://github.com/hypeproof/other/issues/123"),"issue_number":.number(123),"next_action":.string("Mismatch")])
        let bad=try JSONDecoder().decode(IntakeReceipt.self,from:IntakeWire.encode(IntakeJSON.object(object)));XCTAssertThrowsError(try bad.validate(binding:b))
    }

    @MainActor func testExplicitSamePrincipalReloginRecoveryPreservesOriginalApproval()async throws {
        let original=binding();var current=original,stored:IntakeOperation?,calls:[IntakeJSON]=[]
        let c=IntakeProposalController(context:{current},route:{actual in XCTAssertEqual(actual,current);return self.route()},call:{_,args in calls.append(args);if calls.count==1{throw URLError(.timedOut)};return self.receipt(self.proposal())},load:{_ in stored},save:{stored=$0},changed:{_ in})
        await c.preview(proposal());await c.confirm();await c.send();let approval=stored!.approvalDigest
        c.invalidate();current=IntakeBinding(studioAccountID:"A",studioSessionEpoch:"renewed",principal:IntakePrincipal(id:principalID,endpoint:origin+"/mcp",expiresAt:Date().addingTimeInterval(1000)),requestID:original.requestID,sourceRevision:2,sourceTextRevision:2)
        await c.open();XCTAssertNil(c.view.operation);await c.send();XCTAssertEqual(calls.count,1)
        await c.recoverForCurrentSession();XCTAssertEqual(c.view.operation?.binding,original);XCTAssertEqual(c.view.operation?.approvalDigest,approval)
        await c.send();XCTAssertEqual(calls.count,2);XCTAssertEqual(calls[0],calls[1]);XCTAssertEqual(c.view.operation?.phase,.received)
        c.invalidate();current=binding("B");await c.recoverForCurrentSession();XCTAssertNil(c.view.operation);XCTAssertEqual(calls.count,2)
    }

}
