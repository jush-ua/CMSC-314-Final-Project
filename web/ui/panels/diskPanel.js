import { CONFIG } from "../../config.js?v=20260503c";

/** Simple modal dialog helper for user input (replaces prompt/confirm). */
function createInputDialog(title, defaultValue = '') {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;z-index:10000';
    const dialog = document.createElement('div');
    dialog.style.cssText = 'background:white;border-radius:12px;padding:20px;min-width:300px;box-shadow:0 20px 60px rgba(0,0,0,0.3)';
    dialog.innerHTML = `
      <div style="font-weight:600;margin-bottom:12px">${title}</div>
      <input type="text" value="${defaultValue}" style="width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;box-sizing:border-box;margin-bottom:12px" />
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button style="padding:6px 12px;border-radius:6px;border:1px solid #ccc;cursor:pointer">Cancel</button>
        <button style="padding:6px 12px;border-radius:6px;background:#007AFF;color:white;border:0;cursor:pointer">OK</button>
      </div>
    `;
    overlay.appendChild(dialog);
    const input = dialog.querySelector('input');
    const [cancelBtn, okBtn] = dialog.querySelectorAll('button');
    const cleanup = () => overlay.remove();
    cancelBtn.onclick = () => { cleanup(); resolve(null); };
    okBtn.onclick = () => { cleanup(); resolve(input.value); };
    input.focus();
    input.onkeydown = (e) => { if (e.key === 'Enter') okBtn.click(); if (e.key === 'Escape') cancelBtn.click(); };
    document.body.appendChild(overlay);
  });
}

function createConfirmDialog(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;z-index:10000';
    const dialog = document.createElement('div');
    dialog.style.cssText = 'background:white;border-radius:12px;padding:20px;min-width:320px;box-shadow:0 20px 60px rgba(0,0,0,0.3)';
    dialog.innerHTML = `
      <div style="margin-bottom:12px">${message}</div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button id="c-cancel" style="padding:6px 12px;border-radius:6px;border:1px solid #ccc;cursor:pointer">Cancel</button>
        <button id="c-ok" style="padding:6px 12px;border-radius:6px;background:#ff3b30;color:white;border:0;cursor:pointer">Delete</button>
      </div>
    `;
    overlay.appendChild(dialog);
    const cancelBtn = dialog.querySelector('#c-cancel');
    const okBtn = dialog.querySelector('#c-ok');
    const cleanup = () => overlay.remove();
    cancelBtn.onclick = () => { cleanup(); resolve(false); };
    okBtn.onclick = () => { cleanup(); resolve(true); };
    document.body.appendChild(overlay);
  });
}

/** Creates the disk manager panel renderer with canvases, queues, and FAT views. */
export function createDiskPanel({ container, disk, requestRender }) {
  const state = { dirty: true, cwd: '/', selectedFile: null };

  container.innerHTML = `
    <div class="panel-shell disk-panel file-explorer-panel">
      <div class="fe-toolbar">
        <button class="sf-button" data-role="up">Up</button>
        <input class="sf-input" data-field="path" value="/" />
        <button class="sf-button primary" data-role="mkdir">New Folder</button>
        <button class="sf-button" data-role="touch">New File</button>
        <button class="sf-button" data-role="rename">Rename</button>
        <button class="sf-button" data-role="delete">Delete</button>
      </div>
      <div class="fe-body">
        <aside class="fe-tree" data-role="tree"></aside>
        <section class="fe-list" data-role="list"></section>
        <section class="fe-editor">
          <div class="fe-editor-header"><span data-role="editor-path">No file</span></div>
          <textarea class="file-content" data-role="editor" spellcheck="false"></textarea>
          <div class="fe-editor-actions">
            <input class="sf-input" data-field="pid" type="number" min="1" value="${CONFIG.disk.defaultProcessId}" />
            <button class="sf-button primary" data-role="save">Save</button>
            <button class="sf-button" data-role="reload">Reload</button>
          </div>
        </section>
      </div>
    </div>
  `;

  const refs = {
    pathField: container.querySelector('[data-field="path"]'),
    tree: container.querySelector('[data-role="tree"]'),
    list: container.querySelector('[data-role="list"]'),
    mkdir: container.querySelector('[data-role="mkdir"]'),
    touch: container.querySelector('[data-role="touch"]'),
    rename: container.querySelector('[data-role="rename"]'),
    del: container.querySelector('[data-role="delete"]'),
    up: container.querySelector('[data-role="up"]'),
    editor: container.querySelector('[data-role="editor"]'),
    editorPath: container.querySelector('[data-role="editor-path"]'),
    save: container.querySelector('[data-role="save"]'),
    reload: container.querySelector('[data-role="reload"]'),
    pid: container.querySelector('[data-field="pid"]'),
  };

  function markDirty() { state.dirty = true; requestRender(); }

  // Context menu element (singleton for this panel)
  let contextMenuEl = null;
  function ensureContextMenu() {
    if (contextMenuEl) return contextMenuEl;
    contextMenuEl = document.createElement('div');
    contextMenuEl.className = 'fe-context-menu hidden';
    contextMenuEl.style.cssText = 'position:fixed;z-index:12000;min-width:200px;background:white;border:1px solid rgba(0,0,0,0.08);box-shadow:0 8px 30px rgba(0,0,0,0.18);border-radius:8px;overflow:hidden;padding:6px';
    document.body.appendChild(contextMenuEl);
    window.addEventListener('click', () => { contextMenuEl.classList.add('hidden'); });
    return contextMenuEl;
  }

  function showContextMenu(x, y, item) {
    const menu = ensureContextMenu();
    menu.innerHTML = '';
    const make = (label, cb) => {
      const el = document.createElement('div'); el.className = 'fe-context-item'; el.textContent = label; el.style.cssText = 'padding:8px 12px;cursor:pointer'; el.addEventListener('click', (e) => { e.stopPropagation(); cb(); menu.classList.add('hidden'); }); return el;
    };
    if (item.type === 'file') {
      menu.appendChild(make('Open', () => selectFile(item.path)));
      menu.appendChild(make('Rename', async () => { const name = await createInputDialog('Rename file (full path or basename):', item.path); if (!name) return; const newPath = name.startsWith('/') ? name : localDirname(item.path) + '/' + name; disk.renamePath(item.path, newPath); selectDir(localDirname(newPath)); selectFile(newPath); markDirty(); }));
      menu.appendChild(make('Delete', async () => { const ok = await createConfirmDialog(`Delete file ${item.path}?`); if (!ok) return; disk.deletePath(item.path); selectFile(null); markDirty(); }));
    } else if (item.type === 'dir') {
      menu.appendChild(make('Open', () => selectDir(item.path)));
      menu.appendChild(make('New File', async () => { const name = await createInputDialog('New file name:'); if (!name) return; const p = (item.path === '/' ? '' : item.path) + '/' + name; disk.createFile(p, CONFIG.disk.defaultFileSize); selectFile(p); markDirty(); }));
      menu.appendChild(make('New Folder', async () => { const name = await createInputDialog('New folder name:'); if (!name) return; const p = (item.path === '/' ? '' : item.path) + '/' + name; disk.createDirectory(p); selectDir(item.path); markDirty(); }));
      menu.appendChild(make('Rename', async () => { const name = await createInputDialog('Rename directory:', item.path); if (!name) return; const newPath = name.startsWith('/') ? name : localDirname(item.path) + '/' + name; disk.renamePath(item.path, newPath); selectDir(newPath); markDirty(); }));
      menu.appendChild(make('Delete', async () => { const ok = await createConfirmDialog(`Delete directory ${item.path}?`); if (!ok) return; disk.deletePath(item.path); selectDir('/'); markDirty(); }));
    }
    menu.style.left = `${Math.min(window.innerWidth - 240, x)}px`;
    menu.style.top = `${Math.min(window.innerHeight - 200, y)}px`;
    menu.classList.remove('hidden');
  }

  function selectDir(path) {
    state.cwd = path || '/';
    refs.pathField.value = state.cwd;
    renderList();
    renderTree();
  }

  function localDirname(p) {
    if (!p) return '/';
    let s = String(p).trim();
    if (!s || s === '/') return '/';
    if (!s.startsWith('/')) s = '/' + s;
    if (s.length > 1 && s.endsWith('/')) s = s.replace(/\/+$/, '');
    const parts = s.split('/'); parts.pop(); const dir = parts.join('/') || '/'; return dir;
  }

  function selectFile(path) {
    state.selectedFile = path;
    refs.editorPath.textContent = path || 'No file';
    if (!path) { refs.editor.value = ''; return; }
    const res = disk.getFileContent(path);
    refs.editor.value = res.ok ? res.content : '';
    markDirty();
  }

  function renderTree() {
    const snap = disk.getSnapshot();
    const dirs = (snap.directories || []).sort();
    refs.tree.replaceChildren(...dirs.map((d) => {
      const node = document.createElement('div');
      node.className = 'fe-tree-node';
      node.textContent = d;
      node.dataset.path = d;
      node.addEventListener('click', () => selectDir(d));
      // allow dropping files onto a directory
      node.addEventListener('dragover', (e) => { e.preventDefault(); node.classList.add('fe-tree-drop'); });
      node.addEventListener('dragleave', () => { node.classList.remove('fe-tree-drop'); });
      node.addEventListener('drop', (e) => {
        e.preventDefault(); node.classList.remove('fe-tree-drop');
        try {
          const dragged = e.dataTransfer.getData('text/plain');
          if (!dragged) return;
          const src = dragged;
          const destDir = d;
          const base = src.split('/').pop();
          const newPath = (destDir === '/' ? '' : destDir) + '/' + base;
          disk.renamePath(src, newPath);
          selectDir(destDir);
          markDirty();
        } catch (err) {
          console.warn('drop error', err);
        }
      });
      return node;
    }));
  }

  function renderList() {
    const res = disk.listDir(state.cwd);
    if (!res.ok) { refs.list.textContent = res.message; return; }
    const items = [...res.dirs.map((d) => ({ type: 'dir', ...d })), ...res.files.map((f) => ({ type: 'file', ...f }))];
    refs.list.replaceChildren(...(items.length ? items.map((it) => {
      const r = document.createElement('div');
      r.className = 'fe-list-row ' + it.type;
      r.dataset.path = it.path;
      // show icon, name, and size
      const icon = document.createElement('div'); icon.className = 'fe-list-icon'; icon.textContent = it.type === 'dir' ? '📁' : (it.icon === 'image' ? '🖼️' : (it.icon === 'code' ? '🧾' : (it.icon === 'markdown' ? '📄' : '📄')));
      const label = document.createElement('div'); label.className = 'fe-list-label'; label.innerHTML = `<strong>${it.name}</strong><div class="fe-list-meta">${it.type === 'file' ? it.sizeDisplay : ''}</div>`;
      r.appendChild(icon);
      r.appendChild(label);
      r.draggable = it.type === 'file';
      r.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', it.path); e.dataTransfer.effectAllowed = 'move'; });
      r.addEventListener('click', () => { if (it.type === 'dir') selectDir(it.path); else selectFile(it.path); });
      r.addEventListener('contextmenu', (e) => { e.preventDefault(); showContextMenu(e.clientX, e.clientY, it); });
      return r;
    }) : [Object.assign(document.createElement('div'), { className: 'empty-state-card', textContent: 'No content.' })]));
  }

  async function bindControls() {
    refs.mkdir.addEventListener('click', async () => {
      const name = await createInputDialog('New folder name:'); if (!name) return; disk.createDirectory((state.cwd === '/' ? '' : state.cwd) + '/' + name); selectDir(state.cwd); markDirty();
    });
    refs.touch.addEventListener('click', async () => {
      const name = await createInputDialog('New file name:'); if (!name) return; const size = Number(await createInputDialog('Size in sectors:', String(CONFIG.disk.defaultFileSize))) || CONFIG.disk.defaultFileSize; disk.createFile((state.cwd === '/' ? '' : state.cwd) + '/' + name, size); selectFile((state.cwd === '/' ? '' : state.cwd) + '/' + name); markDirty();
    });
    refs.del.addEventListener('click', async () => {
      if (state.selectedFile) {
        const ok = await createConfirmDialog(`Delete file ${state.selectedFile}?`);
        if (!ok) return; disk.deletePath(state.selectedFile); selectFile(null);
      } else {
        const ok = await createConfirmDialog(`Delete directory ${state.cwd}?`);
        if (!ok) return; disk.deletePath(state.cwd); selectDir('/');
      }
      markDirty();
    });
    refs.rename.addEventListener('click', async () => {
      const target = state.selectedFile || state.cwd; const name = await createInputDialog('New name (full path or basename):', target); if (!name) return; const newPath = name.startsWith('/') ? name : localDirname(target) + '/' + name; disk.renamePath(target, newPath); selectDir(localDirname(newPath)); selectFile(newPath); markDirty();
    });
    refs.up.addEventListener('click', () => { const p = localDirname(state.cwd); selectDir(p); });
    refs.pathField.addEventListener('change', () => { selectDir(refs.pathField.value.trim() || '/'); });
    refs.save.addEventListener('click', () => { if (!state.selectedFile) return; const pid = Number(refs.pid.value) || CONFIG.disk.defaultProcessId; disk.writeFile(state.selectedFile, pid, refs.editor.value); markDirty(); });
    refs.reload.addEventListener('click', () => { if (!state.selectedFile) return; selectFile(state.selectedFile); });
  }

  function init() { bindControls(); selectDir('/'); }

  function markDirtyFromBus() { markDirty(); }

  function render() { if (!state.dirty) return; state.dirty = false; renderTree(); renderList(); }

  return { init, markDirty: markDirtyFromBus, render };
}
