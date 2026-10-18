// Built product UI + real task store; Service/model transport is synthetic and never billed.
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { serveTaskWorkspace } from './server.mjs';
import { resolvedProfile } from '../../extensions/hypeproof-chat/test/sx-screen-fixtures.mjs';
export const profile = resolvedProfile(3, {
  lesson: undefined, observation: { format: 'hps-observation/2', assess: true, scope: 'synthetic-personal-a' },
  model_selection: { source: 'profile', choices: [{ id: 'fixture-sonnet', alias: 'fixture-sonnet', label: 'Claude Sonnet 5.5' }, { id: 'fixture-gpt', alias: 'fixture-gpt', label: 'GPT' }] },
  ux: { ...resolvedProfile(3).ux, suggestions: { initial: [
    { text: '해야 할 일은 있는데 어디서 시작할지 모르겠어', caption: '시작이 막막해', style: 'good' },
    { text: '이미 하고 있는 일을 더 잘하고 싶어', caption: '지금 일을 개선', style: 'good' },
    { text: 'AI에게 어디까지 맡겨야 할지 모르겠어', caption: '위임 범위 고민', style: 'good' },
  ], follow_up: [] } },
  welcome: { greeting_md: '지금 해결하거나 더 낫게 만들고 싶은 일이 있나요? 이미 하고 싶은 일이 분명하면 바로 말씀해 주세요.', example_prompts: ['해야 할 일은 있는데 어디서 시작할지 모르겠어', '이미 하고 있는 일을 더 잘하고 싶어', 'AI에게 어디까지 맡겨야 할지 모르겠어'] },
});
export const configExtras = { model: 'fixture-sonnet', effort: { value: 'medium', allowed: ['low','medium','high'] }, access: { status: 'ready', view: { configured: false, required: false, choices: [], as_of: '2026-10-18T00:00:00Z' } } };
export const question = '네, 객관식으로 골라 보세요. 번호만 답하셔도 됩니다.\n\n**최근 AI가 해주면 좋겠다고 생각한 일은 어느 쪽에 가까웠나요?**\n\n1. 글쓰기나 정리: 메일, 보고서, 메모, 자료 요약\n2. 계획 세우기: 여행, 일정, 공부, 할 일\n3. 알아보고 비교하기: 제품, 장소, 정보 조사\n4. 아이디어 내기: 기획, 이름 짓기, 콘텐츠 소재\n5. 위에 없음. 직접 말할게요';
const addMessage = content => async f => { await f.h.appendHistory([{id:'review-'+Date.now(),role:'assistant',content,createdAt:Date.now()}]); await f.h.postHistory(); };
const fixtureActions = {
  'compact-question': {label:'객관식 질문 추가',run:addMessage(question)},
  'compact-instructions': {label:'일반 번호 목록 추가',run:addMessage('다음 순서로 진행하세요.\n\n1. 파일을 만듭니다.\n2. 실행합니다.')},
  'compact-partial': {label:'미완성 질문 추가',run:addMessage('객관식으로 골라 보세요.\n\n1. 글쓰기')},
  'compact-access-unknown': {label:'이용권 확인 실패',run:async f=>{configExtras.access={status:'unknown'};await f.h.postConfig();}},
  'compact-access-ready': {label:'이용권 복구',run:async f=>{configExtras.access={status:'ready',view:{configured:false,required:false,choices:[],as_of:'2026-10-18T00:00:00Z'}};await f.h.postConfig();}},
};
const server = await serveTaskWorkspace({ profile, configExtras, fixtureActions, seedHistory: false, port: Number(process.env.PORT ?? 0) });
if (process.argv.includes('--serve')) {
  await server.fixture.h.appendHistory([{id:'q-user',role:'user',content:'객관식으로 질문해 줘',createdAt:1},{id:'q-answer',role:'assistant',content:question,createdAt:2}]);
  console.log(JSON.stringify({url:server.url,scope:'synthetic full personal profile + product theme + built UI + real host/store'}));
} else {
  const output=resolve(process.env.HPS_CHAT_COMPACT_EVIDENCE ?? 'e2e/test-results/chat-compact');
  await mkdir(output,{recursive:true});
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  const checks=[], errors=[]; page.on('pageerror',error=>errors.push(error.message));
  const input=page.locator('.hps-input textarea');
  const shot=name=>page.screenshot({path:resolve(output,name+'.png')});
  try {
    await page.goto(server.url+'/?theme=green'); await expect(input).toBeVisible();
    await expect(page.getByRole('combobox',{name:'대화 모델',exact:true})).toBeHidden();
    await expect(page.getByRole('combobox',{name:'Effort',exact:true})).toBeHidden();
    await expect(page.locator('.hps-native-observation')).toBeHidden();
    await expect(page.locator('.hps-access')).toBeHidden();
    await expect(page.locator('.hps-shell')).toHaveCSS('background-color','rgb(21, 29, 25)');
    await shot('empty-green-1440'); checks.push('green theme full profile: secondary controls hidden; composer visible');
    await input.fill('설정을 열어도 유지할 초안');
    await page.getByRole('button',{name:'대화 메뉴',exact:true}).click();
    await page.getByRole('menuitem',{name:'설정',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'대화 설정',exact:true}); await expect(dialog).toBeVisible();
    await expect(page.getByRole('button',{name:'대화 설정 닫기'})).toBeFocused();
    await page.getByText('응답 고급 설정',{exact:true}).click();
    await expect(page.getByRole('combobox',{name:'대화 모델',exact:true})).toHaveValue('fixture-sonnet');
    await expect(page.getByRole('combobox',{name:'Effort',exact:true})).toHaveValue('medium');
    await shot('settings-green'); await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden(); await expect(page.getByRole('button',{name:'대화 메뉴',exact:true})).toBeFocused();
    await expect(input).toHaveValue('설정을 열어도 유지할 초안'); checks.push('settings closed by default, existing values available, Escape focus return and draft retention');
    await server.fixture.h.appendHistory([{id:'q-user',role:'user',content:'객관식으로 질문해 줘',createdAt:1},{id:'q-answer',role:'assistant',content:question,createdAt:2}]);
    await server.fixture.h.postHistory();
    const options=page.getByRole('group',{name:'답변 선택'}); await expect(options).toBeVisible();
    await expect(options.getByRole('button')).toHaveCount(5);
    const mark=page.locator('.hps-assistant-mark').last(); expect((await mark.boundingBox()).width).toBe(18);
    await expect(page.locator('.hps-msg-role .hps-msg-retry')).toHaveCount(0);
    await expect(page.locator('.hps-message-actions .hps-msg-retry')).toBeVisible();
    await shot('choices-green-1440');
    await options.getByRole('button',{name:/글쓰기나 정리/}).click();
    await expect(input).toHaveValue('설정을 열어도 유지할 초안\n1. 글쓰기나 정리: 메일, 보고서, 메모, 자료 요약');
    await expect(input).toBeFocused(); expect(server.sent).toHaveLength(0);
    await options.getByRole('button',{name:/아이디어 내기/}).click();
    await expect(input).toHaveValue('설정을 열어도 유지할 초안\n4. 아이디어 내기: 기획, 이름 짓기, 콘텐츠 소재');
    await input.fill('직접 고친 답변');
    await options.getByRole('button',{name:/알아보고 비교하기/}).click();
    await expect(input).toHaveValue('직접 고친 답변\n3. 알아보고 비교하기: 제품, 장소, 정보 조사');
    await input.fill(''); await options.getByRole('button',{name:/계획 세우기/}).focus(); await page.keyboard.press('Enter');
    await expect(input).toHaveValue('2. 계획 세우기: 여행, 일정, 공부, 할 일');
    await expect(input).toBeFocused(); expect(server.sent).toHaveLength(0);
    checks.push('choices: exact option in editable composer, draft preservation, keyboard click, no automatic send');
    for(const viewport of [{width:1024,height:500},{width:390,height:640}]) {
      await page.setViewportSize(viewport); await expect(input).toBeVisible();
      const box=await page.locator('.hps-input').boundingBox(); expect(box.y+box.height).toBeLessThanOrEqual(viewport.height);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await shot('choices-green-'+viewport.width);
    }
    checks.push('short and narrow windows retain visible composer without horizontal page overflow');
    await page.setViewportSize({width:1280,height:720}); await page.goto(server.url+'/?theme=light'); await expect(options).toBeVisible(); await shot('choices-light');
    await page.request.post(server.url+'/fixture/stream'); await expect(options).toHaveCount(0);
    await page.request.post(server.url+'/fixture/stop');
    await server.fixture.h.appendHistory([{id:'instruction',role:'assistant',content:'다음 순서로 진행하세요.\n\n1. 파일을 만듭니다.\n2. 실행합니다.',createdAt:3}]); await server.fixture.h.postHistory();
    await expect(options).toHaveCount(0); checks.push('streaming and ordinary numbered instructions remain non-interactive prose');
    configExtras.access={status:'unknown'}; await server.fixture.h.postConfig();
    await expect(page.getByRole('button',{name:'이용권 확인',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'이용권 확인',exact:true}).click(); await expect(dialog).toBeVisible();
    await page.locator('.hps-access summary').click(); await expect(page.locator('.hps-access')).toContainText('확인하지 못했습니다');
    checks.push('unknown access stays visible and opens recovery settings');
    expect(errors).toEqual([]);
    await writeFile(resolve(output,'result.json'),JSON.stringify({verdict:'PASS',checks,errors,scope:'built UI + synthetic Service/model + real provider/store; no native or paid inference claim'},null,2));
    console.log(JSON.stringify({verdict:'PASS',checks,output}));
  } catch(error) { await shot('failure'); throw error; }
  finally { await browser.close(); await server.close(); }
}
