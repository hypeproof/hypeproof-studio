import Foundation

public enum IntakeFailure: Error, Equatable { case invalidResponse, invalidInput, identityChanged, expired, cancelled, pending, tooEarly, storage, confirmationRequired, routing, conflict, tool(String), http(Int), rpc(Int) }
public enum IntakeJSON: Codable, Equatable, Sendable {
    case object([String:IntakeJSON]), array([IntakeJSON]), string(String), number(Int), decimal(Double), bool(Bool), null
    public init(from decoder: Decoder) throws { let c=try decoder.singleValueContainer(); if c.decodeNil(){self = .null} else if let b=try? c.decode(Bool.self){self = .bool(b)} else if let n=try? c.decode(Int.self){self = .number(n)} else if let d=try? c.decode(Double.self),d.isFinite{self = .decimal(d)} else if let s=try? c.decode(String.self){self = .string(s)} else if let a=try? c.decode([Self].self){self = .array(a)} else {self = .object(try c.decode([String:Self].self))} }
    public func encode(to encoder: Encoder) throws { var c=encoder.singleValueContainer(); switch self {case .null:try c.encodeNil();case .bool(let x):try c.encode(x);case .number(let x):try c.encode(x);case .decimal(let x):guard x.isFinite else{throw IntakeFailure.invalidInput};try c.encode(x);case .string(let x):try c.encode(x);case .array(let x):try c.encode(x);case .object(let x):try c.encode(x)} }
    public subscript(_ key:String)->Self? {if case .object(let o)=self{return o[key]};return nil}
    public var string:String? {if case .string(let s)=self{return s};return nil}
    public var int:Int? {if case .number(let n)=self{return n};return nil}
    public var array:[Self]? {if case .array(let a)=self{return a};return nil}
}
public struct IntakeHTTPResponse: Sendable {
    public let status:Int, url:URL, body:Data
    public init(status:Int,url:URL,body:Data){self.status=status;self.url=url;self.body=body}
}
/// Adapter must reject redirects BEFORE following them and bound response streaming to 256 KiB.
/// The final URL check is defense in depth, not permission to forward credentials on redirects.
public typealias IntakeTransport = @MainActor (URL, [String:String], Data) async throws -> IntakeHTTPResponse
public enum IntakeWire {
    public static func origin(_ value:String)throws->URL {guard let u=URL(string:value),u.scheme=="https",u.host != nil,u.user==nil,u.password==nil,u.query==nil,u.fragment==nil,u.path.isEmpty || u.path=="/", u.absoluteString.trimmingCharacters(in:CharacterSet(charactersIn:"/"))==value else{throw IntakeFailure.invalidInput};return u}
    public static func encode<T:Encodable>(_ value:T)throws->Data {let e=JSONEncoder();e.outputFormatting=[.sortedKeys,.withoutEscapingSlashes];return try e.encode(value)}
    public static func json(_ response:IntakeHTTPResponse,url:URL)throws->IntakeJSON {guard response.url==url,response.body.count<=262144 else{throw IntakeFailure.invalidResponse};guard (200..<300).contains(response.status) else{throw IntakeFailure.http(response.status)};return try JSONDecoder().decode(IntakeJSON.self,from:response.body)}
    static func matches(_ s:String,_ regex:String)->Bool {s.range(of:regex,options:.regularExpression) != nil}
}
/// Stateless MCP client. No secret is Codable or included in a result/error description.
@MainActor public final class IntakeClient {
    private let endpoint:URL, token:()->String?, transport:IntakeTransport
    private var protocolVersion:String?, counter=0, generation=0
    public init(origin:String,token:@escaping ()->String?,transport:@escaping IntakeTransport)throws {endpoint=try IntakeWire.origin(origin).appendingPathComponent("mcp");self.token=token;self.transport=transport}
    public func invalidate(){generation+=1;protocolVersion=nil}
    private static func toolCallBody(_ tool:String,arguments:IntakeJSON,id:Int)throws->Data {
        let body=try IntakeWire.encode(IntakeJSON.object(["jsonrpc":.string("2.0"),"id":.number(id),"method":.string("tools/call"),"params":.object(["name":.string(tool),"arguments":arguments])]))
        guard body.count<=65536 else{throw IntakeFailure.invalidInput};return body
    }
    /// Same encoder as the actual transport, using the largest possible request ID.
    /// Call BEFORE a durable operation becomes uncertain; local size refusal did not send.
    public static func preflightToolCall(_ tool:String,arguments:IntakeJSON)throws { _ = try toolCallBody(tool,arguments:arguments,id:Int.max) }
    private func exchange(method:String,params:IntakeJSON,id:Int?)async throws->IntakeJSON? {
        let g=generation
        guard let bearer=token(),IntakeWire.matches(bearer,"^[A-Za-z0-9_-]{43,128}$") else{throw IntakeFailure.expired}
        var envelope:[String:IntakeJSON] = ["jsonrpc":.string("2.0"),"method":.string(method),"params":params];if let id{envelope["id"] = .number(id)}
        let data:Data
        if method=="tools/call" {guard let tool=params["name"]?.string,let arguments=params["arguments"],let id else{throw IntakeFailure.invalidInput};data=try Self.toolCallBody(tool,arguments:arguments,id:id)}
        else {data=try IntakeWire.encode(IntakeJSON.object(envelope))}
        guard data.count<=65536 else{throw IntakeFailure.invalidInput}
        var headers=["Authorization":"Bearer "+bearer,"Content-Type":"application/json","Accept":"application/json, text/event-stream"];if let protocolVersion{headers["MCP-Protocol-Version"]=protocolVersion}
        let r=try await transport(endpoint,headers,data)
        guard generation==g,token()==bearer else{throw IntakeFailure.identityChanged}
        guard r.url==endpoint,r.body.count<=262144 else{throw IntakeFailure.invalidResponse}
        if id==nil {guard r.status==202 || r.status==204 else{throw IntakeFailure.invalidResponse};return nil}
        let v=try IntakeWire.json(r,url:endpoint);guard v["jsonrpc"]?.string=="2.0",v["id"]?.int==id else{throw IntakeFailure.invalidResponse}
        if let error=v["error"] {guard let code=error["code"]?.int else{throw IntakeFailure.invalidResponse};throw IntakeFailure.rpc(code)}
        guard let result=v["result"] else{throw IntakeFailure.invalidResponse};return result
    }
    public func initialize()async throws {
        counter+=1
        let result=try await exchange(method:"initialize",params:.object(["protocolVersion":.string("2025-03-26"),"capabilities":.object([:]),"clientInfo":.object(["name":.string("HP Studio iOS"),"version":.string("1")])]),id:counter)
        guard let version=result?["protocolVersion"]?.string,["2024-11-05","2025-03-26","2025-06-18"].contains(version),result?["capabilities"]?["tools"] != nil else{throw IntakeFailure.invalidResponse}
        protocolVersion=version
        do {_ = try await exchange(method:"notifications/initialized",params:.object([:]),id:nil)} catch {protocolVersion=nil;throw error}
    }
    public func call(_ tool:String,arguments:IntakeJSON = .object([:]))async throws->IntakeJSON {
        guard ["get_intake_policy","submit_proposal","get_proposal","revise_proposal","retry_publication"].contains(tool) else{throw IntakeFailure.invalidInput}
        if protocolVersion==nil{try await initialize()};counter+=1
        guard let result=try await exchange(method:"tools/call",params:.object(["name":.string(tool),"arguments":arguments]),id:counter),let content=result["content"]?.array,content.count==1,content[0]["type"]?.string=="text",let text=content[0]["text"]?.string,let data=text.data(using:.utf8),data.count<=262144 else{throw IntakeFailure.invalidResponse}
        let value=try JSONDecoder().decode(IntakeJSON.self,from:data)
        if result["isError"] == .bool(true) {guard let code=value["error"]?.string,IntakeWire.matches(code,"^[a-z_]{1,80}$") else{throw IntakeFailure.invalidResponse};throw IntakeFailure.tool(code)}
        guard result["isError"]==nil || result["isError"] == .bool(false) else{throw IntakeFailure.invalidResponse};return value
    }
}
