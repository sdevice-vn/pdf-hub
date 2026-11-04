'use strict';
(() => {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

    const api = window.pdfHub;
    const $ = (id) => document.getElementById(id);

    const store = {
        get(key, fallback) {
            try { const v = localStorage.getItem(key); return v === null ? fallback : v; } catch (_) { return fallback; }
        },
        set(key, value) {
            try { localStorage.setItem(key, value); } catch (_) { /* bỏ qua */ }
        }
    };

    // --- STATE ---
    const SORTS = ['newest', 'oldest', 'name', 'size'];
    const state = {
        files: [],
        categories: [],
        catColors: {},
        libraryPath: '',
        libraryReady: false,

        viewMode: ['grid', 'list'].includes(store.get('viewMode', 'grid')) ? store.get('viewMode', 'grid') : 'grid',
        sortBy: SORTS.includes(store.get('sortBy', 'newest')) ? store.get('sortBy', 'newest') : 'newest',
        nav: 'all',              // 'all' | 'trash'
        selectedCategory: 'ALL', // 'ALL' | tên phân loại
        searchQuery: '',
        editingCategory: null,

        // Reader
        readerPdfDoc: null,
        readerCurrentPage: 1,
        readerZoomScale: 1.2,
        readerCurrentFile: null
    };

    const fileContainer = $('fileContainer');
    const emptyState = $('emptyState');
    const searchInput = $('searchInput');
    const uploadModal = $('uploadModal');
    const categoryModal = $('categoryModal');
    const folderModal = $('folderModal');
    const categoryManageList = $('categoryManageList');
    const uploadCategorySelect = $('uploadCategorySelect');
    const trashBar = $('trashBar');
    const welcomeScreen = $('welcomeScreen');
    const contentScroll = $('contentScroll');

    // --- UTILITIES ---
    const escapeHtml = (s) =>
        String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    const numberFormat = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });

    function formatFileSize(bytes) {
        if (!bytes) return '0 KB';
        const units = ['B', 'KB', 'MB', 'GB'];
        const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
        return numberFormat.format(bytes / Math.pow(1024, i)) + ' ' + units[i];
    }

    function formatDate(timestamp) {
        return new Date(timestamp).toLocaleString('vi-VN', {
            year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
        });
    }

    function formatRelative(timestamp) {
        const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
        const date = new Date(timestamp);
        const days = Math.round((dayStart(new Date()) - dayStart(date)) / 86400000);
        if (days <= 0) return 'Hôm nay';
        if (days === 1) return 'Hôm qua';
        if (days < 7) return `${days} ngày trước`;
        return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }

    const baseName = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || p;

    // Mỗi phân loại một màu, ổn định theo tên và không trùng nhau trong cùng danh sách
    const CAT_COLORS = ['#D9663A', '#5B6CFF', '#D4A017', '#D6458A', '#3FA66A', '#9A6BE0', '#2E9BD6', '#8A8F3A'];
    function computeCategoryColors(categories) {
        const used = new Set();
        const map = {};
        for (const name of categories) {
            let h = 0;
            for (const ch of name) h = (h * 31 + ch.codePointAt(0)) >>> 0;
            let idx = h % CAT_COLORS.length;
            for (let step = 0; step < CAT_COLORS.length && used.has(idx); step++) idx = (idx + 1) % CAT_COLORS.length;
            used.add(idx);
            map[name] = CAT_COLORS[idx];
        }
        return map;
    }
    const catColor = (name) => state.catColors[name] || '#8A8F8C';

    // --- TOAST ---
    let toastTimer = null;
    function showToast(message, type = 'success') {
        const toast = $('toast');
        $('toastMessage').textContent = message;
        $('toastIcon').className = 'fa-solid ' + (
            type === 'error' ? 'fa-circle-exclamation' : type === 'info' ? 'fa-circle-info' : 'fa-circle-check');
        toast.classList.remove('opacity-0', 'translate-y-3');
        toast.classList.add('opacity-100', 'translate-y-0');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
            toast.classList.add('opacity-0', 'translate-y-3');
            toast.classList.remove('opacity-100', 'translate-y-0');
        }, type === 'error' ? 5000 : 3000);
    }
    const showError = (err) => showToast((err && err.message) || String(err), 'error');

    function confirmDialog(message, okLabel = 'Xác nhận') {
        return new Promise((resolve) => {
            const modal = $('confirmModal');
            $('confirmMessage').textContent = message;
            $('btnConfirmOk').textContent = okLabel;
            modal.classList.remove('hidden');
            $('btnConfirmCancel').focus();
            const done = (value) => {
                modal.classList.add('hidden');
                $('btnConfirmOk').onclick = null;
                $('btnConfirmCancel').onclick = null;
                resolve(value);
            };
            $('btnConfirmOk').onclick = () => done(true);
            $('btnConfirmCancel').onclick = () => done(false);
        });
    }

    function applySnapshot(snap) {
        state.files = snap.files;
        state.categories = snap.categories;
        state.catColors = computeCategoryColors(snap.categories);
        state.libraryPath = snap.path;
        state.libraryReady = true;
        if (state.selectedCategory !== 'ALL' && !state.categories.includes(state.selectedCategory)) {
            state.selectedCategory = 'ALL';
        }
    }

    // --- THEME ---
    function setTheme(dark, persist = true) {
        document.documentElement.classList.toggle('dark', dark);
        $('themeIcon').className = dark ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
        if (persist) store.set('theme', dark ? 'dark' : 'light');
        api.setTheme(dark).catch(() => { /* chỉ ảnh hưởng thanh tiêu đề */ });
    }

    function initTheme() {
        const saved = store.get('theme', null);
        const dark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
        setTheme(dark, false);
    }

    $('btnThemeToggle').addEventListener('click', () => setTheme(!document.documentElement.classList.contains('dark')));

    // --- DATA VIEW ---
    function visibleFiles() {
        let result = state.files.filter((f) => (state.nav === 'trash' ? f.isTrash : !f.isTrash));
        if (state.nav === 'all' && state.selectedCategory !== 'ALL') {
            result = result.filter((f) => f.category === state.selectedCategory);
        }
        const q = state.searchQuery.trim().toLowerCase();
        if (q) {
            result = result.filter((f) => f.name.toLowerCase().includes(q) || (f.notes && f.notes.toLowerCase().includes(q)));
        }
        const by = {
            newest: (a, b) => b.uploadDate - a.uploadDate,
            oldest: (a, b) => a.uploadDate - b.uploadDate,
            name: (a, b) => a.name.localeCompare(b.name, 'vi', { numeric: true, sensitivity: 'base' }),
            size: (a, b) => b.size - a.size
        };
        return result.sort(by[state.sortBy]);
    }

    // --- RENDER ---
    const NAV_ON = ['bg-sunken', 'text-ink', 'font-medium'];
    const NAV_OFF = ['text-muted', 'hover:bg-sunken/60', 'hover:text-ink'];

    function renderApp() {
        const list = visibleFiles();
        renderSidebar();
        renderHeader(list);
        renderFiles(list);
        updateCategoryDropdowns();
        updateViewControls();
    }

    function renderSidebar() {
        const active = state.files.filter((f) => !f.isTrash);
        const trashed = state.files.filter((f) => f.isTrash);

        $('badge-count-all').textContent = active.length;
        $('badge-count-trash').textContent = trashed.length;

        document.querySelectorAll('[data-nav]').forEach((btn) => {
            const on = btn.dataset.nav === 'trash'
                ? state.nav === 'trash'
                : state.nav === 'all' && state.selectedCategory === 'ALL';
            btn.classList.remove(...NAV_ON, ...NAV_OFF);
            btn.classList.add(...(on ? NAV_ON : NAV_OFF));
            if (on) btn.setAttribute('aria-current', 'page'); else btn.removeAttribute('aria-current');
        });

        $('categoryList').innerHTML = state.categories.map((cat) => {
            const count = active.filter((f) => f.category === cat).length;
            const on = state.nav === 'all' && state.selectedCategory === cat;
            const color = catColor(cat);
            return `
                <button role="listitem" data-cat="${escapeHtml(cat)}" ${on ? 'aria-current="page"' : ''}
                    class="relative w-full flex items-center gap-3 h-9 px-3 rounded-lg text-[13px] text-left transition-colors ${on ? NAV_ON.join(' ') : NAV_OFF.join(' ')}">
                    ${on ? `<span class="absolute left-0 top-2 bottom-2 w-[3px] rounded-r" style="background:${color}"></span>` : ''}
                    <span class="h-2.5 w-2.5 shrink-0 rounded-[3px]" style="background:${color}"></span>
                    <span class="flex-1 truncate">${escapeHtml(cat)}</span>
                    <span class="text-xs tabular-nums text-muted">${count}</span>
                </button>`;
        }).join('');

        $('folderLabel').textContent = state.libraryPath ? baseName(state.libraryPath) : 'Thư mục lưu trữ';
        $('btnOpenFolderModal').title = state.libraryPath || 'Thư mục lưu trữ';
        const totalBytes = active.reduce((sum, f) => sum + f.size, 0);
        $('storageMeta').textContent = `${active.length} tài liệu, ${formatFileSize(totalBytes)}`;
    }

    function renderHeader(list) {
        $('viewTitle').textContent = state.nav === 'trash'
            ? 'Thùng rác'
            : state.selectedCategory === 'ALL' ? 'Tất cả tài liệu' : state.selectedCategory;
        $('viewCount').textContent = state.searchQuery.trim()
            ? `${list.length} kết quả`
            : `${list.length} tài liệu`;
    }

    function updateViewControls() {
        const on = ['bg-panel', 'shadow-sheet', 'text-ink'];
        const off = ['text-muted', 'hover:text-ink'];
        [['grid', $('btnGridView')], ['list', $('btnListView')]].forEach(([mode, btn]) => {
            const active = state.viewMode === mode;
            btn.classList.remove(...on, ...off);
            btn.classList.add(...(active ? on : off));
            btn.setAttribute('aria-pressed', String(active));
        });
        $('sortSelect').value = state.sortBy;
    }

    function updateCategoryDropdowns() {
        const previous = uploadCategorySelect.value;
        uploadCategorySelect.innerHTML = state.categories
            .map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
        if (state.categories.includes(previous)) uploadCategorySelect.value = previous;
    }

    function renderEmpty() {
        const q = state.searchQuery.trim();
        let icon = 'fa-file-circle-plus';
        let title;
        let text;
        let action = '';

        if (state.nav === 'trash') {
            icon = 'fa-trash-can';
            title = 'Thùng rác trống';
            text = 'File bạn bỏ vào thùng rác sẽ nằm ở đây cho đến khi bạn xóa vĩnh viễn.';
        } else if (q) {
            icon = 'fa-magnifying-glass';
            title = `Không có kết quả cho "${q}"`;
            text = 'Thử từ khóa khác hoặc chọn Tất cả tài liệu để bỏ lọc phân loại.';
        } else if (state.selectedCategory !== 'ALL') {
            title = 'Phân loại này chưa có tài liệu';
            text = 'Thêm file PDF và chúng sẽ được lưu trong thư mục của phân loại này.';
            action = `<button data-action="add" class="btn-primary mt-6"><i class="fa-solid fa-plus text-xs"></i> Thêm PDF vào ${escapeHtml(state.selectedCategory)}</button>`;
        } else {
            title = 'Chưa có tài liệu nào';
            text = 'Thêm file PDF để bắt đầu. File được chép vào thư mục lưu trữ của bạn.';
            action = '<button data-action="add" class="btn-primary mt-6"><i class="fa-solid fa-plus text-xs"></i> Thêm PDF</button>';
        }

        emptyState.innerHTML = `
            <span class="grid place-items-center h-14 w-14 rounded-2xl bg-sunken text-muted mb-5"><i class="fa-solid ${icon} text-xl"></i></span>
            <h2 class="text-[17px] font-semibold">${escapeHtml(title)}</h2>
            <p class="mt-1.5 text-[13px] text-muted leading-relaxed">${escapeHtml(text)}</p>
            ${action}`;
    }

    function renderFiles(list) {
        thumbObserver.disconnect();

        const showTrashBar = state.nav === 'trash' && state.files.some((f) => f.isTrash);
        trashBar.classList.toggle('hidden', !showTrashBar);
        trashBar.classList.toggle('flex', showTrashBar);

        if (list.length === 0) {
            renderEmpty();
            fileContainer.innerHTML = '';
            emptyState.classList.remove('hidden');
            emptyState.classList.add('flex');
            return;
        }
        emptyState.classList.add('hidden');
        emptyState.classList.remove('flex');

        if (state.viewMode === 'grid') {
            fileContainer.className = 'grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-x-7 gap-y-9';
            fileContainer.innerHTML = list.map(gridItemHTML).join('');
        } else {
            fileContainer.className = '';
            fileContainer.innerHTML = `
                <div class="grid grid-cols-[40px_minmax(0,1fr)_88px_120px_112px] gap-4 px-2 pb-2 text-xs text-muted">
                    <span></span><span>Tên</span><span>Dung lượng</span><span>Ngày thêm</span><span></span>
                </div>
                <div>${list.map(listRowHTML).join('')}</div>`;
        }
        observeThumbs();
    }

    // --- TỜ GIẤY (thumbnail) ---
    const thumbUrls = new Map();
    const thumbFailed = new Set();
    const thumbPending = new Set();
    const thumbQueue = [];
    let thumbActive = 0;

    function thumbMarkup(id) {
        const url = thumbUrls.get(id);
        return url
            ? `<img class="thumb-img h-full w-full object-contain" src="${url}" alt="" draggable="false">`
            : '<span class="absolute inset-0 grid place-items-center text-black/15"><i class="fa-solid fa-file-pdf text-3xl"></i></span>';
    }

    const stackClass = (file) => (file.pageCount >= 5 ? 'stack-2' : file.pageCount >= 2 ? 'stack-1' : '');

    const thumbObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            thumbObserver.unobserve(entry.target);
            requestThumb(entry.target.dataset.thumbId);
        }
    }, { root: contentScroll, rootMargin: '300px' });

    function observeThumbs() {
        fileContainer.querySelectorAll('[data-thumb-id]').forEach((el) => {
            if (!thumbUrls.has(el.dataset.thumbId) && !thumbFailed.has(el.dataset.thumbId)) thumbObserver.observe(el);
        });
    }

    function requestThumb(id) {
        if (thumbUrls.has(id) || thumbFailed.has(id) || thumbPending.has(id)) return;
        thumbPending.add(id);
        thumbQueue.push(id);
        pumpThumbs();
    }

    function pumpThumbs() {
        while (thumbActive < 2 && thumbQueue.length) {
            const id = thumbQueue.shift();
            thumbActive++;
            loadThumb(id).finally(() => {
                thumbActive--;
                thumbPending.delete(id);
                pumpThumbs();
            });
        }
    }

    async function loadThumb(id) {
        try {
            let bytes = await api.getThumb(id);
            if (!bytes) {
                bytes = await generateThumb(id);
                try { await api.setThumb(id, bytes); } catch (_) { /* vẫn dùng ảnh trong phiên này */ }
            }
            thumbUrls.set(id, URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' })));
            document.querySelectorAll(`[data-thumb-id="${id}"]`).forEach((el) => { el.innerHTML = thumbMarkup(id); });
        } catch (err) {
            console.warn('Không tạo được ảnh xem trước:', err);
            thumbFailed.add(id);
        }
    }

    async function generateThumb(id) {
        const bytes = await api.readFile(id);
        const doc = await pdfjsLib.getDocument({ data: new Uint8Array(bytes) }).promise;
        try {
            const page = await doc.getPage(1);
            const base = page.getViewport({ scale: 1 });
            const scale = Math.min(360 / base.width, 600 / base.height);
            const viewport = page.getViewport({ scale });

            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.floor(viewport.width));
            canvas.height = Math.max(1, Math.floor(viewport.height));
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            await page.render({ canvasContext: ctx, viewport }).promise;

            const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
            canvas.width = canvas.height = 0;
            if (!blob) throw new Error('Không tạo được ảnh');
            return new Uint8Array(await blob.arrayBuffer());
        } finally {
            doc.destroy();
        }
    }

    // --- THẺ TÀI LIỆU ---
    function hoverActions(file) {
        const btn = 'grid h-7 w-7 place-items-center rounded-md bg-panel/95 text-ink shadow-sheet hover:text-accent transition-colors';
        return `
            <div class="absolute right-2 top-2 z-10 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                <button data-action="reveal" data-id="${file.id}" class="${btn}" title="Hiện trong thư mục" aria-label="Hiện trong thư mục"><i class="fa-solid fa-folder-open text-xs"></i></button>
                <button data-action="export" data-id="${file.id}" class="${btn}" title="Lưu bản sao" aria-label="Lưu bản sao"><i class="fa-solid fa-download text-xs"></i></button>
                <button data-action="trash" data-id="${file.id}" class="${btn}" title="Bỏ vào thùng rác" aria-label="Bỏ vào thùng rác"><i class="fa-solid fa-trash-can text-xs"></i></button>
            </div>`;
    }

    function trashButtons(file) {
        return `
            <div class="mt-2 flex gap-2">
                <button data-action="restore" data-id="${file.id}" class="btn-quiet !h-7 !px-2 text-xs whitespace-nowrap">Khôi phục</button>
                <button data-action="delete" data-id="${file.id}" class="btn-quiet !h-7 !px-2 text-xs whitespace-nowrap text-red-600 dark:text-red-400">Xóa vĩnh viễn</button>
            </div>`;
    }

    function gridItemHTML(file) {
        const name = escapeHtml(file.name);
        const cat = escapeHtml(file.category);
        const sheetInner = `<span class="thumb absolute inset-0" data-thumb-id="${file.id}">${thumbMarkup(file.id)}</span>`;
        const sheet = file.isTrash
            ? `<div class="sheet block w-full aspect-[3/4] overflow-hidden">${sheetInner}</div>`
            : `<button data-action="open" data-id="${file.id}" aria-label="Mở ${name}" class="sheet block w-full aspect-[3/4] overflow-hidden">${sheetInner}</button>`;

        return `
            <article class="doc group min-w-0">
                <div class="pr-2 pb-2">
                    <div class="sheet-wrap ${stackClass(file)} ${file.isTrash ? 'opacity-60' : ''}">
                        ${sheet}
                        ${file.isTrash ? '' : hoverActions(file)}
                    </div>
                </div>
                <div class="mt-1 px-0.5">
                    <h3 class="line-clamp-2 break-words text-[13px] font-medium leading-snug" title="${name}">${name}</h3>
                    <div class="mt-1 flex items-center justify-between gap-2 text-xs text-muted">
                        <span class="flex min-w-0 items-center gap-1.5">
                            <span class="h-2 w-2 shrink-0 rounded-[2px]" style="background:${catColor(file.category)}"></span>
                            <span class="truncate">${cat}</span>
                        </span>
                        <span class="shrink-0" title="${formatDate(file.uploadDate)}">${formatRelative(file.uploadDate)}</span>
                    </div>
                    <div class="mt-0.5 flex gap-3 text-xs text-muted">
                        ${file.pageCount > 0 ? `<span>${file.pageCount} trang</span>` : ''}
                        <span>${formatFileSize(file.size)}</span>
                    </div>
                    ${file.isTrash ? trashButtons(file) : ''}
                </div>
            </article>`;
    }

    function listRowHTML(file) {
        const name = escapeHtml(file.name);
        const thumbInner = `<span class="thumb absolute inset-0" data-thumb-id="${file.id}">${thumbMarkup(file.id)}</span>`;
        const mini = file.isTrash
            ? `<div class="sheet block h-[53px] w-10 overflow-hidden opacity-60">${thumbInner}</div>`
            : `<button data-action="open" data-id="${file.id}" aria-label="Mở ${name}" class="sheet block h-[53px] w-10 overflow-hidden">${thumbInner}</button>`;

        const iconBtn = 'tool-btn';
        const actions = file.isTrash
            ? `<button data-action="restore" data-id="${file.id}" class="btn-quiet !h-7 !px-2.5 text-xs">Khôi phục</button>
               <button data-action="delete" data-id="${file.id}" class="tool-btn text-red-600 dark:text-red-400" title="Xóa vĩnh viễn" aria-label="Xóa vĩnh viễn"><i class="fa-solid fa-xmark text-xs"></i></button>`
            : `<button data-action="reveal" data-id="${file.id}" class="${iconBtn}" title="Hiện trong thư mục" aria-label="Hiện trong thư mục"><i class="fa-solid fa-folder-open text-xs"></i></button>
               <button data-action="export" data-id="${file.id}" class="${iconBtn}" title="Lưu bản sao" aria-label="Lưu bản sao"><i class="fa-solid fa-download text-xs"></i></button>
               <button data-action="trash" data-id="${file.id}" class="${iconBtn}" title="Bỏ vào thùng rác" aria-label="Bỏ vào thùng rác"><i class="fa-solid fa-trash-can text-xs"></i></button>`;

        return `
            <div class="doc group grid grid-cols-[40px_minmax(0,1fr)_88px_120px_112px] items-center gap-4 border-t border-line px-2 py-2.5 transition-colors hover:bg-sunken/50">
                ${mini}
                <div class="min-w-0">
                    <div class="truncate text-[13px] font-medium" title="${name}">${name}</div>
                    <div class="mt-0.5 flex items-center gap-3 text-xs text-muted">
                        <span class="flex min-w-0 items-center gap-1.5">
                            <span class="h-2 w-2 shrink-0 rounded-[2px]" style="background:${catColor(file.category)}"></span>
                            <span class="truncate">${escapeHtml(file.category)}</span>
                        </span>
                        ${file.pageCount > 0 ? `<span class="shrink-0">${file.pageCount} trang</span>` : ''}
                    </div>
                </div>
                <span class="text-[13px] text-muted tabular-nums">${formatFileSize(file.size)}</span>
                <span class="text-[13px] text-muted" title="${formatDate(file.uploadDate)}">${formatRelative(file.uploadDate)}</span>
                <div class="flex items-center justify-end gap-0.5 ${file.isTrash ? '' : 'opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100'}">${actions}</div>
            </div>`;
    }

    // --- THAO TÁC TRÊN TÀI LIỆU (ủy quyền sự kiện) ---
    async function handleAction(btn) {
        const action = btn.dataset.action;
        if (action === 'add') { openUploadModal(); return; }

        const id = btn.dataset.id;
        const file = state.files.find((f) => f.id === id);
        if (!file) return;

        try {
            switch (action) {
                case 'open':
                    await openPDFReader(id);
                    break;
                case 'reveal':
                    await api.revealFile(id);
                    break;
                case 'export': {
                    const res = await api.exportFile(id);
                    if (res.saved) showToast(`Đã lưu bản sao: ${res.path}`);
                    break;
                }
                case 'trash':
                    applySnapshot(await api.trashFile(id));
                    renderApp();
                    showToast(`Đã chuyển "${file.name}" vào thùng rác`, 'info');
                    break;
                case 'restore':
                    applySnapshot(await api.restoreFile(id));
                    renderApp();
                    showToast(`Đã khôi phục "${file.name}"`);
                    break;
                case 'delete':
                    if (await confirmDialog(`Xóa vĩnh viễn "${file.name}"? File sẽ bị xóa khỏi ổ đĩa và không thể khôi phục.`, 'Xóa vĩnh viễn')) {
                        applySnapshot(await api.deleteFile(id));
                        renderApp();
                        showToast(`Đã xóa vĩnh viễn "${file.name}"`, 'info');
                    }
                    break;
            }
        } catch (err) {
            showError(err);
        }
    }

    contentScroll.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (btn) handleAction(btn);
    });

    $('btnEmptyTrash').addEventListener('click', async () => {
        const count = state.files.filter((f) => f.isTrash).length;
        if (!count) return;
        if (await confirmDialog(`Xóa vĩnh viễn ${count} file trong thùng rác? Thao tác này không thể hoàn tác.`, 'Dọn sạch')) {
            try {
                applySnapshot(await api.emptyTrash());
                renderApp();
                showToast('Đã dọn sạch thùng rác', 'info');
            } catch (err) {
                showError(err);
            }
        }
    });

    // --- ĐIỀU HƯỚNG, TÌM KIẾM, SẮP XẾP, KIỂU XEM ---
    document.querySelector('nav[aria-label="Thư viện"]').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-nav]');
        if (!btn) return;
        state.nav = btn.dataset.nav;
        if (state.nav === 'all') state.selectedCategory = 'ALL';
        renderApp();
        contentScroll.scrollTop = 0;
    });

    $('categoryList').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-cat]');
        if (!btn) return;
        state.nav = 'all';
        state.selectedCategory = btn.dataset.cat;
        renderApp();
        contentScroll.scrollTop = 0;
    });

    searchInput.addEventListener('input', (e) => {
        state.searchQuery = e.target.value;
        $('searchHint').classList.toggle('hidden', !!e.target.value);
        renderApp();
    });

    $('sortSelect').addEventListener('change', (e) => {
        state.sortBy = e.target.value;
        store.set('sortBy', state.sortBy);
        renderApp();
    });

    $('btnGridView').addEventListener('click', () => { state.viewMode = 'grid'; store.set('viewMode', 'grid'); renderApp(); });
    $('btnListView').addEventListener('click', () => { state.viewMode = 'list'; store.set('viewMode', 'list'); renderApp(); });

    // --- TRÌNH ĐỌC PDF ---
    const pdfReaderModal = $('pdfReaderModal');
    const readerCanvas = $('readerCanvas');
    const readerLoading = $('readerLoading');
    const readerViewport = $('readerViewport');
    const readerCurrentPageInput = $('readerCurrentPageInput');
    const readerTotalPages = $('readerTotalPages');
    const readerZoomLevel = $('readerZoomLevel');

    let readerOpenSeq = 0;
    let renderSeq = 0;
    let activeRender = null;

    const isReaderOpen = () => !pdfReaderModal.classList.contains('hidden');
    const clampZoom = (z) => Math.min(3, Math.max(0.5, Math.round(z * 10) / 10));

    async function openPDFReader(id) {
        const file = state.files.find((f) => f.id === id);
        if (!file) return;

        const seq = ++readerOpenSeq;
        state.readerCurrentFile = file;
        state.readerCurrentPage = 1;
        state.readerZoomScale = 1.2;

        $('readerFileName').textContent = file.name;
        pdfReaderModal.classList.remove('hidden');
        readerLoading.classList.remove('hidden');

        try {
            const bytes = await api.readFile(id);
            const doc = await pdfjsLib.getDocument({ data: new Uint8Array(bytes) }).promise;
            if (seq !== readerOpenSeq) { // người dùng đã đóng hoặc mở file khác
                doc.destroy();
                return;
            }
            state.readerPdfDoc = doc;
            readerTotalPages.textContent = doc.numPages;
            readerCurrentPageInput.max = doc.numPages;
            await fitToWidth(true);
        } catch (err) {
            if (seq !== readerOpenSeq) return;
            console.error('Lỗi mở PDF reader:', err);
            showToast('Không thể hiển thị nội dung PDF này', 'error');
            closeReader();
        } finally {
            if (seq === readerOpenSeq) readerLoading.classList.add('hidden');
        }
    }

    async function renderReaderPage(pageNum) {
        const doc = state.readerPdfDoc;
        if (!doc) return;

        const seq = ++renderSeq;
        if (activeRender) {
            try { activeRender.cancel(); } catch (_) { /* bỏ qua */ }
            try { await activeRender.promise; } catch (_) { /* bị hủy */ }
        }
        if (seq !== renderSeq || state.readerPdfDoc !== doc) return;

        readerLoading.classList.remove('hidden');
        try {
            const page = await doc.getPage(pageNum);
            const viewport = page.getViewport({ scale: state.readerZoomScale });
            const dpr = window.devicePixelRatio || 1;

            readerCanvas.width = Math.floor(viewport.width * dpr);
            readerCanvas.height = Math.floor(viewport.height * dpr);
            readerCanvas.style.width = Math.floor(viewport.width) + 'px';
            readerCanvas.style.height = Math.floor(viewport.height) + 'px';

            const task = page.render({
                canvasContext: readerCanvas.getContext('2d'),
                viewport,
                transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null
            });
            activeRender = task;
            await task.promise;

            readerCurrentPageInput.value = pageNum;
            readerZoomLevel.textContent = `${Math.round(state.readerZoomScale * 100)}%`;
            readerViewport.scrollTop = 0;
        } catch (err) {
            if (!err || err.name !== 'RenderingCancelledException') console.error('Lỗi render trang PDF:', err);
        } finally {
            if (seq === renderSeq) {
                activeRender = null;
                readerLoading.classList.add('hidden');
            }
        }
    }

    function goToPage(n) {
        const doc = state.readerPdfDoc;
        if (!doc) return;
        state.readerCurrentPage = Math.min(doc.numPages, Math.max(1, n));
        renderReaderPage(state.readerCurrentPage);
    }

    async function fitToWidth(first = false) {
        const doc = state.readerPdfDoc;
        if (!doc) return;
        const page = await doc.getPage(state.readerCurrentPage);
        const base = page.getViewport({ scale: 1 });
        const fit = clampZoom((readerViewport.clientWidth - 96) / base.width);
        state.readerZoomScale = first ? Math.min(fit, 1.6) : fit;
        await renderReaderPage(state.readerCurrentPage);
    }

    function closeReader() {
        readerOpenSeq++;
        renderSeq++;
        if (activeRender) { try { activeRender.cancel(); } catch (_) { /* bỏ qua */ } }
        activeRender = null;
        pdfReaderModal.classList.add('hidden');
        if (state.readerPdfDoc) state.readerPdfDoc.destroy();
        state.readerPdfDoc = null;
        state.readerCurrentFile = null;
    }

    $('btnReaderPrevPage').addEventListener('click', () => goToPage(state.readerCurrentPage - 1));
    $('btnReaderNextPage').addEventListener('click', () => goToPage(state.readerCurrentPage + 1));
    readerCurrentPageInput.addEventListener('change', (e) => {
        const val = parseInt(e.target.value, 10);
        goToPage(isNaN(val) ? 1 : val);
    });
    $('btnReaderZoomIn').addEventListener('click', () => {
        state.readerZoomScale = clampZoom(state.readerZoomScale + 0.2);
        renderReaderPage(state.readerCurrentPage);
    });
    $('btnReaderZoomOut').addEventListener('click', () => {
        state.readerZoomScale = clampZoom(state.readerZoomScale - 0.2);
        renderReaderPage(state.readerCurrentPage);
    });
    $('btnReaderResetZoom').addEventListener('click', () => fitToWidth(false));
    $('btnCloseReaderModal').addEventListener('click', closeReader);

    $('btnReaderDownload').addEventListener('click', async () => {
        if (!state.readerCurrentFile) return;
        try {
            const res = await api.exportFile(state.readerCurrentFile.id);
            if (res.saved) showToast(`Đã lưu bản sao: ${res.path}`);
        } catch (err) { showError(err); }
    });

    $('btnReaderOpenExternal').addEventListener('click', async () => {
        if (!state.readerCurrentFile) return;
        try { await api.openExternal(state.readerCurrentFile.id); } catch (err) { showError(err); }
    });

    // --- PHÂN LOẠI ---
    const openModal = (modal) => modal.classList.remove('hidden');
    const closeModal = (modal) => modal.classList.add('hidden');

    $('btnOpenCategoryModal').addEventListener('click', () => {
        state.editingCategory = null;
        renderCategoryManageList();
        openModal(categoryModal);
    });
    document.querySelectorAll('.btnCloseCategoryModal').forEach((btn) =>
        btn.addEventListener('click', () => closeModal(categoryModal)));

    function renderCategoryManageList() {
        categoryManageList.innerHTML = state.categories.map((cat, index) => {
            if (state.editingCategory === cat) {
                return `
                    <div class="flex items-center gap-2 rounded-lg px-3 py-1.5 bg-sunken/70">
                        <input data-edit-input value="${escapeHtml(cat)}" class="field !py-1.5" aria-label="Tên phân loại">
                        <button data-cat-action="save" data-index="${index}" class="tool-btn text-accent" title="Lưu" aria-label="Lưu"><i class="fa-solid fa-check"></i></button>
                        <button data-cat-action="cancel" class="tool-btn" title="Hủy" aria-label="Hủy"><i class="fa-solid fa-xmark"></i></button>
                    </div>`;
            }
            return `
                <div class="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-sunken/60 transition-colors">
                    <span class="h-2.5 w-2.5 shrink-0 rounded-[3px]" style="background:${catColor(cat)}"></span>
                    <span class="flex-1 truncate text-[13px] font-medium">${escapeHtml(cat)}</span>
                    <button data-cat-action="edit" data-index="${index}" class="tool-btn" title="Đổi tên" aria-label="Đổi tên ${escapeHtml(cat)}"><i class="fa-solid fa-pen text-xs"></i></button>
                    <button data-cat-action="delete" data-index="${index}" class="tool-btn" title="Xóa phân loại" aria-label="Xóa phân loại ${escapeHtml(cat)}"><i class="fa-solid fa-trash-can text-xs"></i></button>
                </div>`;
        }).join('');

        const input = categoryManageList.querySelector('[data-edit-input]');
        if (input) { input.focus(); input.select(); }
    }

    async function saveCategoryRename(index) {
        const oldName = state.categories[index];
        const input = categoryManageList.querySelector('[data-edit-input]');
        const newName = input ? input.value.trim() : '';
        if (!newName || newName === oldName) {
            state.editingCategory = null;
            renderCategoryManageList();
            return;
        }
        try {
            const wasSelected = state.selectedCategory === oldName;
            applySnapshot(await api.renameCategory(oldName, newName));
            if (wasSelected) state.selectedCategory = state.categories[index] || 'ALL'; // tên có thể đã được làm sạch
            state.editingCategory = null;
            renderCategoryManageList();
            renderApp();
            showToast('Đã đổi tên phân loại');
        } catch (err) { showError(err); }
    }

    categoryManageList.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-cat-action]');
        if (!btn) return;
        const index = parseInt(btn.dataset.index, 10);
        const name = state.categories[index];

        switch (btn.dataset.catAction) {
            case 'edit':
                state.editingCategory = name;
                renderCategoryManageList();
                break;
            case 'cancel':
                state.editingCategory = null;
                renderCategoryManageList();
                break;
            case 'save':
                await saveCategoryRename(index);
                break;
            case 'delete': {
                if (state.categories.length <= 1) {
                    showToast('Cần giữ lại ít nhất một phân loại', 'error');
                    return;
                }
                const target = state.categories.find((c) => c !== name);
                const ok = await confirmDialog(
                    `Xóa phân loại "${name}"? File trong phân loại này sẽ được chuyển sang "${target}".`, 'Xóa phân loại');
                if (!ok) return;
                try {
                    applySnapshot(await api.deleteCategory(name));
                    renderCategoryManageList();
                    renderApp();
                    showToast(`Đã xóa phân loại "${name}"`, 'info');
                } catch (err) { showError(err); }
                break;
            }
        }
    });

    categoryManageList.addEventListener('keydown', (e) => {
        if (!e.target.matches('[data-edit-input]')) return;
        if (e.key === 'Enter') {
            e.preventDefault();
            const idx = state.categories.indexOf(state.editingCategory);
            if (idx >= 0) saveCategoryRename(idx);
        } else if (e.key === 'Escape') {
            e.stopPropagation();
            state.editingCategory = null;
            renderCategoryManageList();
        }
    });

    $('addCategoryForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = $('newCategoryNameInput');
        const name = input.value.trim();
        if (!name) return;
        try {
            applySnapshot(await api.addCategory(name));
            input.value = '';
            renderCategoryManageList();
            renderApp();
            showToast(`Đã thêm phân loại "${name}"`);
        } catch (err) { showError(err); }
    });

    // --- THƯ MỤC LƯU TRỮ ---
    async function chooseFolder() {
        try {
            const snap = await api.chooseFolder();
            if (!snap) return false; // người dùng hủy
            applySnapshot(snap);
            state.selectedCategory = 'ALL';
            state.nav = 'all';
            welcomeScreen.classList.add('hidden');
            closeModal(folderModal);
            renderApp();
            showToast('Đã mở thư mục lưu trữ');
            backfillPageCounts();
            return true;
        } catch (err) {
            showError(err);
            return false;
        }
    }

    $('btnOpenFolderModal').addEventListener('click', () => {
        $('folderModalPath').textContent = state.libraryPath || '—';
        openModal(folderModal);
    });
    document.querySelectorAll('.btnCloseFolderModal').forEach((btn) =>
        btn.addEventListener('click', () => closeModal(folderModal)));
    $('btnChangeFolder').addEventListener('click', chooseFolder);
    $('btnOpenLibraryFolder').addEventListener('click', async () => {
        try { await api.openLibraryFolder(); } catch (err) { showError(err); }
    });
    $('btnWelcomeChoose').addEventListener('click', chooseFolder);

    // --- THÊM PDF ---
    const fileInput = $('fileInput');
    const dropZone = $('dropZone');

    function defaultUploadCategory() {
        if (!uploadModal.classList.contains('hidden') && uploadCategorySelect.value) return uploadCategorySelect.value;
        return state.nav === 'all' && state.categories.includes(state.selectedCategory)
            ? state.selectedCategory
            : state.categories[0];
    }

    function openUploadModal() {
        if (!state.libraryReady) return;
        if (state.nav === 'all' && state.categories.includes(state.selectedCategory)) {
            uploadCategorySelect.value = state.selectedCategory;
        }
        openModal(uploadModal);
    }

    $('btnOpenUploadModal').addEventListener('click', openUploadModal);
    document.querySelectorAll('.btnCloseModal').forEach((btn) =>
        btn.addEventListener('click', () => closeModal(uploadModal)));

    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
    });
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        hideDropOverlay();
        if (e.dataTransfer.files.length) handleFileUpload(e.dataTransfer.files, uploadCategorySelect.value);
    });
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length) handleFileUpload(e.target.files, uploadCategorySelect.value);
    });

    // Thả file PDF vào bất kỳ đâu trong cửa sổ
    const dropOverlay = $('dropOverlay');
    let dragDepth = 0;
    const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');

    function hideDropOverlay() {
        dragDepth = 0;
        dropOverlay.classList.add('hidden');
        dropOverlay.classList.remove('flex');
    }

    window.addEventListener('dragenter', (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        dragDepth++;
        if (!state.libraryReady || isReaderOpen()) return;
        $('dropTarget').textContent = defaultUploadCategory() || 'thư viện';
        dropOverlay.classList.remove('hidden');
        dropOverlay.classList.add('flex');
    });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('dragleave', (e) => {
        if (!hasFiles(e)) return;
        dragDepth = Math.max(0, dragDepth - 1);
        if (dragDepth === 0) hideDropOverlay();
    });
    window.addEventListener('drop', (e) => {
        e.preventDefault();
        hideDropOverlay();
        if (!state.libraryReady || !e.dataTransfer || !e.dataTransfer.files.length) return;
        handleFileUpload(e.dataTransfer.files, defaultUploadCategory());
    });

    async function handleFileUpload(files, category) {
        let ok = 0;

        for (const file of Array.from(files)) {
            if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
                showToast(`"${file.name}" không phải file PDF`, 'error');
                continue;
            }

            try {
                const buffer = await file.arrayBuffer();

                let pageCount = 0;
                try {
                    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer.slice(0)) }).promise;
                    pageCount = doc.numPages;
                    doc.destroy();
                } catch (pErr) {
                    console.warn('Không thể đọc số trang:', pErr);
                }

                applySnapshot(await api.saveFile({ name: file.name, data: new Uint8Array(buffer), category, pageCount }));
                ok++;
            } catch (err) {
                console.error('Lỗi khi lưu file:', err);
                showToast(`Không thể lưu "${file.name}": ${err.message}`, 'error');
            }
        }

        closeModal(uploadModal);
        fileInput.value = '';
        if (ok > 0) {
            state.nav = 'all';
            renderApp();
            showToast(ok === 1 ? 'Đã thêm 1 file PDF' : `Đã thêm ${ok} file PDF`);
        }
    }

    // --- PHÍM TẮT ---
    document.addEventListener('keydown', (e) => {
        const mod = e.ctrlKey || e.metaKey;

        if (!$('confirmModal').classList.contains('hidden')) {
            if (e.key === 'Escape') $('btnConfirmCancel').click();
            return;
        }

        if (e.key === 'Escape') {
            if (isReaderOpen()) closeReader();
            else if ([uploadModal, categoryModal, folderModal].some((m) => !m.classList.contains('hidden'))) {
                [uploadModal, categoryModal, folderModal].forEach(closeModal);
            } else if (document.activeElement === searchInput) {
                searchInput.value = '';
                state.searchQuery = '';
                $('searchHint').classList.remove('hidden');
                searchInput.blur();
                renderApp();
            }
            return;
        }

        if (isReaderOpen()) {
            if (e.target.tagName === 'INPUT') return;
            if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') goToPage(state.readerCurrentPage - 1);
            else if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown') goToPage(state.readerCurrentPage + 1);
            return;
        }

        if (!state.libraryReady) return;
        if (mod && (e.key === 'k' || e.key === 'f')) {
            e.preventDefault();
            searchInput.focus();
            searchInput.select();
        } else if (mod && (e.key === 'n' || e.key === 'o')) {
            e.preventDefault();
            openUploadModal();
        }
    });

    // --- TÍNH SỐ TRANG CHO FILE MỚI NHẬN DIỆN TỪ THƯ MỤC ---
    let backfilling = false;
    async function backfillPageCounts() {
        if (backfilling) return;
        backfilling = true;
        try {
            const pending = state.files.filter((f) => !f.isTrash && !f.pageCount);
            for (const f of pending) {
                let n = -1; // -1: không đọc được, không thử lại
                try {
                    const bytes = await api.readFile(f.id);
                    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(bytes) }).promise;
                    n = doc.numPages;
                    doc.destroy();
                } catch (_) { /* file lỗi */ }
                try {
                    applySnapshot(await api.updateMeta(f.id, { pageCount: n }));
                    renderApp();
                } catch (_) { /* bỏ qua */ }
            }
        } finally {
            backfilling = false;
        }
    }

    // --- KHỞI ĐỘNG ---
    window.addEventListener('DOMContentLoaded', async () => {
        initTheme();
        updateViewControls();
        try {
            const snap = await api.loadLibrary();
            if (snap) {
                applySnapshot(snap);
                renderApp();
                backfillPageCounts();
            } else {
                welcomeScreen.classList.remove('hidden');
                renderApp();
            }
        } catch (err) {
            // Thư mục đã chọn trước đó không còn truy cập được: cho chọn lại
            const box = $('welcomeError');
            box.textContent = `Không mở được thư mục lưu trữ: ${err.message}`;
            box.classList.remove('hidden');
            welcomeScreen.classList.remove('hidden');
            renderApp();
        }
    });
})();
