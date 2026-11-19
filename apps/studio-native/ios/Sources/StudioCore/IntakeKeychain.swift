import Foundation
import Security
import CryptoKit

/// Separate Intake namespace; never reads, updates or deletes Studio account credentials.
/// Pending verifier/device code remain memory-only in IntakeDeviceAuth and are not restartable.
public final class IntakeKeychain {
    public final class Credential {
        public let principal:IntakePrincipal
        private let token:String
        fileprivate init(principal:IntakePrincipal,token:String){self.principal=principal;self.token=token}
        public func bearer(now:Date=Date())throws->String {guard principal.expiresAt>now else{throw IntakeFailure.expired};return token}
    }
    struct Operations {
        var read:([String:Any])->(OSStatus,Data?)
        var update:([String:Any],[String:Any])->OSStatus
        var add:([String:Any])->OSStatus
        var delete:([String:Any])->OSStatus
        static var system:Self {Self(read:{q in var value:CFTypeRef?;let status=SecItemCopyMatching(q as CFDictionary,&value);return(status,value as? Data)},update:{SecItemUpdate($0 as CFDictionary,$1 as CFDictionary)},add:{SecItemAdd($0 as CFDictionary,nil)},delete:{SecItemDelete($0 as CFDictionary)})}
    }
    private let origin:String,service:String,operations:Operations
    public convenience init(studioAccountID:String,origin:String)throws {try self.init(studioAccountID:studioAccountID,origin:origin,operations:.system)}
    init(studioAccountID:String,origin:String,operations:Operations)throws {
        guard StoredAccount.validID(studioAccountID) else{throw IntakeFailure.invalidInput};_ = try IntakeWire.origin(origin)
        self.origin=origin;self.operations=operations
        let scope=try IntakeWire.encode([studioAccountID,origin])
        service="ai.hypeproof.studio.mobile.intake."+Self.hash(scope)
    }
    private static func hash(_ data:Data)->String {SHA256.hash(data:data).map{String(format:"%02x",$0)}.joined()}
    private func query(_ principalID:String?)throws->[String:Any] {
        var q:[String:Any]=[kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:service,kSecAttrSynchronizable as String:false]
        if let principalID {guard IntakeWire.matches(principalID,"^lab-[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$") else{throw IntakeFailure.invalidInput};q[kSecAttrAccount as String]=Self.hash(Data(principalID.utf8))}
        return q
    }
    public func save(principal:IntakePrincipal,token:String,now:Date=Date())throws {
        try principal.validate(origin:origin,now:now);guard IntakeWire.matches(token,"^[A-Za-z0-9_-]{43,128}$") else{throw IntakeFailure.invalidInput}
        // One atomic item binds nonsecret metadata to raw secret bytes. Token is never Codable.
        let metadata=try IntakeWire.encode(principal);guard metadata.count<4096 else{throw IntakeFailure.invalidInput}
        var bytes=Data([1,UInt8(metadata.count >> 8),UInt8(metadata.count & 255)]);bytes.append(metadata);bytes.append(Data(token.utf8))
        let q=try query(principal.id),status=operations.update(q,[kSecValueData as String:bytes])
        if status==errSecItemNotFound {var add=q;add[kSecValueData as String]=bytes;add[kSecAttrAccessible as String]=kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            guard operations.add(add)==errSecSuccess else{throw IntakeFailure.storage}
        }else if status != errSecSuccess {throw IntakeFailure.storage}
    }
    public func read(principalID:String,now:Date=Date())throws->Credential? {
        var q=try query(principalID);q[kSecReturnData as String]=true;q[kSecMatchLimit as String]=kSecMatchLimitOne
        let (status,value)=operations.read(q);if status==errSecItemNotFound{return nil}
        guard status==errSecSuccess else{throw IntakeFailure.storage}
        guard let bytes=value,bytes.count>=3,bytes.count<=4227,bytes[0]==1 else{throw IntakeFailure.invalidResponse}
        let count=Int(bytes[1])*256+Int(bytes[2]);guard count>0,count<4096,bytes.count>3+count else{throw IntakeFailure.invalidResponse}
        let principal=try JSONDecoder().decode(IntakePrincipal.self,from:bytes.subdata(in:3..<3+count))
        guard principal.id==principalID,principal.endpoint==origin+"/mcp",let token=String(data:bytes.subdata(in:3+count..<bytes.count),encoding:.utf8),IntakeWire.matches(token,"^[A-Za-z0-9_-]{43,128}$") else{throw IntakeFailure.invalidResponse}
        guard principal.expiresAt>now else{try remove(principalID:principalID);return nil}
        try principal.validate(origin:origin,now:now);return Credential(principal:principal,token:token)
    }
    public func remove(principalID:String)throws {try remove(query:query(principalID))}
    public func removeAllForStudioAccount()throws {try remove(query:query(nil))}
    private func remove(query:[String:Any])throws {let status=operations.delete(query);guard status==errSecSuccess || status==errSecItemNotFound else{throw IntakeFailure.storage}}
}
