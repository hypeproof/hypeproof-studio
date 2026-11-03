// CGP-SHELL-R-020 — example ideas: the no-idea classifier and goal-question check (positive and
// negative controls), the offer binding to one learner answer, and the bounded dismissal list.
import assert from 'node:assert/strict';
import {IDEA_OFFER_MAX_LEARNER_TURNS,taskHasWork,PROJECT_IDEAS,PROJECT_IDEAS_MAX,PROJECT_IDEAS_DISMISS_MAX,PROJECT_IDEAS_STATE_KEY,NO_IDEA_MAX_CHARS,ideaOfferFor,ideaOfferKey,isGoalQuestion,isNoIdeaAnswer,normalizeTurnText,readIdeaDismissals,withIdeaDismissal} from '../webview-ui/src/projectIdeasModel';
import {replyChoices} from '../webview-ui/src/replyChoiceParser';
const ch=(n:number)=>String.fromCharCode(n);

// The list: at most six, short titles, editable prompts, unique ids.
assert.ok(PROJECT_IDEAS.length>0&&PROJECT_IDEAS.length<=PROJECT_IDEAS_MAX&&PROJECT_IDEAS_MAX===6);
assert.equal(new Set(PROJECT_IDEAS.map(i=>i.id)).size,PROJECT_IDEAS.length);
for(const i of PROJECT_IDEAS){assert.ok([...i.title].length<=14,i.title);assert.ok(i.prompt.length>i.title.length);}

// No-idea answers: positive controls.
for(const t of ['몰라요','몰라','잘 모르겠어요','모르겠어요 ㅠㅠ','음... 모르겠네요','모름','생각이 안 나요','아무것도 안 떠올라요','떠오르는 게 없어요','아이디어가 없어요','딱히 없어요','없어요','아직 못 정했어요','정하지 못했어요','추천해 주세요','아무거나요','모르겠어요!!','  몰라요  ','몰라요？','아이디어가 없어요','하고 싶은 게 없어요','아무것도 없어요'])
 assert.equal(isNoIdeaAnswer(t),true,t);
// Negative controls: a named goal, a request, a long message, an unrelated "없어요", empty.
for(const t of ['모르겠어요 그냥 퀴즈 만들래요','게임 만들고 싶어요','이 공지를 한 문장으로 줄여줘','재미없어요x','해야 할 일은 있는데 어디서 시작할지 모르겠어 정말로 너무 막막해요 어떡하죠','','   ','네','좋아요','모르는 사람에게 보낼 편지를 써 줘','시간이 없어요','돈이 없어요','관심 없어요','재료가 없어요','몰라요'.repeat(100)])
 assert.equal(isNoIdeaAnswer(t),false,t);
assert.equal(isNoIdeaAnswer('가'.repeat(NO_IDEA_MAX_CHARS-3)+'몰라요'),true,'at the cap');
assert.equal(isNoIdeaAnswer('가'.repeat(NO_IDEA_MAX_CHARS-2)+'몰라요'),false,'over the cap');
assert.equal(isNoIdeaAnswer(42 as unknown as string),false);
// Hostile text: invisible and bidi characters do not hide or fake the phrase.
assert.equal(isNoIdeaAnswer(`몰${ch(0x200b)}라${ch(0x202e)}요`),true,'zero-width and bidi removed before matching');
assert.equal(isNoIdeaAnswer(`몰라요${ch(0x2028)}게임 만들래요`),false,'a line separator does not end the message early');
assert.equal(normalizeTurnText(`a${ch(0x2029)}b\t${ch(0x3164)}c`),'a b c');

// Goal questions: positive and negative controls.
for(const t of ['안녕하세요! 오늘은 무엇을 만들어 보고 싶어요?','어떤 걸 해 보고 싶으세요?','목표가 뭐예요?','좋아요. 그럼 뭘 만들어 볼까요？','오늘은 무엇을 만들어 볼까요? 😊','**어떤 걸 해 보고 싶어요?**','무엇을 만들고 싶으세요?~','목표가 뭐예요?'])
 assert.equal(isGoalQuestion(t),true,t);
for(const t of ['파일을 만들었어요.','파일을 만들었어요. 저장해 둘까요?','이 파일을 저장하고 싶으세요?','만들어 볼까요?','x'.repeat(5000)+' 뭘 만들고 싶어요? '.repeat(0)+'끝.','몇 시에 시작해요','',undefined])
 assert.equal(isGoalQuestion(t),false,String(t));

// Detail and choice questions are never goal questions (verifier examples, each failed on the old head).
for(const t of ['어떤 색으로 만들까요?','어떤 파일 이름으로 만들까요?','어떤 방식으로 만들까요? 1번은 표, 2번은 카드예요.','무엇을 더 해 볼까요?','무엇부터 시작해 볼까요?','다음에 무엇을 만들어 볼까요?','어느 쪽으로 만들고 싶어요?','어떤 모양을 만들고 싶어요?','이 페이지에 무엇을 만들고 싶어요?','좋아요. 위 표에서 뭘 하고 싶어요?','제목은 무엇으로 만들까요?','무엇을 만들고 싶어요? 어떤 색으로 만들까요?','어떤 색으로 만들까요? 무엇을 만들고 싶어요?'])
 assert.equal(isGoalQuestion(t),false,t);
assert.equal(isGoalQuestion('무엇을 만들어 보고 싶어요?'),true,'positive control');

// Offer binding.
const m=(id:string,role:'user'|'assistant'|'tool'|'system',content:string)=>({id,role,content,createdAt:0}) as any;
const none=()=>false,choices=(t:string)=>replyChoices(t)!==null;
const Q=m('a0','assistant','어떤 걸 만들어 보고 싶어요?'),A=m('u1','user','잘 모르겠어요'),R=m('a1','assistant','같이 찾아봐요.');
assert.equal(ideaOfferFor([],'무엇을 만들고 싶어요?',none,false),null,'first screen: never');
assert.deepEqual(ideaOfferFor([Q,A,R],'',none,false),{messageId:'u1'},'after the coach replied to the answer');
assert.deepEqual(ideaOfferFor([Q,A],'',none,false),{messageId:'u1'},'answer with no reply (failed or stopped turn)');
assert.deepEqual(ideaOfferFor([Q,A,{...m('t1','tool','x'),tool:{icon:'💭',label:'x',state:'done'}},m('s1','system',''),R],'',none,false),{messageId:'u1'},'look-only tool rows and system rows are skipped');
assert.deepEqual(ideaOfferFor([A,R],'오늘은 무엇을 만들어 볼까요?',none,false),{messageId:'u1'},'the greeting is the goal question for the first message');
assert.equal(ideaOfferFor([A,R],'안녕하세요!',none,false),null,'a greeting that asks nothing');
assert.equal(ideaOfferFor([m('a0','assistant','파일을 저장했어요. 다른 질문 있어요?'),A,R],'',none,false),null,'not a goal question');
assert.equal(ideaOfferFor([Q,m('u1','user','퀴즈 만들래요'),R],'',none,false),null,'a named goal');
assert.equal(ideaOfferFor([Q,A,R,m('u2','user','퀴즈로 할게요')],'',none,false),null,'the learner moved on');
assert.equal(ideaOfferFor([Q,A,R,m('u2','user','퀴즈로 할게요'),m('a2','assistant','좋아요')],'',none,false),null,'moved on and answered');
assert.equal(ideaOfferFor([Q,A,m('a1','assistant','')],'',none,false),null,'empty reply (still forming)');
const offered=m('a1','assistant','이 중에서 골라 보세요.\n1. 퀴즈\n2. 일기장');
assert.equal(ideaOfferFor([Q,A,offered],'',choices,false),null,'the coach already offered its own choices: one picker at a time');
assert.deepEqual(ideaOfferFor([Q,A,offered],'',none,false),{messageId:'u1'});

// Ideas are for STARTING a project: never after work was made, never late in the conversation.
const tool=(icon:string)=>({id:'t'+icon,role:'tool',content:'',createdAt:0,tool:{icon,label:'x',state:'done'}}) as any;
assert.deepEqual(ideaOfferFor([Q,A],'',none,false),{messageId:'u1'},'start of a task: offered');
assert.equal(ideaOfferFor([Q,A],'',none,true),null,'an artifact exists in the task (picked surface, open world or publish)');
for(const icon of ['✍️','🖼️','⌨️','📝','🗂','?'])
 assert.equal(ideaOfferFor([Q,tool(icon),A],'',none,false),null,'work made: tool row '+icon);
for(const icon of ['💭','…','📖','🔍'])
 assert.deepEqual(ideaOfferFor([Q,tool(icon),A],'',none,false),{messageId:'u1'},'look-only row does not count: '+icon);
assert.equal(taskHasWork([m('a','assistant','여기 있어요\n```html\n<p>x</p>\n```')],false),true,'a fenced page is an artifact');
assert.equal(ideaOfferFor([Q,m('u0','user','안녕'),m('a9','assistant','네\n```html\n<p>x</p>\n```'),Q,A],'',none,false),null,'fenced page earlier in the task');
const later=(n:number)=>{const l:any[]=[];for(let i=0;i<n;i++)l.push(m('x'+i,'user','안녕'+i),m('y'+i,'assistant','네'+i));l.push(Q,A);return l;};
assert.equal(IDEA_OFFER_MAX_LEARNER_TURNS,3);
assert.deepEqual(ideaOfferFor(later(IDEA_OFFER_MAX_LEARNER_TURNS-1),'',none,false),{messageId:'u1'},'the answer is the 3rd learner message');
assert.equal(ideaOfferFor(later(IDEA_OFFER_MAX_LEARNER_TURNS),'',none,false),null,'the answer is the 4th learner message: too late');
assert.equal(ideaOfferFor(later(10),'',none,false),null,'deep in the task');

// Keys and dismissals.
assert.notEqual(ideaOfferKey('a','t','u1'),ideaOfferKey('a','t2','u1'));
assert.notEqual(ideaOfferKey('a","b','c','d'),ideaOfferKey('a','b","c','d'),'no delimiter collisions');
assert.equal(ideaOfferKey(undefined,null,'u1'),JSON.stringify(['','','u1']));
assert.deepEqual(readIdeaDismissals({[PROJECT_IDEAS_STATE_KEY]:['a',1,null,'b']}),['a','b']);
assert.deepEqual(readIdeaDismissals({[PROJECT_IDEAS_STATE_KEY]:'a'}),[]);
assert.deepEqual(withIdeaDismissal(['a','b'],'a'),['b','a']);
let list:string[]=[];for(let i=0;i<PROJECT_IDEAS_DISMISS_MAX+3;i++)list=withIdeaDismissal(list,'k'+i);
assert.equal(list.length,PROJECT_IDEAS_DISMISS_MAX);assert.ok(!list.includes('k0'));
console.log('PASS project ideas model');
