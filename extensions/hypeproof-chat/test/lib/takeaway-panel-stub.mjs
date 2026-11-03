// The real host assigns HTML only after its message/close listeners are installed.
export const autoTakeawayPanel = decide => () => {
 let receive,closed,html='';
 const panel={webview:{onDidReceiveMessage(fn){receive=fn;return {dispose(){}};},get html(){return html;},set html(value){html=value;queueMicrotask(()=>{const nonce=/script nonce="([a-f0-9]+)"/.exec(value)[1];receive({...decide(value),nonce});});}},onDidDispose(fn){closed=fn;return {dispose(){}};},dispose(){closed?.();}};
 return panel;
};
