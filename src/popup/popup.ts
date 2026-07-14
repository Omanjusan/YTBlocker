import { getEntries } from '../shared/storage';

const countEl = document.getElementById('count')!;
const openBtn = document.getElementById('open-options')!;

getEntries().then((entries) => {
  countEl.textContent = String(entries.length);
});

openBtn.addEventListener('click', () => {
  browser.runtime.openOptionsPage();
});
