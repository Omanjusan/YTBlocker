import { removeEntry } from '../shared/storage';

const DURATION_MS = 5000;

function truncate(text: string, max = 10): string {
  return text.length <= max ? text : text.slice(0, max) + '…';
}

export function showToast(label: string, entryId: string): void {
  const toast = document.createElement('div');
  toast.style.cssText = [
    'position:fixed',
    'bottom:24px',
    'right:24px',
    'z-index:2147483647',
    'display:flex',
    'align-items:center',
    'gap:10px',
    'background:#222',
    'color:#fff',
    'font-size:13px',
    'font-family:Roboto,Arial,sans-serif',
    'padding:10px 14px',
    'border-radius:6px',
    'box-shadow:0 2px 8px rgba(0,0,0,0.5)',
    'opacity:1',
    'transition:opacity 0.3s',
    'max-width:320px',
  ].join(';');

  const msg = document.createElement('span');
  msg.textContent = `🚫 「${truncate(label)}」をNG登録しました`;
  msg.style.cssText = 'flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';

  const revertBtn = document.createElement('button');
  revertBtn.textContent = '元に戻す';
  revertBtn.style.cssText = [
    'background:#555',
    'color:#fff',
    'border:none',
    'border-radius:4px',
    'padding:3px 9px',
    'font-size:12px',
    'font-family:Roboto,Arial,sans-serif',
    'cursor:pointer',
    'flex-shrink:0',
    'white-space:nowrap',
  ].join(';');
  revertBtn.addEventListener('mouseenter', () => { revertBtn.style.background = '#777'; });
  revertBtn.addEventListener('mouseleave', () => { revertBtn.style.background = '#555'; });

  let dismissed = false;
  function dismiss() {
    if (dismissed) return;
    dismissed = true;
    clearTimeout(timer);
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }

  revertBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await removeEntry(entryId);
    dismiss();
  });

  const timer = setTimeout(dismiss, DURATION_MS);

  toast.append(msg, revertBtn);
  document.body.appendChild(toast);
}
