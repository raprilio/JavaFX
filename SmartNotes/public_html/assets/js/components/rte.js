// Lightweight rich-text editor on top of contenteditable.
// Output HTML is always re-sanitized on the server (whitelist) before it is stored.
import { html, icon, h, $$, loadScript, esc } from '../core/dom.js';
import { menu, popover, prompt, toast } from '../core/ui.js';

const TEXT_COLORS = ['', '#e5484d', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#0ea5e9', '#6366f1', '#a855f7', '#ec4899', '#64748b', '#111827'];
const HL_COLORS = ['', '#fef08a', '#bbf7d0', '#bae6fd', '#fbcfe8', '#fed7aa', '#ddd6fe', '#e5e7eb'];
const SIZES = [['Small', '13px'], ['Normal', ''], ['Large', '19px'], ['Huge', '25px']];

function toolbarHtml(opts) {
  const b = (cmd, ic, tip, extra = '') => html`<button type="button" class="btn" data-cmd="${cmd}" data-tip="${tip}" aria-label="${tip}" ${extra}>${icon(ic, 'sm')}</button>`;
  return html`
    ${b('undo', 'undo-2', 'Undo')}${b('redo', 'redo-2', 'Redo')}<span class="sep"></span>
    <button type="button" class="btn" data-cmd="block" data-tip="Text style" style="gap:4px">${icon('heading', 'sm')}${icon('chevron-down', 'sm')}</button>
    <button type="button" class="btn" data-cmd="size" data-tip="Font size" style="gap:4px">${icon('a-large-small', 'sm')}${icon('chevron-down', 'sm')}</button><span class="sep"></span>
    ${b('bold', 'bold', 'Bold (Ctrl+B)')}${b('italic', 'italic', 'Italic (Ctrl+I)')}${b('underline', 'underline', 'Underline (Ctrl+U)')}${b('strikeThrough', 'strikethrough', 'Strikethrough')}
    ${b('foreColor', 'baseline', 'Text color')}${b('hiliteColor', 'highlighter', 'Highlight')}<span class="sep"></span>
    ${b('align', 'align-left', 'Alignment')}${b('insertUnorderedList', 'list', 'Bullet list')}${b('insertOrderedList', 'list-ordered', 'Numbered list')}${b('checklist', 'list-checks', 'Checklist')}<span class="sep"></span>
    ${b('quote', 'quote', 'Quote')}${b('code', 'code', 'Code block')}${b('link', 'link', 'Link')}${b('table', 'table', 'Table')}${b('hr', 'minus', 'Divider')}${b('removeFormat', 'remove-formatting', 'Clear formatting')}
    ${opts.media ? html`<span class="sep"></span>${b('image', 'image-plus', 'Insert image')}${b('audio', 'mic', 'Record / attach audio')}${b('file', 'paperclip', 'Attach file')}` : ''}`;
}

export function createRTE({ content = '', placeholder = 'Start writing…', media = true, onChange, onImages, onAudio, onFiles, onImageOpen } = {}) {
  const toolbar = h('<div class="fmt-bar" role="toolbar" aria-label="Formatting"></div>');
  toolbar.innerHTML = String(toolbarHtml({ media }));
  const editor = h(`<div class="rte" contenteditable="true" spellcheck="true" data-placeholder="${esc(placeholder)}"></div>`);
  editor.innerHTML = content || '';
  let savedRange = null;

  const changed = () => onChange?.();
  const exec = (cmd, val = null) => {
    editor.focus({ preventScroll: true });
    restore();
    document.execCommand(cmd, false, val);
    changed();
    updateState();
  };
  const save = () => {
    const sel = window.getSelection();
    if (sel.rangeCount && editor.contains(sel.anchorNode)) savedRange = sel.getRangeAt(0).cloneRange();
  };
  const restore = () => {
    if (!savedRange) return;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange);
  };
  const blockOf = (node) => {
    while (node && node !== editor) {
      if (node.nodeType === 1 && /^(P|DIV|H[1-6]|LI|BLOCKQUOTE|PRE|TD|TH)$/.test(node.tagName)) return node;
      node = node.parentNode;
    }
    return null;
  };
  const caretNode = () => {
    const sel = window.getSelection();
    return sel.rangeCount && editor.contains(sel.anchorNode) ? sel.anchorNode : null;
  };

  editor.addEventListener('focus', () => {
    try { document.execCommand('styleWithCSS', false, true); document.execCommand('defaultParagraphSeparator', false, 'p'); } catch { /* old browser */ }
  });
  document.addEventListener('selectionchange', onSel);
  function onSel() { if (document.activeElement === editor) { save(); updateState(); } }

  function updateState() {
    ['bold', 'italic', 'underline', 'strikeThrough', 'insertUnorderedList', 'insertOrderedList'].forEach((c) => {
      let on = false;
      try { on = document.queryCommandState(c); } catch { /* ignore */ }
      toolbar.querySelector(`[data-cmd="${c}"]`)?.classList.toggle('on', on);
    });
    const n = caretNode();
    const ul = n && (n.nodeType === 1 ? n : n.parentElement)?.closest('ul');
    toolbar.querySelector('[data-cmd="checklist"]')?.classList.toggle('on', !!ul?.classList.contains('checklist'));
    if (ul?.classList.contains('checklist')) toolbar.querySelector('[data-cmd="insertUnorderedList"]')?.classList.remove('on');
  }

  // ---------------------------------------------------------- checklist
  function toggleChecklist() {
    editor.focus();
    restore();
    let n = caretNode();
    let el = n && (n.nodeType === 1 ? n : n.parentElement);
    let ul = el?.closest('ul');
    if (ul && ul.classList.contains('checklist')) {
      ul.classList.remove('checklist');
      ul.querySelectorAll(':scope > li').forEach((li) => li.removeAttribute('data-checked'));
    } else {
      if (!ul || !editor.contains(ul)) document.execCommand('insertUnorderedList');
      n = caretNode();
      el = n && (n.nodeType === 1 ? n : n.parentElement);
      ul = el?.closest('ul');
      if (ul) {
        ul.classList.add('checklist');
        ul.querySelectorAll(':scope > li').forEach((li) => li.dataset.checked = li.dataset.checked === 'true' ? 'true' : 'false');
      }
    }
    changed();
    updateState();
  }
  editor.addEventListener('click', (e) => {
    const li = e.target.closest('ul.checklist > li');
    if (li && e.offsetX < 26 && e.target === li) {
      e.preventDefault();
      li.dataset.checked = li.dataset.checked === 'true' ? 'false' : 'true';
      changed();
      return;
    }
    const img = e.target.closest('img');
    $$('img.selected', editor).forEach((x) => x !== img && x.classList.remove('selected'));
    if (img) {
      img.classList.add('selected');
      if (e.detail >= 2 || matchMedia('(pointer: coarse)').matches) onImageOpen?.(img);
    }
  });
  editor.addEventListener('dblclick', (e) => { const img = e.target.closest('img'); if (img) onImageOpen?.(img); });

  // ---------------------------------------------------------- keyboard
  editor.addEventListener('keydown', (e) => {
    const n = caretNode();
    const el = n && (n.nodeType === 1 ? n : n.parentElement);
    if (e.key === 'Enter' && !e.shiftKey) {
      const li = el?.closest('ul.checklist > li');
      if (li) setTimeout(() => {
        const c = caretNode();
        const nli = c && (c.nodeType === 1 ? c : c.parentElement)?.closest('ul.checklist > li');
        if (nli && nli !== li) nli.dataset.checked = 'false';
      });
      const pre = el?.closest('pre');
      if (pre) { e.preventDefault(); document.execCommand('insertText', false, '\n'); }
    }
    if (e.key === 'Tab') {
      const inList = el?.closest('li');
      if (inList) { e.preventDefault(); document.execCommand(e.shiftKey ? 'outdent' : 'indent'); changed(); }
      else if (el?.closest('td,th')) {
        e.preventDefault();
        const cells = $$('td,th', el.closest('table'));
        const i = cells.indexOf(el.closest('td,th'));
        const next = cells[i + (e.shiftKey ? -1 : 1)];
        if (next) placeCaret(next);
      }
    }
    if ((e.key === 'Backspace' || e.key === 'Delete')) {
      const img = editor.querySelector('img.selected');
      if (img) { e.preventDefault(); img.remove(); changed(); }
    }
  });

  // Markdown-style shortcuts at the start of a line: "# ", "## ", "- ", "1. ", "[] ", "> ", "```"
  editor.addEventListener('input', (e) => {
    changed();
    if (e.inputType !== 'insertText' || e.data !== ' ') return;
    const n = caretNode();
    if (!n || n.nodeType !== 3) return;
    const block = blockOf(n);
    if (!block || block.tagName === 'LI' || block.tagName === 'PRE') return;
    const text = n.textContent.slice(0, window.getSelection().anchorOffset);
    if (n !== firstText(block) || !/^(#{1,3}|-|\*|1\.|\[\]|>)\s$/.test(text.replace(/ /g, ' '))) return;
    const token = text.trim();
    n.textContent = n.textContent.slice(text.length);
    placeCaret(block);
    if (token.startsWith('#')) document.execCommand('formatBlock', false, 'h' + token.length);
    else if (token === '-' || token === '*') document.execCommand('insertUnorderedList');
    else if (token === '1.') document.execCommand('insertOrderedList');
    else if (token === '[]') toggleChecklist();
    else if (token === '>') document.execCommand('formatBlock', false, 'blockquote');
    changed();
  });
  function firstText(node) {
    const w = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    return w.nextNode();
  }
  function placeCaret(node, atEnd = false) {
    const r = document.createRange();
    r.selectNodeContents(node);
    r.collapse(!atEnd);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  }

  // ---------------------------------------------------------- paste & drop
  editor.addEventListener('paste', async (e) => {
    const cd = e.clipboardData;
    if (!cd) return;
    const files = Array.from(cd.files || []).filter((f) => /^image\//.test(f.type));
    if (files.length && onImages) {
      e.preventDefault();
      save();
      onImages(files);
      return;
    }
    const htmlData = cd.getData('text/html');
    if (htmlData) {
      e.preventDefault();
      let clean = '';
      try {
        await loadScript('assets/vendor/purify.min.js');
        clean = window.DOMPurify.sanitize(htmlData, {
          ALLOWED_TAGS: ['p', 'div', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'a', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'hr', 'span', 'mark', 'sub', 'sup'],
          ALLOWED_ATTR: ['href', 'colspan', 'rowspan'],
        });
      } catch {
        clean = esc(cd.getData('text/plain')).replace(/\n/g, '<br>');
      }
      document.execCommand('insertHTML', false, clean);
      changed();
    }
  });
  editor.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
  editor.addEventListener('drop', (e) => {
    const files = Array.from(e.dataTransfer?.files || []);
    if (!files.length) return;
    e.preventDefault();
    e.stopPropagation();
    const range = document.caretRangeFromPoint?.(e.clientX, e.clientY)
      || (document.caretPositionFromPoint && (() => { const p = document.caretPositionFromPoint(e.clientX, e.clientY); const r = document.createRange(); r.setStart(p.offsetNode, p.offset); return r; })());
    if (range) { const s = window.getSelection(); s.removeAllRanges(); s.addRange(range); save(); }
    const imgs = files.filter((f) => /^image\/(jpeg|png|webp)$/.test(f.type));
    const audio = files.filter((f) => /^audio\//.test(f.type));
    const others = files.filter((f) => !imgs.includes(f) && !audio.includes(f));
    if (imgs.length) onImages?.(imgs);
    if (audio.length) onAudio?.(audio);
    if (others.length) onFiles?.(others);
  });

  // ---------------------------------------------------------- toolbar
  toolbar.addEventListener('mousedown', (e) => { if (e.target.closest('.btn')) e.preventDefault(); });
  toolbar.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-cmd]');
    if (!btn) return;
    const cmd = btn.dataset.cmd;
    switch (cmd) {
      case 'undo': case 'redo': case 'bold': case 'italic': case 'underline': case 'strikeThrough':
      case 'insertUnorderedList': case 'insertOrderedList': case 'removeFormat':
        exec(cmd); break;
      case 'hr': exec('insertHorizontalRule'); break;
      case 'quote': exec('formatBlock', 'blockquote'); break;
      case 'code': exec('formatBlock', 'pre'); break;
      case 'checklist': toggleChecklist(); break;
      case 'block':
        menu(btn, [['p', 'Normal text', 'pilcrow'], ['h1', 'Heading 1', 'heading-1'], ['h2', 'Heading 2', 'heading-2'], ['h3', 'Heading 3', 'heading-3'], ['blockquote', 'Quote', 'quote'], ['pre', 'Code block', 'code']]
          .map(([t, l, i]) => ({ label: l, icon: i, onClick: () => exec('formatBlock', t) })));
        break;
      case 'size':
        menu(btn, SIZES.map(([l, px]) => ({ label: l, icon: 'type', onClick: () => setSize(px) })));
        break;
      case 'align':
        menu(btn, [['justifyLeft', 'Align left', 'align-left'], ['justifyCenter', 'Center', 'align-center'], ['justifyRight', 'Align right', 'align-right'], ['justifyFull', 'Justify', 'align-justify']]
          .map(([c, l, i]) => ({ label: l, icon: i, onClick: () => exec(c) })));
        break;
      case 'foreColor': case 'hiliteColor': {
        const list = cmd === 'foreColor' ? TEXT_COLORS : HL_COLORS;
        const wrap = h(String(html`<div><div class="menu-title">${cmd === 'foreColor' ? 'Text color' : 'Highlight'}</div><div class="swatches">${list.map((c) => html`<button class="swatch" data-c="${c}" style="--sw:${c || 'var(--bg-elev)'}">${c ? '' : icon('slash', 'sm')}</button>`)}</div></div>`));
        const p = popover(btn, wrap);
        wrap.addEventListener('mousedown', (ev) => ev.preventDefault());
        wrap.addEventListener('click', (ev) => {
          const s = ev.target.closest('[data-c]');
          if (!s) return;
          p.close();
          const c = s.dataset.c;
          if (cmd === 'foreColor') exec('foreColor', c || 'inherit');
          else exec('hiliteColor', c || 'transparent');
        });
        break;
      }
      case 'link': {
        save();
        const sel = window.getSelection();
        const text = sel.toString();
        const url = await prompt({ title: 'Insert link', label: 'URL', placeholder: 'https://example.com', confirmText: 'Insert', type: 'url' });
        if (!url) return;
        const href = /^(https?:|mailto:|tel:)/i.test(url) ? url : 'https://' + url;
        editor.focus();
        restore();
        if (text) exec('createLink', href);
        else exec('insertHTML', `<a href="${esc(href)}">${esc(url)}</a>&nbsp;`);
        break;
      }
      case 'table':
        tableMenu(btn);
        break;
      case 'image': save(); pick('image/jpeg,image/png,image/webp', true).then((f) => f.length && onImages?.(f)); break;
      case 'audio': save(); onAudio?.(null); break;
      case 'file': pick('', true).then((f) => f.length && onFiles?.(f)); break;
    }
  });

  function setSize(px) {
    editor.focus();
    restore();
    document.execCommand('styleWithCSS', false, false);
    document.execCommand('fontSize', false, '7');
    document.execCommand('styleWithCSS', false, true);
    editor.querySelectorAll('font[size="7"]').forEach((f) => {
      const span = document.createElement('span');
      if (px) span.style.fontSize = px;
      while (f.firstChild) span.appendChild(f.firstChild);
      f.replaceWith(span);
    });
    editor.querySelectorAll('span[style*="xxx-large"]').forEach((s) => { s.style.fontSize = px || ''; if (!s.getAttribute('style')) s.removeAttribute('style'); });
    changed();
  }

  function currentCell() {
    const n = caretNode();
    return n && (n.nodeType === 1 ? n : n.parentElement)?.closest('td,th');
  }
  function tableMenu(btn) {
    const cell = currentCell();
    const items = [{ label: 'Insert 3 × 3 table', icon: 'table', onClick: () => insertTable(3, 3) }, { label: 'Insert 2 × 4 table', icon: 'table', onClick: () => insertTable(4, 2) }];
    if (cell) {
      const row = cell.parentElement;
      const table = cell.closest('table');
      const idx = Array.from(row.children).indexOf(cell);
      items.push({ divider: true },
        { label: 'Add row below', icon: 'between-horizontal-start', onClick: () => { const r = row.cloneNode(true); r.querySelectorAll('td,th').forEach((c) => { const td = document.createElement('td'); td.innerHTML = '<br>'; c.replaceWith(td); }); row.after(r); changed(); } },
        { label: 'Add column right', icon: 'between-vertical-start', onClick: () => { table.querySelectorAll('tr').forEach((tr) => { const c = tr.children[idx]; const n = document.createElement(c?.tagName === 'TH' ? 'th' : 'td'); n.innerHTML = '<br>'; c ? c.after(n) : tr.appendChild(n); }); changed(); } },
        { label: 'Delete row', icon: 'minus', onClick: () => { if (table.querySelectorAll('tr').length > 1) row.remove(); else table.remove(); changed(); } },
        { label: 'Delete column', icon: 'minus', onClick: () => { table.querySelectorAll('tr').forEach((tr) => tr.children[idx]?.remove()); if (!table.querySelector('td,th')) table.remove(); changed(); } },
        { label: 'Delete table', icon: 'trash-2', danger: true, onClick: () => { table.remove(); changed(); } });
    }
    menu(btn, items);
  }
  function insertTable(cols, rows) {
    let t = '<table><thead><tr>' + Array.from({ length: cols }, (_, i) => `<th>Header ${i + 1}</th>`).join('') + '</tr></thead><tbody>';
    for (let r = 0; r < rows; r++) t += '<tr>' + Array.from({ length: cols }, () => '<td><br></td>').join('') + '</tr>';
    exec('insertHTML', t + '</tbody></table><p><br></p>');
  }

  function pick(accept, multiple) {
    return new Promise((resolve) => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = accept;
      inp.multiple = multiple;
      inp.onchange = () => resolve(Array.from(inp.files || []));
      inp.click();
    });
  }

  return {
    toolbar,
    editor,
    getHTML() {
      const clone = editor.cloneNode(true);
      clone.querySelectorAll('img.selected').forEach((i) => i.classList.remove('selected'));
      clone.querySelectorAll('[class=""]').forEach((x) => x.removeAttribute('class'));
      return clone.innerHTML.trim() === '<br>' ? '' : clone.innerHTML;
    },
    getText: () => editor.innerText,
    setHTML(v) { editor.innerHTML = v || ''; },
    /** Insert HTML at the last known caret position (or the end). */
    insertHTML(htmlStr) {
      editor.focus({ preventScroll: true });
      if (savedRange && editor.contains(savedRange.startContainer)) {
        // Insert after the selection instead of replacing selected text.
        savedRange.collapse(false);
        restore();
      } else placeCaret(editor, true);
      document.execCommand('insertHTML', false, htmlStr);
      save();
      changed();
    },
    focus: () => editor.focus(),
    destroy() { document.removeEventListener('selectionchange', onSel); },
    toast,
  };
}
