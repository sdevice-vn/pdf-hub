'use strict';
(() => {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

    const api = window.docHub;
    const $ = (id) => document.getElementById(id);

    const store = {
        get(key, fallback) {
            try { const v = localStorage.getItem(key); return v === null ? fallback : v; } catch (_) { return fallback; }
        },
        set(key, value) {
            try { localStorage.setItem(key, value); } catch (_) { /* bỏ qua */ }
        }
    };

    // Áp dụng ngay giao diện đã nhớ để tránh nháy sáng/tối lúc mở app
    {
        const early = store.get('dark', null);
        const dark = early === null ? window.matchMedia('(prefers-color-scheme: dark)').matches : early === '1';
        document.documentElement.classList.toggle('dark', dark);
    }

    // --- LOẠI TỆP ---
    const KIND_INFO = {
        pdf:     { label: 'PDF',      icon: 'fa-file-pdf',    color: '#C8452B' },
        image:   { label: 'Hình ảnh', icon: 'fa-file-image',  color: '#2E9BD6' },
        video:   { label: 'Video',    icon: 'fa-file-video',  color: '#7A4FD3' },
        audio:   { label: 'Âm thanh', icon: 'fa-file-audio',  color: '#D6458A' },
        text:    { label: 'Văn bản',  icon: 'fa-file-lines',  color: '#5F6F68' },
        office:  { label: 'Office',   icon: 'fa-file-word',   color: '#2B579A' },
        archive: { label: 'Tệp nén',  icon: 'fa-file-zipper', color: '#9A7B1E' },
        other:   { label: 'Tệp',      icon: 'fa-file',        color: '#7B8580' }
    };
    const SHEET_EXT = ['xls', 'xlsx', 'xlsm', 'ods', 'numbers'];
    const SLIDE_EXT = ['ppt', 'pptx', 'pps', 'ppsx', 'odp', 'key'];

    // Bộ lọc loại trong thanh công cụ -> các kind thật
    const TYPE_GROUPS = {
        pdf: ['pdf'],
        text: ['text', 'office'],
        image: ['image'],
        video: ['video'],
        audio: ['audio'],
        other: ['archive', 'other']
    };
    const THUMB_KINDS = new Set(['pdf', 'image', 'video']); // loại có ảnh xem trước thật

    const extOf = (name) => {
        const i = String(name).lastIndexOf('.');
        return i > 0 ? String(name).slice(i + 1).toLowerCase() : '';
    };

    function kindInfo(file) {
        if (file.kind === 'office') {
            const e = extOf(file.name);
            if (SHEET_EXT.includes(e)) return { label: 'Bảng tính', icon: 'fa-file-excel', color: '#217346' };
            if (SLIDE_EXT.includes(e)) return { label: 'Trình chiếu', icon: 'fa-file-powerpoint', color: '#C43E1C' };
            return { label: 'Văn bản', icon: 'fa-file-word', color: '#2B579A' };
        }
        return KIND_INFO[file.kind] || KIND_INFO.other;
    }

    const mediaUrl = (id) => `dochub://file/${encodeURIComponent(id)}`;

    // --- STATE ---
    const SORTS = ['newest', 'oldest', 'name', 'size'];
    const state = {
        files: [],
        byId: new Map(),
        categories: [],
        catColors: {},
        libraryPath: '',
        libraryReady: false,

        viewMode: ['grid', 'list'].includes(store.get('viewMode', 'grid')) ? store.get('viewMode', 'grid') : 'grid',
        sortBy: SORTS.includes(store.get('sortBy', 'newest')) ? store.get('sortBy', 'newest') : 'newest',
        typeFilter: 'all',
        nav: 'all',              // 'all' | 'trash'
        selectedCategory: 'ALL', // 'ALL' | tên phân loại
        searchQuery: '',
        editingCategory: null,

        // Trình xem
        viewerFile: null,
        readerPdfDoc: null,
        readerCurrentPage: 1,
        readerZoomScale: 1.2,
        imageFit: true
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

    // --- TIỆN ÍCH ---
    const escapeHtml = (s) =>
        String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    const numberFormat = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 });

    function formatFileSize(bytes) {
        if (!bytes) return '0 KB';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
        return numberFormat.format(bytes / Math.pow(1024, i)) + ' ' + units[i];
    }

    function formatDuration(sec) {
        sec = Math.max(0, Math.round(sec));
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const s = sec % 60;
        const pad = (n) => String(n).padStart(2, '0');
        return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
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

    // --- THÔNG BÁO ---
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
        }, type === 'error' ? 6000 : 3000);
    }
    const showError = (err) => showToast((err && err.message) || String(err), 'error');

    function setBusy(text) {
        const box = $('busy');
        if (text) {
            $('busyText').textContent = text;
            box.classList.remove('hidden');
        } else {
            box.classList.add('hidden');
        }
    }

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
        state.byId = new Map(snap.files.map((f) => [f.id, f]));
        state.categories = snap.categories;
        state.catColors = computeCategoryColors(snap.categories);
        state.libraryPath = snap.path;
        state.libraryReady = true;
        if (state.selectedCategory !== 'ALL' && !state.categories.includes(state.selectedCategory)) {
            state.selectedCategory = 'ALL';
        }
    }

    // --- GIAO DIỆN SÁNG/TỐI (preload đã đặt sẵn class "dark" từ cài đặt đã lưu) ---
    function applyDark(dark) {
        document.documentElement.classList.toggle('dark', !!dark);
        syncThemeIcon();
    }

    function syncThemeIcon() {
        const dark = document.documentElement.classList.contains('dark');
        $('themeIcon').className = dark ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
    }

    $('btnThemeToggle').addEventListener('click', () => {
        const dark = !document.documentElement.classList.contains('dark');
        applyDark(dark);
        store.set('dark', dark ? '1' : '0');
        api.setTheme(dark).catch(() => { /* chỉ ảnh hưởng thanh tiêu đề */ });
    });

    // --- DỮ LIỆU HIỂN THỊ ---
    function visibleFiles() {
        let result = state.files.filter((f) => (state.nav === 'trash' ? f.isTrash : !f.isTrash));
        if (state.nav === 'all' && state.selectedCategory !== 'ALL') {
            result = result.filter((f) => f.category === state.selectedCategory);
        }
        if (state.typeFilter !== 'all') {
            const kinds = TYPE_GROUPS[state.typeFilter] || [];
            result = result.filter((f) => kinds.includes(f.kind));
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

    // --- HIỂN THỊ ---
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
        $('storageMeta').textContent = `${active.length} tệp, ${formatFileSize(totalBytes)}`;
    }

    function renderHeader(list) {
        $('viewTitle').textContent = state.nav === 'trash'
            ? 'Thùng rác'
            : state.selectedCategory === 'ALL' ? 'Tất cả tài liệu' : state.selectedCategory;
        $('viewCount').textContent = state.searchQuery.trim()
            ? `${list.length} kết quả`
            : `${list.length} tệp`;
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
        $('typeSelect').value = state.typeFilter;
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
            text = 'Tệp bạn bỏ vào thùng rác sẽ nằm ở đây cho đến khi bạn xóa vĩnh viễn.';
        } else if (q) {
            icon = 'fa-magnifying-glass';
            title = `Không có kết quả cho "${q}"`;
            text = 'Thử từ khóa khác, hoặc chọn Tất cả loại và Tất cả tài liệu để bỏ bộ lọc.';
        } else if (state.typeFilter !== 'all') {
            icon = 'fa-filter';
            title = 'Không có tệp thuộc loại này';
            text = 'Chọn Tất cả loại để xem mọi tệp, hoặc thêm tệp mới.';
        } else if (state.selectedCategory !== 'ALL') {
            title = 'Phân loại này chưa có tệp';
            text = 'Thêm tệp và chúng sẽ được lưu trong thư mục của phân loại này.';
            action = `<button data-action="add" class="btn-primary mt-6"><i class="fa-solid fa-plus text-xs"></i> Thêm tệp vào ${escapeHtml(state.selectedCategory)}</button>`;
        } else {
            title = 'Chưa có tệp nào';
            text = 'Thêm PDF, ảnh, video hoặc bất kỳ tệp nào. Tệp được chép vào thư mục lưu trữ của bạn.';
            action = '<button data-action="add" class="btn-primary mt-6"><i class="fa-solid fa-plus text-xs"></i> Thêm tệp</button>';
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

    // --- ẢNH XEM TRƯỚC (thumbnail) ---
    const thumbUrls = new Map();     // id -> blob URL của ảnh JPEG
    const textPreviews = new Map();  // id -> vài dòng đầu của tệp văn bản
    const thumbFailed = new Set();
    const thumbPending = new Set();
    const thumbQueue = [];
    let thumbActive = 0;

    // Mặt giấy khi chưa có (hoặc không có) ảnh xem trước: dải màu theo loại, biểu tượng, đuôi tệp
    function faceMarkup(file, mini) {
        const info = kindInfo(file);
        const ext = extOf(file.name).slice(0, 6);
        return `
            <span class="absolute inset-0 flex flex-col">
                <span class="h-1.5 shrink-0" style="background:${info.color}"></span>
                <span class="grid flex-1 place-items-center"><i class="fa-solid ${info.icon} ${mini ? 'text-lg' : 'text-4xl'}" style="color:${info.color}"></i></span>
                ${mini || !ext ? '' : `<span class="pb-3 text-center text-xs font-medium" style="color:${info.color}">.${escapeHtml(ext)}</span>`}
            </span>`;
    }

    function thumbMarkup(file, mini = false) {
        const url = thumbUrls.get(file.id);
        if (url) {
            const fit = file.kind === 'pdf' ? 'object-contain' : 'object-cover';
            let html = `<img class="thumb-img h-full w-full ${fit}" src="${url}" alt="" draggable="false">`;
            if (file.kind === 'video' && !mini) {
                html += `
                    <span class="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-6 text-[11px] text-white">
                        <i class="fa-solid fa-play text-[9px]"></i>
                        ${file.duration > 0 ? `<span class="tabular-nums">${formatDuration(file.duration)}</span>` : ''}
                    </span>`;
            }
            return html;
        }
        if (file.kind === 'text' && textPreviews.has(file.id)) {
            const info = kindInfo(file);
            return `
                <span class="absolute inset-x-0 top-0 h-1.5" style="background:${info.color}"></span>
                <pre class="thumb-img absolute inset-0 m-0 overflow-hidden whitespace-pre px-2.5 pb-2 pt-4 font-mono ${mini ? 'text-[3px]' : 'text-[5.5px]'} leading-[1.45] text-black/70">${escapeHtml(textPreviews.get(file.id))}</pre>`;
        }
        return faceMarkup(file, mini);
    }

    function needsThumb(file) {
        if (!file || thumbFailed.has(file.id)) return false;
        if (file.kind === 'text') return !textPreviews.has(file.id);
        return THUMB_KINDS.has(file.kind) && !thumbUrls.has(file.id);
    }

    const thumbObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            thumbObserver.unobserve(entry.target);
            requestThumb(entry.target.dataset.thumbId);
        }
    }, { root: contentScroll, rootMargin: '300px' });

    function observeThumbs() {
        fileContainer.querySelectorAll('[data-thumb-id]').forEach((el) => {
            if (needsThumb(state.byId.get(el.dataset.thumbId))) thumbObserver.observe(el);
        });
    }

    function requestThumb(id) {
        if (thumbPending.has(id) || !needsThumb(state.byId.get(id))) return;
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

    function refreshThumbEls(id) {
        const file = state.byId.get(id);
        if (!file) return;
        document.querySelectorAll(`[data-thumb-id="${id}"]`).forEach((el) => {
            el.innerHTML = thumbMarkup(file, el.dataset.mini === '1');
        });
    }

    // Ghi nhớ thời lượng video mà không vẽ lại cả danh sách
    function rememberDuration(file, seconds) {
        if (!(seconds > 0) || file.duration === seconds) return;
        file.duration = seconds;
        api.updateMeta(file.id, { duration: seconds }).then(applySnapshot).catch(() => { /* không quan trọng */ });
    }

    async function loadThumb(id) {
        const file = state.byId.get(id);
        if (!file) return;
        try {
            if (file.kind === 'text') {
                const r = await api.readText(id, 2400);
                textPreviews.set(id, r.text.slice(0, 1400));
            } else {
                let bytes = await api.getThumb(id);
                if (!bytes) {
                    const gen = await generateThumb(file);
                    bytes = gen.bytes;
                    try { await api.setThumb(id, bytes); } catch (_) { /* vẫn dùng ảnh trong phiên này */ }
                    if (gen.duration) rememberDuration(file, gen.duration);
                }
                thumbUrls.set(id, URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' })));
            }
            refreshThumbEls(id);
        } catch (err) {
            console.warn('Không tạo được ảnh xem trước:', file.name, err);
            thumbFailed.add(id);
        }
    }

    function generateThumb(file) {
        if (file.kind === 'pdf') return thumbFromPdf(file.id);
        if (file.kind === 'image') return thumbFromImage(file.id);
        return thumbFromVideo(file.id);
    }

    const THUMB_W = 270;
    const THUMB_H = 360;

    function coverCanvas() {
        const canvas = document.createElement('canvas');
        canvas.width = THUMB_W;
        canvas.height = THUMB_H;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, THUMB_W, THUMB_H);
        return { canvas, ctx };
    }

    function drawCover(ctx, source, sw, sh) {
        const scale = Math.max(THUMB_W / sw, THUMB_H / sh);
        const dw = sw * scale;
        const dh = sh * scale;
        ctx.drawImage(source, (THUMB_W - dw) / 2, (THUMB_H - dh) / 2, dw, dh);
    }

    async function canvasToBytes(canvas) {
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
        canvas.width = canvas.height = 0;
        if (!blob) throw new Error('Không tạo được ảnh');
        return new Uint8Array(await blob.arrayBuffer());
    }

    async function thumbFromPdf(id) {
        const bytes = await api.readFile(id);
        const doc = await pdfjsLib.getDocument({ data: new Uint8Array(bytes) }).promise;
        try {
            const page = await doc.getPage(1);
            const base = page.getViewport({ scale: 1 });
            const viewport = page.getViewport({ scale: Math.min(360 / base.width, 600 / base.height) });

            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.floor(viewport.width));
            canvas.height = Math.max(1, Math.floor(viewport.height));
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            await page.render({ canvasContext: ctx, viewport }).promise;
            return { bytes: await canvasToBytes(canvas) };
        } finally {
            doc.destroy();
        }
    }

    async function thumbFromImage(id) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = () => reject(new Error('Không đọc được ảnh'));
            img.src = mediaUrl(id);
        });
        const { canvas, ctx } = coverCanvas();
        drawCover(ctx, img, img.naturalWidth || 512, img.naturalHeight || 512);
        return { bytes: await canvasToBytes(canvas) };
    }

    async function thumbFromVideo(id) {
        const video = document.createElement('video');
        video.muted = true;
        video.preload = 'auto';
        video.crossOrigin = 'anonymous';
        video.playsInline = true;

        const waitFor = (event, ms) => new Promise((resolve, reject) => {
            const timer = setTimeout(() => { cleanup(); reject(new Error('Video mở quá lâu')); }, ms);
            const ok = () => { cleanup(); resolve(); };
            const bad = () => { cleanup(); reject(new Error('Không giải mã được video')); };
            function cleanup() {
                clearTimeout(timer);
                video.removeEventListener(event, ok);
                video.removeEventListener('error', bad);
            }
            video.addEventListener(event, ok, { once: true });
            video.addEventListener('error', bad, { once: true });
        });

        try {
            const loaded = waitFor('loadeddata', 12000);
            video.src = mediaUrl(id);
            await loaded;
            if (!video.videoWidth) throw new Error('Tệp không có hình ảnh');

            const duration = Number.isFinite(video.duration) ? video.duration : 0;
            const target = duration > 0 ? Math.min(duration * 0.1, 10) : 0;
            if (target > 0.05) {
                const seeked = waitFor('seeked', 12000);
                video.currentTime = target;
                await seeked;
            }
            const { canvas, ctx } = coverCanvas();
            drawCover(ctx, video, video.videoWidth, video.videoHeight);
            return { bytes: await canvasToBytes(canvas), duration };
        } finally {
            video.pause();
            video.removeAttribute('src');
            video.load();
        }
    }

    // --- THẺ TỆP ---
    function detailText(file) {
        if (file.kind === 'pdf') return file.pageCount > 0 ? `${file.pageCount} trang` : '';
        const ext = extOf(file.name);
        return ext ? `.${ext}` : kindInfo(file).label;
    }

    function hoverActions(file) {
        const btn = 'grid h-7 w-7 place-items-center rounded-md bg-panel/95 text-ink shadow-sheet hover:text-accent transition-colors';
        return `
            <div class="absolute right-2 top-2 z-10 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                <button data-action="edit" data-id="${file.id}" class="${btn}" title="Đổi tên / chuyển phân loại" aria-label="Đổi tên hoặc chuyển phân loại"><i class="fa-solid fa-pen text-xs"></i></button>
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
        const stack = file.kind === 'pdf' ? (file.pageCount >= 5 ? 'stack-2' : file.pageCount >= 2 ? 'stack-1' : '') : '';
        const sheetInner = `<span class="thumb absolute inset-0 block" data-thumb-id="${file.id}">${thumbMarkup(file)}</span>`;
        const sheet = file.isTrash
            ? `<div class="sheet block w-full aspect-[3/4] overflow-hidden">${sheetInner}</div>`
            : `<button data-action="open" data-id="${file.id}" aria-label="Mở ${name}" class="sheet block w-full aspect-[3/4] overflow-hidden">${sheetInner}</button>`;
        const detail = detailText(file);

        return `
            <article class="doc group min-w-0">
                <div class="pr-2 pb-2">
                    <div class="sheet-wrap ${stack} ${file.isTrash ? 'opacity-60' : ''}">
                        ${sheet}
                        ${file.isTrash ? '' : hoverActions(file)}
                    </div>
                </div>
                <div class="mt-1 px-0.5">
                    <h3 class="line-clamp-2 break-words text-[13px] font-medium leading-snug" title="${name}">${name}</h3>
                    <div class="mt-1 flex items-center justify-between gap-2 text-xs text-muted">
                        <span class="flex min-w-0 items-center gap-1.5">
                            <span class="h-2 w-2 shrink-0 rounded-[2px]" style="background:${catColor(file.category)}"></span>
                            <span class="truncate">${escapeHtml(file.category)}</span>
                        </span>
                        <span class="shrink-0" title="${formatDate(file.uploadDate)}">${formatRelative(file.uploadDate)}</span>
                    </div>
                    <div class="mt-0.5 flex gap-3 text-xs text-muted">
                        ${detail ? `<span>${escapeHtml(detail)}</span>` : ''}
                        <span>${formatFileSize(file.size)}</span>
                    </div>
                    ${file.isTrash ? trashButtons(file) : ''}
                </div>
            </article>`;
    }

    function listRowHTML(file) {
        const name = escapeHtml(file.name);
        const thumbInner = `<span class="thumb absolute inset-0 block" data-thumb-id="${file.id}" data-mini="1">${thumbMarkup(file, true)}</span>`;
        const mini = file.isTrash
            ? `<div class="sheet block h-[53px] w-10 overflow-hidden opacity-60">${thumbInner}</div>`
            : `<button data-action="open" data-id="${file.id}" aria-label="Mở ${name}" class="sheet block h-[53px] w-10 overflow-hidden">${thumbInner}</button>`;

        const actions = file.isTrash
            ? `<button data-action="restore" data-id="${file.id}" class="btn-quiet !h-7 !px-2.5 text-xs">Khôi phục</button>
               <button data-action="delete" data-id="${file.id}" class="tool-btn text-red-600 dark:text-red-400" title="Xóa vĩnh viễn" aria-label="Xóa vĩnh viễn"><i class="fa-solid fa-xmark text-xs"></i></button>`
            : `<button data-action="edit" data-id="${file.id}" class="tool-btn" title="Đổi tên / chuyển phân loại" aria-label="Đổi tên hoặc chuyển phân loại"><i class="fa-solid fa-pen text-xs"></i></button>
               <button data-action="reveal" data-id="${file.id}" class="tool-btn" title="Hiện trong thư mục" aria-label="Hiện trong thư mục"><i class="fa-solid fa-folder-open text-xs"></i></button>
               <button data-action="export" data-id="${file.id}" class="tool-btn" title="Lưu bản sao" aria-label="Lưu bản sao"><i class="fa-solid fa-download text-xs"></i></button>
               <button data-action="trash" data-id="${file.id}" class="tool-btn" title="Bỏ vào thùng rác" aria-label="Bỏ vào thùng rác"><i class="fa-solid fa-trash-can text-xs"></i></button>`;
        const detail = detailText(file);

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
                        ${detail ? `<span class="shrink-0">${escapeHtml(detail)}</span>` : ''}
                    </div>
                </div>
                <span class="text-[13px] text-muted tabular-nums">${formatFileSize(file.size)}</span>
                <span class="text-[13px] text-muted" title="${formatDate(file.uploadDate)}">${formatRelative(file.uploadDate)}</span>
                <div class="flex items-center justify-end gap-0.5 ${file.isTrash ? '' : 'opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100'}">${actions}</div>
            </div>`;
    }

    // --- THAO TÁC TRÊN TỆP (ủy quyền sự kiện) ---
    async function handleAction(btn) {
        const action = btn.dataset.action;
        if (action === 'add') { openUploadModal(); return; }

        const id = btn.dataset.id;
        const file = state.byId.get(id);
        if (!file) return;

        try {
            switch (action) {
                case 'open':
                    await openViewer(id);
                    break;
                case 'edit':
                    openEditModal(id);
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
                    if (await confirmDialog(`Xóa vĩnh viễn "${file.name}"? Tệp sẽ bị xóa khỏi ổ đĩa và không thể khôi phục.`, 'Xóa vĩnh viễn')) {
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
        if (await confirmDialog(`Xóa vĩnh viễn ${count} tệp trong thùng rác? Thao tác này không thể hoàn tác.`, 'Dọn sạch')) {
            try {
                applySnapshot(await api.emptyTrash());
                renderApp();
                showToast('Đã dọn sạch thùng rác', 'info');
            } catch (err) {
                showError(err);
            }
        }
    });

    // --- ĐIỀU HƯỚNG, TÌM KIẾM, LỌC, SẮP XẾP, KIỂU XEM ---
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

    $('typeSelect').addEventListener('change', (e) => {
        state.typeFilter = e.target.value;
        renderApp();
        contentScroll.scrollTop = 0;
    });

    $('sortSelect').addEventListener('change', (e) => {
        state.sortBy = e.target.value;
        store.set('sortBy', state.sortBy);
        renderApp();
    });

    $('btnGridView').addEventListener('click', () => { state.viewMode = 'grid'; store.set('viewMode', 'grid'); renderApp(); });
    $('btnListView').addEventListener('click', () => { state.viewMode = 'list'; store.set('viewMode', 'list'); renderApp(); });

    // --- TRÌNH XEM TỆP ---
    const viewerModal = $('viewerModal');
    const viewerViewport = $('viewerViewport');
    const viewerLoading = $('viewerLoading');
    const readerCanvas = $('readerCanvas');
    const readerCurrentPageInput = $('readerCurrentPageInput');
    const readerTotalPages = $('readerTotalPages');
    const readerZoomLevel = $('readerZoomLevel');
    const panels = {
        pdf: $('viewerPdf'),
        image: $('viewerImage'),
        media: $('viewerMedia'),
        text: $('viewerText'),
        fallback: $('viewerFallback')
    };
    const FLEX_PANELS = new Set(['image', 'media', 'fallback']);

    let viewerSeq = 0;
    let renderSeq = 0;
    let activeRender = null;

    const isViewerOpen = () => !viewerModal.classList.contains('hidden');
    const clampZoom = (z) => Math.min(3, Math.max(0.5, Math.round(z * 10) / 10));
    const hideLoading = () => viewerLoading.classList.add('hidden');

    function showPanel(name) {
        for (const [key, el] of Object.entries(panels)) {
            const on = key === name;
            el.classList.toggle('hidden', !on);
            if (FLEX_PANELS.has(key)) el.classList.toggle('flex', on);
        }
    }

    function toggleControls(kind) {
        for (const [id, on] of [['pdfControls', kind === 'pdf'], ['imageControls', kind === 'image']]) {
            const el = $(id);
            el.classList.toggle('hidden', !on);
            el.classList.toggle('flex', on);
        }
    }

    function resetViewer() {
        viewerSeq++;
        renderSeq++;
        if (activeRender) { try { activeRender.cancel(); } catch (_) { /* bỏ qua */ } }
        activeRender = null;

        const host = $('viewerMediaHost');
        host.querySelectorAll('video,audio').forEach((m) => {
            m.pause();
            m.removeAttribute('src');
            m.load();
        });
        host.innerHTML = '';

        const img = $('viewerImg');
        img.onload = img.onerror = null;
        img.removeAttribute('src');

        $('viewerTextBody').textContent = '';
        $('viewerTextNote').classList.add('hidden');

        if (state.readerPdfDoc) state.readerPdfDoc.destroy();
        state.readerPdfDoc = null;
        state.viewerFile = null;
    }

    function showFallback(file, message) {
        const info = kindInfo(file);
        showPanel('fallback');
        $('fallbackIcon').innerHTML = `<i class="fa-solid ${info.icon}" style="color:${info.color}"></i>`;
        $('fallbackTitle').textContent = file.name;
        $('fallbackText').textContent = message;
        hideLoading();
    }

    async function openViewer(id) {
        const file = state.byId.get(id);
        if (!file) return;

        resetViewer();
        const seq = ++viewerSeq;
        state.viewerFile = file;
        $('viewerFileName').textContent = file.name;
        viewerViewport.scrollTop = 0;
        viewerModal.classList.remove('hidden');
        api.setChromeDark(true).catch(() => {});
        toggleControls(file.kind);
        viewerLoading.classList.remove('hidden');

        try {
            switch (file.kind) {
                case 'pdf': await openPdf(file, seq); break;
                case 'image': await openImage(file, seq); break;
                case 'video':
                case 'audio': openMedia(file, seq); break;
                case 'text': await openText(file, seq); break;
                default:
                    showFallback(file, 'Documents Hub chưa xem trực tiếp được loại tệp này. Bạn có thể mở bằng ứng dụng mặc định trên máy.');
            }
        } catch (err) {
            if (seq !== viewerSeq) return;
            console.error('Lỗi mở tệp:', err);
            showFallback(file, (err && err.message) || 'Không mở được tệp này.');
        } finally {
            // video/âm thanh tự tắt màn hình chờ khi đã tải xong siêu dữ liệu
            if (seq === viewerSeq && file.kind !== 'video' && file.kind !== 'audio') hideLoading();
        }
    }

    function closeViewer() {
        resetViewer();
        viewerModal.classList.add('hidden');
        api.setChromeDark(false).catch(() => {});
    }

    // PDF
    async function openPdf(file, seq) {
        const bytes = await api.readFile(file.id);
        const doc = await pdfjsLib.getDocument({ data: new Uint8Array(bytes) }).promise;
        if (seq !== viewerSeq) { doc.destroy(); return; } // đã đóng hoặc mở tệp khác
        state.readerPdfDoc = doc;
        state.readerCurrentPage = 1;
        readerTotalPages.textContent = doc.numPages;
        readerCurrentPageInput.max = doc.numPages;
        showPanel('pdf');
        await fitToWidth(true);
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

        viewerLoading.classList.remove('hidden');
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
            viewerViewport.scrollTop = 0;
        } catch (err) {
            if (!err || err.name !== 'RenderingCancelledException') console.error('Lỗi render trang PDF:', err);
        } finally {
            if (seq === renderSeq) {
                activeRender = null;
                hideLoading();
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
        const fit = clampZoom((viewerViewport.clientWidth - 96) / base.width);
        state.readerZoomScale = first ? Math.min(fit, 1.6) : fit;
        await renderReaderPage(state.readerCurrentPage);
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

    // Hình ảnh
    function applyImageFit() {
        const img = $('viewerImg');
        img.style.maxWidth = state.imageFit ? '100%' : 'none';
        img.style.maxHeight = state.imageFit ? 'calc(100vh - 116px)' : 'none';
        img.style.cursor = state.imageFit ? 'zoom-in' : 'zoom-out';
        $('btnImageFit').textContent = state.imageFit ? 'Kích thước thật' : 'Vừa khung';
    }

    async function openImage(file, seq) {
        const img = $('viewerImg');
        state.imageFit = true;
        applyImageFit();
        showPanel('image');
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = () => reject(new Error('Không hiển thị được hình ảnh này.'));
            img.src = mediaUrl(file.id);
        });
        if (seq !== viewerSeq) return;
    }

    $('btnImageFit').addEventListener('click', () => { state.imageFit = !state.imageFit; applyImageFit(); });
    $('viewerImg').addEventListener('click', () => { state.imageFit = !state.imageFit; applyImageFit(); });

    // Video và âm thanh
    function openMedia(file, seq) {
        const isVideo = file.kind === 'video';
        const host = $('viewerMediaHost');
        showPanel('media');

        const el = document.createElement(isVideo ? 'video' : 'audio');
        el.controls = true;
        el.autoplay = true;
        el.preload = 'auto';
        if (isVideo) {
            el.playsInline = true;
            el.className = 'max-w-full rounded-sheet bg-black shadow-pop';
            el.style.maxHeight = 'calc(100vh - 116px)';
            host.appendChild(el);
        } else {
            const card = document.createElement('div');
            card.className = 'w-full max-w-xl rounded-xl bg-panel p-6 text-center shadow-sheet';
            card.innerHTML = `
                <span class="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-sunken text-xl" style="color:${KIND_INFO.audio.color}"><i class="fa-solid fa-music"></i></span>
                <p class="mb-4 break-words text-[14px] font-medium">${escapeHtml(file.name)}</p>`;
            el.className = 'w-full';
            card.appendChild(el);
            host.appendChild(card);
        }

        el.addEventListener('loadedmetadata', () => {
            if (seq !== viewerSeq) return;
            hideLoading();
            if (isVideo && Number.isFinite(el.duration)) rememberDuration(file, el.duration);
        });
        el.addEventListener('error', () => {
            if (seq !== viewerSeq) return;
            host.innerHTML = '';
            showFallback(file, isVideo
                ? 'Định dạng hoặc bộ mã hóa của video này chưa phát được trong Documents Hub. MP4 (H.264), WebM và MOV thường phát tốt; AVI, WMV hoặc HEVC thì nên mở bằng trình phát mặc định.'
                : 'Định dạng âm thanh này chưa phát được trong Documents Hub. Bạn có thể mở bằng trình phát mặc định trên máy.');
        });
        el.src = mediaUrl(file.id);
    }

    // Văn bản
    async function openText(file, seq) {
        const limit = 1048576;
        const r = await api.readText(file.id, limit);
        if (seq !== viewerSeq) return;
        showPanel('text');
        $('viewerTextBody').textContent = r.text.length ? r.text : '(Tệp trống)';
        const note = $('viewerTextNote');
        if (r.truncated) {
            note.textContent = `Chỉ hiển thị ${formatFileSize(limit)} đầu tiên trong tổng ${formatFileSize(r.size)}. Dùng "Mở bằng ứng dụng mặc định" để xem đầy đủ.`;
            note.classList.remove('hidden');
        }
    }

    // Các nút chung của trình xem
    $('btnCloseViewer').addEventListener('click', closeViewer);

    const withViewerFile = (fn) => async () => {
        const file = state.viewerFile;
        if (!file) return;
        try { await fn(file); } catch (err) { showError(err); }
    };
    $('btnViewerSave').addEventListener('click', withViewerFile(async (file) => {
        const res = await api.exportFile(file.id);
        if (res.saved) showToast(`Đã lưu bản sao: ${res.path}`);
    }));
    $('btnViewerOpenExternal').addEventListener('click', withViewerFile((file) => api.openExternal(file.id)));
    $('btnFallbackOpen').addEventListener('click', withViewerFile((file) => api.openExternal(file.id)));
    $('btnViewerReveal').addEventListener('click', withViewerFile((file) => api.revealFile(file.id)));
    $('btnFallbackReveal').addEventListener('click', withViewerFile((file) => api.revealFile(file.id)));

    // --- ĐỔI TÊN / CHUYỂN PHÂN LOẠI ---
    const editModal = $('editModal');
    const editNameInput = $('editNameInput');
    const editCategorySelect = $('editCategorySelect');
    let editingId = null;

    function openEditModal(id) {
        const file = state.byId.get(id);
        if (!file || file.isTrash) return;
        editingId = id;
        editNameInput.value = file.name;
        editCategorySelect.innerHTML = state.categories
            .map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
        editCategorySelect.value = file.category;
        editModal.classList.remove('hidden');
        editNameInput.focus();
        // chọn phần tên, không chọn đuôi tệp
        const dot = file.name.lastIndexOf('.');
        editNameInput.setSelectionRange(0, dot > 0 ? dot : file.name.length);
    }

    function closeEditModal() {
        editModal.classList.add('hidden');
        editingId = null;
    }

    document.querySelectorAll('.btnCloseEdit').forEach((b) => b.addEventListener('click', closeEditModal));
    $('btnViewerEdit').addEventListener('click', () => { if (state.viewerFile) openEditModal(state.viewerFile.id); });

    $('editForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = editingId;
        const file = state.byId.get(id);
        if (!file) return closeEditModal();
        const newName = editNameInput.value.trim();
        const newCat = editCategorySelect.value;
        if (!newName) { showToast('Tên tệp không được để trống', 'error'); return; }
        try {
            let changed = false;
            if (newName !== file.name) { applySnapshot(await api.renameFile(id, newName)); changed = true; }
            if (newCat !== state.byId.get(id).category) { applySnapshot(await api.moveFile(id, newCat)); changed = true; }
            closeEditModal();
            if (changed) {
                renderApp();
                const updated = state.byId.get(id);
                if (state.viewerFile && state.viewerFile.id === id) {
                    state.viewerFile = updated;
                    $('viewerFileName').textContent = updated.name;
                }
                showToast('Đã cập nhật tệp');
            }
        } catch (err) { showError(err); }
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
                    `Xóa phân loại "${name}"? Tệp trong phân loại này sẽ được chuyển sang "${target}".`, 'Xóa phân loại');
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

    // --- THÊM TỆP ---
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

    function reportImport(res) {
        const failed = res.failed || [];
        const keep = res.notRemoved || [];
        const base = res.added === 1 ? 'Đã thêm 1 tệp' : `Đã thêm ${res.added} tệp`;
        if (failed.length === 0 && keep.length === 0) {
            showToast(res.removed > 0 ? `${base} và xóa tệp gốc` : base);
            return;
        }
        if (failed.length === 0) {
            showToast(`${base}, nhưng không xóa được tệp gốc "${keep[0].name}": ${keep[0].error}`, 'info');
            return;
        }
        const first = failed[0];
        const more = failed.length > 1 ? ` và ${failed.length - 1} tệp khác` : '';
        const head = res.added > 0 ? `Đã thêm ${res.added} tệp. ` : '';
        showToast(`${head}Không thêm được "${first.name}"${more}: ${first.error}`, res.added > 0 ? 'info' : 'error');
    }

    const removeSourceCheck = $('removeSourceCheck');
    removeSourceCheck.checked = store.get('removeSource', '1') === '1';
    removeSourceCheck.addEventListener('change', () => store.set('removeSource', removeSourceCheck.checked ? '1' : '0'));

    // removeSource chỉ bật cho luồng "Thêm tệp"; kéo thả vào cửa sổ luôn chỉ sao chép
    async function importPaths(paths, category, removeSource = false) {
        if (!paths.length) {
            showToast('Không đọc được đường dẫn của tệp đã thả vào', 'error');
            return;
        }
        setBusy(paths.length === 1 ? 'Đang thêm tệp' : `Đang thêm ${paths.length} tệp`);
        try {
            const res = await api.importPaths(paths, category, removeSource);
            applySnapshot(res.snapshot);
            closeModal(uploadModal);
            if (res.added > 0) state.nav = 'all';
            renderApp();
            reportImport(res);
            backfillPageCounts();
        } catch (err) {
            showError(err);
        } finally {
            setBusy(null);
        }
    }

    async function pickFiles() {
        try {
            const paths = await api.chooseFiles();
            if (paths.length) await importPaths(paths, uploadCategorySelect.value, removeSourceCheck.checked);
        } catch (err) { showError(err); }
    }

    dropZone.addEventListener('click', pickFiles);
    dropZone.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickFiles(); }
    });
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        hideDropOverlay();
        importPaths(api.pathsForFiles(e.dataTransfer.files), uploadCategorySelect.value, removeSourceCheck.checked);
    });

    // Thả tệp vào bất kỳ đâu trong cửa sổ
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
        if (!state.libraryReady || isViewerOpen()) return;
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
        if (!state.libraryReady || isViewerOpen() || !e.dataTransfer || !e.dataTransfer.files.length) return;
        importPaths(api.pathsForFiles(e.dataTransfer.files), defaultUploadCategory());
    });

    // --- PHÍM TẮT ---
    document.addEventListener('keydown', (e) => {
        const mod = e.ctrlKey || e.metaKey;

        if (!$('confirmModal').classList.contains('hidden')) {
            if (e.key === 'Escape') $('btnConfirmCancel').click();
            return;
        }

        if (e.key === 'Escape') {
            if (!editModal.classList.contains('hidden')) closeEditModal();
            else if (isViewerOpen()) closeViewer();
            else if ([uploadModal, categoryModal, folderModal, editModal].some((m) => !m.classList.contains('hidden'))) {
                [uploadModal, categoryModal, folderModal].forEach(closeModal);
                closeEditModal();
            } else if (document.activeElement === searchInput) {
                searchInput.value = '';
                state.searchQuery = '';
                $('searchHint').classList.remove('hidden');
                searchInput.blur();
                renderApp();
            }
            return;
        }

        if (isViewerOpen()) {
            if (!state.viewerFile || state.viewerFile.kind !== 'pdf' || e.target.tagName === 'INPUT') return;
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

    // --- TÍNH SỐ TRANG CHO PDF MỚI NHẬN DIỆN ---
    let backfilling = false;
    async function backfillPageCounts() {
        if (backfilling) return;
        backfilling = true;
        try {
            const pending = state.files.filter((f) => !f.isTrash && f.kind === 'pdf' && !f.pageCount);
            for (const f of pending) {
                let n = -1; // -1: không đọc được, không thử lại
                try {
                    const bytes = await api.readFile(f.id);
                    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(bytes) }).promise;
                    n = doc.numPages;
                    doc.destroy();
                } catch (_) { /* tệp lỗi */ }
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
        // Đồng bộ giao diện với cài đặt đã lưu (hoặc theo hệ thống) để khớp với màu nút cửa sổ do main đặt
        try {
            const saved = await api.getTheme();
            applyDark(saved === null ? window.matchMedia('(prefers-color-scheme: dark)').matches : saved);
        } catch (_) { syncThemeIcon(); }
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
