import Foundation
import XCTest
@testable import StudioCore

final class TeamDiscussionTests: XCTestCase {
    let request = "trq_" + String(repeating: "a", count: 32)
    let commentID = "tcm_" + String(repeating: "b", count: 32)
    func comment(request: String? = nil, body: String = "Original question", key: String = "old-key") -> TeamRequestComment {
        .init(id: commentID, request_id: request ?? self.request, account_id: "A", client_comment_id: key, body: body, created_at: 1000, intent: "question", reply_to: nil)
    }
    func testLegacyUnknownDraftKeepsExactSchemaKeyAndPayloadAcrossUpgrade() throws {
        let key = UUID().uuidString.lowercased()
        let old: [String:Any] = ["accountID":"A", "requestID":request, "key":key, "body":"Uncertain old comment", "phase":"uncertain"]
        let draft = try JSONDecoder().decode(TeamCommentDraft.self, from: JSONSerialization.data(withJSONObject: old))
        try draft.validate(account: "A", request: request)
        let payload = try draft.payload()
        XCTAssertEqual(payload as? [String:String], ["schema":"hps-team-comment/1", "client_comment_id":key, "body":"Uncertain old comment"])
        XCTAssertThrowsError(try draft.choosing("question", reply:nil, loadedComments:[]))
        let reopened = try JSONDecoder().decode(TeamCommentDraft.self, from: JSONEncoder().encode(draft))
        XCTAssertEqual(try reopened.payload() as? [String:String], payload as? [String:String])
        XCTAssertThrowsError(try reopened.validate(account:"B", request:request))
    }
    func testExplicitQuestionAndReplyRequireSameRequestTargetsAndFreezeUncertainPayload() throws {
        var old = TeamCommentDraft(accountID:"A", requestID:request); old.body = "Keep my words"
        let question = try old.choosing("question", reply:nil, loadedComments:[])
        XCTAssertNotEqual(old.key, question.key); XCTAssertEqual(question.body, old.body)
        XCTAssertTrue(try question.payload()["reply_to"] is NSNull)
        XCTAssertThrowsError(try old.choosing("reply", reply:commentID, loadedComments:[comment(request:"trq_" + String(repeating:"c",count:32))]))
        var reply = try old.choosing("reply", reply:commentID, loadedComments:[comment()]); reply.phase = .uncertain
        let frozen = try JSONSerialization.data(withJSONObject:reply.payload(), options:.sortedKeys)
        XCTAssertThrowsError(try reply.choosing("discussion", reply:nil, loadedComments:[]))
        let reopened = try JSONDecoder().decode(TeamCommentDraft.self, from: JSONEncoder().encode(reply))
        XCTAssertEqual(try JSONSerialization.data(withJSONObject:reopened.payload(), options:.sortedKeys), frozen)
        XCTAssertEqual(reopened.wireSchema,"hps-team-comment/2")
    }
    func testOnlyDefinitiveMissingTargetAllowsExplicitFreshKeyWithPreservedWords() throws {
        var base = TeamCommentDraft(accountID:"A",requestID:request); base.body="Keep this reply"
        var pending = try base.choosing("reply",reply:commentID,loadedComments:[comment()]); pending.phase = .uncertain
        let payload = try JSONSerialization.data(withJSONObject:pending.payload(),options:.sortedKeys)
        XCTAssertFalse(pending.recordDefinitiveRejection("generic_conflict")); XCTAssertThrowsError(try pending.freshReplyChoice())
        XCTAssertTrue(pending.recordDefinitiveRejection("team_reply_target_unavailable"))
        let restored = try JSONDecoder().decode(TeamCommentDraft.self,from:JSONEncoder().encode(pending))
        XCTAssertEqual(try JSONSerialization.data(withJSONObject:restored.payload(),options:.sortedKeys),payload)
        let next = try restored.freshReplyChoice(); XCTAssertNotEqual(next.key,pending.key); XCTAssertEqual(next.body,pending.body); XCTAssertEqual(next.phase,.draft); XCTAssertNil(next.replyTo); XCTAssertThrowsError(try next.payload())
        let chosen = try next.choosing("reply",reply:request,loadedComments:[]); XCTAssertEqual(try chosen.payload()["reply_to"] as? String,request)
        XCTAssertTrue(pending.recordDefinitiveRejection("team_content_expired")); XCTAssertThrowsError(try pending.freshReplyChoice())
    }
    func testDiscoveryAndRenderedIntentRejectMalformedContractsWithoutInferringStatus() throws {
        XCTAssertEqual(try TeamCommentSupport.schemas(nil), ["hps-team-comment/1"])
        XCTAssertEqual(try TeamCommentSupport.schemas([]), [])
        XCTAssertEqual(try TeamCommentSupport.schemas(["hps-team-comment/1","hps-team-comment/2","hps-team-comment/3"]),["hps-team-comment/1","hps-team-comment/2"])
        XCTAssertThrowsError(try TeamCommentSupport.schemas(["hps-team-comment/2","hps-team-comment/2"]))
        var row = comment(); try row.validate(request:request)
        row.intent = "reply"; XCTAssertThrowsError(try row.validate(request:request))
        row.reply_to = request; try row.validate(request:request)
        row.reply_to = "trq_" + String(repeating:"c",count:32); XCTAssertThrowsError(try row.validate(request:request))
        row.intent = nil; row.reply_to = nil; XCTAssertEqual(row.discussionIntent,"discussion")
    }
    func testPurgeBetweenPagesDropsOldContentAndReconcilesFirstPageReceipt() throws {
        var acknowledged = TeamCommentDraft(accountID:"A", requestID:request)
        acknowledged.body = "Private page one"; acknowledged.phase = .received; acknowledged.receipt = commentID
        let record = TeamRequestRecord(id:request, account_id:"A", client_request_id:"key", product:"studio", category:"bug", body:"Original", notice_version:"test", status:"submitted", revision:1, created_at:1000, updated_at:1000)
        let first = TeamRequestDetail(request:record,comments:[comment(body:acknowledged.body,key:acknowledged.key)],next_comments_cursor:"1000:" + commentID)
        let mark = TeamCommentRetention(policy:"90_days_after_reporter_confirmation",purge_implemented:true,content_purged_at:2000,purged_outcome_revision:2)
        var second = TeamRequestDetail(request:record,comments:[],next_comments_cursor:nil); second.retention = mark
        var history = TeamCommentHistory(); XCTAssertTrue(try history.accept(first,more:false)); XCTAssertTrue(history.canDisplay(acknowledged))
        XCTAssertFalse(try history.accept(second,more:true)); XCTAssertTrue(history.comments.isEmpty); XCTAssertNil(history.detail); XCTAssertFalse(history.canDisplay(acknowledged))
        XCTAssertThrowsError(try history.accept(first,more:false),"An older first page cannot restore private content after a known purge.")
        var fresh = TeamRequestDetail(request:record,comments:[comment(body:"보관 기간이 지나 내용이 삭제됐어요.",key:acknowledged.key)],next_comments_cursor:nil); fresh.retention = mark
        XCTAssertTrue(try history.accept(fresh,more:false)); XCTAssertFalse(history.comments.contains { $0.body == "Private page one" })
        var uncertain = acknowledged; uncertain.phase = .uncertain; uncertain.receipt = nil
        XCTAssertTrue(history.canDisplay(uncertain)); XCTAssertFalse(uncertain.observeTombstone(fresh)); XCTAssertEqual(uncertain.body,"Private page one")
        XCTAssertTrue(acknowledged.observeTombstone(try XCTUnwrap(history.detail))); XCTAssertEqual(acknowledged.body,""); XCTAssertTrue(history.canDisplay(acknowledged))
    }
    func testServerTombstoneScrubsOnlyMatchingAcknowledgedCommentNeverUncertainDraft() throws {
        var draft = TeamCommentDraft(accountID:"A",requestID:request); draft.body="Private retained text"; draft.phase = .uncertain
        let record = TeamRequestRecord(id:request, account_id:"A", client_request_id:"key", product:"studio", category:"bug", body:"Original", notice_version:"test", status:"submitted", revision:1, created_at:1000, updated_at:1000)
        var detail = TeamRequestDetail(request:record, comments:[comment(body:"보관 기간이 지나 내용이 삭제됐어요.", key:draft.key)], next_comments_cursor:nil)
        detail.retention = .init(policy:"90_days_after_reporter_confirmation",purge_implemented:true,content_purged_at:2000,purged_outcome_revision:1)
        try detail.validate(id:request)
        XCTAssertFalse(draft.observeTombstone(detail)); XCTAssertEqual(draft.body,"Private retained text")
        draft.phase = .received; draft.receipt = commentID
        XCTAssertTrue(draft.observeTombstone(detail)); XCTAssertEqual(draft.body,""); XCTAssertEqual(draft.receipt,commentID)
    }
}
