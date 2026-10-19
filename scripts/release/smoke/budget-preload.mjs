// Existing SDK-shape probe only; never preload or modify the installed App.
const deadline=Number(process.env.HPS_SMOKE_BUDGET_DEADLINE);if(process.env.HPS_CONTROLLED_SDK_SMOKE!=='1'||!Number.isSafeInteger(deadline))throw Error('BLOCKED: scoped SDK smoke budget unavailable');
const original=globalThis.fetch.bind(globalThis);let calls=0;globalThis.fetch=async(...args)=>{if(Date.now()>=deadline||++calls>6)throw Error('BLOCKED: scoped SDK smoke request budget expired/exhausted');return original(...args);};
