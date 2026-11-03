import { useId, useLayoutEffect, useRef, useState } from 'react';
import { useDialogFocus } from './dialogFocus';
import { imeComposing } from './imeGuard';
import { ChatIcon } from './ChatDetails';
import { useAttachmentSendPreparation } from './AttachmentSendPreparation';
import './modalSurface.css';
export const SKETCH_COLORS = [{name:'검정',value:'#202020'},{name:'빨강',value:'#C62828'},{name:'주황',value:'#EF6C00'},{name:'초록',value:'#2E7D32'},{name:'파랑',value:'#1565C0'},{name:'보라',value:'#6A1B9A'}] as const;
type Point = {x:number;y:number};
type Stroke = {color:string;erase:boolean;points:Point[]};
const SIZE = 768;
const isMac = () => /Mac|iPhone|iPad/.test(globalThis.navigator?.platform || globalThis.navigator?.userAgent || '');
/** CGP-CHAT-D-020: Cmd+Z on macOS, Ctrl+Z elsewhere, no Shift (redo) or Alt. The physical key also
 * counts, so a Korean input source (where `key` is 'ㅋ') still undoes. */
export function isSketchUndoShortcut(e: Pick<KeyboardEvent,'key'|'code'|'altKey'|'shiftKey'|'ctrlKey'|'metaKey'|'isComposing'>, mac = isMac()) {
  if ((e.key.toLowerCase() !== 'z' && e.code !== 'KeyZ') || e.altKey || e.shiftKey || e.isComposing) return false;
  return mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
}
/** Local learner marks only; attaching saves through the same host preparation as pasted images. */
export function SketchDialog({scope,allowed,onClose,onAttach}: {scope:string;allowed:boolean;onClose:()=>void;onAttach:(png:string)=>boolean}) {
  const dialog=useRef<HTMLDialogElement>(null),canvas=useRef<HTMLCanvasElement>(null),title=useId();
  const [strokes,setStrokes]=useState<Stroke[]>([]),[color,setColor]=useState<string>(SKETCH_COLORS[0].value),[erase,setErase]=useState(false);
  const [discard,setDiscard]=useState(false),[note,setNote]=useState('');
  const active=useRef<Stroke|null>(null),cursor=useRef<Point>({x:SIZE/2,y:SIZE/2});
  const preparation=useAttachmentSendPreparation(scope,true),alive=useRef(true),composing=useRef(false),keepDrawing=useRef<HTMLButtonElement>(null),hint=useId();
  useLayoutEffect(()=>{if(discard)keepDrawing.current?.focus();},[discard]);
  useLayoutEffect(()=>{alive.current=true;const element=dialog.current!;element.showModal();return()=>{alive.current=false;element.close();};},[]);
  const close=()=>{if(preparation.busy)return;if(strokes.length||active.current)setDiscard(true);else onClose();};
  useDialogFocus(dialog,{open:true,kind:'modal',keepFocusOnDismiss:true,onDismiss:close});
  const paint=(items:Stroke[])=>{
    const ctx=canvas.current?.getContext('2d');if(!ctx)return;
    ctx.fillStyle='#FFFFFF';ctx.fillRect(0,0,SIZE,SIZE);ctx.lineCap='round';ctx.lineJoin='round';
    for(const stroke of items){ctx.strokeStyle=stroke.erase?'#FFFFFF':stroke.color;ctx.fillStyle=ctx.strokeStyle;ctx.lineWidth=stroke.erase?24:5;const [first,...rest]=stroke.points;if(!first)continue;
      ctx.beginPath();ctx.moveTo(first.x,first.y);for(const point of rest)ctx.lineTo(point.x,point.y);ctx.stroke();
      if(!rest.length){ctx.beginPath();ctx.arc(first.x,first.y,ctx.lineWidth/2,0,Math.PI*2);ctx.fill();}
    }
  };
  useLayoutEffect(()=>paint(strokes),[strokes]);
  const point=(event:{clientX:number;clientY:number}):Point=>{const box=canvas.current!.getBoundingClientRect();return {x:Math.max(0,Math.min(SIZE,(event.clientX-box.left)/box.width*SIZE)),y:Math.max(0,Math.min(SIZE,(event.clientY-box.top)/box.height*SIZE))};};
  const finish=()=>{const stroke=active.current;active.current=null;if(stroke)setStrokes(previous=>[...previous,stroke]);};
  const attach=async()=>{
    if(!allowed||preparation.busy||!strokes.length||active.current)return;
    const png=canvas.current!.toDataURL('image/png');setNote('');
    if(await preparation.prepare([{id:'sketch',dataUrl:png}])){
      if(!alive.current)return;
      if(onAttach(png))onClose();else setNote('이미지 첨부 수를 확인해 주세요. 그림은 그대로 남아 있어요.');
    }
  };
  return <dialog ref={dialog} className="hp-modal hps-sketch" aria-labelledby={title} onKeyDown={event=>{composing.current=imeComposing(event);if(composing.current&&event.key==='Escape')event.preventDefault();
      // Undo stays inside the sketch: it never reaches the host editor's undo, and it waits while a stroke is down, a save runs or the discard question is open.
      if(!composing.current&&isSketchUndoShortcut(event.nativeEvent)){event.preventDefault();event.stopPropagation();if(!discard&&!preparation.busy&&!active.current)setStrokes(previous=>previous.slice(0,-1));}}} onCancel={event=>{event.preventDefault();if(!composing.current)close();}}>
    <h2 id={title}>그려서 보여주기</h2>
    <div className="hps-sketch-tools" role="group" aria-label="그리기 도구">
      <button type="button" className="hps-panel-fallback-retry" aria-pressed={!erase} disabled={preparation.busy} aria-label="펜" onClick={()=>setErase(false)}>{!erase&&<ChatIcon kind="check" />}펜</button>
      <button type="button" className="hps-panel-fallback-retry" aria-pressed={erase} disabled={preparation.busy} aria-label="지우개" onClick={()=>setErase(true)}>{erase&&<ChatIcon kind="check" />}지우개</button>
      {SKETCH_COLORS.map(item=><button key={item.name} type="button" className="hps-panel-fallback-retry" aria-pressed={!erase&&color===item.value} disabled={preparation.busy} aria-label={item.name} onClick={()=>{setColor(item.value);setErase(false);}}>{!erase&&color===item.value&&<ChatIcon kind="check" />}{item.name}</button>)}
      <button type="button" className="hps-panel-fallback-retry" disabled={!strokes.length||preparation.busy} onClick={()=>setStrokes(previous=>previous.slice(0,-1))}>실행 취소</button>
      <button type="button" className="hps-panel-fallback-retry" disabled={!strokes.length||preparation.busy} onClick={()=>setStrokes([])}>모두 지우기</button>
    </div>
    <p id={hint}>드래그해서 그려 주세요. 키보드는 방향키로 이동하고 Shift와 방향키로 그릴 수 있어요. {isMac()?'Cmd':'Ctrl'}+Z로 실행 취소할 수 있어요.</p>
    <canvas ref={canvas} width={SIZE} height={SIZE} className="hps-sketch-canvas" tabIndex={0} role="img" aria-label="그림판" aria-describedby={hint}
      onPointerDown={event=>{if(preparation.busy||!allowed||event.button!==0||active.current)return;event.preventDefault();event.currentTarget.focus();event.currentTarget.setPointerCapture(event.pointerId);active.current={color,erase,points:[point(event)]};paint([...strokes,active.current]);}}
      onPointerMove={event=>{if(!active.current)return;if(active.current.points.length>=5000)return;active.current.points.push(point(event));paint([...strokes,active.current]);}}
      onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
      onKeyDown={event=>{const move:Record<string,Point>={ArrowLeft:{x:-8,y:0},ArrowRight:{x:8,y:0},ArrowUp:{x:0,y:-8},ArrowDown:{x:0,y:8}};const delta=move[event.key];if(!delta||preparation.busy||!allowed||event.nativeEvent.isComposing)return;event.preventDefault();const previous=cursor.current;cursor.current={x:Math.max(0,Math.min(SIZE,previous.x+delta.x)),y:Math.max(0,Math.min(SIZE,previous.y+delta.y))};if(event.shiftKey)setStrokes(items=>[...items,{color,erase,points:[previous,cursor.current]}]);}} />
    {!allowed&&<p role="status">지금은 그림을 붙일 수 없어요. 그림은 그대로 남아 있어요.</p>}
    {preparation.failures.map(failure=><p key={failure.id} role="alert">{failure.reason}</p>)}
    {note&&<p role="alert">{note}</p>}
    {discard?<div role="group" aria-label="그림 버리기 확인"><p>그린 내용을 버리고 닫을까요?</p><button type="button" ref={keepDrawing} className="hps-panel-fallback-retry" onClick={()=>{setDiscard(false);requestAnimationFrame(()=>canvas.current?.focus());}}>계속 그리기</button><button type="button" className="hps-panel-fallback-retry" onClick={onClose}>버리고 닫기</button></div>:<div className="hps-sketch-tools"><button type="button" className="hps-panel-fallback-retry" disabled={preparation.busy} onClick={close}>닫기</button><button type="button" className="hps-panel-fallback-retry" disabled={!strokes.length||preparation.busy||!allowed} onClick={()=>void attach()}>{preparation.busy?'저장 중…':'그림 붙이기'}</button></div>}
  </dialog>;
}
