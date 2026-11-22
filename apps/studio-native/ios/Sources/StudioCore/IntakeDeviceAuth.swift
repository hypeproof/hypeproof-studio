import Foundation
import CryptoKit
import Security

/// Public identity only. Access token/verifier/device code are deliberately not Codable.
public struct IntakePrincipal: Codable, Equatable, Sendable {
    public let id:String, endpoint:String, expiresAt:Date
    public init(id:String,endpoint:String,expiresAt:Date){self.id=id;self.endpoint=endpoint;self.expiresAt=expiresAt}
    public func validate(origin:String,now:Date)throws {guard IntakeWire.matches(id,"^lab-[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$"),endpoint==origin+"/mcp",expiresAt>now,expiresAt.timeIntervalSince(now)<=28860 else{throw IntakeFailure.invalidResponse}}
}
@MainActor public final class IntakeDeviceAuth {
    public struct View: Equatable {public var code:String?, verificationURL:URL?, expiresAt:Date?, nextPollAt:Date?, principal:IntakePrincipal?;public var busy=false;public var needsFreshLogin=false}
    public private(set) var view=View()
    private let origin:String, transport:IntakeTransport, now:()->Date, studioIdentity:()->String?
    /// The app supplies a separately scoped Keychain adapter. Never use a draft/export store.
    private let saveSecret:(IntakePrincipal,String)throws->Void, clearSecret:()throws->Void
    private let changed:(View)->Void
    private var verifier:String?, deviceCode:String?, binding:String?, nextPoll=Date.distantPast, interval=5.0, generation=0
    public init(origin:String,studioIdentity:@escaping ()->String?,transport:@escaping IntakeTransport,now:@escaping ()->Date = Date.init,saveSecret:@escaping (IntakePrincipal,String)throws->Void,clearSecret:@escaping ()throws->Void,changed:@escaping (View)->Void)throws {
        _ = try IntakeWire.origin(origin);self.origin=origin;self.studioIdentity=studioIdentity;self.transport=transport;self.now=now;self.saveSecret=saveSecret;self.clearSecret=clearSecret;self.changed=changed
    }
    public func cancel()throws {generation+=1;verifier=nil;deviceCode=nil;binding=nil;view=View();changed(view);try clearSecret()}
    private func admitted(_ g:Int,_ b:String)throws {guard generation==g,studioIdentity()==b else{if generation==g{try? cancel()};throw IntakeFailure.identityChanged}}
    public func start()async throws {
        guard !view.busy,let b=studioIdentity(),!b.isEmpty else{throw IntakeFailure.identityChanged}
        try cancel();binding=b;let g=generation;let startedAt=now()
        var bytes=[UInt8](repeating:0,count:32);guard SecRandomCopyBytes(kSecRandomDefault,bytes.count,&bytes)==errSecSuccess else{throw IntakeFailure.invalidResponse}
        let secret=Data(bytes).base64EncodedString().replacingOccurrences(of:"+",with:"-").replacingOccurrences(of:"/",with:"_").replacingOccurrences(of:"=",with:"")
        let challenge=SHA256.hash(data:Data(secret.utf8)).map{String(format:"%02x",$0)}.joined()
        view.busy=true;changed(view)
        do {
            let url=URL(string:origin+"/mcp-auth/device/start")!
            let body=try IntakeWire.encode(IntakeJSON.object(["code_challenge":.string(challenge),"client_name":.string("HP Studio iOS"),"remember_device":.bool(false)]))
            let response=try await transport(url,["Content-Type":"application/json"],body);try admitted(g,b)
            let value=try IntakeWire.json(response,url:url)
            guard response.status==200,let device=value["device_code"]?.string,IntakeWire.matches(device,"^[A-Za-z0-9_-]{43,128}$"),let code=value["user_code"]?.string,IntakeWire.matches(code,"^[A-Z0-9]{4}-[A-Z0-9]{4}$"),let uri=value["verification_uri"]?.string,uri=="https://hypeproof-ai.xyz/members/mcp?code="+code,let ttl=value["expires_in"]?.int,(1...600).contains(ttl),let seconds=value["interval"]?.int,(1...600).contains(seconds) else{throw IntakeFailure.invalidResponse}
            verifier=secret;deviceCode=device;interval=Double(seconds);nextPoll=now().addingTimeInterval(interval)
            view.nextPollAt=nextPoll;view.code=code;view.verificationURL=URL(string:uri);view.expiresAt=startedAt.addingTimeInterval(Double(ttl));view.busy=false;changed(view)
        }catch {if generation==g{verifier=nil;deviceCode=nil;view=View();changed(view)};throw error}
    }
    /// Caller schedules this at the advertised interval. No detached or automatic retry loop.
    public func poll()async throws {
        guard !view.busy,let b=binding,let verifier,let deviceCode else{throw IntakeFailure.cancelled}
        let g=generation;try admitted(g,b)
        guard let expiry=view.expiresAt,now()<expiry else{try cancel();throw IntakeFailure.expired}
        guard now()>=nextPoll else{throw IntakeFailure.tooEarly}
        view.busy=true;nextPoll=now().addingTimeInterval(interval);view.nextPollAt=nextPoll;changed(view)
        do {
            let url=URL(string:origin+"/mcp-auth/device/poll")!
            let body=try IntakeWire.encode(IntakeJSON.object(["device_code":.string(deviceCode),"code_verifier":.string(verifier)]))
            let response=try await transport(url,["Content-Type":"application/json"],body);try admitted(g,b)
            guard now()<expiry else{throw IntakeFailure.expired}
            let value=try IntakeWire.json(response,url:url)
            if response.status==202,value["status"]?.string=="pending" {view.busy=false;changed(view);return}
            guard response.status==200,value["status"]?.string=="approved",let token=value["token"]?.string,IntakeWire.matches(token,"^[A-Za-z0-9_-]{43,128}$"),let m=value["member"],let id=m["id"]?.string,let endpoint=m["endpoint"]?.string,let expiration=m["expires_at"]?.string,let date=Self.date(expiration),value["refresh_token"]==nil else{throw IntakeFailure.invalidResponse}
            let principal=IntakePrincipal(id:id,endpoint:endpoint,expiresAt:date);try principal.validate(origin:origin,now:now());try saveSecret(principal,token)
            self.verifier=nil;self.deviceCode=nil;view=View();view.principal=principal;changed(view)
        }catch {
            // A failed/ambiguous poll may have consumed the once-only bearer. Fresh login is required.
            if generation==g {self.verifier=nil;self.deviceCode=nil;view=View();view.needsFreshLogin=true;changed(view);try? clearSecret()}
            throw error
        }
    }
    static func date(_ s:String)->Date? {let f=ISO8601DateFormatter();f.formatOptions=[.withInternetDateTime,.withFractionalSeconds];return f.date(from:s) ?? ISO8601DateFormatter().date(from:s)}
}
