// This client requests authorization only. It cannot approve or publish.
export class ReleaseGateClient {
 constructor({origin,token,fetchImpl=fetch}) {
  if(origin!=='https://release-engine.hypeproof-ai.xyz'||!token)throw Error('Release engine gate unconfigured');Object.assign(this,{origin,token,fetch:fetchImpl});
 }
 async authorize(body) {
  const response=await this.fetch(this.origin+'/v1/publication/authorize',{method:'POST',headers:{authorization:`Bearer ${this.token}`,'content-type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('Release engine authorization unavailable');return response.json();
 }
}
