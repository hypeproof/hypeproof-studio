// Prevent a slow background read from overwriting revoke or reopening a closed panel.
export class PublishReadGate {
  private revision = 0;
  private closed = true;
  private actions = 0;
  open() { this.closed = false; }
  close() { this.closed = true; this.revision++; }
  beginAction() { this.actions++; this.revision++; }
  endAction() { this.actions--; }
  get canRefresh() { return !this.closed && this.actions === 0; }
  async read<T>(load: () => Promise<T>, post: (value: T) => Promise<void>) {
    if (this.closed) return;
    const revision = ++this.revision;
    const value = await load();
    if (!this.closed && revision === this.revision) await post(value);
  }
}
