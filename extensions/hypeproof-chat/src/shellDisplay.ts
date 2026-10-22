import type { ShellPresentation } from './shellPresentation';
/** Keep the task-file schema readable by older builds: the existing label is plain text. */
export function shellLabel(shell: ShellPresentation): string {
  return `${shell.purpose}\n$ ${shell.command}${shell.folder !== undefined ? `\n폴더: ${shell.folder}` : ''}`;
}
export function storedShell(label: string): ShellPresentation | undefined {
  const lines = label.split('\n');
  if ((lines.length !== 2 && lines.length !== 3) || !lines[1].startsWith('$ ') || (lines.length === 3 && !lines[2].startsWith('폴더: '))) return;
  return { purpose: lines[0], command: lines[1].slice(2), ...(lines.length === 3 ? { folder: lines[2].slice(4) } : {}), collapsed: true };
}
