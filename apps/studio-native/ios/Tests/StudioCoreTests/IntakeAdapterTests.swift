import XCTest
import Security
@testable import StudioCore

private final class IntakeProtocol:URLProtocol,@unchecked Sendable {
    static let lock=NSLock()
    static var handler:((IntakeProtocol)->Void)?
    static var started=0,stopped=0
    override class func canInit(with request:URLRequest)->Bool{true}
    override class func canonicalRequest(for request:URLRequest)->URLRequest{request}
    override func startLoading(){Self.lock.lock();Self.started+=1;let handler=Self.handler;Self.lock.unlock();handler?(self)}
    override func stopLoading(){Self.lock.lock();Self.stopped+=1;Self.lock.unlock()}
    static func setup(_ handler:@escaping (IntakeProtocol)->Void){lock.lock();self.handler=handler;started=0;stopped=0;lock.unlock()}
    func response(_ status:Int=200,length:Int?=nil){var h=["Content-Type":"application/json"];if let length{h["Content-Length"]=String(length)};client?.urlProtocol(self,didReceive:HTTPURLResponse(url:request.url!,statusCode:status,httpVersion:"HTTP/1.1",headerFields:h)!,cacheStoragePolicy:.notAllowed)}
    func data(_ data:Data){client?.urlProtocol(self,didLoad:data)}
    func finish(){client?.urlProtocolDidFinishLoading(self)}
}
final class IntakeAdapterTests:XCTestCase {
    let origin="https://service.example"
    @MainActor func testExactEndpointAndHeadersBeforeTransportAndBoundedStreaming()async throws {
        let t=try IntakeURLSessionTransport(origin:origin,protocolClasses:[IntakeProtocol.self]);let url=URL(string:origin+"/mcp")!,headers=["Content-Type":"application/json","Authorization":"Bearer "+String(repeating:"a",count:43)]
        IntakeProtocol.setup{p in XCTAssertEqual(p.request.httpMethod,"POST");XCTAssertEqual(p.request.value(forHTTPHeaderField:"Authorization"),headers["Authorization"]);p.response();p.data(Data("{}".utf8));p.finish()}
        let good=try await t.send(url,headers:headers,body:Data("{}".utf8));XCTAssertEqual(good.body,Data("{}".utf8))
        for bad in ["https://attacker.example/mcp",origin+"/mcp?redirect=yes",origin+"/mcp-auth/device/approve"] {do{_ = try await t.send(URL(string:bad)!,headers:headers,body:Data());XCTFail()}catch{XCTAssertEqual(error as? IntakeFailure,.invalidInput)}}
        XCTAssertEqual(IntakeProtocol.started,1)
        IntakeProtocol.setup{p in p.response();p.data(Data(repeating:65,count:131072));p.data(Data(repeating:66,count:131073));p.finish()}
        do{_ = try await t.send(url,headers:headers,body:Data());XCTFail("Streaming overflow must reject") }catch{XCTAssertEqual(error as? IntakeFailure,.invalidResponse)}
    }
    @MainActor func testRedirectRefusalAndCallerCancellation()async throws {
        let t=try IntakeURLSessionTransport(origin:origin,protocolClasses:[IntakeProtocol.self]);let url=URL(string:origin+"/mcp")!,headers=["Content-Type":"application/json"]
        IntakeProtocol.setup{p in
            let response=HTTPURLResponse(url:p.request.url!,statusCode:307,httpVersion:"HTTP/1.1",headerFields:["Location":"https://attacker.example/mcp"])!
            p.client?.urlProtocol(p,wasRedirectedTo:URLRequest(url:URL(string:"https://attacker.example/mcp")!),redirectResponse:response)
        }
        do{_ = try await t.send(url,headers:headers,body:Data());XCTFail()}catch{XCTAssertEqual(error as? IntakeFailure,.invalidResponse)}
        XCTAssertEqual(IntakeProtocol.started,1)
        IntakeProtocol.setup{_ in /* Deliberately waits until cancellation. */}
        let task=Task{try await t.send(url,headers:headers,body:Data())}
        while IntakeProtocol.started==0{await Task.yield()};task.cancel()
        do{_ = try await task.value;XCTFail()}catch{XCTAssertTrue(error is CancellationError)}
        let cancelled=Task{try await t.send(url,headers:headers,body:Data())};cancelled.cancel()
        do{_ = try await cancelled.value;XCTFail()}catch{XCTAssertTrue(error is CancellationError)}
    }
    func testKeychainSeparateScopeExpiryAndStorageFailures()throws {
        var items:[String:Data]=[:],fail=false;var queries:[[String:Any]]=[]
        func key(_ q:[String:Any])->String{(q[kSecAttrService as String] as? String ?? "")+":"+(q[kSecAttrAccount as String] as? String ?? "")}
        let operations=IntakeKeychain.Operations(read:{q in queries.append(q);if fail{return(errSecInteractionNotAllowed,nil)};return items[key(q)].map{(errSecSuccess,$0)} ?? (errSecItemNotFound,nil)},update:{q,v in queries.append(q);if fail{return errSecInteractionNotAllowed};guard items[key(q)] != nil else{return errSecItemNotFound};items[key(q)]=v[kSecValueData as String] as? Data;return errSecSuccess},add:{q in queries.append(q);XCTAssertEqual(q[kSecAttrAccessible as String] as? String,kSecAttrAccessibleWhenUnlockedThisDeviceOnly as String);items[key(q)]=q[kSecValueData as String] as? Data;return errSecSuccess},delete:{q in queries.append(q);if fail{return errSecInteractionNotAllowed};if q[kSecAttrAccount as String]==nil {items=items.filter{!$0.key.hasPrefix((q[kSecAttrService as String] as! String)+":")}}else{items.removeValue(forKey:key(q))};return errSecSuccess})
        let a=try IntakeKeychain(studioAccountID:"A",origin:origin,operations:operations),b=try IntakeKeychain(studioAccountID:"B",origin:origin,operations:operations)
        let now=Date(timeIntervalSince1970:1_800_000_000),id="lab-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",other="lab-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",secret=String(repeating:"s",count:43)
        let principal=IntakePrincipal(id:id,endpoint:origin+"/mcp",expiresAt:now.addingTimeInterval(100))
        try a.save(principal:principal,token:secret,now:now);XCTAssertEqual(try a.read(principalID:id,now:now)?.bearer(now:now),secret);XCTAssertNil(try b.read(principalID:id,now:now));XCTAssertNil(try a.read(principalID:other,now:now))
        fail=true;XCTAssertThrowsError(try a.removeAllForStudioAccount());XCTAssertThrowsError(try a.read(principalID:id,now:now));fail=false
        XCTAssertNil(try a.read(principalID:id,now:now.addingTimeInterval(101)));XCTAssertTrue(items.isEmpty)
        XCTAssertTrue(queries.allSatisfy{($0[kSecAttrService as String] as? String)?.hasPrefix("ai.hypeproof.studio.mobile.intake.")==true})
        XCTAssertFalse(queries.contains{($0[kSecAttrService as String] as? String)=="ai.hypeproof.studio.mobile.account"})
    }
}
