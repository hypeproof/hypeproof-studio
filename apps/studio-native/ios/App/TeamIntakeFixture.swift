#if DEBUG
import Foundation
@MainActor enum TeamIntakeFixture {
    static var enabled: Bool { TeamEntryFixture.enabled && ProcessInfo.processInfo.environment["HP_TEAM_INTAKE"] != nil }
    static private(set) var keys: [String] = []
    static private var proposal: IntakeJSON?
    static private var starts = 0, polls = 0
    static var trace: String { String(data: (try? JSONSerialization.data(withJSONObject: ["posts":keys.count,"keys":keys,"starts":starts,"polls":polls])) ?? Data(), encoding:.utf8) ?? "" }
    static func send(_ url: URL, headers: [String:String], body: Data) async throws -> IntakeHTTPResponse {
        let value = try JSONDecoder().decode(IntakeJSON.self, from:body)
        func response(_ value:IntakeJSON, _ status:Int = 200)throws->IntakeHTTPResponse { .init(status:status,url:url,body:try IntakeWire.encode(value)) }
        if url.path.hasSuffix("/start") { starts += 1; return try response(.object(["device_code":.string(String(repeating:"d",count:43)),"user_code":.string("ABCD-1234"),"verification_uri":.string("https://hypeproof-ai.xyz/members/mcp?code=ABCD-1234"),"expires_in":.number(600),"interval":.number(1)])) }
        if url.path.hasSuffix("/poll") { polls += 1; return try response(.object(["status":.string("approved"),"token":.string(String(repeating:"t",count:43)),"member":.object(["id":.string("lab-11111111-1111-4111-8111-111111111111"),"endpoint":.string("https://team-entry.invalid/mcp"),"expires_at":.string(ISO8601DateFormatter().string(from:Date().addingTimeInterval(3600)))])])) }
        if value["method"]?.string == "notifications/initialized" { return try response(.null,202) }
        let id = value["id"] ?? .number(0)
        func rpc(_ result:IntakeJSON)throws->IntakeHTTPResponse { try response(.object(["jsonrpc":.string("2.0"),"id":id,"result":result])) }
        if value["method"]?.string == "initialize" { return try rpc(.object(["protocolVersion":.string("2025-03-26"),"capabilities":.object(["tools":.object([:])])])) }
        let tool = value["params"]?["name"]?.string, args = value["params"]?["arguments"]
        var output:IntakeJSON
        if tool == "get_intake_policy" { output = .object(["policy":.object(["revision":.string("fixture-policy/1"),"repositories":.array([.string("hypeproof/hypeproof-studio")])])]) }
        else {
            if tool == "submit_proposal" {
                guard let key = args?["request_key"]?.string, let submitted = args?["proposal"] else { throw IntakeFailure.invalidInput }
                keys.append(key)
                if let proposal, proposal != submitted { throw IntakeFailure.conflict }; proposal = submitted
                if ProcessInfo.processInfo.environment["HP_TEAM_INTAKE"] == "unknown", keys.count == 1 { return try response(.object(["error":.string("unavailable")]),503) }
            }
            guard let proposal else { throw IntakeFailure.invalidResponse }
            output = .object(["proposal_id":.string("HP-11111111-1111-4111-8111-111111111111"),"revision":.number(1),"owner_id":.string("lab-11111111-1111-4111-8111-111111111111"),"state":.string("issued"),"draft":proposal,"feedback":.object(["outcome":.string("new_work"),"reason":.string("공개 요청을 생성했어요."),"questions":.array([]),"next_action":.string("기존 요청에서 진행 상황을 확인하세요."),"policy_revision":.string("fixture-policy/1")]),"publication":.object(["state":.string("issue_created"),"issue_url":.string("https://github.com/hypeproof/hypeproof-studio/issues/4381"),"issue_number":.number(4381),"project_item_id":.null,"project_url":.null,"problem":.null,"next_action":.string("프로젝트 연결 확인 대기")])])
        }
        return try rpc(.object(["content":.array([.object(["type":.string("text"),"text":.string(String(data:try IntakeWire.encode(output),encoding:.utf8)!)])])]))
    }
}
#endif
