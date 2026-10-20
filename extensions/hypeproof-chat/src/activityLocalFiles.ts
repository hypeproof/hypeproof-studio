/** Local-only, explicit file selection. No token, Service, model or AI gate is involved. */
export interface LocalFilePorts<T> {
  choose(): Promise<T | undefined>;
  destination(source: T): Promise<T | undefined>;
  open(source: T): Promise<void>;
  copy(source: T, destination: T): Promise<void>;
  current(): boolean;
}
export async function activityLocalFile<T>(action: 'open' | 'export', ports: LocalFilePorts<T>): Promise<void> {
  const source = await ports.choose();
  if (!source || !ports.current()) return;
  if (action === 'open') { await ports.open(source); return; }
  const destination = await ports.destination(source);
  if (!destination || !ports.current()) return;
  await ports.copy(source, destination);
}
