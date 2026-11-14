import * as vscode from 'vscode';
import * as path from 'node:path';
import type { AccountSession } from './accountSession';
import { accountLock } from './accountLock';
import { MobileConversation, type MobileBinding, type MobileScope } from './mobileConversation';
import { refuseOnChildSeat } from "./childProfileHost";

const KEY='hps.mobileConversation.v1';
export const MOBILE_CONVERSATION_COMMAND='hypeproof-chat.shareConversationWithPhone';
interface DesktopConversation {
  mobileConversationScope():MobileScope|undefined;
  submitMobileConversation(scope:MobileScope,request:{id:string;text:string}):Promise<boolean>;
  opsRequestStop():void;
}
export function registerMobileConversation(context:vscode.ExtensionContext,provider:DesktopConversation,accounts:AccountSession|undefined):MobileConversation {
  const status=vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left,65);
  status.command=MOBILE_CONVERSATION_COMMAND;status.text='$(device-mobile) iPhone 연결';status.tooltip='선택한 개인 대화의 글을 iPhone에서 이어가기';status.show();
  const sync=new MobileConversation({
    read:()=>context.globalState.get<MobileBinding>(KEY),save:value=>context.globalState.update(KEY,value),
    scope:()=>provider.mobileConversationScope(),session:async()=>accounts?.conversationSession(),
    request:async(session,suffix,body,method)=>{if(!accounts)throw Error('먼저 개인 계정으로 로그인해 주세요.');return accounts.conversationRequest(session,suffix,body,method);},
    exclusive:accountLock(path.join(context.globalStorageUri.fsPath,'mobile-conversation-lock')),
    execute:(scope,request)=>provider.submitMobileConversation(scope,request),stop:()=>provider.opsRequestStop(),
    changed:message=>{status.text='$(device-mobile) iPhone 연결';status.tooltip=message;},
  });
  const command=vscode.commands.registerCommand(MOBILE_CONVERSATION_COMMAND,async()=>{
    if(refuseOnChildSeat('connections'))return;
    try {
      const binding=context.globalState.get<MobileBinding>(KEY);
      if(binding){
        const choice=await vscode.window.showQuickPick([
          {label:'연결 상태 확인',description:binding.disabled?'연결 중지 · 서버 사본 유지':'선택한 대화를 열어 둔 컴퓨터에서 요청을 처리해요'},
          {label:'이 컴퓨터 연결 정보 지우기',description:'로그인 복구용. 서버 사본과 컴퓨터 원본은 유지'},
          {label:'연결 중지',description:'컴퓨터 실행·업로드 중지. 서버 사본과 로컬 원본은 유지'},
          {label:'서버 대화 사본 삭제',description:'연결 중지 후 서버 사본 삭제. 컴퓨터 원본은 유지'},
        ],{title:'iPhone 대화 연결'});
        if(choice?.label==='이 컴퓨터 연결 정보 지우기'){
          const answer=await vscode.window.showWarningMessage('이 컴퓨터의 연결 정보만 지울까요?',{modal:true,detail:'서버 대화 사본과 요청 기록은 삭제되지 않아요. 원래 호스트 로그인을 사용할 수 없다면 새 로그인에서 그 서버 사본을 삭제하지 못할 수 있어요. 컴퓨터의 원래 대화와 파일은 그대로 남고, 새 연결은 별도 동의가 필요해요. 진행 중인 응답은 먼저 연결 중지로 멈춰 주세요.'},'로컬 연결 정보만 지우기');
          if(answer==='로컬 연결 정보만 지우기')await sync.forgetLocal();
        }
        if(choice?.label==='연결 중지')await sync.disconnect(false);
        if(choice?.label==='서버 대화 사본 삭제'){
          const answer=await vscode.window.showWarningMessage('서버 대화 사본을 삭제할까요?',{modal:true,detail:'iPhone에서 읽던 서버 사본과 요청 기록을 삭제해요. 컴퓨터의 원래 대화와 파일은 그대로 남아요.'},'서버 사본 삭제');
          if(answer==='서버 사본 삭제')await sync.disconnect(true);
        }
        if(choice?.label==='연결 상태 확인'){await sync.tick();await vscode.window.showInformationMessage(String(status.tooltip));}
        return;
      }
      const scope=provider.mobileConversationScope();
      if(!scope?.ready||!await accounts?.conversationSession())throw Error('먼저 개인 계정으로 로그인하고 개인 대화를 선택해 주세요. 실행 중인 작업과 작성 중인 입력을 마친 뒤 연결할 수 있어요.');
      const answer=await vscode.window.showInformationMessage('이 대화를 iPhone과 연결할까요?',{modal:true,detail:
        `선택한 대화: ${scope.title}\n\n이 대화의 기존·이후 사용자와 AI 글을 계정의 HypeProof Service에 저장해요. 같은 계정으로 로그인한 iPhone에서 읽을 수 있어요. 파일·도구 출력·다른 대화·원시 음성은 공유하지 않아요. 전송은 TLS로 보호되며 종단간 암호화 저장은 아니에요.\n\niPhone에서 명시적으로 보낸 글은 이 컴퓨터의 같은 대화에서 처리하고 기존 AI 이용량을 사용해요. iPhone에서는 질문과 의도를 정리하고 계획을 이어갈 수 있어요. 파일 만들기·도구 실행은 이 컴퓨터의 원래 대화에서 직접 요청해 주세요. 원격 요청 자체로 파일·도구를 실행하지 않아요. 이 대화를 열어 둔 컴퓨터가 오프라인이거나 다른 작업 중이면 기다려요.\n\n연결 중지는 서버 사본을 지우지 않아요. 이 메뉴에서 서버 사본을 별도로 삭제할 수 있어요.`},'동의하고 대화 연결');
      if(answer!=='동의하고 대화 연결')return;
      const current=provider.mobileConversationScope();
      if(!current||current.activity!==scope.activity||current.workspace!==scope.workspace||current.task!==scope.task)throw Error('선택한 대화가 바뀌었어요. 다시 확인해 주세요.');
      await sync.connect();await vscode.window.showInformationMessage('연결 상태를 확인했어요. iPhone에서 같은 개인 계정으로 로그인해 대화를 선택하세요. 상태 표시줄에서 진행 상태를 확인할 수 있어요.');
    }catch(error){await vscode.window.showWarningMessage(error instanceof Error?error.message:'연결하지 못했어요. 로컬 원본은 그대로예요.');}
  });
  const timer=setInterval(()=>{void sync.tick();},3000);
  context.subscriptions.push(command,status,{dispose:()=>{clearInterval(timer);sync.dispose();}});
  return sync;
}
