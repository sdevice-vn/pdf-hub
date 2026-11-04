'use strict';
(() => {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';

    const api = window.pdfHub;

    // --- APP STATE ---
    const state = {
        files: [],
        categories: [],
        libraryPath: '',
        libraryReady: false,
        currentViewMode: 'grid', // 'grid' | 'list'
        activeNavView: 'all',    // 'all' | 'trash'
        selectedCategory: 'ALL', // 'ALL' | tên phân loại
        searchQuery: '',
        editingCategory: null,

        // Reader
        readerPdfDoc: null,
        readerCurrentPage: 1,
        readerZoomScale: 1.2,
        readerCurrentFile: null
    };

    const $ = (id) => document.getElementById(id);
    const fileContainer = $('fileContainer');
    const emptyState = $('emptyState');
    const searchInput = $('searchInput');
    const btnGridView = $('btnGridView');
    const btnListView = $('btnListView');
    const uploadModal = $('uploadModal');
    const categoryModal = $('categoryModal');
    const folderModal = $('folderModal');
    const categoryChipsContainer = $('categoryChipsContainer');
    const categoryManageList = $('categoryManageList');
    const uploadCategorySelect = $('uploadCategorySelect');
    const trashBar = $('trashBar');
    const welcomeScreen = $('welcomeScreen');

    // --- UTILITIES ---
    const escapeHtml = (s) =>
        String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function formatFileSize(bytes) {
        if (!bytes) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    function formatDate(timestamp) {
        return new Date(timestamp).toLocaleDateString('vi-VN', {
            year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
        });
    }

    const baseName = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || p;

    let toastTimer = null;
    function showToast(message, type = 'success') {
        const toast = $('toast');
        const toastIcon = $('toastIcon');
        $('toastMessage').textContent = message;
        toast.className = 'fixed bottom-5 right-5 z-[80] flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg text-white transition-all transform duration-300 translate-y-0 max-w-md';

        if (type === 'success') {
            toast.classList.add('bg-emerald-600');
            toastIcon.className = 'fa-solid fa-circle-check text-xl';
        } else if (type === 'error') {
            toast.classList.add('bg-red-600');
            toastIcon.className = 'fa-solid fa-circle-exclamation text-xl';
        } else {
            toast.classList.add('bg-blue-600');
            toastIcon.className = 'fa-solid fa-info-circle text-xl';
        }

        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toast.classList.add('translate-y-full', 'opacity-0'), 3500);
    }

    const showError = (err) => showToast((err && err.message) || String(err), 'error');

    function confirmDialog(message, okLabel = 'Xác nhận') {
        return new Promise((resolve) => {
            const modal = $('confirmModal');
            $('confirmMessage').textContent = message;
            $('btnConfirmOk').textContent = okLabel;
            modal.classList.remove('hidden');
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

    // Nhận trạng thái mới từ main process
    function applySnapshot(snap) {
        state.files = snap.files;
        state.categories = snap.categories;
        state.libraryPath = snap.path;
        state.libraryReady = true;
        if (state.selectedCategory !== 'ALL' && !state.categories.includes(state.selectedCategory)) {
            state.selectedCategory = 'ALL';
        }
    }

    // --- THEME ---
    const themeIcon = $('themeIcon');
    function initTheme() {
        const dark = localStorage.theme === 'dark' ||
            (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches);
        document.documentElement.classList.toggle('dark', dark);
        themeIcon.className = dark ? 'fa-solid fa-sun text-lg text-amber-400' : 'fa-solid fa-moon text-lg';
    }

    $('btnThemeToggle').addEventListener('click', () => {
        const dark = !document.documentElement.classList.contains('dark');
        document.documentElement.classList.toggle('dark', dark);
        localStorage.theme = dark ? 'dark' : 'light';
        themeIcon.className = dark ? 'fa-solid fa-sun text-lg text-amber-400' : 'fa-solid fa-moon text-lg';
    });

    // --- RENDER ---
    function renderApp() {
        updateCategoryDropdowns();
        renderCategoryChips();
        filterAndRenderFiles();
        updateStats();
        $('folderLabel').textContent = state.libraryPath ? baseName(state.libraryPath) : 'Thư mục lưu trữ';
        $('btnOpenFolderModal').title = state.libraryPath || 'Thư mục lưu trữ';
    }

    function filterAndRenderFiles() {
        let result = state.files.filter((f) => (state.activeNavView === 'trash' ? f.isTrash : !f.isTrash));

        if (state.selectedCategory !== 'ALL') {
            result = result.filter((f) => f.category === state.selectedCategory);
        }

        const q = state.searchQuery.trim().toLowerCase();
        if (q) {
            result = result.filter((f) => f.name.toLowerCase().includes(q) || (f.notes && f.notes.toLowerCase().includes(q)));
        }

        result.sort((a, b) => b.uploadDate - a.uploadDate);

        const showTrashBar = state.activeNavView === 'trash' && state.files.some((f) => f.isTrash);
        trashBar.classList.toggle('hidden', !showTrashBar);
        trashBar.classList.toggle('flex', showTrashBar);

        if (result.length === 0) {
            fileContainer.classList.add('hidden');
            emptyState.classList.remove('hidden');
            emptyState.classList.add('flex');
            $('btnEmptyUpload').classList.toggle('hidden', state.activeNavView === 'trash');
        } else {
            emptyState.classList.add('hidden');
            emptyState.classList.remove('flex');
            fileContainer.classList.remove('hidden');

            if (state.currentViewMode === 'grid') {
                fileContainer.className = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4';
                fileContainer.innerHTML = result.map(createGridCardHTML).join('');
            } else {
                fileContainer.className = 'flex flex-col space-y-3';
                fileContainer.innerHTML = result.map(createListItemHTML).join('');
            }
        }
    }

    const CHIP_ON = 'bg-red-600 text-white shadow-sm';
    const CHIP_OFF = 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600';

    function renderCategoryChips() {
        const chip = (value, label, selected) =>
            `<button data-cat="${escapeHtml(value)}" class="px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${selected ? CHIP_ON : CHIP_OFF}">${escapeHtml(label)}</button>`;

        let html = chip('__all__', 'Tất cả', state.selectedCategory === 'ALL');
        state.categories.forEach((cat) => { html += chip(cat, cat, state.selectedCategory === cat); });
        categoryChipsContainer.innerHTML = html;
    }

    categoryChipsContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-cat]');
        if (!btn) return;
        state.selectedCategory = btn.dataset.cat === '__all__' ? 'ALL' : btn.dataset.cat;
        renderApp();
    });

    function updateCategoryDropdowns() {
        const previous = uploadCategorySelect.value;
        uploadCategorySelect.innerHTML = state.categories
            .map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
        if (state.categories.includes(previous)) uploadCategorySelect.value = previous;
    }

    function actionButtons(file, size) {
        const pad = size === 'grid' ? 'p-1.5' : 'p-2';
        if (!file.isTrash) {
            return `
                <button data-action="open" data-id="${file.id}" class="${pad} text-gray-500 hover:text-red-600 dark:hover:text-red-400 rounded transition-colors" title="Đọc/Xem trực tiếp file">
                    <i class="fa-solid fa-eye text-base"></i>
                </button>
                <button data-action="reveal" data-id="${file.id}" class="${pad} text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 rounded transition-colors" title="Hiện file trong thư mục">
                    <i class="fa-solid fa-folder-open text-base"></i>
                </button>
                <button data-action="export" data-id="${file.id}" class="${pad} text-gray-500 hover:text-emerald-600 dark:hover:text-emerald-400 rounded transition-colors" title="Lưu bản sao ra nơi khác">
                    <i class="fa-solid fa-download text-base"></i>
                </button>
                <button data-action="trash" data-id="${file.id}" class="${pad} text-gray-500 hover:text-red-600 dark:hover:text-red-400 rounded transition-colors" title="Bỏ vào thùng rác">
                    <i class="fa-solid fa-trash-can text-base"></i>
                </button>`;
        }
        return `
            <button data-action="restore" data-id="${file.id}" class="px-2.5 py-1.5 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 rounded-lg text-xs font-semibold hover:bg-emerald-100 transition-colors">
                <i class="fa-solid fa-rotate-left"></i> Khôi phục
            </button>
            <button data-action="delete" data-id="${file.id}" class="px-2.5 py-1.5 bg-red-50 dark:bg-red-900/20 text-red-600 rounded-lg text-xs font-semibold hover:bg-red-100 transition-colors">
                <i class="fa-solid fa-xmark"></i> Xóa
            </button>`;
    }

    function createGridCardHTML(file) {
        const name = escapeHtml(file.name);
        return `
            <div class="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm hover:shadow-md transition-all flex flex-col justify-between overflow-hidden group">
                <div class="p-4 space-y-3">
                    <div class="flex items-start justify-between gap-2">
                        <div class="p-2.5 bg-red-100 dark:bg-red-900/30 text-red-600 rounded-lg flex-shrink-0">
                            <i class="fa-solid fa-file-pdf text-2xl"></i>
                        </div>
                        <span class="px-2.5 py-1 text-xs font-semibold rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 truncate max-w-[60%]">${escapeHtml(file.category)}</span>
                    </div>
                    <div>
                        <h3 ${file.isTrash ? '' : `data-action="open" data-id="${file.id}"`} class="font-bold text-gray-800 dark:text-gray-100 text-sm truncate ${file.isTrash ? '' : 'cursor-pointer hover:text-red-600'} transition-colors" title="${name}">${name}</h3>
                        <p class="text-xs text-gray-400 mt-1 flex items-center justify-between">
                            <span>${formatFileSize(file.size)}</span>
                            <span>${file.pageCount > 0 ? file.pageCount + ' trang' : ''}</span>
                        </p>
                    </div>
                </div>
                <div class="px-4 py-3 bg-gray-50 dark:bg-gray-900/40 border-t border-gray-100 dark:border-gray-700/50 flex justify-between items-center text-xs">
                    <span class="text-gray-400">${formatDate(file.uploadDate)}</span>
                    <div class="flex items-center gap-1">${actionButtons(file, 'grid')}</div>
                </div>
            </div>`;
    }

    function createListItemHTML(file) {
        const name = escapeHtml(file.name);
        return `
            <div class="bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 hover:border-gray-300 dark:hover:border-gray-600 transition-all">
                <div class="flex items-center gap-3 overflow-hidden ${file.isTrash ? '' : 'cursor-pointer'}" ${file.isTrash ? '' : `data-action="open" data-id="${file.id}"`}>
                    <div class="p-2.5 bg-red-100 dark:bg-red-900/30 text-red-600 rounded-lg flex-shrink-0">
                        <i class="fa-solid fa-file-pdf text-xl"></i>
                    </div>
                    <div class="truncate">
                        <h3 class="font-bold text-gray-800 dark:text-gray-100 text-sm truncate ${file.isTrash ? '' : 'hover:text-red-600'} transition-colors" title="${name}">${name}</h3>
                        <div class="text-xs text-gray-400 flex items-center gap-3 mt-0.5">
                            <span>${formatFileSize(file.size)}</span>
                            <span>•</span>
                            <span>${file.pageCount > 0 ? file.pageCount + ' trang' : 'N/A'}</span>
                            <span>•</span>
                            <span>${formatDate(file.uploadDate)}</span>
                        </div>
                    </div>
                </div>
                <div class="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
                    <span class="px-2.5 py-1 text-xs font-semibold rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300">${escapeHtml(file.category)}</span>
                    <div class="flex items-center gap-1 border-l pl-3 border-gray-200 dark:border-gray-700">${actionButtons(file, 'list')}</div>
                </div>
            </div>`;
    }

    function updateStats() {
        const active = state.files.filter((f) => !f.isTrash);
        const trashed = state.files.filter((f) => f.isTrash);
        $('badge-count-all').textContent = active.length;
        $('badge-count-trash').textContent = trashed.length;
        $('statTotalFiles').textContent = active.length;
        $('statTotalSize').textContent = formatFileSize(active.reduce((acc, f) => acc + f.size, 0));
        $('statTotalCategories').textContent = state.categories.length;
    }

    // --- FILE ACTIONS (ủy quyền sự kiện) ---
    fileContainer.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const id = btn.dataset.id;
        const file = state.files.find((f) => f.id === id);
        if (!file) return;

        try {
            switch (btn.dataset.action) {
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
                        showToast(`Đã xóa vĩnh viễn "${file.name}"`, 'error');
                    }
                    break;
            }
        } catch (err) {
            showError(err);
        }
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

    // --- PDF READER ---
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
            if (seq !== readerOpenSeq) { // người dùng đã đóng/mở file khác
                doc.destroy();
                return;
            }
            state.readerPdfDoc = doc;
            readerTotalPages.textContent = doc.numPages;
            readerCurrentPageInput.max = doc.numPages;
            await renderReaderPage(1);
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
        const page = Math.min(doc.numPages, Math.max(1, n));
        state.readerCurrentPage = page;
        renderReaderPage(page);
    }

    async function fitToWidth() {
        const doc = state.readerPdfDoc;
        if (!doc) return;
        const page = await doc.getPage(state.readerCurrentPage);
        const base = page.getViewport({ scale: 1 });
        state.readerZoomScale = clampZoom((readerViewport.clientWidth - 48) / base.width);
        renderReaderPage(state.readerCurrentPage);
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
    $('btnReaderResetZoom').addEventListener('click', fitToWidth);
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

    // --- CATEGORY MANAGEMENT ---
    function openModal(modal) { modal.classList.remove('hidden'); }
    function closeModal(modal) { modal.classList.add('hidden'); }

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
                    <div class="flex items-center gap-2 bg-gray-50 dark:bg-gray-900/60 p-2 rounded-lg border border-indigo-400">
                        <input data-edit-input value="${escapeHtml(cat)}" class="flex-1 px-2 py-1 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white">
                        <button data-cat-action="save" data-index="${index}" class="p-1 text-emerald-600 hover:text-emerald-700 rounded" title="Lưu"><i class="fa-solid fa-check"></i></button>
                        <button data-cat-action="cancel" class="p-1 text-gray-400 hover:text-gray-600 rounded" title="Hủy"><i class="fa-solid fa-xmark"></i></button>
                    </div>`;
            }
            return `
                <div class="flex items-center justify-between bg-gray-50 dark:bg-gray-900/60 p-2.5 rounded-lg border border-gray-200 dark:border-gray-700">
                    <span class="text-sm font-medium text-gray-700 dark:text-gray-200 truncate">${escapeHtml(cat)}</span>
                    <div class="flex items-center gap-1">
                        <button data-cat-action="edit" data-index="${index}" class="p-1 text-gray-400 hover:text-blue-500 rounded transition-colors" title="Đổi tên">
                            <i class="fa-solid fa-pen text-xs"></i>
                        </button>
                        <button data-cat-action="delete" data-index="${index}" class="p-1 text-gray-400 hover:text-red-500 rounded transition-colors" title="Xóa phân loại">
                            <i class="fa-solid fa-trash-can text-xs"></i>
                        </button>
                    </div>
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
            // main có thể làm sạch tên; tìm tên mới theo vị trí cũ
            if (wasSelected) state.selectedCategory = state.categories[index] || 'ALL';
            state.editingCategory = null;
            renderCategoryManageList();
            renderApp();
            showToast('Đã cập nhật tên phân loại');
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
                    showToast('Bạn phải giữ lại ít nhất 1 phân loại!', 'error');
                    return;
                }
                const ok = await confirmDialog(
                    `Xóa phân loại "${name}"? Các file trong phân loại này sẽ được chuyển sang phân loại "${state.categories.find((c) => c !== name)}".`,
                    'Xóa phân loại');
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

    // --- STORAGE FOLDER ---
    async function chooseFolder() {
        try {
            const snap = await api.chooseFolder();
            if (!snap) return false; // người dùng hủy
            applySnapshot(snap);
            state.selectedCategory = 'ALL';
            state.activeNavView = 'all';
            setNavViewStyles();
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

    // --- UPLOAD ---
    const fileInput = $('fileInput');
    const dropZone = $('dropZone');

    const defaultUploadCategory = () =>
        state.selectedCategory !== 'ALL' && state.categories.includes(state.selectedCategory)
            ? state.selectedCategory
            : state.categories[0];

    function openUploadModal() {
        uploadCategorySelect.value = defaultUploadCategory();
        openModal(uploadModal);
    }

    $('btnOpenUploadModal').addEventListener('click', openUploadModal);
    $('btnEmptyUpload').addEventListener('click', openUploadModal);
    document.querySelectorAll('.btnCloseModal').forEach((btn) =>
        btn.addEventListener('click', () => closeModal(uploadModal)));

    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('border-red-500', 'bg-red-50/50');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('border-red-500', 'bg-red-50/50'));
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('border-red-500', 'bg-red-50/50');
        if (e.dataTransfer.files.length) handleFileUpload(e.dataTransfer.files, uploadCategorySelect.value);
    });
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length) handleFileUpload(e.target.files, uploadCategorySelect.value);
    });

    // Thả file PDF vào bất kỳ đâu trong cửa sổ cũng được (và không bị mở như một trang web)
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
        e.preventDefault();
        if (!state.libraryReady || !e.dataTransfer || !e.dataTransfer.files.length) return;
        handleFileUpload(e.dataTransfer.files, defaultUploadCategory());
    });

    async function handleFileUpload(files, category) {
        let ok = 0;
        let skipped = 0;

        for (const file of Array.from(files)) {
            if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
                showToast(`Tệp "${file.name}" không phải là định dạng PDF`, 'error');
                skipped++;
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

                applySnapshot(await api.saveFile({
                    name: file.name,
                    data: new Uint8Array(buffer),
                    category,
                    pageCount
                }));
                ok++;
            } catch (err) {
                console.error('Lỗi khi lưu file:', err);
                showToast(`Không thể lưu "${file.name}": ${err.message}`, 'error');
            }
        }

        closeModal(uploadModal);
        fileInput.value = '';
        if (ok > 0) {
            if (state.activeNavView !== 'all') {
                state.activeNavView = 'all';
                setNavViewStyles();
            }
            renderApp();
            showToast(`Đã lưu ${ok} file PDF vào thư mục lưu trữ`);
        }
    }

    // --- NAV / SEARCH / VIEW MODE ---
    const NAV_ON = ['bg-white', 'dark:bg-gray-800', 'text-red-600', 'dark:text-red-400', 'shadow-sm'];
    const NAV_OFF = ['text-gray-600', 'dark:text-gray-300'];

    function setNavViewStyles() {
        document.querySelectorAll('.nav-view-btn').forEach((b) => {
            const active = b.dataset.filterView === state.activeNavView;
            b.classList.remove(...NAV_ON, ...NAV_OFF);
            b.classList.add(...(active ? NAV_ON : NAV_OFF));
        });
    }

    document.querySelectorAll('.nav-view-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            state.activeNavView = e.currentTarget.dataset.filterView;
            setNavViewStyles();
            renderApp();
        });
    });

    searchInput.addEventListener('input', (e) => {
        state.searchQuery = e.target.value;
        filterAndRenderFiles();
    });

    function setViewMode(mode) {
        state.currentViewMode = mode;
        const on = ['bg-white', 'dark:bg-gray-600', 'shadow-sm'];
        (mode === 'grid' ? btnGridView : btnListView).classList.add(...on);
        (mode === 'grid' ? btnListView : btnGridView).classList.remove(...on);
        filterAndRenderFiles();
    }
    btnGridView.addEventListener('click', () => setViewMode('grid'));
    btnListView.addEventListener('click', () => setViewMode('list'));

    // --- KEYBOARD ---
    document.addEventListener('keydown', (e) => {
        if (!$('confirmModal').classList.contains('hidden')) {
            if (e.key === 'Escape') $('btnConfirmCancel').click();
            return;
        }
        if (e.key === 'Escape') {
            if (isReaderOpen()) closeReader();
            else [uploadModal, categoryModal, folderModal].forEach(closeModal);
            return;
        }
        if (!isReaderOpen() || e.target.tagName === 'INPUT') return;
        if (e.key === 'ArrowLeft' || e.key === 'PageUp') goToPage(state.readerCurrentPage - 1);
        else if (e.key === 'ArrowRight' || e.key === 'PageDown') goToPage(state.readerCurrentPage + 1);
    });

    // --- BACKFILL: tính số trang cho file PDF mới nhận diện từ thư mục ---
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

    // --- INIT ---
    window.addEventListener('DOMContentLoaded', async () => {
        initTheme();
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
            // Thư mục đã chọn trước đó không còn truy cập được -> cho chọn lại
            const box = $('welcomeError');
            box.textContent = `Không mở được thư mục lưu trữ: ${err.message}`;
            box.classList.remove('hidden');
            welcomeScreen.classList.remove('hidden');
            renderApp();
        }
    });
})();
