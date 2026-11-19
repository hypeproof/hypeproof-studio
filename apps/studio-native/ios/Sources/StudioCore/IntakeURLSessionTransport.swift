import Foundation

/// Production transport for the existing Intake endpoints only. Each request owns its
/// ephemeral session; cancellation never invalidates another caller's session.
@MainActor public final class IntakeURLSessionTransport {
    private let origin:String
    private let configuration:URLSessionConfiguration
    public init(origin:String)throws {
        _ = try IntakeWire.origin(origin);self.origin=origin
        configuration=Self.configuration()
    }
    // URLProtocol injection is internal and available to @testable unit tests only.
    init(origin:String,protocolClasses:[AnyClass])throws {
        _ = try IntakeWire.origin(origin);self.origin=origin
        configuration=Self.configuration();configuration.protocolClasses=protocolClasses
    }
    private static func configuration()->URLSessionConfiguration {
        let c=URLSessionConfiguration.ephemeral
        c.httpCookieStorage=nil;c.httpShouldSetCookies=false;c.urlCredentialStorage=nil;c.urlCache=nil
        c.requestCachePolicy = .reloadIgnoringLocalCacheData
        c.timeoutIntervalForRequest=30;c.timeoutIntervalForResource=45;c.waitsForConnectivity=false
        return c
    }
    public func send(_ url:URL,headers:[String:String],body:Data)async throws->IntakeHTTPResponse {
        let allowed=[origin+"/mcp",origin+"/mcp-auth/device/start",origin+"/mcp-auth/device/poll"]
        guard allowed.contains(url.absoluteString),url.user==nil,url.password==nil,url.fragment==nil,
              body.count <= (url.path=="/mcp" ? 65536:4096),
              Set(headers.keys).isSubset(of:["Authorization","Content-Type","Accept","MCP-Protocol-Version"]),
              headers["Content-Type"]=="application/json",
              headers.values.allSatisfy({!$0.contains("\r") && !$0.contains("\n") && $0.utf8.count<=512}),
              url.path=="/mcp" || headers["Authorization"]==nil else{throw IntakeFailure.invalidInput}
        var request=URLRequest(url:url,cachePolicy:.reloadIgnoringLocalCacheData,timeoutInterval:30)
        request.httpMethod="POST";request.httpBody=body;request.allHTTPHeaderFields=headers
        let exchange=IntakeSessionExchange(configuration:configuration,request:request)
        return try await withTaskCancellationHandler(operation:{try Task.checkCancellation();return try await exchange.run()},onCancel:{exchange.cancel()})
    }
}

private final class IntakeSessionExchange:NSObject,URLSessionDataDelegate,@unchecked Sendable {
    private let lock=NSLock(), configuration:URLSessionConfiguration, request:URLRequest
    private var continuation:CheckedContinuation<IntakeHTTPResponse,Error>?,session:URLSession?,task:URLSessionDataTask?
    private var response:HTTPURLResponse?,bytes=Data(),finished=false,cancelled=false
    init(configuration:URLSessionConfiguration,request:URLRequest){self.configuration=configuration;self.request=request}
    func run()async throws->IntakeHTTPResponse {
        try await withCheckedThrowingContinuation { continuation in
            lock.lock()
            if cancelled {lock.unlock();continuation.resume(throwing:CancellationError());return}
            self.continuation=continuation
            let session=URLSession(configuration:configuration,delegate:self,delegateQueue:nil)
            self.session=session;let task=session.dataTask(with:request);self.task=task
            lock.unlock();task.resume()
        }
    }
    func cancel(){lock.lock();cancelled=true;lock.unlock();finish(.failure(CancellationError()))}
    private func finish(_ result:Result<IntakeHTTPResponse,Error>) {
        lock.lock();guard !finished,let continuation else{lock.unlock();return}
        finished=true;self.continuation=nil;let session=self.session;self.session=nil;let task=self.task;self.task=nil
        bytes.removeAll(keepingCapacity:false);lock.unlock()
        task?.cancel();session?.invalidateAndCancel();continuation.resume(with:result)
    }
    func urlSession(_ session:URLSession,task:URLSessionTask,willPerformHTTPRedirection response:HTTPURLResponse,newRequest request:URLRequest,completionHandler:@escaping (URLRequest?)->Void){
        // Never replay Authorization or POST content to a redirect, including same origin.
        completionHandler(nil);finish(.failure(IntakeFailure.invalidResponse))
    }
    func urlSession(_ session:URLSession,task:URLSessionTask,didReceive challenge:URLAuthenticationChallenge,completionHandler:@escaping (URLSession.AuthChallengeDisposition,URLCredential?)->Void){
        // Permit system TLS trust only. No HTTP challenge, cached or client credentials.
        if challenge.protectionSpace.authenticationMethod==NSURLAuthenticationMethodServerTrust{completionHandler(.performDefaultHandling,nil)}else{completionHandler(.cancelAuthenticationChallenge,nil)}
    }
    func urlSession(_ session:URLSession,dataTask:URLSessionDataTask,didReceive response:URLResponse,completionHandler:@escaping (URLSession.ResponseDisposition)->Void){
        guard let http=response as? HTTPURLResponse,http.url==request.url,(200...599).contains(http.statusCode),!(300..<400).contains(http.statusCode),response.expectedContentLength<=262144 else{
            completionHandler(.cancel);finish(.failure(IntakeFailure.invalidResponse));return
        }
        lock.lock();self.response=http;lock.unlock();completionHandler(.allow)
    }
    func urlSession(_ session:URLSession,dataTask:URLSessionDataTask,didReceive data:Data){
        lock.lock();guard !finished else{lock.unlock();return}
        let overflow=data.count>262144-bytes.count
        if !overflow{bytes.append(data)};lock.unlock()
        if overflow{finish(.failure(IntakeFailure.invalidResponse))}
    }
    func urlSession(_ session:URLSession,task:URLSessionTask,didCompleteWithError error:Error?){
        if let error {finish(.failure(error));return}
        lock.lock();let response=self.response;let body=bytes;lock.unlock()
        guard let response,let url=response.url else{finish(.failure(IntakeFailure.invalidResponse));return}
        finish(.success(IntakeHTTPResponse(status:response.statusCode,url:url,body:body)))
    }
}
