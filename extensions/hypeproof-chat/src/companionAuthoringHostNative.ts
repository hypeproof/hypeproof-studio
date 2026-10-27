/** Explicit DEV adapter. Uses the same native authority producer as preview; registers no endpoint. */
import * as vscode from 'vscode';
import { CompanionAuthoringHost, type CompanionAuthoringHostPorts } from './companionAuthoringHost.ts';
import { createDevCompanionAuthoritySnapshot, type CompanionNativeBridgePorts } from './companionHostBridgeNative.ts';
export function createDevCompanionAuthoringHost(ports: CompanionNativeBridgePorts &
  Pick<CompanionAuthoringHostPorts,'store'|'lifecycle'|'imported'>): CompanionAuthoringHost {
  return new CompanionAuthoringHost({ ...ports, now: ports.now ?? Date.now,
    snapshot:createDevCompanionAuthoritySnapshot(ports), confirm:async intent => {
      if (ports.context.extensionMode !== vscode.ExtensionMode.Development) return false;
      return await vscode.window.showInformationMessage('휴대폰 요청을 대화 입력에 가져올까요?', {modal:true,
        detail:[`휴대폰: ${intent.selection.deviceId}`,`작업: ${intent.selection.taskId} · 버전 ${intent.selection.version}`,
          `파일 버전: ${intent.selection.artifactVersion}`,`요청: ${intent.requestId}`,intent.text,
          '아직 실행하지 않았어요. 빈 대화 입력에만 가져와요. 컴퓨터에서 보내기를 눌러야 시작해요.'].join('\n\n')}, '대화 입력에 가져오기') === '대화 입력에 가져오기';
    } });
}
