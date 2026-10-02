/** Trigger a browser download for a blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function downloadText(text: string, filename: string, mime = 'text/plain;charset=utf-8'): void {
  downloadBlob(new Blob([text], { type: mime }), filename);
}

export function sanitizeFilename(name: string): string {
  return (name.trim() || 'project').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'project';
}
