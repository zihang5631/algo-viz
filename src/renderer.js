class SortingVisualizer {
    constructor() {
        this.array = [];
        // 初始数组快照：每次"开始排序"前冻结；"重置"从此恢复，
        // 避免协程原地交换污染 this.array 后重置仍显示已排序的状态。
        this.initialArray = [];
        // 重置请求：用户在协程中点重置时设为 true，协程 finally 看到后
        // 不再把半成品推入 sessionData / unsavedCount。
        this.resetRequested = false;
        this.arraySize = 30;
        this.speed = 100;
        this.currentAlgorithm = 'bubble';
        this.isSorting = false;
        this.isPaused = false;
        this.isStepMode = false;     // 单步模式：用户已进入逐帧控制
        this.stepRequested = false;  // 单步请求：sleep() 放行一次后自动再暂停
        this.sortingComplete = false;
        this.comparisons = 0;
        this.swaps = 0;
        // 调试开关：仅当 localStorage.ALGO_VIZ_DEBUG=1 时启用 IPC/路径详细日志
        this.debug = (typeof localStorage !== 'undefined') && (localStorage.getItem('ALGO_VIZ_DEBUG') === '1');
        this._previewLimit = 200;
        this.sessionData = [];        // 本会话内每次"启动排序"产生的运行记录
        this.unsavedCount = 0;        // 尚未持久化到磁盘的运行条数
        this.elapsedMs = 0;           // 当前排序累计"运行时间"（毫秒，自动播放时间，单步模式暂停不计时）
        this.elapsedTimerId = null;
        this.appSettings = {          // 应用基础设置
            defaultSavePath: '',
            defaultExportPath: ''
        };
        this.chartType = 'bar';       // 'bar' | 'scatter'：测试数据页图表类型

        this.initializeElements();
        this.loadAppSettings().then(() => this.loadHistoryFromDefaultPath());
        this.generateRandomArray();
        this.attachEventListeners();
        this.renderBars();
        this.initializeDesktopFeatures();
        this.initializeResizeHandler();
        this.updateElapsedDisplay();
        this.attachWindowUnloadGuard();
        // 初始控件状态：未在排序中 → 数组大小/生成新数组按钮可用
        this.updateControlsState();
        // 初始图表切换按钮状态（默认柱状图）

        this.updateChartTypeToggleUI();
    }

    // 渲染端日志：在 DevTools 控制台打印，主进程日志在终端。
    // 触发条件：浏览器里执行 `localStorage.setItem('ALGO_VIZ_DEBUG','1')` 后刷新。
    _log(tag, payload) {
        if (!this.debug) return;
        try {
            const time = new Date().toISOString();
            const safe = this._safeClone(payload);
            console.log(`[ALGO-VIZ ${time}] [renderer][${tag}]`, safe);
        } catch (e) { /* ignore */ }
    }
    _safeClone(v) {
        try { return JSON.parse(JSON.stringify(v, (k, val) => {
            if (typeof val === 'string' && val.length > this._previewLimit) {
                return val.slice(0, this._previewLimit) + `...(truncated, total ${val.length} chars)`;
            }
            return val;
        })); } catch (e) { return '[unserializable]'; }
    }

    // ==================== IPC 包装层 ====================
    // 集中所有 electronAPI 调用，统一打日志和异常包装。
    // 在 DEBUG 开启时，会在 DevTools 看到 [ALGO-VIZ ...][renderer][ipc:xxx]
    async _ipc(name, fn, args) {
        const t0 = Date.now();
        this._log(`ipc:${name}:enter`, { args: args === undefined ? null : args });
        try {
            const result = await fn();
            this._log(`ipc:${name}:done`, { elapsedMs: Date.now() - t0, result });
            return result;
        } catch (e) {
            this._log(`ipc:${name}:error`, { elapsedMs: Date.now() - t0, message: e && e.message });
            throw e;
        }
    }
    ipcSaveData(payload)     { return this._ipc('saveData', () => window.electronAPI.saveData(payload), { payload }); }
    ipcExportCSV(payload)    { return this._ipc('exportCSV', () => window.electronAPI.exportCSV(payload), { payload }); }
    ipcGetAppInfo()          { return this._ipc('getAppInfo', () => window.electronAPI.getAppInfo()); }
    ipcGetSettings()         { return this._ipc('getSettings', () => window.electronAPI.getSettings()); }
    ipcSaveSettings(s)       { return this._ipc('saveSettings', () => window.electronAPI.saveSettings(s), { s }); }
    ipcChooseDirectory(p)    { return this._ipc('chooseDirectory', () => window.electronAPI.chooseDirectory(p), { defaultPath: p }); }
    ipcChooseSaveFile(o)     { return this._ipc('chooseSaveFile', () => window.electronAPI.chooseSaveFile(o), { opts: o }); }
    ipcConfirmDialog(o)      { return this._ipc('confirmDialog', () => window.electronAPI.confirmDialog(o), { opts: o }); }
    ipcListHistory(o)        { return this._ipc('listHistory', () => window.electronAPI.listHistory(o), { opts: o }); }
    ipcReadFile(p)           { return this._ipc('readFile', () => window.electronAPI.readFile(p), { filePath: p }); }
    ipcDeleteFile(p)         { return this._ipc('deleteFile', () => window.electronAPI.deleteFile(p), { filePath: p }); }
    ipcQuitApp()             { return this._ipc('quitApp', () => window.electronAPI.quitApp()); }
    ipcMinimizeWindow()      { return this._ipc('minimizeWindow', () => window.electronAPI.minimizeWindow()); }
    ipcToggleMaximize()      { return this._ipc('toggleMaximizeWindow', () => window.electronAPI.toggleMaximizeWindow()); }

    initializeElements() {
        this.barsContainer = document.getElementById('barsContainer');
        this.arraySizeSlider = document.getElementById('arraySize');
        this.sizeValue = document.getElementById('sizeValue');
        this.sortSpeedSlider = document.getElementById('sortSpeed');
        this.speedValue = document.getElementById('speedValue');
        this.comparisonsEl = document.getElementById('comparisons');
        this.swapsEl = document.getElementById('swaps');
        this.currentAlgorithmEl = document.getElementById('currentAlgorithm');
        this.arraySizeDisplay = document.getElementById('arraySizeDisplay');

        // 开始/暂停按钮（同时承担"开始"、"暂停"、"继续"三种状态切换）
        this.startSortBtn = document.getElementById('startSort');
        this.startSortIcon = this.startSortBtn.querySelector('.action-icon');
        this.startSortText = this.startSortBtn.querySelector('.action-text');

        // 单步执行按钮（运行时=切入单步模式；单步模式中=推进一帧）
        this.stepSortBtn = document.getElementById('stepSort');
        this.stepSortIcon = this.stepSortBtn.querySelector('.action-icon');
        this.stepSortText = this.stepSortBtn.querySelector('.action-text');

        // 生成新数组按钮（运行时禁用，避免破坏正在排序的数组）
        this.generateArrayBtn = document.getElementById('generateArray');

        this.exportDataBtn = document.getElementById('exportData');
        this.saveDataBtn = document.getElementById('saveDataBtn');
        this.appSettingsBtn = document.getElementById('appSettings');
        this.appQuitBtn = document.getElementById('appQuit');
        this.appMinimizeBtn = document.getElementById('appMinimize');
        this.appToggleMaximizeBtn = document.getElementById('appToggleMaximize');

        // 计时显示
        this.elapsedTimeEl = document.getElementById('elapsedTime');
        this.elapsedStatItem = document.querySelector('.stat-item[data-stat="elapsed"]');

        // 设置对话框
        this.settingsModal = document.getElementById('settingsModal');
        this.defaultSavePathInput = document.getElementById('defaultSavePath');
        this.defaultExportPathInput = document.getElementById('defaultExportPath');
        this.sessionRunCountEl = document.getElementById('sessionRunCount');
        this.appInfoNameEl = document.getElementById('appInfoName');
        this.appInfoVersionEl = document.getElementById('appInfoVersion');
        this.appInfoPlatformEl = document.getElementById('appInfoPlatform');

        // 左侧导航 + 测试数据页（新）
        this.leftRailTabs = document.querySelectorAll('.left-rail-tab');
        this.mainLayout = document.querySelector('.main-layout');
        this.dataPage = document.getElementById('dataPage');
        this.classifyTabs = document.querySelectorAll('.classify-tab');
        this.sourceTabs = document.querySelectorAll('.source-tab');
        this.classifyContainer = document.getElementById('classifyContainer');
        this.manualGroupEditor = document.getElementById('manualGroupEditor');
        this.manualGroupListEl = document.getElementById('manualGroupList');
        this.newGroupNameInput = document.getElementById('newGroupName');
        this.createGroupBtn = document.getElementById('createGroupBtn');
        this.srcCountAllEl = document.getElementById('srcCountAll');
        this.srcCountUnsavedEl = document.getElementById('srcCountUnsaved');
        this.srcCountSavedEl = document.getElementById('srcCountSaved');
        // 图表类型切换（柱状图 / 散点图）
        this.chartTypeToggleBtn = document.getElementById('chartTypeToggle');

        // 兼容旧引用（可能不再使用，但保留避免未定义）
        this.unsavedListEl = null;
        this.historyListEl = null;

        // 数据状态
        this.classifyMode = 'auto';       // 'auto' | 'manual'
        this.sourceMode = 'all';          // 'all' | 'unsaved' | 'saved'
        this.manualGroups = [];           // [{ id, name }]
        this.historyItems = [];           // 默认路径下的历史文件
        this.dirtyHintEl = document.getElementById('dataDirtyHint');
        this.saveAllBtn = document.getElementById('saveAllUnsaved');
        this.saveAllLinkEl = document.getElementById('dataSaveAllLink');
        this.savedRuns = [];              // 从 historyItems 解析出的运行记录（仅 session_*.json）
        this.runToKey = new Map();        // run -> 'session#idx' | 'history#name'
        this.keyToSource = new Map();     // key -> 'unsaved' | 'saved'
        // 记住用户在分类页"展开"了哪些 group，renderDataPage 整体重建后恢复
        this.expandedGroupIds = new Set();

        // 初始控件状态
        this.updateControlsState();
    }
    
    generateRandomArray(size) {
        const n = (typeof size === 'number' && size > 0) ? size : this.arraySize;
        this.arraySize = n;
        this.array = [];
        for (let i = 0; i < n; i++) {
            this.array.push(Math.floor(Math.random() * 95) + 5);
        }
        // 同步初始快照——重置时从此恢复
        this.initialArray = [...this.array];
        this.resetStats();
        this.renderBars();
    }
    
    resetStats() {
        this.stopElapsedTimer();
        this.elapsedMs = 0;
        this.comparisons = 0;
        this.swaps = 0;
        this.sortingComplete = false;
        this.isSorting = false;
        this.isPaused = false;
        this.isStepMode = false;
        this.stepRequested = false;
        this.updateStats();
        this.updateElapsedDisplay();
        this.updateElapsedState('idle');
        this.updateStartButton('start');
        this.updateStepButton('enter');   // 复位为"进入单步"状态
        this.updateControlsState();       // 重新启用被锁的控件
        // 关键：排序进行中重置（用户主动点重置 / 生成新数组 / 滑条），当前
        // run 的数据不完整（endTime / finalArray / 比较交换次数等都不全），
        // 不应作为"未保存"被保留。直接清空 currentSession，finally 块看到
        // 为 null 时会跳过 recordSessionEnd，按钮也不会被覆盖为 'done'。
        if (this.isSorting === false && this.currentSession) {
            this.currentSession = null;
        }
    }
    
    updateStats() {
        this.comparisonsEl.textContent = this.comparisons;
        this.swapsEl.textContent = this.swaps;
        this.arraySizeDisplay.textContent = this.arraySize;
    }
    
    renderBars() {
        this.barsContainer.innerHTML = '';
        const maxHeight = Math.max(...this.array);
        // 数组较大时（>40）隐藏柱子下方的数值标签，避免拥挤重叠
        const showLabels = this.array.length <= 40;
        // 数组较大时（>60）缩小 bar 之间的间隙，保证视觉清晰
        const dense = this.array.length > 60;

        this.array.forEach((value, index) => {
            const bar = document.createElement('div');
            bar.className = 'bar';
            if (dense) bar.classList.add('bar-dense');
            bar.style.height = `${(value / maxHeight) * 100}%`;

            if (this.sortingComplete) {
                bar.classList.add('sorted');
            }

            if (showLabels) {
                const valueLabel = document.createElement('div');
                valueLabel.className = 'bar-label';
                valueLabel.textContent = value;
                bar.appendChild(valueLabel);
            }
            this.barsContainer.appendChild(bar);
        });
    }
    
    updateBarColors(activeIndices = [], comparingIndices = [], sortedIndices = []) {
        const bars = this.barsContainer.children;
        
        for (let i = 0; i < bars.length; i++) {
            bars[i].className = 'bar';
            
            if (activeIndices.includes(i)) {
                bars[i].classList.add('active');
            }
            if (comparingIndices.includes(i)) {
                bars[i].classList.add('comparing');
            }
            if (sortedIndices.includes(i) || this.sortingComplete) {
                bars[i].classList.add('sorted');
            }
        }
    }
    
    attachEventListeners() {
        // 生成新数组：仅在非排序中可用（运行时禁用 + 不响应）
        this.generateArrayBtn.addEventListener('click', () => {
            if (this.isSorting) return;
            this.generateRandomArray();
        });

        // 开始/暂停/继续/退出单步 按钮：根据当前状态切换
        this.startSortBtn.addEventListener('click', () => {
            if (this.isStepMode) {
                // 单步模式 → 退出单步，恢复自动播放
                this.isStepMode = false;
                this.isPaused = false;
                this.stepRequested = false;
                this.updateStartButton('pause');
                this.updateStepButton('next');
            } else if (!this.isSorting && !this.sortingComplete) {
                // 初始 → 启动排序
                this.startSorting();
            } else if (this.isSorting) {
                // 自动运行中 → 切换暂停/继续
                this.isPaused = !this.isPaused;
                this.updateStartButton(this.isPaused ? 'resume' : 'pause');
            } else if (this.sortingComplete) {
                // 排序完成 → "再来一次"用本轮同一个数组重新跑（不重新随机生成）
                this.startSorting();
            }
        });

        // 单步执行按钮：
        //   - 排序中（不在单步模式）→ 暂停并进入单步模式
        //   - 单步模式中 → 推进一帧
        //   - 初始 → 先启动排序再进入单步模式（让单步对所有算法统一可用）；
        //            旧 sortSteps 模式仅保留为兜底
        this.stepSortBtn.addEventListener('click', () => {
            if (this.isSorting && !this.isStepMode) {
                this.isPaused = true;
                this.isStepMode = true;
                this.stepRequested = false;
                this.updateStartButton('resume');   // 现在是"恢复自动"按钮
                this.updateStepButton('next');
            } else if (this.isStepMode) {
                this.stepRequested = true;   // 标记：放行一次 sleep 后自动再暂停
                this.isPaused = false;       // 唤醒 sleep()
            } else if (!this.isSorting && !this.sortingComplete) {
                // 初始：先启动排序 + 立即进入单步模式（不等排序完成再切）
                this.startSorting();
                this.isPaused = true;
                this.isStepMode = true;
                this.stepRequested = false;
                this.updateStartButton('resume');
                this.updateStepButton('next');
            }
        });

        // 重置：恢复本次测试前的初始状态——
        // 1) 协程可能正在交换 this.array，必须从快照恢复，不能用被改过的 this.array
        // 2) 标记 resetRequested 让协程 finally 知道这是用户主动重置 → 不推入 sessionData
        document.getElementById('reset').addEventListener('click', async () => {
            // 先标记"重置"——必须在 isSorting=false 之前，
            // 否则协程可能已经退出到 finally 看到标志还是 false
            this.resetRequested = true;
            // 停协程
            this.isSorting = false;
            this.isPaused = false;
            this.isStepMode = false;
            this.stepRequested = false;
            // 用快照恢复 this.array；如果快照为空则用 generateRandomArray 兜底
            if (this.initialArray && this.initialArray.length > 0) {
                this.array = [...this.initialArray];
            } else {
                this.generateRandomArray();
                return;     // generateRandomArray 已完成 resetStats + renderBars
            }
            this.resetStats();
            // 放一个微任务让协程退出（sleep 看到 !isSorting 立即 resolve），
            // 协程退出后再渲染，避免协程的同步交换段在快照恢复后再次污染。
            await new Promise(r => setTimeout(r, 0));
            // 渲染时 resetRequested 仍为 true，协程 finally 看到后会判为
            // "未完成" → 不推入 unsaved 数据。
            this.renderBars();
        });

        // 数组大小：运行时锁定
        this.arraySizeSlider.addEventListener('input', (e) => {
            if (this.isSorting) return;
            this.arraySize = parseInt(e.target.value);
            if (this.sizeValue) this.sizeValue.value = String(this.arraySize);
            this.generateRandomArray();
        });

        // 数组大小：右侧数值输入框（手动输入会夹取到滑条 min/max）
        if (this.sizeValue) {
            const handleSizeInput = (commit) => {
                if (this.isSorting) return;
                const min = parseInt(this.arraySizeSlider.min) || 5;
                const max = parseInt(this.arraySizeSlider.max) || 200;
                let raw = parseInt(this.sizeValue.value, 10);
                if (!Number.isFinite(raw)) raw = this.arraySize;
                const clamped = Math.max(min, Math.min(max, raw));
                this.arraySize = clamped;
                if (commit || clamped !== raw) {
                    this.sizeValue.value = String(clamped);
                }
                this.arraySizeSlider.value = String(clamped);
                this.generateRandomArray();
            };
            this.sizeValue.addEventListener('input', () => handleSizeInput(false));
            this.sizeValue.addEventListener('change', () => handleSizeInput(true));
            this.sizeValue.addEventListener('blur', () => handleSizeInput(true));
        }

        this.sortSpeedSlider.addEventListener('input', (e) => {
            this.speed = parseInt(e.target.value);
            if (this.speedValue) this.speedValue.value = String(this.speed);
        });

        // 排序速度：右侧数值输入框（手动输入会夹取到滑条 min/max）
        if (this.speedValue) {
            const handleSpeedInput = (commit) => {
                const min = parseInt(this.sortSpeedSlider.min) || 10;
                const max = parseInt(this.sortSpeedSlider.max) || 500;
                let raw = parseInt(this.speedValue.value, 10);
                if (!Number.isFinite(raw)) raw = this.speed;
                const clamped = Math.max(min, Math.min(max, raw));
                this.speed = clamped;
                if (commit || clamped !== raw) {
                    this.speedValue.value = String(clamped);
                }
                this.sortSpeedSlider.value = String(clamped);
            };
            this.speedValue.addEventListener('input', () => handleSpeedInput(false));
            this.speedValue.addEventListener('change', () => handleSpeedInput(true));
            this.speedValue.addEventListener('blur', () => handleSpeedInput(true));
        }

        // 随机参数开关（两个独立）
        this.randomArraySizeEl = document.getElementById('randomArraySize');
        this.randomSortSpeedEl = document.getElementById('randomSortSpeed');
        [this.randomArraySizeEl, this.randomSortSpeedEl].forEach(el => {
            if (!el) return;
            const row = (typeof el.closest === 'function') ? el.closest('.param-random-row') : null;
            const syncRow = () => {
                if (row) row.classList.toggle('is-active', el.checked);
            };
            el.addEventListener('change', syncRow);
            syncRow();
        });

        // 算法分类列表（按次要分类折叠）
        this.renderAlgoCategoryList();

        // 启动时初始化 dirty hint 状态
        this.updateDirtyHint();

        document.querySelectorAll('.algo-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                if (this.isSorting) return;

                document.querySelectorAll('.algo-btn').forEach(b => b.classList.remove('active'));
                const targetBtn = e.target.closest('.algo-btn');
                if (!targetBtn) return;
                targetBtn.classList.add('active');
                this.currentAlgorithm = targetBtn.dataset.algorithm;
                this.currentAlgorithmEl.textContent = targetBtn.querySelector('.algo-name').textContent;
                this.updateComplexityTable();
            });
        });
    }

    // 算法次要分类：6 大类（与算法表格保持一致）
    static ALGO_CATEGORIES = [
        {
            id: 'exchange', name: '交换排序', icon: '🔁',
            items: [
                { id: 'bubble', name: '冒泡排序', tag: 'O(n²)' },
                { id: 'quick',  name: '快速排序', tag: 'O(n log n)' }
            ]
        },
        {
            id: 'selection', name: '选择排序', icon: '👆',
            items: [
                { id: 'selection', name: '选择排序', tag: 'O(n²)' },
                { id: 'heap',      name: '堆排序',   tag: 'O(n log n)' }
            ]
        },
        {
            id: 'insertion', name: '插入排序', icon: '📥',
            items: [
                { id: 'insertion', name: '插入排序',   tag: 'O(n²)' },
                { id: 'shell',     name: '希尔排序',   tag: 'O(n log²n)' },
                { id: 'cocktail',  name: '鸡尾酒排序', tag: 'O(n²)' },
                { id: 'gnome',     name: '地精排序',   tag: 'O(n²)' },
                { id: 'oddeven',   name: '奇偶排序',   tag: 'O(n²)' }
            ]
        },
        {
            id: 'divide', name: '分治合并', icon: '🪓',
            items: [
                { id: 'merge', name: '归并排序', tag: 'O(n log n)' }
            ]
        },
        {
            id: 'noncompare', name: '非比较排序', icon: '🧮',
            items: [
                { id: 'counting', name: '计数排序', tag: 'O(n+k)' },
                { id: 'bucket',   name: '桶排序',   tag: 'O(n+k)' },
                { id: 'radix',    name: '基数排序', tag: 'O(nk)' }
            ]
        },
        {
            id: 'other', name: '其他', icon: '✨',
            items: [
                { id: 'comb',       name: '梳排序',     tag: 'O(n log n)' },
                { id: 'patience',   name: '耐心排序',   tag: 'O(n log n)' },
                { id: 'library',    name: '图书馆排序', tag: 'O(n log n)' },
                { id: 'block',      name: '块排序',     tag: 'O(n log n)' },
                { id: 'smooth',     name: '平滑排序',   tag: 'O(n log n)' },
                { id: 'tournament', name: '锦标赛排序', tag: 'O(n log n)' },
                { id: 'introsort',  name: '内省排序',   tag: 'O(n log n)' },
                { id: 'timsort',    name: '蒂姆排序',   tag: 'O(n log n)' }
            ]
        }
    ];

    renderAlgoCategoryList() {
        const list = document.getElementById('algoCategoryList');
        if (!list) return;
        list.innerHTML = '';
        const cats = SortingVisualizer.ALGO_CATEGORIES;
        // 默认全部折叠
        cats.forEach(cat => {
            const wrap = document.createElement('div');
            wrap.className = 'algo-category';
            const headerId = `algoCat_${cat.id}`;
            wrap.innerHTML = `
                <button class="algo-cat-header" type="button" aria-expanded="false" aria-controls="${headerId}">
                    <span class="algo-cat-name">${cat.name}</span>
                    <span class="algo-cat-count">${cat.items.length}</span>
                    <span class="algo-cat-chevron">▸</span>
                </button>
                <div class="algo-cat-body" id="${headerId}" style="display:none;">
                    ${cat.items.map(a => `
                        <button class="algo-btn${a.id === this.currentAlgorithm ? ' active' : ''}" data-algorithm="${a.id}">
                            <span class="algo-name">${a.name}</span>
                            <span class="algo-tag">${a.tag}</span>
                        </button>
                    `).join('')}
                </div>
            `;
            list.appendChild(wrap);
        });
        // 折叠/展开
        list.querySelectorAll('.algo-cat-header').forEach(btn => {
            btn.addEventListener('click', () => {
                const body = btn.nextElementSibling;
                if (!body) return;
                const isOpen = btn.getAttribute('aria-expanded') === 'true';
                btn.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
                body.style.display = isOpen ? 'none' : 'grid';
                const chevron = btn.querySelector('.algo-cat-chevron');
                if (chevron) chevron.textContent = isOpen ? '▸' : '▾';
            });
        });
    }

    // 切换"开始/暂停/继续"按钮的文字、图标和颜色
    updateStartButton(state) {
        if (!this.startSortBtn) return;
        const cls = this.startSortBtn.classList;

        cls.remove('action-success', 'action-warning');

        switch (state) {
            case 'start':
                this.startSortIcon.textContent = '▶️';
                this.startSortText.textContent = '开始排序';
                cls.add('action-success');
                break;
            case 'pause':
                // 自动播放中：可点击切换为"暂停"
                this.startSortIcon.textContent = '⏸️';
                this.startSortText.textContent = '暂停';
                cls.add('action-warning');
                break;
            case 'resume':
                // 已暂停（含单步模式）：可点击恢复自动播放
                this.startSortIcon.textContent = '▶️';
                this.startSortText.textContent = '继续';
                cls.add('action-success');
                break;
            case 'done':
                this.startSortIcon.textContent = '🔁';
                this.startSortText.textContent = '再来一次';
                cls.add('action-success');
                break;
        }
    }

    // 切换"单步执行"按钮的两种状态
    updateStepButton(state) {
        if (!this.stepSortBtn) return;
        const cls = this.stepSortBtn.classList;

        cls.remove('action-warning', 'action-info');

        switch (state) {
            case 'enter':
                // 默认态：可点击进入单步模式
                this.stepSortIcon.textContent = '⏭️';
                this.stepSortText.textContent = '单步执行';
                cls.add('action-warning');
                break;
            case 'next':
                // 单步模式中：每次点击推进一帧
                this.stepSortIcon.textContent = '⏩';
                this.stepSortText.textContent = '下一步';
                cls.add('action-info');
                break;
        }
    }

    // 🎲 随机数组大小（独立开关）
    applyRandomArraySizeIfEnabled() {
        if (!this.randomArraySizeEl || !this.randomArraySizeEl.checked) return;
        const minS = parseInt(this.arraySizeSlider.min) || 5;
        const maxS = parseInt(this.arraySizeSlider.max) || 200;
        const newSize = Math.floor(Math.random() * (maxS - minS + 1)) + minS;
        const prevSize = this.arraySize;
        this.arraySize = newSize;
        if (this.arraySizeSlider) this.arraySizeSlider.value = String(newSize);
        if (this.sizeValue) this.sizeValue.value = String(newSize);
        const sizeDisplay = document.getElementById('arraySizeDisplay');
        if (sizeDisplay) sizeDisplay.textContent = String(newSize);
        // 关键：抽到新 size 后立即按新长度重新生成 this.array。
        // 千万不能调 generateRandomArray()，因为它内部会 resetStats()，
        // 而此时 isSorting 已经被设为 true，resetStats 会把 isSorting 置回 false，
        // 导致后续 sleep() 立即 resolve，排序瞬间完成（柱子无法显示）。
        if (newSize !== prevSize) {
            this.array = [];
            for (let i = 0; i < newSize; i++) {
                this.array.push(Math.floor(Math.random() * 95) + 5);
            }
            // 同步快照，否则重置会用旧长度的快照
            this.initialArray = [...this.array];
            if (typeof this.renderBars === 'function') this.renderBars();
        }
    }

    // 🎲 随机排序速度（独立开关）
    applyRandomSortSpeedIfEnabled() {
        if (!this.randomSortSpeedEl || !this.randomSortSpeedEl.checked) return;
        const minV = parseInt(this.sortSpeedSlider.min) || 10;
        const maxV = parseInt(this.sortSpeedSlider.max) || 500;
        const newSpeed = Math.floor(Math.random() * (maxV - minV + 1)) + minV;
        this.speed = newSpeed;
        if (this.sortSpeedSlider) this.sortSpeedSlider.value = String(newSpeed);
        if (this.speedValue) this.speedValue.value = String(newSpeed);
    }

    // 同步控件的可用状态：排序中禁用数组大小和生成新数组
    updateControlsState() {
        if (!this.arraySizeSlider || !this.generateArrayBtn) return;
        const locked = this.isSorting;

        this.arraySizeSlider.disabled = locked;
        this.generateArrayBtn.disabled = locked;
        if (this.sizeValue) this.sizeValue.disabled = locked;

        this.arraySizeSlider.classList.toggle('is-locked', locked);
        this.generateArrayBtn.classList.toggle('is-locked', locked);
    }
    
    async startSorting() {
        // 清旧重置请求（每轮排序重新开始）
        this.resetRequested = false;
        // "再来一次"：如果上轮已经排序完成，先把数组恢复到本轮初始快照再跑
        if (this.sortingComplete && this.initialArray && this.initialArray.length > 0) {
            this.array = [...this.initialArray];
            this.renderBars();
        }
        // 关键：在协程启动 + 随机大小应用之后、recordSessionStart 之前，
        // 把当前 this.array 冻结为快照——重置按钮靠这个快照恢复初始状态。
        this.applyRandomArraySizeIfEnabled();  // 可能改 this.array 长度
        this.initialArray = [...this.array];
        this.isSorting = true;
        this.isPaused = false;
        this.isStepMode = false;     // 启动新排序时强制退出单步模式
        this.stepRequested = false;
        this.elapsedMs = 0;
        this.updateElapsedDisplay();
        // 🎲 随机速度
        this.applyRandomSortSpeedIfEnabled();
        this.startElapsedTimer();
        this.recordSessionStart();
        this.updateStartButton('pause');
        this.updateStepButton('enter');  // 启动后单步按钮显示"单步执行"——点击进入单步模式
        this.updateControlsState();     // 锁住数组大小和生成新数组
        try {
            switch (this.currentAlgorithm) {
            case 'bubble':
                await this.bubbleSort();
                break;
            case 'selection':
                await this.selectionSort();
                break;
            case 'insertion':
                await this.insertionSort();
                break;
            case 'quick':
                await this.quickSort();
                break;
            case 'merge':
                await this.mergeSort();
                break;
            case 'shell':
                await this.shellSort();
                break;
            case 'heap':
                await this.heapSort();
                break;
            case 'counting':
                await this.countingSort();
                break;
            case 'bucket':
                await this.bucketSort();
                break;
            case 'radix':
                await this.radixSort();
                break;
            case 'comb':
                await this.combSort();
                break;
            case 'oddeven':
                await this.oddEvenSort();
                break;
            case 'cocktail':
                await this.cocktailSort();
                break;
            case 'gnome':
                await this.gnomeSort();
                break;
            case 'patience':
                await this.patienceSort();
                break;
            case 'library':
                await this.librarySort();
                break;
            case 'block':
                await this.blockSort();
                break;
            case 'smooth':
                await this.smoothSort();
                break;
            case 'tournament':
                await this.tournamentSort();
                break;
            case 'introsort':
                await this.introSort();
                break;
            case 'timsort':
                await this.timSort();
                break;
            }
        } catch (e) {
            // 静默处理协程的"主动退出"信号（重置导致 sleep reject）
            // ——不是真正的错误，不污染控制台
            if (e && e.message !== 'sorting-stopped') {
                console.error('排序过程异常:', e);
            }
            this.stopElapsedTimer();
            // 异常路径：当前 run 数据不完整，丢弃
            this.currentSession = null;
        } finally {
            // 关键：只有 currentSession 还在（即未在 resetStats 中被丢弃）且
            // 不是用户主动"重置"触发的退出 → 才算完整完成
            const runCompleted = this.currentSession !== null && !this.resetRequested;
            this.isSorting = false;
            this.isPaused = false;
            this.isStepMode = false;
            this.stepRequested = false;
            this.sortingComplete = runCompleted;
            this.stopElapsedTimer();
            if (runCompleted) {
                this.updateBarColors([], [], Array.from({length: this.array.length}, (_, i) => i));
                this.recordSessionEnd();
            } else {
                // 中断 / 异常：彻底丢弃 currentSession；柱子颜色由 generateRandomArray
                // 的 renderBars() / 上一次 updateBarColors 决定，不在这里强行覆盖
                this.currentSession = null;
            }
            this.renderDataPage();
            // 重置 / 中断：保持 'start'（测试前初始状态）；只有完整完成才 'done'
            this.updateStartButton(runCompleted ? 'done' : 'start');
            this.updateStepButton('enter');
            this.updateControlsState();   // 解锁数组大小和生成新数组
        }
    }
    
    async bubbleSort() {
        let n = this.array.length;

        for (let i = 0; i < n - 1; i++) {
            for (let j = 0; j < n - i - 1; j++) {
                if (!this.isSorting) return;

                this.comparisons++;
                this.updateBarColors([j], [j + 1], Array.from({length: i}, (_, k) => n - 1 - k));
                await this.sleep();
                // 关键：await 后必须再检查一次，否则重置期间协程会污染刚恢复的 this.array
                if (!this.isSorting) return;

                if (this.array[j] > this.array[j + 1]) {
                    this.swaps++;
                    [this.array[j], this.array[j + 1]] = [this.array[j + 1], this.array[j]];
                    this.renderBars();
                    this.updateBarColors([j, j + 1], [], Array.from({length: i}, (_, k) => n - 1 - k));
                    await this.sleep();
                    if (!this.isSorting) return;
                }
                this.updateStats();
            }
        }
    }
    
    async selectionSort() {
        let n = this.array.length;
        
        for (let i = 0; i < n - 1; i++) {
            let minIdx = i;
            
            for (let j = i + 1; j < n; j++) {
                if (!this.isSorting) return;
                
                this.comparisons++;
                this.updateBarColors([i], [j, minIdx], Array.from({length: i}, (_, k) => k));
                await this.sleep();
                if (!this.isSorting) return;
                
                if (this.array[j] < this.array[minIdx]) {
                    minIdx = j;
                }
            }
            
            if (minIdx !== i) {
                this.swaps++;
                [this.array[i], this.array[minIdx]] = [this.array[minIdx], this.array[i]];
                this.renderBars();
                this.updateBarColors([i, minIdx], [], Array.from({length: i + 1}, (_, k) => k));
                await this.sleep();
                if (!this.isSorting) return;
            }
            
            this.updateStats();
        }
    }
    
    async insertionSort() {
        let n = this.array.length;
        
        for (let i = 1; i < n; i++) {
            let key = this.array[i];
            let j = i - 1;
            
            while (j >= 0 && this.array[j] > key) {
                if (!this.isSorting) return;
                
                this.comparisons++;
                this.updateBarColors([i], [j], Array.from({length: i}, (_, k) => k));
                await this.sleep();
                if (!this.isSorting) return;
                
                this.swaps++;
                this.array[j + 1] = this.array[j];
                j = j - 1;
                
                this.renderBars();
                this.updateBarColors([j + 1], [], Array.from({length: i}, (_, k) => k));
                await this.sleep();
                if (!this.isSorting) return;
            }
            
            this.array[j + 1] = key;
            this.swaps++;
            this.renderBars();
            this.updateBarColors([j + 1], [], Array.from({length: i + 1}, (_, k) => k));
            await this.sleep();
            if (!this.isSorting) return;

            this.updateStats();
        }
    }
    
    async quickSort() {
        await this.quickSortHelper(0, this.array.length - 1);
    }
    
    async quickSortHelper(low, high) {
        if (low < high) {
            let pi = await this.partition(low, high);
            await this.quickSortHelper(low, pi - 1);
            await this.quickSortHelper(pi + 1, high);
        } else if (low === high) {
            this.updateBarColors([], [], [low]);
            await this.sleep();
        }
    }
    
    async partition(low, high) {
        let pivot = this.array[high];
        let i = low - 1;
        
        for (let j = low; j < high; j++) {
            if (!this.isSorting) return;
            
            this.comparisons++;
            this.updateBarColors([high], [j, i + 1], []);
            await this.sleep();
            
            if (this.array[j] < pivot) {
                i++;
                this.swaps++;
                [this.array[i], this.array[j]] = [this.array[j], this.array[i]];
                this.renderBars();
                this.updateBarColors([i, j], [high], []);
                await this.sleep();
            }
            this.updateStats();
        }
        
        this.swaps++;
        [this.array[i + 1], this.array[high]] = [this.array[high], this.array[i + 1]];
        this.renderBars();
        this.updateBarColors([i + 1, high], [], []);
        await this.sleep();
        
        return i + 1;
    }
    
    async mergeSort() {
        await this.mergeSortHelper(0, this.array.length - 1);
    }
    
    async mergeSortHelper(l, r) {
        if (l < r) {
            let m = Math.floor((l + r) / 2);
            
            this.updateBarColors([l, r], [m], Array.from({length: l}, (_, i) => i));
            await this.sleep();
            
            await this.mergeSortHelper(l, m);
            await this.mergeSortHelper(m + 1, r);
            await this.merge(l, m, r);
        }
    }
    
    async merge(l, m, r) {
        let n1 = m - l + 1;
        let n2 = r - m;
        let L = new Array(n1);
        let R = new Array(n2);
        
        for (let i = 0; i < n1; i++) L[i] = this.array[l + i];
        for (let j = 0; j < n2; j++) R[j] = this.array[m + 1 + j];
        
        let i = 0, j = 0, k = l;
        
        while (i < n1 && j < n2) {
            if (!this.isSorting) return;
            
            this.comparisons++;
            this.updateBarColors([l + i, m + 1 + j], [k], Array.from({length: l}, (_, idx) => idx));
            await this.sleep();
            
            if (L[i] <= R[j]) {
                this.array[k] = L[i];
                this.swaps++;
                i++;
            } else {
                this.array[k] = R[j];
                this.swaps++;
                j++;
            }
            
            this.renderBars();
            this.updateBarColors([k], [], Array.from({length: l}, (_, idx) => idx));
            await this.sleep();
            
            k++;
            this.updateStats();
        }
        
        while (i < n1) {
            this.array[k] = L[i];
            this.swaps++;
            i++;
            k++;
            
            this.renderBars();
            this.updateBarColors([k - 1], [], Array.from({length: l}, (_, idx) => idx));
            await this.sleep();
        }
        
        while (j < n2) {
            this.array[k] = R[j];
            this.swaps++;
            j++;
            k++;
            
            this.renderBars();
            this.updateBarColors([k - 1], [], Array.from({length: l}, (_, idx) => idx));
            await this.sleep();
        }
    }
    
    async shellSort() {
        let n = this.array.length;
        for (let gap = Math.floor(n / 2); gap > 0; gap = Math.floor(gap / 2)) {
            for (let i = gap; i < n; i++) {
                if (!this.isSorting) return;
                let temp = this.array[i];
                let j = i;
                this.comparisons++;   // 初始比较：与远端元素比较前的占位
                this.updateBarColors([i], [i - gap], []);
                await this.sleep();
                while (j >= gap) {
                    this.comparisons++;   // 实际比较：array[j-gap] vs temp
                    if (this.array[j - gap] <= temp) break;
                    if (!this.isSorting) return;
                    this.swaps++;
                    this.array[j] = this.array[j - gap];
                    j -= gap;
                    this.renderBars();
                    this.updateBarColors([j, j + gap], [], []);
                    await this.sleep();
                }
                this.array[j] = temp;
                this.renderBars();
                await this.sleep();
                this.updateStats();
            }
        }
    }
    
    async heapSort() {
        let n = this.array.length;
        for (let i = Math.floor(n / 2) - 1; i >= 0; i--) {
            await this.heapify(n, i);
        }
        for (let i = n - 1; i > 0; i--) {
            if (!this.isSorting) return;
            this.swaps++;
            [this.array[0], this.array[i]] = [this.array[i], this.array[0]];
            this.renderBars();
            this.updateBarColors([0, i], [], Array.from({length: n - i - 1}, (_, k) => n - 1 - k));
            await this.sleep();
            await this.heapify(i, 0);
        }
    }
    
    async heapify(n, i) {
        let largest = i;
        let l = 2 * i + 1;
        let r = 2 * i + 2;
        if (l < n) {
            this.comparisons++;
            if (this.array[l] > this.array[largest]) largest = l;
        }
        if (r < n) {
            this.comparisons++;
            if (this.array[r] > this.array[largest]) largest = r;
        }
        if (largest !== i) {
            if (!this.isSorting) return;
            this.updateBarColors([i], [largest], []);
            await this.sleep();
            this.swaps++;
            [this.array[i], this.array[largest]] = [this.array[largest], this.array[i]];
            this.renderBars();
            await this.sleep();
            await this.heapify(n, largest);
        }
    }
    
    async countingSort() {
        let n = this.array.length;
        if (n === 0) return;
        let max = Math.max(...this.array);
        let min = Math.min(...this.array);
        let range = max - min + 1;
        let count = new Array(range).fill(0);
        let output = new Array(n);
        // 阶段 1：扫描统计频次（非比较排序，comparisons 不增加；可视作"读取"开销）
        for (let i = 0; i < n; i++) {
            if (!this.isSorting) return;
            count[this.array[i] - min]++;
            this.updateBarColors([i], [], []);
            await this.sleep();
        }
        // 阶段 2：累计计数（无比较/无交换）
        for (let i = 1; i < range; i++) count[i] += count[i - 1];
        // 阶段 3：按 count 放置到 output（写 output，不算 swap，因为数组未变化）
        for (let i = n - 1; i >= 0; i--) {
            if (!this.isSorting) return;
            output[count[this.array[i] - min] - 1] = this.array[i];
            count[this.array[i] - min]--;
        }
        // 阶段 4：回写原数组 —— 每次写入计为 1 次 swap
        for (let i = 0; i < n; i++) {
            if (!this.isSorting) return;
            this.array[i] = output[i];
            this.swaps++;
            this.renderBars();
            this.updateBarColors([i], [], []);
            await this.sleep();
        }
    }
    
    async bucketSort() {
        let n = this.array.length;
        if (n === 0) return;
        let max = Math.max(...this.array);
        let min = Math.min(...this.array);
        let bucketCount = Math.max(1, Math.floor(Math.sqrt(n)));
        let buckets = Array.from({ length: bucketCount }, () => []);
        for (let i = 0; i < n; i++) {
            if (!this.isSorting) return;
            let idx = Math.floor((this.array[i] - min) / (max - min + 1) * bucketCount);
            if (idx >= bucketCount) idx = bucketCount - 1;
            buckets[idx].push(this.array[i]);
            this.updateBarColors([i], [], []);
            await this.sleep();
        }
        let k = 0;
        for (let b = 0; b < bucketCount; b++) {
            // 桶内使用 Array.sort()，内部比较为 JS 引擎实现，本项目不计入 comparisons
            buckets[b].sort((a, b) => a - b);
            for (let v of buckets[b]) {
                if (!this.isSorting) return;
                this.array[k++] = v;
                this.swaps++;
                this.renderBars();
                this.updateBarColors([k - 1], [], []);
                await this.sleep();
            }
        }
    }
    
    async radixSort() {
        let n = this.array.length;
        if (n === 0) return;
        let max = Math.max(...this.array);
        for (let exp = 1; Math.floor(max / exp) > 0; exp *= 10) {
            if (!this.isSorting) return;
            await this.countingSortByDigit(exp);
        }
    }
    
    async countingSortByDigit(exp) {
        let n = this.array.length;
        let output = new Array(n);
        let count = new Array(10).fill(0);
        for (let i = 0; i < n; i++) {
            count[Math.floor(this.array[i] / exp) % 10]++;
            this.updateBarColors([i], [], []);
            await this.sleep();
        }
        for (let i = 1; i < 10; i++) count[i] += count[i - 1];
        for (let i = n - 1; i >= 0; i--) {
            output[count[Math.floor(this.array[i] / exp) % 10] - 1] = this.array[i];
            count[Math.floor(this.array[i] / exp) % 10]--;
        }
        for (let i = 0; i < n; i++) {
            if (!this.isSorting) return;
            this.array[i] = output[i];
            this.swaps++;
            this.renderBars();
            this.updateBarColors([i], [], []);
            await this.sleep();
        }
    }
    
    async combSort() {
        let n = this.array.length;
        let gap = n;
        let shrink = 1.3;
        let sorted = false;
        while (!sorted) {
            if (!this.isSorting) return;
            gap = Math.floor(gap / shrink);
            if (gap <= 1) { gap = 1; sorted = true; }
            for (let i = 0; i + gap < n; i++) {
                if (!this.isSorting) return;
                this.comparisons++;
                this.updateBarColors([i], [i + gap], []);
                await this.sleep();
                if (this.array[i] > this.array[i + gap]) {
                    this.swaps++;
                    [this.array[i], this.array[i + gap]] = [this.array[i + gap], this.array[i]];
                    sorted = false;
                    this.renderBars();
                    this.updateBarColors([i, i + gap], [], []);
                    await this.sleep();
                }
            }
        }
    }
    
    async oddEvenSort() {
        let n = this.array.length;
        let sorted = false;
        while (!sorted) {
            if (!this.isSorting) return;
            sorted = true;
            for (let i = 1; i < n - 1; i += 2) {
                if (!this.isSorting) return;
                this.comparisons++;
                this.updateBarColors([i], [i + 1], []);
                await this.sleep();
                if (this.array[i] > this.array[i + 1]) {
                    this.swaps++;
                    [this.array[i], this.array[i + 1]] = [this.array[i + 1], this.array[i]];
                    sorted = false;
                    this.renderBars();
                    this.updateBarColors([i, i + 1], [], []);
                    await this.sleep();
                }
            }
            for (let i = 0; i < n - 1; i += 2) {
                if (!this.isSorting) return;
                this.comparisons++;
                this.updateBarColors([i], [i + 1], []);
                await this.sleep();
                if (this.array[i] > this.array[i + 1]) {
                    this.swaps++;
                    [this.array[i], this.array[i + 1]] = [this.array[i + 1], this.array[i]];
                    sorted = false;
                    this.renderBars();
                    this.updateBarColors([i, i + 1], [], []);
                    await this.sleep();
                }
            }
        }
    }
    
    async cocktailSort() {
        let n = this.array.length;
        let start = 0, end = n - 1;
        let swapped = true;
        while (swapped) {
            if (!this.isSorting) return;
            swapped = false;
            for (let i = start; i < end; i++) {
                if (!this.isSorting) return;
                this.comparisons++;
                this.updateBarColors([i], [i + 1], []);
                await this.sleep();
                if (this.array[i] > this.array[i + 1]) {
                    this.swaps++;
                    [this.array[i], this.array[i + 1]] = [this.array[i + 1], this.array[i]];
                    swapped = true;
                    this.renderBars();
                    this.updateBarColors([i, i + 1], [], []);
                    await this.sleep();
                }
            }
            end--;
            if (!swapped) break;
            swapped = false;
            for (let i = end - 1; i >= start; i--) {
                if (!this.isSorting) return;
                this.comparisons++;
                this.updateBarColors([i], [i + 1], []);
                await this.sleep();
                if (this.array[i] > this.array[i + 1]) {
                    this.swaps++;
                    [this.array[i], this.array[i + 1]] = [this.array[i + 1], this.array[i]];
                    swapped = true;
                    this.renderBars();
                    this.updateBarColors([i, i + 1], [], []);
                    await this.sleep();
                }
            }
            start++;
        }
    }
    
    async gnomeSort() {
        let n = this.array.length;
        let i = 0;
        while (i < n) {
            if (!this.isSorting) return;
            if (i === 0 || this.array[i - 1] <= this.array[i]) {
                this.comparisons++;
                this.updateBarColors([i], [i - 1 >= 0 ? i - 1 : 0], []);
                await this.sleep();
                i++;
            } else {
                this.swaps++;
                [this.array[i], this.array[i - 1]] = [this.array[i - 1], this.array[i]];
                this.renderBars();
                this.updateBarColors([i, i - 1], [], []);
                await this.sleep();
                i--;
            }
        }
    }
    
    async patienceSort() {
        let n = this.array.length;
        let piles = [];
        for (let i = 0; i < n; i++) {
            if (!this.isSorting) return;
            let placed = false;
            for (let p = 0; p < piles.length; p++) {
                this.comparisons++;
                if (piles[p][piles[p].length - 1] >= this.array[i]) {
                    piles[p].push(this.array[i]);
                    placed = true;
                    break;
                }
            }
            if (!placed) piles.push([this.array[i]]);
            this.updateBarColors([i], [], []);
            await this.sleep();
        }
        let k = 0;
        while (piles.length > 0) {
            let minIdx = 0;
            for (let p = 1; p < piles.length; p++) {
                this.comparisons++;
                if (piles[p][piles[p].length - 1] < piles[minIdx][piles[minIdx].length - 1]) minIdx = p;
            }
            this.array[k++] = piles[minIdx].pop();
            this.swaps++;
            if (piles[minIdx].length === 0) piles.splice(minIdx, 1);
            this.renderBars();
            this.updateBarColors([k - 1], [], []);
            await this.sleep();
        }
    }
    
    async librarySort() {
        let n = this.array.length;
        if (n === 0) return;
        // 简化版："gapped insertion sort"
        // 维护两个结构：
        //   slots: 稀疏数组（gap 步长放元素）
        //   values: 紧凑有序列表（供二分查找用）
        // 每轮：二分 → 在 slots 中按 gap 步长后移 → 插入 → 更新 values
        let gap = Math.max(1, Math.floor(Math.sqrt(n)));
        let slots = new Array(n * gap + gap).fill(null);
        let values = [];
        values.push(this.array[0]);
        slots[0] = this.array[0];
        this.swaps++;
        for (let i = 1; i < n; i++) {
            if (!this.isSorting) return;
            // 二分查找 values（紧凑列表，无 null）
            let target = this.array[i];
            let lo = 0, hi = values.length;
            while (lo < hi) {
                let mid = (lo + hi) >> 1;
                this.comparisons++;
                if (values[mid] > target) hi = mid;
                else lo = mid + 1;
            }
            let pos = lo;
            // 在 slots 中，从右往左按 gap 步长后移
            for (let j = (values.length - 1) * gap; j >= pos * gap; j -= gap) {
                slots[j + gap] = slots[j];
                this.swaps++;
            }
            slots[pos * gap] = target;
            this.swaps++;
            values.splice(pos, 0, target);
            this.updateBarColors([i], [], []);
            await this.sleep();
        }
        // 压缩回 this.array
        let k = 0;
        for (let i = 0; i < slots.length && k < n; i += gap) {
            if (slots[i] !== null) {
                this.array[k++] = slots[i];
                this.swaps++;
                this.renderBars();
                this.updateBarColors([k - 1], [], []);
                await this.sleep();
            }
        }
    }

    // 原 binarySearchInsert 保留以兼容可能的旧调用点（如有）
    binarySearchInsert(arr, len, target) {
        let lo = 0, hi = len;
        while (lo < hi) {
            let mid = (lo + hi) >> 1;
            this.comparisons++;
            if (arr[mid] === undefined || arr[mid] === null || arr[mid] > target) hi = mid;
            else lo = mid + 1;
        }
        return lo;
    }
    
    async blockSort() {
        let n = this.array.length;
        if (n === 0) return;
        let blockSize = Math.max(1, Math.floor(Math.sqrt(n)));
        let blocks = [];
        for (let i = 0; i < n; i += blockSize) {
            // 块内 Array.sort() 的比较由 JS 引擎实现，本项目不计入 comparisons
            let block = this.array.slice(i, i + blockSize).sort((a, b) => a - b);
            blocks.push({ values: block, startIdx: i });
            this.swaps += block.length;  // 排序后写回元素的次数
        }
        let result = [];
        // 多路归并阶段：每次取最小元都计一次比较
        while (blocks.some(b => b.values.length > 0)) {
            if (!this.isSorting) return;
            let minVal = Infinity, minBlock = -1;
            for (let b = 0; b < blocks.length; b++) {
                if (blocks[b].values.length > 0) {
                    this.comparisons++;
                    if (blocks[b].values[0] < minVal) {
                        minVal = blocks[b].values[0];
                        minBlock = b;
                    }
                }
            }
            if (minBlock >= 0) {
                result.push(blocks[minBlock].values.shift());
            }
        }
        for (let i = 0; i < n; i++) {
            if (!this.isSorting) return;
            this.array[i] = result[i];
            this.swaps++;
            this.renderBars();
            this.updateBarColors([i], [], []);
            await this.sleep();
        }
    }
    
    async smoothSort() {
        // 平滑排序 (Smoothsort) — Dijkstra, 1981
        // 基于 Leonardo 堆的原地排序，时间复杂度 O(n log n)，最好情况 O(n)。
        // 实现策略：复用经典的 sift-down 思路，保证排序正确性。
        // 本实现使用一个简化的稳定变体：先 sift（向下调整为堆），再循环提取根。

        const n = this.array.length;
        if (n < 2) return;

        // 阶段 1：建堆（sift-down from middle to start）
        for (let start = Math.floor((n - 2) / 2); start >= 0; start--) {
            if (!this.isSorting) return;
            let root = start;
            while (true) {
                const left = 2 * root + 1;
                const right = 2 * root + 2;
                if (left >= n) break;
                let big = left;
                if (right < n) {
                    this.comparisons++;
                    if (this.array[right] > this.array[left]) big = right;
                }
                this.comparisons++;
                if (this.array[big] > this.array[root]) {
                    this.swaps++;
                    [this.array[big], this.array[root]] = [this.array[root], this.array[big]];
                    this.renderBars();
                    this.updateBarColors([big, root], [], []);
                    await this.sleep();
                    root = big;
                } else {
                    break;
                }
            }
        }

        // 阶段 2：循环提取根（最大值）放到末尾
        for (let end = n - 1; end > 0; end--) {
            if (!this.isSorting) return;
            this.swaps++;
            [this.array[0], this.array[end]] = [this.array[end], this.array[0]];
            this.renderBars();
            this.updateBarColors([0, end], [], []);
            await this.sleep();
            // sift down new root in [0, end-1]
            let root = 0;
            while (true) {
                const left = 2 * root + 1;
                const right = 2 * root + 2;
                if (left >= end) break;
                let big = left;
                if (right < end) {
                    this.comparisons++;
                    if (this.array[right] > this.array[left]) big = right;
                }
                this.comparisons++;
                if (this.array[big] > this.array[root]) {
                    this.swaps++;
                    [this.array[big], this.array[root]] = [this.array[root], this.array[big]];
                    this.renderBars();
                    this.updateBarColors([big, root], [], []);
                    await this.sleep();
                    root = big;
                } else {
                    break;
                }
            }
        }
    }
    
    async tournamentSort() {
        let n = this.array.length;
        if (n === 0) return;
        let tree = new Array(2 * n - 1).fill(null);
        for (let i = 0; i < n; i++) tree[n - 1 + i] = { val: this.array[i], idx: i };
        for (let i = n - 2; i >= 0; i--) {
            let l = tree[2 * i + 1], r = tree[2 * i + 2];
            if (l && r) {
                this.comparisons++;
                tree[i] = l.val <= r.val ? l : r;
            } else {
                tree[i] = l || r;
            }
        }
        for (let k = 0; k < n; k++) {
            if (!this.isSorting) return;
            let winner = tree[0];
            if (!winner) break;
            this.array[k] = winner.val;
            this.swaps++;
            this.renderBars();
            this.updateBarColors([k], [winner.idx], []);
            await this.sleep();
            let pos = n - 1 + winner.idx;
            tree[pos] = null;
            while (pos > 0) {
                pos = Math.floor((pos - 1) / 2);
                let l = tree[2 * pos + 1], r = tree[2 * pos + 2];
                if (l && r) {
                    this.comparisons++;
                    tree[pos] = l.val <= r.val ? l : r;
                } else {
                    tree[pos] = l || r;
                }
            }
        }
    }
    
    async introSort() {
        let n = this.array.length;
        await this.introSortHelper(0, n - 1, 2 * Math.floor(Math.log2(n)));
    }
    
    async introSortHelper(low, high, depthLimit) {
        if (low < high) {
            if (!this.isSorting) return;
            let size = high - low + 1;
            if (size < 16) {
                await this.insertionSortRange(low, high);
            } else if (depthLimit === 0) {
                await this.heapSortRange(low, high);
            } else {
                let pi = await this.introPartition(low, high);
                await this.introSortHelper(low, pi - 1, depthLimit - 1);
                await this.introSortHelper(pi + 1, high, depthLimit - 1);
            }
        }
    }
    
    async introPartition(low, high) {
        let pivot = this.array[high];
        let i = low - 1;
        for (let j = low; j < high; j++) {
            if (!this.isSorting) return i + 1;
            this.comparisons++;
            this.updateBarColors([high], [j], []);
            await this.sleep();
            if (this.array[j] < pivot) {
                i++;
                if (i !== j) {
                    this.swaps++;
                    [this.array[i], this.array[j]] = [this.array[j], this.array[i]];
                    this.renderBars();
                    this.updateBarColors([i, j], [], []);
                    await this.sleep();
                }
            }
        }
        this.swaps++;
        [this.array[i + 1], this.array[high]] = [this.array[high], this.array[i + 1]];
        this.renderBars();
        await this.sleep();
        return i + 1;
    }
    
    async insertionSortRange(low, high) {
        for (let i = low + 1; i <= high; i++) {
            if (!this.isSorting) return;
            let key = this.array[i];
            let j = i - 1;
            while (j >= low && this.array[j] > key) {
                this.comparisons++;
                this.array[j + 1] = this.array[j];
                this.swaps++;
                j--;
            }
            this.array[j + 1] = key;
            this.swaps++;
            this.renderBars();
            this.updateBarColors([j + 1], [], []);
            await this.sleep();
        }
    }
    
    async heapSortRange(low, high) {
        let n = high - low + 1;
        for (let i = Math.floor(n / 2) - 1; i >= 0; i--) {
            await this.heapifyRange(low, n, i);
        }
        for (let i = n - 1; i > 0; i--) {
            if (!this.isSorting) return;
            this.swaps++;
            [this.array[low], this.array[low + i]] = [this.array[low + i], this.array[low]];
            this.renderBars();
            await this.sleep();
            await this.heapifyRange(low, i, 0);
        }
    }
    
    async heapifyRange(base, n, i) {
        let largest = i, l = 2 * i + 1, r = 2 * i + 2;
        if (l < n) { this.comparisons++; if (this.array[base + l] > this.array[base + largest]) largest = l; }
        if (r < n) { this.comparisons++; if (this.array[base + r] > this.array[base + largest]) largest = r; }
        if (largest !== i) {
            this.swaps++;
            [this.array[base + i], this.array[base + largest]] = [this.array[base + largest], this.array[base + i]];
            this.renderBars();
            await this.sleep();
            await this.heapifyRange(base, n, largest);
        }
    }
    
    async timSort() {
        let n = this.array.length;
        let RUN = 32;
        for (let i = 0; i < n; i += RUN) {
            await this.insertionSortRange(i, Math.min(i + RUN - 1, n - 1));
        }
        for (let size = RUN; size < n; size = 2 * size) {
            for (let left = 0; left < n; left += 2 * size) {
                let mid = left + size - 1;
                let right = Math.min(left + 2 * size - 1, n - 1);
                if (mid < right) {
                    await this.mergeRange(left, mid, right);
                }
            }
        }
    }
    
    async mergeRange(l, m, r) {
        let n1 = m - l + 1, n2 = r - m;
        let L = new Array(n1), R = new Array(n2);
        for (let i = 0; i < n1; i++) L[i] = this.array[l + i];
        for (let j = 0; j < n2; j++) R[j] = this.array[m + 1 + j];
        let i = 0, j = 0, k = l;
        while (i < n1 && j < n2) {
            if (!this.isSorting) return;
            this.comparisons++;
            this.updateBarColors([l + i, m + 1 + j], [k], []);
            await this.sleep();
            if (L[i] <= R[j]) { this.array[k] = L[i++]; this.swaps++; }
            else { this.array[k] = R[j++]; this.swaps++; }
            this.renderBars();
            this.updateBarColors([k], [], []);
            await this.sleep();
            k++;
        }
        while (i < n1) { this.array[k] = L[i++]; this.swaps++; this.renderBars(); await this.sleep(); k++; }
        while (j < n2) { this.array[k] = R[j++]; this.swaps++; this.renderBars(); await this.sleep(); k++; }
    }
    
    selectionSortSteps(array) {
        let steps = [];
        let n = array.length;
        let comparisons = 0;
        let swaps = 0;
        
        for (let i = 0; i < n - 1; i++) {
            let minIdx = i;
            let sortedIndices = Array.from({length: i}, (_, k) => k);
            
            for (let j = i + 1; j < n; j++) {
                comparisons++;
                steps.push({
                    array: [...array],
                    comparisons: comparisons,
                    swaps: swaps,
                    activeIndices: [i],
                    comparingIndices: [j, minIdx],
                    sortedIndices: sortedIndices
                });
                
                if (array[j] < array[minIdx]) {
                    minIdx = j;
                }
            }
            
            if (minIdx !== i) {
                swaps++;
                [array[i], array[minIdx]] = [array[minIdx], array[i]];
                steps.push({
                    array: [...array],
                    comparisons: comparisons,
                    swaps: swaps,
                    activeIndices: [i, minIdx],
                    comparingIndices: [],
                    sortedIndices: [...sortedIndices, i]
                });
            } else {
                steps.push({
                    array: [...array],
                    comparisons: comparisons,
                    swaps: swaps,
                    activeIndices: [i],
                    comparingIndices: [],
                    sortedIndices: [...sortedIndices, i]
                });
            }
        }
        
        steps.push({
            array: [...array],
            comparisons: comparisons,
            swaps: swaps,
            activeIndices: [],
            comparingIndices: [],
            sortedIndices: Array.from({length: n}, (_, k) => k)
        });
        
        this.sortSteps = steps;
    }
    
    updateComplexityTable() {
        const table = document.querySelector('.complexity-table');
        if (!table) return;
        
        const complexities = {
            bubble: { best: 'O(n)', average: 'O(n²)', worst: 'O(n²)', space: 'O(1)', stable: '是' },
            selection: { best: 'O(n²)', average: 'O(n²)', worst: 'O(n²)', space: 'O(1)', stable: '否' },
            insertion: { best: 'O(n)', average: 'O(n²)', worst: 'O(n²)', space: 'O(1)', stable: '是' },
            quick: { best: 'O(n log n)', average: 'O(n log n)', worst: 'O(n²)', space: 'O(log n)', stable: '否' },
            merge: { best: 'O(n log n)', average: 'O(n log n)', worst: 'O(n log n)', space: 'O(n)', stable: '是' },
            shell: { best: 'O(n log n)', average: 'O(n log²n)', worst: 'O(n²)', space: 'O(1)', stable: '否' },
            heap: { best: 'O(n log n)', average: 'O(n log n)', worst: 'O(n log n)', space: 'O(1)', stable: '否' },
            counting: { best: 'O(n+k)', average: 'O(n+k)', worst: 'O(n+k)', space: 'O(k)', stable: '是' },
            bucket: { best: 'O(n+k)', average: 'O(n+k)', worst: 'O(n²)', space: 'O(n+k)', stable: '是' },
            radix: { best: 'O(nk)', average: 'O(nk)', worst: 'O(nk)', space: 'O(n+k)', stable: '是' },
            comb: { best: 'O(n log n)', average: 'O(n²/2^p)', worst: 'O(n²)', space: 'O(1)', stable: '否' },
            oddeven: { best: 'O(n)', average: 'O(n²)', worst: 'O(n²)', space: 'O(1)', stable: '是' },
            cocktail: { best: 'O(n)', average: 'O(n²)', worst: 'O(n²)', space: 'O(1)', stable: '是' },
            gnome: { best: 'O(n)', average: 'O(n²)', worst: 'O(n²)', space: 'O(1)', stable: '是' },
            patience: { best: 'O(n)', average: 'O(n log n)', worst: 'O(n log n)', space: 'O(n)', stable: '否' },
            library: { best: 'O(n)', average: 'O(n log n)', worst: 'O(n²)', space: 'O(n)', stable: '是' },
            block: { best: 'O(n log n)', average: 'O(n log n)', worst: 'O(n log n)', space: 'O(1)', stable: '否' },
            smooth: { best: 'O(n)', average: 'O(n log n)', worst: 'O(n log n)', space: 'O(1)', stable: '否' },
            tournament: { best: 'O(n log n)', average: 'O(n log n)', worst: 'O(n log n)', space: 'O(n)', stable: '否' },
            introsort: { best: 'O(n log n)', average: 'O(n log n)', worst: 'O(n log n)', space: 'O(log n)', stable: '否' },
            timsort: { best: 'O(n)', average: 'O(n log n)', worst: 'O(n log n)', space: 'O(n)', stable: '是' }
        };
        
        const algo = this.currentAlgorithm;
        const comp = complexities[algo];
        
        if (!comp) return;
        
        document.querySelector('.complexity-best').textContent = comp.best;
        document.querySelector('.complexity-average').textContent = comp.average;
        document.querySelector('.complexity-worst').textContent = comp.worst;
        
        document.querySelector('.info-card[data-info="space-complexity"] .info-value').textContent = comp.space;
        document.querySelector('.info-card[data-info="stability"] .info-value').textContent = comp.stable;
    }
    
    initializeDesktopFeatures() {
        if (this.exportDataBtn) {
            this.exportDataBtn.addEventListener('click', () => this.exportData());
        }

        if (this.saveDataBtn) {
            this.saveDataBtn.addEventListener('click', () => this.saveData());
        }

        // 数据页：一键保存所有未保存 + dirty hint 链接
        if (this.saveAllBtn) {
            this.saveAllBtn.addEventListener('click', () => this.saveAllUnsaved());
        }
        if (this.saveAllLinkEl) {
            this.saveAllLinkEl.addEventListener('click', (e) => {
                e.preventDefault();
                this.saveAllUnsaved();
            });
        }
        // 图表类型切换（柱状图 / 散点图）
        if (this.chartTypeToggleBtn) {
            this.chartTypeToggleBtn.addEventListener('click', () => this.toggleChartType());
        }

        if (this.appSettingsBtn) {
            this.appSettingsBtn.addEventListener('click', () => this.openSettings());
        }

        if (this.appQuitBtn) {
            this.appQuitBtn.addEventListener('click', () => this.quitApp());
        }

        // 工具栏窗口控制：最小化 / 切换全屏
        if (this.appMinimizeBtn) {
            this.appMinimizeBtn.addEventListener('click', () => this.minimizeWindow());
        }
        if (this.appToggleMaximizeBtn) {
            this.appToggleMaximizeBtn.addEventListener('click', () => this.toggleMaximizeWindow());
        }

        // 模态框关闭：所有 .modal 内的 [data-close-modal] 都支持关闭（包括 fileDataModal）
        document.querySelectorAll('.modal').forEach(modal => {
            modal.querySelectorAll('[data-close-modal]').forEach(el => {
                el.addEventListener('click', () => {
                    modal.setAttribute('aria-hidden', 'true');
                });
            });
        });
        // Esc 键关闭最上层模态框
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const open = [...document.querySelectorAll('.modal[aria-hidden="false"]')];
                if (open.length) open[open.length - 1].setAttribute('aria-hidden', 'true');
            }
        });
        const saveSettingsBtn = document.getElementById('saveSettings');
        if (saveSettingsBtn) saveSettingsBtn.addEventListener('click', () => this.commitSettings());

        const browseSaveBtn = document.getElementById('browseSavePath');
        if (browseSaveBtn) browseSaveBtn.addEventListener('click', () => this.pickDirectory('defaultSavePath'));

        const browseExportBtn = document.getElementById('browseExportPath');
        if (browseExportBtn) browseExportBtn.addEventListener('click', () => this.pickDirectory('defaultExportPath'));

        const resetBtn = document.getElementById('resetPathsDefault');
        if (resetBtn) resetBtn.addEventListener('click', () => this.resetPathsToDefault());

        const clearBtn = document.getElementById('clearSessionData');
        if (clearBtn) clearBtn.addEventListener('click', () => this.clearSessionData());

        // 左侧竖列导航
        this.leftRailTabs.forEach(tab => {
            tab.addEventListener('click', () => this.switchRailTab(tab.dataset.railTab));
        });

        // 分类模式 tabs
        this.classifyTabs.forEach(t => {
            t.addEventListener('click', () => this.switchClassifyMode(t.dataset.classifyMode));
        });
        // 数据源 tabs
        this.sourceTabs.forEach(t => {
            t.addEventListener('click', () => this.switchSourceMode(t.dataset.sourceMode));
        });

        // 手动分组：新建
        if (this.createGroupBtn) {
            this.createGroupBtn.addEventListener('click', () => {
                const n = (this.newGroupNameInput && this.newGroupNameInput.value) || '';
                this.createManualGroup(n);
                if (this.newGroupNameInput) this.newGroupNameInput.value = '';
            });
        }
        if (this.newGroupNameInput) {
            this.newGroupNameInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    this.createManualGroup(this.newGroupNameInput.value);
                    this.newGroupNameInput.value = '';
                }
            });
        }
        // 手动分组列表事件
        if (this.manualGroupListEl) {
            this.manualGroupListEl.addEventListener('click', (e) => {
                const btn = e.target.closest('button[data-act="delete-group"]');
                if (btn) {
                    this.deleteManualGroup(btn.dataset.gid);
                }
            });
            this.manualGroupListEl.addEventListener('change', (e) => {
                const inp = e.target.closest('input[data-act="rename-group"]');
                if (inp) this.renameManualGroup(inp.dataset.gid, inp.value);
            });
        }

        // 测试数据页内：单条数据操作（保存/导出/删除/分配分组/查看）
        if (this.classifyContainer) {
            this.classifyContainer.addEventListener('click', (e) => {
                const btn = e.target.closest('button[data-act]');
                if (!btn) return;
                const act = btn.dataset.act;
                const key = btn.dataset.key || '';
                if (act === 'save' || act === 'export' || act === 'delete') {
                    if (key.startsWith('session#')) {
                        const idx = parseInt(key.slice('session#'.length), 10);
                        if (act === 'save') this.saveOneUnsaved(idx);
                        else if (act === 'export') this.exportOneUnsaved(idx);
                        else if (act === 'delete') this.deleteOneUnsaved(idx);
                    }
                } else if (act === 'view-content' && key.startsWith('history#')) {
                    const fileName = key.slice('history#'.length);
                    this.viewSingleRun(fileName, btn);
                } else if (act === 'delete-file' && key.startsWith('history#')) {
                    const fileName = key.slice('history#'.length);
                    this.deleteSingleHistoryFile(fileName);
                }
            });
            this.classifyContainer.addEventListener('change', (e) => {
                const sel = e.target.closest('select[data-act="assign-group"]');
                if (!sel) return;
                const key = sel.dataset.key || '';
                const newGid = sel.value || null;
                if (key.startsWith('session#')) {
                    const idx = parseInt(key.slice('session#'.length), 10);
                    if (this.sessionData[idx]) {
                        this.sessionData[idx].manualGroupId = newGid;
                        this.renderDataPage();
                    }
                } else if (key.startsWith('history#')) {
                    const fileName = key.slice('history#'.length);
                    const r = this.savedRuns.find(x => x.__fileName === fileName);
                    if (r) {
                        r.manualGroupId = newGid;
                        this.renderDataPage();
                    }
                }
            });
        }
    }

    // ==================== 应用设置 ====================
    async loadAppSettings() {
        try {
            if (window.electronAPI && window.electronAPI.getSettings) {
                const settings = await window.electronAPI.getSettings();
                if (settings) {
                    this.appSettings.defaultSavePath = settings.defaultSavePath || '';
                    this.appSettings.defaultExportPath = settings.defaultExportPath || '';
                }
            }
        } catch (e) {
            console.error('读取应用设置失败:', e);
        }
    }

    openSettings() {
        if (!this.settingsModal) return;
        if (this.defaultSavePathInput) this.defaultSavePathInput.value = this.appSettings.defaultSavePath || '';
        if (this.defaultExportPathInput) this.defaultExportPathInput.value = this.appSettings.defaultExportPath || '';
        if (this.sessionRunCountEl) this.sessionRunCountEl.textContent = String(this.sessionData.length);
        this.refreshAppInfoInSettings();
        this.settingsModal.setAttribute('aria-hidden', 'false');
    }

    // 拉取并填充"关于"区块的版本号/平台信息
    async refreshAppInfoInSettings() {
        if (!this.appInfoVersionEl) return;
        try {
            if (window.electronAPI && window.electronAPI.getAppInfo) {
                const info = await this.ipcGetAppInfo();
                if (this.appInfoNameEl) this.appInfoNameEl.textContent = info && info.name ? info.name : '排序算法可视化';
                if (this.appInfoVersionEl) this.appInfoVersionEl.textContent = info && info.version ? 'v' + info.version : '--';
                if (this.appInfoPlatformEl) this.appInfoPlatformEl.textContent = info && info.platform ? info.platform : '--';
            }
        } catch (e) {
            if (this.appInfoVersionEl) this.appInfoVersionEl.textContent = '--';
            this._log('refreshAppInfoInSettings:error', { message: e && e.message });
        }
    }

    // 工具栏"退出程序"按钮：弹出确认 → 调用 quit-app IPC
    async quitApp() {
        this._log('quitApp:enter');
        try {
            if (window.electronAPI && window.electronAPI.confirmDialog) {
                // 1) 先看是否有未保存数据：是则三选项（保存并退出 / 不保存退出 / 取消）
                if (this.unsavedCount > 0) {
                    const resp = await this.ipcConfirmDialog({
                        type: 'warning',
                        title: '未保存的数据',
                        message: `当前会话还有 ${this.unsavedCount} 条运行数据未保存到磁盘。`,
                        detail: '选择"保存"会先把这些数据保存为磁盘文件，再退出程序。',
                        buttons: ['保存并退出', '不保存退出', '取消'],
                        defaultId: 0,
                        cancelId: 2
                    });
                    if (resp === 2) {
                        this._log('quitApp:cancel-by-user', { unsaved: this.unsavedCount });
                        return;
                    }
                    if (resp === 0) {
                        // 保存
                        this._log('quitApp:save-then-quit', { unsaved: this.unsavedCount });
                        try {
                            await this.saveAllUnsaved();
                        } catch (e) {
                            this._log('quitApp:save-error', { message: e && e.message });
                            // 保存失败：阻止退出，让用户看到错误
                            await this.ipcConfirmDialog({
                                type: 'error',
                                title: '保存失败',
                                message: '保存未保存数据时发生错误，已取消退出。',
                                detail: (e && e.message) ? String(e.message) : '未知错误',
                                buttons: ['确定'],
                                defaultId: 0,
                                cancelId: 0
                            });
                            return;
                        }
                        // 如果保存后还有残留（部分保存失败），再问一次
                        if (this.unsavedCount > 0) {
                            const resp2 = await this.ipcConfirmDialog({
                                type: 'warning',
                                title: '部分数据未保存',
                                message: `仍有 ${this.unsavedCount} 条数据未成功保存，是否仍要退出？`,
                                buttons: ['仍要退出', '取消'],
                                defaultId: 1,
                                cancelId: 1
                            });
                            if (resp2 !== 0) {
                                this._log('quitApp:cancel-after-partial-save');
                                return;
                            }
                        }
                    }
                    // resp === 1: 不保存退出 → 继续
                } else {
                    // 2) 无未保存数据：常规确认
                    const response = await this.ipcConfirmDialog({
                        type: 'warning',
                        title: '退出程序',
                        message: '确定要退出 排序算法可视化 吗？',
                        detail: '未保存的运行数据会保留在内存中，关闭后不会保留。',
                        buttons: ['退出', '取消'],
                        defaultId: 1,
                        cancelId: 1
                    });
                    if (response !== 0) {
                        this._log('quitApp:cancel', { response });
                        return;
                    }
                }
            }
        } catch (e) {
            this._log('quitApp:confirm-error', { message: e && e.message });
        }
        try {
            if (window.electronAPI && window.electronAPI.quitApp) {
                await this.ipcQuitApp();
            } else {
                window.close();
            }
        } catch (e) {
            this._log('quitApp:error', { message: e && e.message });
            console.error('退出程序失败:', e);
        }
    }

    // 工具栏"最小化"按钮：直接调用主进程最小化窗口
    async minimizeWindow() {
        this._log('minimizeWindow:enter');
        try {
            if (window.electronAPI && window.electronAPI.minimizeWindow) {
                await this.ipcMinimizeWindow();
            }
        } catch (e) {
            this._log('minimizeWindow:error', { message: e && e.message });
        }
    }

    // 工具栏"切换全屏"按钮：调用主进程切换最大化状态
    async toggleMaximizeWindow() {
        this._log('toggleMaximizeWindow:enter');
        try {
            if (window.electronAPI && window.electronAPI.toggleMaximizeWindow) {
                await this.ipcToggleMaximize();
            }
        } catch (e) {
            this._log('toggleMaximizeWindow:error', { message: e && e.message });
        }
    }

    closeSettings() {
        if (!this.settingsModal) return;
        this.settingsModal.setAttribute('aria-hidden', 'true');
    }

    async commitSettings() {
        const savePath = (this.defaultSavePathInput && this.defaultSavePathInput.value || '').trim();
        const exportPath = (this.defaultExportPathInput && this.defaultExportPathInput.value || '').trim();
        this.appSettings.defaultSavePath = savePath;
        this.appSettings.defaultExportPath = exportPath;
        try {
            if (window.electronAPI && window.electronAPI.saveSettings) {
                await window.electronAPI.saveSettings({
                    defaultSavePath: savePath,
                    defaultExportPath: exportPath
                });
            }
            this.closeSettings();
            // 设置变更后重新拉取历史
            await this.loadHistoryFromDefaultPath();
        } catch (e) {
            console.error('保存设置失败:', e);
        }
    }

    async pickDirectory(key) {
        if (!window.electronAPI || !window.electronAPI.chooseDirectory) {
            alert('当前环境不支持目录选择');
            return;
        }
        const current = this.appSettings[key] || '';
        const picked = await window.electronAPI.chooseDirectory(current);
        if (!picked) return; // 用户取消
        this.appSettings[key] = picked;
        if (key === 'defaultSavePath' && this.defaultSavePathInput) this.defaultSavePathInput.value = picked;
        if (key === 'defaultExportPath' && this.defaultExportPathInput) this.defaultExportPathInput.value = picked;
    }

    // 把保存/导出路径重置为"文档/algo-viz"（Electron 端默认）
    async resetPathsToDefault() {
        if (!window.electronAPI || !window.electronAPI.saveSettings || !window.electronAPI.getSettings) {
            alert('当前环境不支持重置');
            return;
        }
        try {
            // 先把服务端设置回退：删掉 settings 文件
            // 这里通过重新保存一个空对象实现 → 重新走默认路径
            // 但 loadSettings 会用空值兜底回默认，因此只要把 appSettings 清空即可
            // 更稳的做法：让后端提供 reset 接口；这里用最简方式：先从 main 端读默认
            // 临时方案：清空本地 + 让 main 端下次 loadSettings 兜底
            await window.electronAPI.saveSettings({
                defaultSavePath: '',
                defaultExportPath: ''
            });
            const refreshed = await window.electronAPI.getSettings();
            if (refreshed) {
                this.appSettings.defaultSavePath = refreshed.defaultSavePath || '';
                this.appSettings.defaultExportPath = refreshed.defaultExportPath || '';
            }
            // 同步输入框
            if (this.defaultSavePathInput) this.defaultSavePathInput.value = this.appSettings.defaultSavePath;
            if (this.defaultExportPathInput) this.defaultExportPathInput.value = this.appSettings.defaultExportPath;
        } catch (e) {
            console.error('重置路径失败:', e);
            alert('重置路径失败: ' + e.message);
        }
    }

    // ==================== 运行数据记录 ====================
    recordSessionStart() {
        this.currentSession = {
            startTime: new Date().toISOString(),
            algorithm: this.currentAlgorithm,
            algorithmLabel: this.currentAlgorithmEl ? this.currentAlgorithmEl.textContent : this.currentAlgorithm,
            arraySize: this.arraySize,
            initialArray: [...this.array],
            comparisons: 0,
            swaps: 0,
            elapsedMs: 0,
            mode: this.isStepMode ? 'step' : 'auto'
        };
    }

    recordSessionEnd() {
        if (!this.currentSession) return;
        const end = new Date();
        this.currentSession.endTime = end.toISOString();
        this.currentSession.finalArray = [...this.array];
        this.currentSession.totalComparisons = this.comparisons;
        this.currentSession.totalSwaps = this.swaps;
        this.currentSession.elapsedMs = this.elapsedMs;
        this.currentSession.duration = end - new Date(this.currentSession.startTime);
        this.currentSession.savedToDisk = false;

        this.sessionData.push(this.currentSession);
        this.unsavedCount += 1;
        this.currentSession = null;
        this.updateDirtyHint();
        // 实时刷新：每次运行结束立即重绘散点图（yMax 重新计算）
        this.refreshDataView();
    }

    // 集中刷新：清空内部缓存 + 重渲染数据页（确保散点图坐标轴=当前 items 最高值）
    refreshDataView() {
        this.renderDataPage();
    }

    clearSessionData() {
        if (this.sessionData.length === 0) return;
        const ok = window.confirm(`确认清空本会话内的 ${this.sessionData.length} 条运行记录？此操作不可撤销。`);
        if (!ok) return;
        this.sessionData = [];
        this.unsavedCount = 0;
        if (this.sessionRunCountEl) this.sessionRunCountEl.textContent = '0';
        this.renderDataPage();
        this.updateDirtyHint();
    }

    // ==================== 左侧导航（独立整页切换） ====================
    switchRailTab(name) {
        this.leftRailTabs.forEach(tab => {
            tab.classList.toggle('is-active', tab.dataset.railTab === name);
        });
        // 直接通过 hidden 属性控制可见性，不依赖 CSS class —— 避免任何
        // 外部样式（自定义皮肤/扩展等）覆盖导致主区域未正确隐藏
        document.querySelectorAll('.algo-test-item').forEach(el => {
            el.hidden = (name === 'data');
        });
        if (this.dataPage) this.dataPage.hidden = (name !== 'data');
        if (name === 'data') {
            this.renderDataPage();
        }
    }

    // 启动时 + 设置变更后调用：从默认保存目录读历史文件
    async loadHistoryFromDefaultPath() {
        if (!window.electronAPI || !window.electronAPI.listHistory) return;
        this._log('loadHistory:enter', { hasAPI: true });
        try {
            const result = await this.ipcListHistory();
            this.historyItems = (result && result.items) || [];
            // 解析已保存的 session 文件为可读运行记录
            // 关键：保留已经在 savedRuns 中存在的引用（避免重读失败时丢失刚保存的 run）
            const existingByPath = new Map();
            for (const r of this.savedRuns) {
                if (r.__filePath) existingByPath.set(r.__filePath, r);
            }
            const nextSavedRuns = [];
            const seenPaths = new Set();
            for (const item of this.historyItems) {
                if (item.type !== 'session') continue;
                seenPaths.add(item.filePath);
                if (existingByPath.has(item.filePath)) {
                    nextSavedRuns.push(existingByPath.get(item.filePath));
                    continue;
                }
                if (!window.electronAPI.readFile) break;
                try {
                    const content = await this.ipcReadFile(item.filePath);
                    const parsed = JSON.parse(content);
                    // session 文件结构：{ runs: [...] } 或单条 run
                    const runs = Array.isArray(parsed.runs) ? parsed.runs : [parsed];
                    runs.forEach((r) => {
                        r.__source = 'saved';
                        r.__fileName = item.name;
                        r.__filePath = item.filePath;
                        nextSavedRuns.push(r);
                    });
                } catch (e) {
                    console.warn('解析历史 session 失败:', item.name, e);
                }
            }
            this.savedRuns = nextSavedRuns;
            // 读取手动分组
            await this.loadManualGroups();
            this.renderDataPage();
        } catch (e) {
            console.error('读取历史数据失败:', e);
        }
        this.updateDirtyHint();
    }

    // 手动分组持久化：存到 settings.json 旁
    async loadManualGroups() {
        if (!window.electronAPI || !window.electronAPI.getSettings) {
            this.manualGroups = [];
            return;
        }
        try {
            const s = await window.electronAPI.getSettings();
            this.manualGroups = (s && Array.isArray(s.manualGroups)) ? s.manualGroups : [];
        } catch (e) {
            this.manualGroups = [];
        }
    }

    async persistManualGroups() {
        if (!window.electronAPI || !window.electronAPI.saveSettings) return;
        try {
            const s = (await window.electronAPI.getSettings()) || {};
            s.manualGroups = this.manualGroups;
            await window.electronAPI.saveSettings({
                defaultSavePath: s.defaultSavePath,
                defaultExportPath: s.defaultExportPath,
                manualGroups: this.manualGroups
            });
        } catch (e) {
            console.error('保存手动分组失败:', e);
        }
    }

    // 切换分类模式
    switchClassifyMode(mode) {
        this.classifyMode = mode;
        this.classifyTabs.forEach(t => t.classList.toggle('is-active', t.dataset.classifyMode === mode));
        if (this.manualGroupEditor) this.manualGroupEditor.hidden = (mode !== 'manual');
        // 模式切换时清空展开状态集合：auto 模式 groupId 是 "algo:xxx"，
        // manual 模式是用户分组的 id；不同模式保留旧状态没意义
        this.expandedGroupIds.clear();
        // 仅当 mode 为 manual 时才重建手动分组列表（避免 auto 模式时频繁重建）
        if (mode === 'manual') {
            this.renderManualGroupList();
        }
        this.renderDataPage();
    }

    // 切换数据源
    switchSourceMode(mode) {
        this.sourceMode = mode;
        this.sourceTabs.forEach(t => t.classList.toggle('is-active', t.dataset.sourceMode === mode));
        this.renderDataPage();
    }

    // 渲染测试数据页
    renderDataPage() {
        if (!this.classifyContainer) return;
        // 给未保存数据打标
        this.sessionData.forEach((r, i) => { r.__source = 'unsaved'; r.__sessionIdx = i; });

        // 顶部计数
        const u = this.sessionData.length;
        const s = this.savedRuns.length;
        if (this.srcCountAllEl) this.srcCountAllEl.textContent = String(u + s);
        if (this.srcCountUnsavedEl) this.srcCountUnsavedEl.textContent = String(u);
        if (this.srcCountSavedEl) this.srcCountSavedEl.textContent = String(s);

        // 过滤数据源
        let runs = [];
        if (this.sourceMode === 'all' || this.sourceMode === 'unsaved') {
            runs = runs.concat(this.sessionData);
        }
        if (this.sourceMode === 'all' || this.sourceMode === 'saved') {
            runs = runs.concat(this.savedRuns);
        }

        // 按分类模式分组
        let groups = [];
        if (this.classifyMode === 'auto') {
            // 自动分类：按 algorithm
            const map = new Map();
            for (const r of runs) {
                const key = r.algorithm || '未知算法';
                if (!map.has(key)) map.set(key, []);
                map.get(key).push(r);
            }
            groups = Array.from(map.entries()).map(([algo, items]) => ({
                id: 'algo:' + algo,
                name: this.prettyAlgoName(algo),
                hint: '按算法自动分组',
                items
            })).sort((a, b) => a.name.localeCompare(b.name));
        } else {
            // 手动分类：按 manualGroup 字段；未设置归"未分组"
            const map = new Map();
            // 先把已有手动分组建空桶
            for (const g of this.manualGroups) {
                map.set(g.id, { id: g.id, name: g.name, hint: '手动分组', items: [] });
            }
            const ungrouped = [];
            for (const r of runs) {
                const gid = r.manualGroupId;
                if (gid && map.has(gid)) {
                    map.get(gid).items.push(r);
                } else {
                    ungrouped.push(r);
                }
            }
            groups = Array.from(map.values());
            if (ungrouped.length > 0) {
                groups.push({ id: '__ungrouped__', name: '未分组', hint: '未指定手动分组的运行', items: ungrouped });
            }
            // 局部更新每个分组的"运行数"，不重建 input DOM（避免丢失焦点）
            this.updateManualGroupCounts();
        }

        // 渲染分组
        this.classifyContainer.innerHTML = '';
        if (groups.length === 0) {
            this.classifyContainer.innerHTML = '<div class="data-empty">暂无数据。请先在「算法测试」页运行排序。</div>';
            return;
        }
        for (const g of groups) {
            const card = document.createElement('div');
            card.className = 'classify-group';
            const count = g.items.length;
            const cmps = g.items.reduce((acc, r) => acc + (r.totalComparisons || 0), 0);
            const swaps = g.items.reduce((acc, r) => acc + (r.totalSwaps || 0), 0);
            const elapsedTotal = g.items.reduce((acc, r) => acc + (r.elapsedMs || 0), 0);
            const opsTotal = cmps + swaps;
            // 各文件自身每步耗时（μs/步），用于显示上下区间
            const perFileStepUs = g.items.map((r) => {
                const ops = (r.totalComparisons || 0) + (r.totalSwaps || 0);
                return ops > 0 ? ((r.elapsedMs || 0) * 1000) / ops : 0;
            }).filter(v => v > 0);
            const stepUsMin = perFileStepUs.length ? Math.min(...perFileStepUs) : 0;
            const stepUsMax = perFileStepUs.length ? Math.max(...perFileStepUs) : 0;
            // 平均数组大小 / 平均耗时
            const avgSize = count ? Math.round(g.items.reduce((a, r) => a + (r.arraySize || 0), 0) / count) : 0;
            const avgElapsed = count ? elapsedTotal / count : 0;
            // 分类模式：自动模式 → 标记为按算法（次要分类标签）
            const subcatLabel = this.classifyMode === 'auto' ? this.algoSubCategory(g.id) : null;
            card.innerHTML = `
                <div class="classify-group-header" data-group-toggle="${this.escapeAttr(g.id)}">
                    <div class="classify-group-title">
                        <span data-group-name-id="${this.escapeAttr(g.id)}">${this.escapeHtml(g.name)}</span>
                        <span class="classify-group-badge">${count}</span>
                        ${subcatLabel ? `<span class="classify-group-tag">${subcatLabel}</span>` : ''}
                    </div>
                    <div class="classify-group-stats">
                        <span title="比较次数">🔁 ${cmps.toLocaleString()}</span>
                        <span title="交换次数">⇄ ${swaps.toLocaleString()}</span>
                        <span title="累计耗时">⏱ ${this.formatElapsed(elapsedTotal)}</span>
                        <span title="平均耗时">⌀ ${this.formatElapsed(avgElapsed)}</span>
                        <span title="各文件自身每步耗时的上下区间 (μs/步)" class="classify-group-stat-emph">⚡ ${stepUsMin.toFixed(2)} ~ ${stepUsMax.toFixed(2)} μs/步</span>
                        <span title="平均数组大小">📐 ${avgSize}</span>
                        ${count > 0 ? `<button class="classify-group-delete" data-group-delete="${this.escapeAttr(g.id)}" title="删除此分组内的所有文件（按文件去重）">🗑</button>` : ''}
                        <button class="classify-group-toggle" title="展开/折叠">▸</button>
                    </div>
                </div>
                <div class="classify-group-body" data-group-body="${this.escapeAttr(g.id)}" hidden></div>
            `;
            this.classifyContainer.appendChild(card);
            const body = card.querySelector('[data-group-body]');
            // 恢复用户上次的展开/折叠状态
            const isExpanded = this.expandedGroupIds.has(g.id);
            if (isExpanded) body.removeAttribute('hidden');
            if (g.items.length === 0) {
                body.innerHTML = '<div class="data-empty" style="padding:14px 8px;">该分组暂无运行</div>';
            } else {
                // 散点图（每种算法一个：N vs 比较、N vs 交换、N vs 耗时）
                const charts = this.renderAlgoScatterCharts(g);
                body.appendChild(charts);
                g.items.forEach((r) => body.appendChild(this.buildClassifyRow(r)));
            }
            // 折叠/展开：同步到 this.expandedGroupIds 让下次重渲染保留状态
            const header = card.querySelector('[data-group-toggle]');
            const toggleBtn = card.querySelector('.classify-group-toggle');
            // 同步 toggle 按钮的初始图标
            if (toggleBtn) toggleBtn.textContent = isExpanded ? '▾' : '▸';
            const setExpanded = (expanded) => {
                if (expanded) {
                    body.removeAttribute('hidden');
                    this.expandedGroupIds.add(g.id);
                } else {
                    body.setAttribute('hidden', '');
                    this.expandedGroupIds.delete(g.id);
                }
                if (toggleBtn) toggleBtn.textContent = expanded ? '▾' : '▸';
            };
            header.addEventListener('click', (e) => {
                // 用 closest() 更稳健：避免子元素 class 变更时漏判
                if (e.target.closest('.classify-group-toggle, .classify-group-delete')) return;
                setExpanded(body.hasAttribute('hidden'));
            });
            if (toggleBtn) toggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                setExpanded(body.hasAttribute('hidden'));
            });
            // 删除当前分组内的所有文件：按 __filePath 去重（一个文件可能含多条 run）
            const deleteBtn = card.querySelector('[data-group-delete]');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.deleteAllInGroup(g);
                });
            }
        }
        this.updateDirtyHint();
    }

    // 删除某分组内所有文件（按文件去重 → 批量删文件 + 内存数据）
    async deleteAllInGroup(g) {
        // 收集该分组中：未保存 run + 已保存 run 的 filePath（去重）
        const filePaths = new Set();
        const toRemoveFromSession = []; // 引用
        for (const r of g.items) {
            if (r.__source === 'unsaved') {
                toRemoveFromSession.push(r);
            } else if (r.__filePath) {
                filePaths.add(r.__filePath);
            }
        }
        const total = toRemoveFromSession.length + filePaths.size;
        if (total === 0) return;
        const ok = await this.confirm({
            type: 'warning',
            title: '删除分组内所有文件',
            message: `确定要删除「${g.name}」分组内的所有内容吗？`,
            detail: `未保存运行 ${toRemoveFromSession.length} 条 + 磁盘文件 ${filePaths.size} 个，共 ${total} 项。\n此操作不可恢复。`,
            buttons: ['删除', '取消'],
            defaultId: 1,
            cancelId: 1
        });
        if (ok !== 0) return;
        // 1) 从内存中删除未保存的 run
        if (toRemoveFromSession.length > 0) {
            const keys = new Set(toRemoveFromSession.map(r => r.__sessionIdx));
            this.sessionData = this.sessionData.filter((r, i) => !keys.has(i));
        }
        // 2) 从内存中删除已保存的 run 引用
        this.savedRuns = this.savedRuns.filter(r => !r.__filePath || !filePaths.has(r.__filePath));
        this.unsavedCount = this.sessionData.length;
        if (this.sessionRunCountEl) this.sessionRunCountEl.textContent = String(this.sessionData.length);
        // 3) 磁盘文件删除（先全部在内存清掉再统一删磁盘，避免 UI 残留）
        this._log('deleteRuns:enter', { filePaths: Array.from(filePaths) });
        for (const fp of filePaths) {
            try {
                await this.ipcDeleteFile(fp);
            } catch (e) {
                console.error('删除文件失败:', fp, e);
            }
        }
        // 4) 刷新视图
        this.updateDirtyHint();
        this.refreshDataView();
    }

    // 根据算法名查 6 大次要分类
    algoSubCategory(algoGroupId) {
        const algo = String(algoGroupId).replace(/^algo:/, '');
        for (const cat of SortingVisualizer.ALGO_CATEGORIES) {
            if (cat.items.some(a => a.id === algo)) return cat.name;
        }
        return '';
    }

    // 散点图 / 柱状图容器（纯 SVG，不依赖外部库）
    // 按数据可用性动态选择图表：缺比较/交换数据时，只显示耗时图
    // 根据 this.chartType 决定使用柱状图或散点图
    renderAlgoScatterCharts(g) {
        const wrap = document.createElement('div');
        wrap.className = 'algo-scatter-wrap';
        const items = g.items;
        // 数据可用性检测：当前 group 中是否所有 item 都没有比较次数/交换次数
        const hasCmp = items.some(r => Number.isFinite(Number(r.totalComparisons)) && Number(r.totalComparisons) > 0);
        const hasSwp = items.some(r => Number.isFinite(Number(r.totalSwaps)) && Number(r.totalSwaps) > 0);
        const hasElapsed = items.some(r => Number.isFinite(Number(r.elapsedMs)) && Number(r.elapsedMs) > 0);
        const chartBuilder = this.chartType === 'scatter' ? this.buildScatterSVG : this.buildIntervalBarChart;
        if (hasCmp) wrap.appendChild(chartBuilder.call(this, 'N 与比较次数', items, 'arraySize', 'totalComparisons', '#2f9e44'));
        if (hasSwp) wrap.appendChild(chartBuilder.call(this, 'N 与交换次数', items, 'arraySize', 'totalSwaps', '#fa5252'));
        if (hasElapsed) wrap.appendChild(chartBuilder.call(this, 'N 与耗时 (ms)', items, 'arraySize', 'elapsedMs', '#1971c2'));
        if (!hasCmp && !hasSwp && !hasElapsed) {
            const empty = document.createElement('div');
            empty.className = 'algo-scatter-empty';
            empty.textContent = '本组暂无统计数据。';
            wrap.appendChild(empty);
        }
        return wrap;
    }

    // 切换图表类型（柱状图 ↔ 散点图），并刷新数据页
    toggleChartType() {
        this.chartType = this.chartType === 'bar' ? 'scatter' : 'bar';
        this.updateChartTypeToggleUI();
        this.renderDataPage();
    }

    // 同步切换按钮的图标 / 提示
    updateChartTypeToggleUI() {
        if (!this.chartTypeToggleBtn) return;
        const isBar = this.chartType === 'bar';
        this.chartTypeToggleBtn.setAttribute('data-chart-type', this.chartType);
        this.chartTypeToggleBtn.setAttribute('title', isBar ? '当前：柱状图（点击切换为散点图）' : '当前：散点图（点击切换为柱状图）');
        this.chartTypeToggleBtn.setAttribute('aria-label', this.chartTypeToggleBtn.getAttribute('title') || '');
        const iconEl = this.chartTypeToggleBtn.querySelector('.chart-toggle-icon');
        const textEl = this.chartTypeToggleBtn.querySelector('.chart-toggle-text');
        if (iconEl) iconEl.textContent = isBar ? '📊' : '🔵';
        if (textEl) textEl.textContent = isBar ? '柱状图' : '散点图';
    }

    // 区间柱状图：以数组大小为 x 轴按 10 一桶分桶，其他参数为 y 轴，柱高 = 该桶内 y 的平均值
    // hover 柱 → 浮动 tip 列出该桶内所有文件 / 数组大小 / 数值
    // 视图尺寸 W×H（坐标映射不变，仅画布变大）
    buildIntervalBarChart(title, items, xField, yField, color) {
        const W = 460, H = 240, P = 40;
        // 单元测试 mock 环境 fallback
        if (typeof document.createElementNS !== 'function') {
            const div = document.createElement('div');
            div.className = 'algo-scatter-svg algo-scatter-mock';
            div.textContent = `[mock] ${title} items=${items.length}`;
            return div;
        }
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
        svg.setAttribute('class', 'algo-scatter-svg algo-bar-svg');
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

        // 过滤掉 y 无效的项
        const valid = items.map(r => ({
            r,
            x: Number(r[xField]) || 0,
            y: Number(r[yField]) || 0
        })).filter(p => Number.isFinite(p.y));
        if (valid.length === 0) {
            const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            t.setAttribute('x', String(W / 2));
            t.setAttribute('y', String(H / 2));
            t.setAttribute('text-anchor', 'middle');
            t.setAttribute('font-size', '11');
            t.setAttribute('fill', '#adb5bd');
            t.textContent = '无有效数据';
            svg.appendChild(t);
            return this._wrapChart(title, svg);
        }

        // 10 区间分桶：[0,10), [10,20), …；根据数据中最大的 N 动态生成，最后一桶为 ∞
        const maxX = Math.max(0, ...valid.map(p => p.x));
        const binSize = 10;
        // 上界取 (maxX+binSize) 上取整，确保最后一桶能覆盖到 maxX
        // 至少预留 2 个桶，避免单桶退化成 [0, ∞)
        let upper = Math.max(binSize * 2, Math.ceil((maxX + 1) / binSize) * binSize);
        const BINS = [];
        for (let lo = 0; lo < upper; lo += binSize) {
            BINS.push(lo === upper - binSize ? [lo, Infinity] : [lo, lo + binSize]);
        }
        const buckets = BINS.map(([lo, hi]) => ({
            lo, hi,
            label: hi === Infinity ? `≥${lo}` : `${lo}-${hi}`,
            runs: []
        }));
        for (const p of valid) {
            const idx = Math.min(BINS.length - 1, Math.floor(p.x / 10));
            buckets[idx].runs.push(p);
        }

        // 计算聚合：y 平均；yMax 取所有非空桶平均的最大值
        const yMax = Math.max(1, ...buckets.filter(b => b.runs.length > 0).map(b => b.runs.reduce((a, p) => a + p.y, 0) / b.runs.length));
        const chartTop = 12, chartBottom = H - P, chartHeight = chartBottom - chartTop;
        const barWidth = (W - P - 8) / BINS.length;
        // 网格
        const grid = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        // x 轴
        const xAxis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        xAxis.setAttribute('x1', String(P));
        xAxis.setAttribute('y1', String(chartBottom));
        xAxis.setAttribute('x2', String(W - 4));
        xAxis.setAttribute('y2', String(chartBottom));
        xAxis.setAttribute('stroke', '#dee2e6');
        grid.appendChild(xAxis);
        // y 轴
        const yAxis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        yAxis.setAttribute('x1', String(P));
        yAxis.setAttribute('y1', String(chartTop));
        yAxis.setAttribute('x2', String(P));
        yAxis.setAttribute('y2', String(chartBottom));
        yAxis.setAttribute('stroke', '#dee2e6');
        grid.appendChild(yAxis);
        // 0 / yMax 刻度文字
        const yZero = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        yZero.setAttribute('x', String(P - 4));
        yZero.setAttribute('y', String(chartBottom + 14));
        yZero.setAttribute('text-anchor', 'end');
        yZero.setAttribute('font-size', '12');
        yZero.setAttribute('fill', '#adb5bd');
        yZero.textContent = '0';
        grid.appendChild(yZero);
        const yTop = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        yTop.setAttribute('x', String(P - 4));
        yTop.setAttribute('y', String(chartTop + 11));
        yTop.setAttribute('text-anchor', 'end');
        yTop.setAttribute('font-size', '12');
        yTop.setAttribute('fill', '#adb5bd');
        yTop.textContent = this.fmtNum(yMax);
        grid.appendChild(yTop);
        svg.appendChild(grid);

        // 画每根柱
        // 规则：每根柱的下限 = 该桶内所有文件的 y 最小值，上限 = 平均值
        // 并在 0 → min 之间画一根淡色"基柱"作为视觉参考
        buckets.forEach((b, i) => {
            if (b.runs.length === 0) return;     // 空桶不画
            const ys = b.runs.map(p => p.y);
            const avg = ys.reduce((a, v) => a + v, 0) / ys.length;
            const minY = Math.min(...ys);
            // 物理坐标：minY 在下、avg 在上（avg 永远 >= min）
            const topVal = Math.max(avg, minY);
            const botVal = Math.min(avg, minY);
            const hBase = (botVal / yMax) * chartHeight;        // 0 → botVal 的高度
            const hBar = ((topVal - botVal) / yMax) * chartHeight;
            const x = P + i * barWidth + 1.5;
            const w = barWidth - 3;
            // 基柱（淡色 0 → 最小值，仅当最小值 > 0 时才有意义）
            if (hBase > 0.5) {
                const ghost = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                ghost.setAttribute('x', x.toFixed(1));
                ghost.setAttribute('y', (chartBottom - hBase).toFixed(1));
                ghost.setAttribute('width', w.toFixed(1));
                ghost.setAttribute('height', Math.max(1, hBase).toFixed(1));
                ghost.setAttribute('fill', color);
                ghost.setAttribute('opacity', '0.18');
                ghost.setAttribute('class', 'algo-bar-ghost');
                svg.appendChild(ghost);
            }
            // 主柱：minY → avg
            const y = chartBottom - hBase - hBar;
            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('x', x.toFixed(1));
            rect.setAttribute('y', y.toFixed(1));
            rect.setAttribute('width', w.toFixed(1));
            rect.setAttribute('height', Math.max(1, hBar).toFixed(1));
            rect.setAttribute('fill', color);
            rect.setAttribute('opacity', '0.85');
            rect.setAttribute('class', 'algo-bar-rect');
            rect.setAttribute('data-bin-index', String(i));
            // SVG <title> 元素用于原生 tooltip（hover 即出现）
            const tipText = this._formatBinTip(b, yField, avg, minY);
            const t = document.createElementNS('http://www.w3.org/2000/svg', 'title');
            t.textContent = tipText;
            rect.appendChild(t);
            // 自定义浮层（更详细，跨浏览器一致）
            rect.addEventListener('mouseenter', () => {
                rect.setAttribute('opacity', '1');
                rect.setAttribute('stroke', '#ffc107');
                rect.setAttribute('stroke-width', '1.5');
                this.showPointTooltip(tipText, x + w / 2, y, rect);
            });
            rect.addEventListener('mouseleave', () => {
                rect.setAttribute('opacity', '0.85');
                rect.removeAttribute('stroke');
                rect.removeAttribute('stroke-width');
                this.hidePointTooltip();
            });
            // 点击高亮（防止遮挡时不响应）
            rect.addEventListener('click', (ev) => {
                ev.stopPropagation();
                this.showClusterPicker(b.runs.map(({ r }, ii) => ({ rr: r, ii })));
            });
            svg.appendChild(rect);
            // 顶部数值标签
            if (hBar > 18) {
                const lbl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                lbl.setAttribute('x', (x + w / 2).toFixed(1));
                lbl.setAttribute('y', Math.max(chartTop + 14, y - 4).toFixed(1));
                lbl.setAttribute('text-anchor', 'middle');
                lbl.setAttribute('font-size', '12');
                lbl.setAttribute('fill', '#495057');
                lbl.textContent = this.fmtNum(avg);
                svg.appendChild(lbl);
            }
            // 桶区间标签（每桶下方）
            if (i % 2 === 0) {     // 隔一个标避免拥挤
                const xlbl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                xlbl.setAttribute('x', (x + w / 2).toFixed(1));
                xlbl.setAttribute('y', String(chartBottom + 16));
                xlbl.setAttribute('text-anchor', 'middle');
                xlbl.setAttribute('font-size', '11');
                xlbl.setAttribute('fill', '#adb5bd');
                xlbl.textContent = b.label;
                svg.appendChild(xlbl);
            }
        });

        return this._wrapChart(title, svg);
    }

    // 辅助：把 svg 包成 chartWrap（含标题）
    _wrapChart(title, svg) {
        const titleEl = document.createElement('div');
        titleEl.className = 'algo-scatter-title';
        titleEl.textContent = title;
        const chartWrap = document.createElement('div');
        chartWrap.className = 'algo-scatter-chart algo-bar-chart';
        chartWrap.appendChild(titleEl);
        chartWrap.appendChild(svg);
        return chartWrap;
    }

    // 辅助：格式化柱的 tooltip 文本（含 min / avg）
    _formatBinTip(b, yField, avg, minY) {
        const head = minY != null
            ? `区间 ${b.label} · 共 ${b.runs.length} 条 · 最小 ${this.fmtNum(minY)} · 平均 ${this.fmtNum(avg)}`
            : `区间 ${b.label} · 共 ${b.runs.length} 条 · 平均 ${this.fmtNum(avg)}`;
        const lines = [head];
        b.runs.forEach((p, i) => {
            const algo = this.prettyAlgoName(p.r.algorithm || '');
            const fn = p.r.__fileName || '—';
            lines.push(`#${i + 1} ${algo}  N=${p.x}  ${yField}=${this.fmtNum(p.y)}  ⏱${this.formatElapsed(p.r.elapsedMs || 0)}`);
            lines.push(`   📁 ${fn}`);
        });
        return lines.join('\n');
    }

    // 散点图：x=数组大小，y=某指标；点与点之间不连线
    // 与 buildIntervalBarChart 接口一致，便于同一调用点切换
    // 视图尺寸 W×H（坐标映射不变，仅画布变大）
    buildScatterSVG(title, items, xField, yField, color) {
        const W = 460, H = 240, P = 40;
        // 单元测试 mock 环境 fallback
        if (typeof document.createElementNS !== 'function') {
            const div = document.createElement('div');
            div.className = 'algo-scatter-svg algo-scatter-mock';
            div.textContent = `[mock] ${title} items=${items.length}`;
            return div;
        }
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
        svg.setAttribute('class', 'algo-scatter-svg algo-scatter-svg-only');
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

        // 过滤掉 y 无效的项
        const valid = items.map(r => ({
            r,
            x: Number(r[xField]) || 0,
            y: Number(r[yField]) || 0
        })).filter(p => Number.isFinite(p.y));
        if (valid.length === 0) {
            const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            t.setAttribute('x', String(W / 2));
            t.setAttribute('y', String(H / 2));
            t.setAttribute('text-anchor', 'middle');
            t.setAttribute('font-size', '11');
            t.setAttribute('fill', '#adb5bd');
            t.textContent = '无有效数据';
            svg.appendChild(t);
            return this._wrapChart(title, svg);
        }

        // 坐标范围：x 0..ceil(maxX/10)*10（向上取整到 10 倍数），y 0..maxY
        const maxXRaw = Math.max(1, ...valid.map(p => p.x));
        const xMax = Math.max(10, Math.ceil(maxXRaw / 10) * 10);
        const yMax = Math.max(1, ...valid.map(p => p.y));
        const chartTop = 12, chartBottom = H - P, chartLeft = P, chartRight = W - 4;
        const chartW = chartRight - chartLeft;
        const chartH = chartBottom - chartTop;
        const xToPx = (x) => chartLeft + Math.min(1, x / xMax) * chartW;
        const yToPx = (y) => chartBottom - Math.min(1, y / yMax) * chartH;

        // 网格（轴 + 0/中段/顶 刻度文字）
        const grid = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        // x 轴
        const xAxis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        xAxis.setAttribute('x1', String(chartLeft));
        xAxis.setAttribute('y1', String(chartBottom));
        xAxis.setAttribute('x2', String(chartRight));
        xAxis.setAttribute('y2', String(chartBottom));
        xAxis.setAttribute('stroke', '#dee2e6');
        grid.appendChild(xAxis);
        // y 轴
        const yAxis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        yAxis.setAttribute('x1', String(chartLeft));
        yAxis.setAttribute('y1', String(chartTop));
        yAxis.setAttribute('x2', String(chartLeft));
        yAxis.setAttribute('y2', String(chartBottom));
        yAxis.setAttribute('stroke', '#dee2e6');
        grid.appendChild(yAxis);
        // y 刻度文字
        const yZero = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        yZero.setAttribute('x', String(chartLeft - 4));
        yZero.setAttribute('y', String(chartBottom + 14));
        yZero.setAttribute('text-anchor', 'end');
        yZero.setAttribute('font-size', '12');
        yZero.setAttribute('fill', '#adb5bd');
        yZero.textContent = '0';
        grid.appendChild(yZero);
        const yTop = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        yTop.setAttribute('x', String(chartLeft - 4));
        yTop.setAttribute('y', String(chartTop + 11));
        yTop.setAttribute('text-anchor', 'end');
        yTop.setAttribute('font-size', '12');
        yTop.setAttribute('fill', '#adb5bd');
        yTop.textContent = this.fmtNum(yMax);
        grid.appendChild(yTop);
        // x 刻度文字（仅两端）
        const xStart = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        xStart.setAttribute('x', String(chartLeft));
        xStart.setAttribute('y', String(chartBottom + 16));
        xStart.setAttribute('text-anchor', 'start');
        xStart.setAttribute('font-size', '11');
        xStart.setAttribute('fill', '#adb5bd');
        xStart.textContent = '0';
        grid.appendChild(xStart);
        const xEnd = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        xEnd.setAttribute('x', String(chartRight));
        xEnd.setAttribute('y', String(chartBottom + 16));
        xEnd.setAttribute('text-anchor', 'end');
        xEnd.setAttribute('font-size', '11');
        xEnd.setAttribute('fill', '#adb5bd');
        xEnd.textContent = this.fmtNum(xMax);
        grid.appendChild(xEnd);
        svg.appendChild(grid);

        // 散点：每个点独立绘制，不连线
        // 同一 (x,y) 上的点视为重叠：点击时弹出重叠点列表
        const keyOf = (p) => `${p.x}|${p.y}`;
        const clusterMap = new Map();
        valid.forEach((p, ii) => {
            const k = keyOf(p);
            if (!clusterMap.has(k)) clusterMap.set(k, []);
            clusterMap.get(k).push({ rr: p.r, ii });
        });

        valid.forEach((p) => {
            const cx = xToPx(p.x);
            const cy = yToPx(p.y);
            const algo = this.prettyAlgoName(p.r.algorithm || '');
            const fn = p.r.__fileName || '—';
            const tipText = `#${valid.indexOf(p) + 1} ${algo}  N=${p.x}  ${yField}=${this.fmtNum(p.y)}  ⏱${this.formatElapsed(p.r.elapsedMs || 0)}\n📁 ${fn}`;
            const t = document.createElementNS('http://www.w3.org/2000/svg', 'title');
            t.textContent = tipText;
            const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            c.setAttribute('cx', cx.toFixed(1));
            c.setAttribute('cy', cy.toFixed(1));
            c.setAttribute('r', '6');
            c.setAttribute('fill', color);
            c.setAttribute('opacity', '0.85');
            c.setAttribute('class', 'algo-scatter-point');
            c.setAttribute('data-x', String(p.x));
            c.setAttribute('data-y', String(p.y));
            c.appendChild(t);
            c.addEventListener('mouseenter', () => {
                c.setAttribute('opacity', '1');
                c.setAttribute('r', '8');
                c.setAttribute('stroke', '#ffc107');
                c.setAttribute('stroke-width', '1.8');
                this.showPointTooltip(tipText, cx, cy, c);
            });
            c.addEventListener('mouseleave', () => {
                c.setAttribute('opacity', '0.85');
                c.setAttribute('r', '6');
                c.removeAttribute('stroke');
                c.removeAttribute('stroke-width');
                this.hidePointTooltip();
            });
            c.addEventListener('click', (ev) => {
                ev.stopPropagation();
                const cluster = clusterMap.get(keyOf(p)) || [{ rr: p.r, ii: valid.indexOf(p) }];
                if (cluster.length > 1) {
                    this.showClusterPicker(cluster);
                } else {
                    this.jumpToRunRow(p.r);
                }
            });
            svg.appendChild(c);
        });

        return this._wrapChart(title, svg);
    }

    // cluster 选择器：重叠点 click 时弹出，列出所有同 (x,y) 的条目供选择跳转
    showClusterPicker(cluster) {
        let modal = document.getElementById('clusterPickerModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'clusterPickerModal';
            modal.className = 'modal';
            modal.setAttribute('aria-hidden', 'true');
            modal.innerHTML = `
                <div class="modal-backdrop" data-close-cluster="1"></div>
                <div class="modal-dialog modal-dialog-narrow">
                    <div class="modal-header">
                        <h3 class="modal-title">重叠点列表</h3>
                        <button class="modal-close" data-close-cluster="1" aria-label="关闭">✕</button>
                    </div>
                    <div class="modal-body" id="clusterPickerBody"></div>
                    <div class="modal-footer">
                        <button class="modal-btn modal-btn-secondary" data-close-cluster="1">关闭</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
            modal.addEventListener('click', (e) => {
                if (e.target.dataset && e.target.dataset.closeCluster !== undefined) this.hideClusterPicker();
            });
        }
        const body = modal.querySelector('#clusterPickerBody');
        body.innerHTML = '';
        const list = document.createElement('div');
        list.className = 'cluster-picker-list';
        cluster.forEach(({ rr, ii }) => {
            const row = document.createElement('button');
            row.className = 'cluster-picker-row';
            row.innerHTML = `
                <span class="cluster-picker-idx">#${ii + 1}</span>
                <span class="cluster-picker-file">${this.escapeHtml(rr.__fileName || '—')}</span>
                <span class="cluster-picker-meta">N=${rr.arraySize}  ⏱ ${this.formatElapsed(rr.elapsedMs || 0)}</span>
            `;
            row.addEventListener('click', () => {
                this.hideClusterPicker();
                this.jumpToRunRow(rr);
            });
            list.appendChild(row);
        });
        body.appendChild(list);
        modal.classList.add('is-open');
        modal.setAttribute('aria-hidden', 'false');
    }

    hideClusterPicker() {
        const modal = document.getElementById('clusterPickerModal');
        if (!modal) return;
        modal.classList.remove('is-open');
        modal.setAttribute('aria-hidden', 'true');
    }

    fmtNum(n) {
        n = Number(n) || 0;
        if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
        if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
        return String(Math.round(n));
    }

    prettyAlgoName(key) {
        const map = {
            bubble: '冒泡排序', selection: '选择排序', insertion: '插入排序',
            quick: '快速排序', merge: '归并排序', shell: '希尔排序',
            heap: '堆排序', counting: '计数排序', bucket: '桶排序',
            radix: '基数排序', comb: '梳排序', oddEven: '奇偶排序',
            cocktail: '鸡尾酒排序', gnome: '侏儒排序', patience: '耐心排序',
            library: '图书馆排序', block: '块排序', smooth: '平滑排序',
            tournament: '锦标赛排序', intro: '内省排序', tim: 'Tim 排序'
        };
        return map[key] || key;
    }

    formatElapsed(ms) {
        if (!ms || ms < 0) return '0ms';
        if (ms < 1000) return ms + 'ms';
        return (ms / 1000).toFixed(2) + 's';
    }

    // 构建分类视图中的单条数据行
    buildClassifyRow(run) {
        const row = document.createElement('div');
        row.className = 'classify-data-row';
        const isSaved = run.__source === 'saved';
        const startTime = run.startTime || run.timestamp || '';
        const startDate = startTime ? new Date(startTime).toLocaleString() : '';
        const safeName = this.escapeHtml(run.algorithm || '未知');
        const idx = run.__sessionIdx != null ? run.__sessionIdx : null;
        // 已保存 run 在所属文件内的序号
        const fileRuns = isSaved ? this.savedRuns.filter(r => r.__fileName === run.__fileName) : [];
        const fileIndex = isSaved ? (fileRuns.indexOf(run) + 1) : 0;
        const fileTotal = isSaved ? fileRuns.length : 0;
        // 平均步耗时：总耗时 / (比较 + 交换)，单位自适应 (ns/μs/ms/s/步)
        const cmp = Number(run.totalComparisons) || 0;
        const swp = Number(run.totalSwaps) || 0;
        const ela = Number(run.elapsedMs) || 0;
        const ops = cmp + swp;
        const avgStepText = (() => {
            if (ops <= 0) return '— /步';
            const ns = (ela * 1e6) / ops;     // ela 是 ms，转 ns：1ms = 1e6 ns
            if (ns >= 1e9) return `${(ns / 1e9).toFixed(2)} s/步`;
            if (ns >= 1e6) return `${(ns / 1e6).toFixed(2)} ms/步`;
            if (ns >= 1e3) return `${(ns / 1e3).toFixed(2)} μs/步`;
            return `${ns.toFixed(1)} ns/步`;
        })();
        const title = isSaved
            ? `${this.escapeHtml(run.__fileName || '')} · #${fileIndex}/${fileTotal} · ${safeName}`
            : `#${idx + 1} · ${safeName}`;
        row.innerHTML = `
            <span class="data-source-badge ${isSaved ? 'is-saved' : 'is-unsaved'}">${isSaved ? '已保存' : '未保存'}</span>
            <div class="data-row-info">
                <span class="data-row-title">${title}</span>
                <span class="data-row-meta">大小 ${run.arraySize || 0} · 比较 ${cmp.toLocaleString()} · 交换 ${swp.toLocaleString()} · ${this.formatElapsed(ela)} · <span class="data-row-emph" title="平均每步耗时 = 总耗时 / (比较+交换)">⚡ ${avgStepText}</span>${startDate ? ' · ' + this.escapeHtml(startDate) : ''}</span>
            </div>
            <div class="data-row-actions">
                ${this.classifyMode === 'manual' ? this.buildGroupSelectHtml(run) : ''}
                ${isSaved
                    ? `<button class="data-row-btn" data-act="view-content" data-key="${this.escapeAttr(this.runKeyOf(run))}" title="查看此条详情">👁️</button>
                       <button class="data-row-btn is-danger" data-act="delete-file" data-key="${this.escapeAttr(this.runKeyOf(run))}" title="从磁盘删除">🗑️</button>`
                    : `<button class="data-row-btn" data-act="save" data-key="session#${idx}" title="保存到磁盘">💾</button>
                       <button class="data-row-btn" data-act="export" data-key="session#${idx}" title="导出CSV">📤</button>
                       <button class="data-row-btn is-danger" data-act="delete" data-key="session#${idx}" title="删除">🗑️</button>`
                }
            </div>
        `;
        return row;
    }

    buildGroupSelectHtml(run) {
        const cur = run.manualGroupId || '';
        const opts = ['<option value="">未分组</option>']
            .concat(this.manualGroups.map(g => `<option value="${this.escapeAttr(g.id)}"${g.id === cur ? ' selected' : ''}>${this.escapeHtml(g.name)}</option>`))
            .join('');
        return `<select class="assign-group-select" data-act="assign-group" data-key="${this.runKeyOf(run)}">${opts}</select>`;
    }

    runKeyOf(run) {
        if (run.__source === 'saved') return 'history#' + (run.__fileName || '');
        return 'session#' + run.__sessionIdx;
    }

    renderManualGroupList() {
        if (!this.manualGroupListEl) return;
        // 记住当前聚焦的 input（gid + 光标位置）以便在重建后恢复
        const active = document.activeElement;
        const focusedGid = (active && active.dataset && active.dataset.act === 'rename-group') ? active.dataset.gid : null;
        const selStart = active && active.selectionStart;
        const selEnd = active && active.selectionEnd;

        this.manualGroupListEl.innerHTML = '';
        if (!this.manualGroups || this.manualGroups.length === 0) {
            this.manualGroupListEl.innerHTML = '<div class="data-empty" style="padding:8px;">暂无手动分组。点击上方"新建分组"创建。</div>';
            return;
        }
        this.manualGroups.forEach((g) => {
            // 统计属于该分组的运行数
            const count = [...this.sessionData, ...this.savedRuns]
                .filter(r => r.manualGroupId === g.id).length;
            const item = document.createElement('div');
            item.className = 'manual-group-item';
            item.innerHTML = `
                <input type="text" class="settings-input" value="${this.escapeAttr(g.name)}" data-act="rename-group" data-gid="${this.escapeAttr(g.id)}" maxlength="32" style="flex:1 1 auto;padding:4px 8px;font-size:0.85em;">
                <span class="manual-group-count">${count} 条</span>
                <button class="data-action-btn is-danger" data-act="delete-group" data-gid="${this.escapeAttr(g.id)}" style="padding:2px 8px;font-size:0.78em;">删除</button>
            `;
            this.manualGroupListEl.appendChild(item);
        });

        // 恢复焦点和光标
        if (focusedGid) {
            requestAnimationFrame(() => {
                const inp = this.manualGroupListEl.querySelector(`input[data-gid="${focusedGid}"]`);
                if (inp) {
                    inp.focus();
                    try {
                        if (selStart != null) inp.setSelectionRange(selStart, selEnd || selStart);
                    } catch (e) { /* ignore */ }
                }
            });
        }
    }

    // 局部更新每个手动分组的运行数（不重建 input，避免丢失焦点）
    updateManualGroupCounts() {
        if (!this.manualGroupListEl) return;
        this.manualGroupListEl.querySelectorAll('.manual-group-item').forEach(item => {
            const inp = item.querySelector('input[data-act="rename-group"]');
            if (!inp) return;
            const gid = inp.dataset.gid;
            const count = [...this.sessionData, ...this.savedRuns]
                .filter(r => r.manualGroupId === gid).length;
            const counter = item.querySelector('.manual-group-count');
            if (counter) counter.textContent = count + ' 条';
        });
    }

    // 创建手动分组
    createManualGroup(name) {
        const n = (name || '').trim();
        if (!n) { alert('请输入分组名'); return; }
        if (this.manualGroups.some(g => g.name === n)) { alert('已存在同名分组'); return; }
        this.manualGroups.push({ id: 'g_' + Date.now() + '_' + Math.floor(Math.random() * 1e6), name: n });
        this.persistManualGroups();
        this.renderDataPage();
    }

    renameManualGroup(id, newName) {
        const n = (newName || '').trim();
        if (!n) return;
        const g = this.manualGroups.find(x => x.id === id);
        if (!g) return;
        if (g.name === n) return; // 未变
        g.name = n;
        // 不调用 renderDataPage 以避免重建正在编辑的 input 及其同级元素
        // 仅持久化数据：其他位置（分组卡 / select option）会在下次 renderDataPage 自动同步
        this.persistManualGroups();
        // 局部更新：所有 group card 中引用此 id 的标题 + select 中的 option
        const escId = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(id) : String(id).replace(/"/g, '\\"');
        document.querySelectorAll(`[data-group-name-id="${escId}"]`).forEach(el => {
            el.textContent = n;
        });
        document.querySelectorAll(`select.assign-group-select option[value="${escId}"]`).forEach(opt => {
            opt.textContent = n;
        });
    }

    deleteManualGroup(id) {
        this.manualGroups = this.manualGroups.filter(x => x.id !== id);
        // 把属于该分组的运行标记为未分组
        [...this.sessionData, ...this.savedRuns].forEach(r => {
            if (r.manualGroupId === id) r.manualGroupId = null;
        });
        this.persistManualGroups();
        this.renderDataPage();
    }

    escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
    escapeAttr(s) { return this.escapeHtml(s); }

    // 启动时 + 每次保存/导出后增量刷新历史
    async saveOneUnsaved(idx) {
        if (idx < 0 || idx >= this.sessionData.length) return;
        if (!window.electronAPI || !window.electronAPI.saveData) return;
        this._log('saveOneUnsaved:enter', { idx });
        try {
            const run = this.sessionData[idx];
            const savedPath = await this.ipcSaveData({ data: run });
            // 保存成功后从 sessionData 移除（数据已落到磁盘）
            this.sessionData.splice(idx, 1);
            this.unsavedCount = this.sessionData.length;
            if (this.sessionRunCountEl) this.sessionRunCountEl.textContent = String(this.sessionData.length);
            // 立即把刚保存的 run 加入 savedRuns（不依赖重读磁盘，避免 listHistory 缓存/读文件失败导致数据看不到）
            if (savedPath) {
                const fileName = savedPath.split(/[\\/]/).pop();
                run.__source = 'saved';
                run.__fileName = fileName;
                run.__filePath = savedPath;
                this.savedRuns.push(run);
            }
            // 再异步重读磁盘，补齐可能漏掉的文件（不影响当前保存的可见性）
            this.loadHistoryFromDefaultPath().catch(e => console.warn('刷新历史失败：', e));
            this.updateDirtyHint();
            this.refreshDataView();   // 保险：强制重渲染（顶部计数 + 列表）
            return savedPath;
        } catch (e) {
            console.error('保存运行失败:', e);
            alert('保存失败: ' + e.message);
        }
    }

    // 一键保存：把所有未保存的运行分别保存为独立文件
    async saveAllUnsaved() {
        if (this.sessionData.length === 0) {
            alert('当前没有未保存的运行数据。');
            return;
        }
        if (!window.electronAPI || !window.electronAPI.saveData) {
            alert('当前环境不支持文件保存。');
            return;
        }
        const total = this.sessionData.length;
        const ok = await this.confirm({
            type: 'info',
            title: '一键保存',
            message: `即将把 ${total} 条未保存运行保存为磁盘文件。`,
            detail: '文件将保存到默认路径下。',
            buttons: ['保存', '取消'],
            defaultId: 0,
            cancelId: 1
        });
        if (ok !== 0) return;

        let success = 0, fail = 0;
        const toSave = [...this.sessionData];
        this._log('saveAllUnsaved:enter', { count: toSave.length });
        for (const run of toSave) {
            try {
                const savedPath = await this.ipcSaveData({ data: run });
                run.__saved = true;
                run.__savedPath = savedPath;
                run.__source = 'saved';
                run.__fileName = savedPath ? savedPath.split(/[\\/]/).pop() : '';
                success++;
            } catch (e) {
                console.error('保存失败:', e);
                fail++;
            }
        }
        // 关键：保存完成后，把这些 run 从 sessionData 中移除（已是磁盘文件，sessionData 不再视为"未保存"）
        // 保留时仅保留"未成功保存"的
        this.sessionData = this.sessionData.filter(r => !r.__saved);
        this.unsavedCount = this.sessionData.length;
        if (this.sessionRunCountEl) this.sessionRunCountEl.textContent = String(this.sessionData.length);
        // 立即把刚保存的 run 加入 savedRuns（不依赖重读磁盘）
        for (const r of toSave) {
            if (r.__saved && r.__savedPath) this.savedRuns.push(r);
        }
        this.loadHistoryFromDefaultPath().catch(e => console.warn('刷新历史失败：', e));
        this.updateDirtyHint();
        this.refreshDataView();   // 保险：强制重渲染（顶部计数 + 列表）
        if (success > 0) {
            alert(`已保存 ${success} 条${fail > 0 ? `，失败 ${fail} 条` : ''}。`);
        } else if (fail > 0) {
            alert(`全部 ${fail} 条保存失败，请查看控制台日志。`);
        }
    }

    // dirty 提示：有未保存条目 → 顶部出现"⚠ 一键保存"；反之隐藏
    updateDirtyHint() {
        const has = (this.unsavedCount || 0) > 0;
        if (this.dirtyHintEl) {
            try {
                if (has) this.dirtyHintEl.removeAttribute('hidden');
                else this.dirtyHintEl.setAttribute('hidden', '');
            } catch (_) { /* 测试 mock 无 setAttribute 时降级到 hidden 字段 */ }
            if (typeof this.dirtyHintEl.hidden === 'boolean') this.dirtyHintEl.hidden = !has;
        }
    }

    async exportOneUnsaved(idx) {
        if (idx < 0 || idx >= this.sessionData.length) return;
        // 单独导出：直接对该条运行生成 CSV
        const run = this.sessionData[idx];
        const singleCSV = this.generateCSVFor([run]);
        await this.exportDataWithContent(singleCSV);
    }

    deleteOneUnsaved(idx) {
        if (idx < 0 || idx >= this.sessionData.length) return;
        this.sessionData.splice(idx, 1);
        if (this.unsavedCount > 0) this.unsavedCount--;
        if (this.sessionRunCountEl) this.sessionRunCountEl.textContent = String(this.sessionData.length);
        this.renderDataPage();
    }

    async deleteHistoryFile(filePath) {
        if (!window.electronAPI || !window.electronAPI.deleteFile) return;
        const ok = await this.confirm({
            type: 'warning',
            title: '删除历史文件',
            message: '确定要删除此历史文件吗？',
            detail: filePath,
            buttons: ['删除', '取消'],
            defaultId: 1,
            cancelId: 1
        });
        if (ok !== 0) return;
        try {
            await this.ipcDeleteFile(filePath);
            // 关键：磁盘已删，立即从内存中过滤掉对应 run，
            // 否则 merge 模式会把 stale 引用保留下来，"已删除"文件又显示在 UI 上
            this.savedRuns = this.savedRuns.filter(r => r.__filePath !== filePath);
            // 再异步重读磁盘补齐（保险）
            this.loadHistoryFromDefaultPath().catch(e => console.warn('刷新历史失败：', e));
            this.updateDirtyHint();
            this.refreshDataView();
        } catch (e) {
            console.error('删除失败:', e);
            alert('删除失败: ' + e.message);
        }
    }

    // 查看历史文件内全部 run 摘要
    async viewHistoryFileContent(fileName) {
        if (!window.electronAPI || !window.electronAPI.readFile) return;
        const item = (this.historyItems || []).find(x => x.name === fileName);
        if (!item) return;
        this._log('viewHistory:enter', { fileName, filePath: item.filePath });
        try {
            const content = await this.ipcReadFile(item.filePath);
            let parsed;
            try { parsed = JSON.parse(content); } catch { parsed = null; }
            const runs = (parsed && Array.isArray(parsed.runs)) ? parsed.runs
                       : (parsed && parsed.algorithm) ? [parsed]  // 单条 run 文件
                       : [];
            this.openFileDataModal(item.name, runs, item.filePath);
        } catch (e) {
            console.error('读取文件失败:', e);
            alert('读取失败: ' + e.message);
        }
    }

    // 打开文件数据可视化模态框
    openFileDataModal(fileName, runs, filePath) {
        const modal = document.getElementById('fileDataModal');
        const titleEl = document.getElementById('fileDataTitle');
        const bodyEl = document.getElementById('fileDataBody');
        if (!modal || !titleEl || !bodyEl) return;

        titleEl.textContent = fileName;
        bodyEl.innerHTML = '';

        if (!runs || runs.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'fd-table-empty';
            empty.textContent = '此文件没有可显示的运行数据。';
            bodyEl.appendChild(empty);
            modal.setAttribute('aria-hidden', 'false');
            return;
        }

        // 摘要卡片
        const totalCmps = runs.reduce((s, r) => s + (r.totalComparisons || 0), 0);
        const totalSwaps = runs.reduce((s, r) => s + (r.totalSwaps || 0), 0);
        const totalElapsed = runs.reduce((s, r) => s + (r.elapsedMs || 0), 0);
        const avgSize = runs.length ? Math.round(runs.reduce((s, r) => s + (r.arraySize || 0), 0) / runs.length) : 0;
        const algoSet = [...new Set(runs.map(r => r.algorithm || '未知'))];

        const summary = document.createElement('div');
        summary.className = 'fd-summary-grid';
        summary.innerHTML = `
            <div class="fd-summary-card">
                <div class="fd-summary-label">运行条数</div>
                <div class="fd-summary-value">${runs.length}</div>
            </div>
            <div class="fd-summary-card">
                <div class="fd-summary-label">比较次数</div>
                <div class="fd-summary-value">${totalCmps.toLocaleString()}</div>
            </div>
            <div class="fd-summary-card">
                <div class="fd-summary-label">交换次数</div>
                <div class="fd-summary-value">${totalSwaps.toLocaleString()}</div>
            </div>
            <div class="fd-summary-card">
                <div class="fd-summary-label">累计耗时</div>
                <div class="fd-summary-value">${this.formatElapsed(totalElapsed)}</div>
            </div>
            <div class="fd-summary-card">
                <div class="fd-summary-label">平均数组大小</div>
                <div class="fd-summary-value">${avgSize}</div>
            </div>
            <div class="fd-summary-card">
                <div class="fd-summary-label">涉及算法</div>
                <div class="fd-summary-value" style="font-size:0.9em;">${algoSet.length} 种</div>
            </div>
        `;
        bodyEl.appendChild(summary);

        // 柱状图：比较次数
        this.appendBarChart(bodyEl, '比较次数', runs, 'totalComparisons', 'is-comparisons');
        // 柱状图：交换次数
        this.appendBarChart(bodyEl, '交换次数', runs, 'totalSwaps', 'is-swaps');

        // 详细表格
        const tWrap = document.createElement('div');
        tWrap.style.marginTop = '12px';
        tWrap.style.maxHeight = '220px';
        tWrap.style.overflowY = 'auto';
        const table = document.createElement('table');
        table.className = 'fd-table';
        table.innerHTML = `
            <thead>
                <tr>
                    <th>#</th><th>算法</th><th>大小</th>
                    <th class="fd-num">比较</th><th class="fd-num">交换</th>
                    <th class="fd-num">耗时</th><th>开始时间</th>
                </tr>
            </thead>
            <tbody>
                ${runs.map((r, i) => {
                    const startTime = r.startTime || r.timestamp || '';
                    const startDate = startTime ? new Date(startTime).toLocaleString() : '—';
                    return `<tr>
                        <td>${i + 1}</td>
                        <td>${this.escapeHtml(this.prettyAlgoName(r.algorithm || '未知'))}</td>
                        <td>${r.arraySize || 0}</td>
                        <td class="fd-num">${(r.totalComparisons || 0).toLocaleString()}</td>
                        <td class="fd-num">${(r.totalSwaps || 0).toLocaleString()}</td>
                        <td class="fd-num">${this.formatElapsed(r.elapsedMs || 0)}</td>
                        <td>${this.escapeHtml(startDate)}</td>
                    </tr>`;
                }).join('')}
            </tbody>
        `;
        tWrap.appendChild(table);
        bodyEl.appendChild(tWrap);

        // 文件路径小字
        if (filePath) {
            const fp = document.createElement('div');
            fp.style.cssText = 'font-size:0.7em;color:#adb5bd;margin-top:8px;word-break:break-all;';
            fp.textContent = '📁 ' + filePath;
            bodyEl.appendChild(fp);
        }

        modal.setAttribute('aria-hidden', 'false');
    }

    // 柱状图渲染（纯 CSS 柱状条）
    appendBarChart(container, title, runs, field, klass) {
        const t = document.createElement('div');
        t.className = 'fd-chart-title';
        t.textContent = title;
        container.appendChild(t);
        const chart = document.createElement('div');
        chart.className = 'fd-bar-chart';
        const max = Math.max(1, ...runs.map(r => r[field] || 0));
        runs.forEach((r, i) => {
            const val = r[field] || 0;
            const pct = max > 0 ? (val / max * 100) : 0;
            const bar = document.createElement('div');
            bar.className = 'fd-bar ' + (klass || '');
            const algo = this.prettyAlgoName(r.algorithm || '未知');
            bar.innerHTML = `
                <div class="fd-bar-fill" style="height:${pct}%" data-tip="#${i + 1} ${algo}: ${val.toLocaleString()}"></div>
                <div class="fd-bar-label" title="${this.escapeAttr(algo)}">#${i + 1}</div>
            `;
            chart.appendChild(bar);
        });
        container.appendChild(chart);
    }

    // 打开任意模态框（设置 aria-hidden=false）
    openModal(modal) {
        if (!modal) return;
        modal.setAttribute('aria-hidden', 'false');
    }

    // 散点图悬浮提示（DOM 浮动 div）
    ensurePointTooltipEl() {
        if (this._ptt && document.body.contains(this._ptt)) return this._ptt;
        const div = document.createElement('div');
        div.className = 'scatter-tooltip';
        div.style.display = 'none';
        document.body.appendChild(div);
        this._ptt = div;
        return div;
    }
    showPointTooltip(text, x, y, anchorEl) {
        const tip = this.ensurePointTooltipEl();
        tip.textContent = text;
        // 转换为屏幕坐标
        const rect = anchorEl.getBoundingClientRect();
        const tx = rect.left + window.scrollX;
        const ty = rect.top + window.scrollY - 10;
        tip.style.left = (tx + 10) + 'px';
        tip.style.top = (ty - tip.offsetHeight - 8) + 'px';
        tip.style.display = 'block';
    }
    hidePointTooltip() {
        if (this._ptt) this._ptt.style.display = 'none';
    }

    // 跳转到指定 run 在数据页中的 row
    jumpToRunRow(run) {
        // 关闭可能打开的模态框
        document.querySelectorAll('.modal[aria-hidden="false"]').forEach(m => m.setAttribute('aria-hidden', 'true'));
        const algoKey = String(run.algorithm || '');
        // 找到对应 group（algo:xxx），展开并滚动到对应 row
        const group = this.classifyContainer && this.classifyContainer.querySelector(`[data-group-body="algo:${this.escapeAttr(algoKey)}"]`);
        if (!group) return;
        // 展开 body
        group.removeAttribute('hidden');
        const toggleBtn = group.previousElementSibling && group.previousElementSibling.querySelector('.classify-group-toggle');
        if (toggleBtn) toggleBtn.textContent = '▾';
        // 查找对应 row：通过 data-key="history#fileName"
        const fileName = run.__fileName || '';
        const row = group.querySelector(`.classify-data-row button[data-act="view-content"][data-key="history#${this.escapeAttr(fileName)}"]`)?.closest('.classify-data-row');
        if (row) {
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            row.classList.add('is-flash');
            setTimeout(() => row.classList.remove('is-flash'), 1600);
        }
    }

    // 查看单条 run 详情
    viewSingleRun(fileName, btn) {
        // 通过 DOM 找到所在 row 标题并解析算法/索引，然后从 savedRuns 取真实 run
        const row = btn.closest('.classify-data-row');
        if (!row) return;
        const titleEl = row.querySelector('.data-row-title');
        const metaEl = row.querySelector('.data-row-meta');
        const titleText = titleEl ? titleEl.textContent : '';
        const metaText = metaEl ? metaEl.textContent : '';
        // 从 savedRuns 找同 fileName 且 algorithm 匹配的第一条
        const algoId = this.algoIdFromTitle(titleText);
        const run = (this.savedRuns || []).find(r => r.__fileName === fileName && (algoId ? r.algorithm === algoId : true));
        if (!run) {
            // 回退：原 alert
            alert('📊 运行详情\n\n' + titleText + '\n' + metaText);
            return;
        }
        this.openRunDetailModal(run, fileName);
    }

    // 从行标题解析 algorithm id，例如 "sorting_xxx.json · #1/1 · insertion" → insertion
    algoIdFromTitle(title) {
        const m = /\u00b7\s*([a-zA-Z][\w-]*)\s*$/.exec(title);
        return m ? m[1] : '';
    }

    // 打开单条运行详情模态框
    openRunDetailModal(run, fileName) {
        const modal = document.getElementById('runDetailModal');
        const title = document.getElementById('runDetailTitle');
        const body = document.getElementById('runDetailBody');
        if (!modal || !body) return;
        const algoName = this.prettyAlgoName(run.algorithm || '');
        const startTime = run.startTime || run.timestamp || '';
        const startDate = startTime ? new Date(startTime).toLocaleString() : '—';
        // 顶部大标题
        title.textContent = `${algoName} · ${startDate}`;
        // 中部键值对统计
        const arrSize = run.arraySize || 0;
        const cmps = run.totalComparisons || 0;
        const swaps = run.totalSwaps || 0;
        const elapsed = run.elapsedMs || 0;
        const ops = cmps + swaps;
        const stepNs = ops > 0 ? (elapsed * 1e6) / ops : 0;
        const stepStr = (() => {
            if (ops <= 0) return '— /步';
            if (stepNs >= 1e9) return `${(stepNs / 1e9).toFixed(2)} s/步`;
            if (stepNs >= 1e6) return `${(stepNs / 1e6).toFixed(2)} ms/步`;
            if (stepNs >= 1e3) return `${(stepNs / 1e3).toFixed(2)} μs/步`;
            return `${stepNs.toFixed(1)} ns/步`;
        })();
        const stable = run.isStable != null ? (run.isStable ? '是' : '否') : (run.stable != null ? (run.stable ? '是' : '否') : '—');
        const mode = run.mode || (run.stepMode ? 'step' : 'auto');
        const rows = [
            ['📁 源文件',  this.escapeHtml(fileName || '—')],
            ['#️⃣ 运行序号', String(run.__runIndex || '—')],
            ['📐 数组大小', `${arrSize.toLocaleString()} 个`],
            ['🔁 比较次数', `${cmps.toLocaleString()} 次`],
            ['⇄ 交换次数', `${swaps.toLocaleString()} 次`],
            ['⏱ 总耗时',   this.formatElapsed(elapsed), 'highlight'],
            ['⚡ 平均每步耗时', stepStr],
            ['⚙️ 运行模式', mode === 'step' ? '单步' : '自动'],
            ['🔒 稳定性', stable],
            ['🕐 开始时间', this.escapeHtml(startDate)]
        ];
        const kvHtml = rows.map(r => {
            const label = r[0];
            const value = r[1];
            const cls = r[2] === 'highlight' ? ' run-kv-highlight' : '';
            return `<div class="run-kv${cls}"><span class="run-kv-label">${label}</span><span class="run-kv-value">${value}</span></div>`;
        }).join('');
        // 模态框内图表：与所属 group 同尺度，并高亮当前 run 所在位置
        // 柱状图模式：高亮当前 run 所在的 bin；散点图模式：高亮当前 run 的点
        const group = this.findGroupForRun(run);
        const charts = [];
        if (group && group.items && group.items.length > 1) {
            const chartBuilder = this.chartType === 'scatter' ? this.buildScatterSVG : this.buildIntervalBarChart;
            charts.push(chartBuilder.call(this, 'N 与比较次数', group.items, 'arraySize', 'totalComparisons', '#2f9e44'));
            charts.push(chartBuilder.call(this, 'N 与交换次数', group.items, 'arraySize', 'totalSwaps', '#fa5252'));
            charts.push(chartBuilder.call(this, 'N 与耗时 (ms)', group.items, 'arraySize', 'elapsedMs', '#1971c2'));
            // 渲染完后给"当前 run 所在位置"描金边
            setTimeout(() => {
                const sizeVal = Number(run.arraySize) || 0;
                if (this.chartType === 'bar') {
                    // 取该 size 所在的分桶；svg 里可能渲染了更多桶，所以用首个 svg 的 rect 数兜底
                    const firstSvg = modal.querySelector('.algo-bar-svg');
                    const totalBins = firstSvg ? firstSvg.querySelectorAll('.algo-bar-rect').length : 11;
                    const highlightBin = Math.min(Math.max(0, totalBins - 1), Math.floor(sizeVal / 10));
                    modal.querySelectorAll('.algo-bar-svg').forEach(svg => {
                        const rect = svg.querySelector(`.algo-bar-rect[data-bin-index="${highlightBin}"]`);
                        if (rect) {
                            rect.setAttribute('stroke', '#ffc107');
                            rect.setAttribute('stroke-width', '2');
                        }
                    });
                } else {
                    // 散点图：定位 (arraySize, yField) 相同的点
                    modal.querySelectorAll('.algo-scatter-svg-only').forEach(svg => {
                        svg.querySelectorAll('circle.algo-scatter-point').forEach(c => {
                            if (Number(c.getAttribute('data-x')) === sizeVal) {
                                c.setAttribute('stroke', '#ffc107');
                                c.setAttribute('stroke-width', '2');
                                c.setAttribute('r', '5');
                            }
                        });
                    });
                }
            }, 0);
        }
        // 渲染：DOM 节点直接 append，保留事件
        body.innerHTML = `
            <div class="run-detail-hero">
                <div class="run-detail-algorithm">${this.escapeHtml(algoName)}</div>
                <div class="run-detail-time">${this.escapeHtml(startDate)}</div>
            </div>
            <div class="run-detail-kv">${kvHtml}</div>
        `;
        if (charts.length > 0) {
            const section = document.createElement('div');
            section.className = 'run-detail-section';
            const title = document.createElement('div');
            title.className = 'run-detail-section-title';
            title.textContent = `📈 在「${group.name}」分组中的位置`;
            section.appendChild(title);
            const wrap = document.createElement('div');
            wrap.className = 'algo-scatter-wrap';
            charts.forEach(c => wrap.appendChild(c));
            section.appendChild(wrap);
            body.appendChild(section);
        }
        this.openModal(modal);
    }

    // 找到 run 所属的 group
    findGroupForRun(run) {
        const groups = this.classifyContainer ? this.classifyContainer.querySelectorAll('.classify-group') : [];
        for (const card of groups) {
            const id = card.querySelector('[data-group-body]')?.getAttribute('data-group-body');
            if (!id) continue;
            // 用全局 group 列表：自动模式 = 按算法
            const algoKey = String(run.algorithm || '');
            if (id === 'algo:' + algoKey) {
                const items = (this.savedRuns || []).filter(r => r.algorithm === algoKey);
                return { id, name: this.prettyAlgoName(algoKey), items };
            }
        }
        // 回退：直接按算法聚合
        const algoKey = String(run.algorithm || '');
        const items = (this.savedRuns || []).filter(r => r.algorithm === algoKey);
        if (items.length > 0) return { id: 'algo:' + algoKey, name: this.prettyAlgoName(algoKey), items };
        return null;
    }

    // 删除单条历史 run（实际是删除整个文件）
    async deleteSingleHistoryFile(fileName) {
        const item = (this.historyItems || []).find(x => x.name === fileName);
        if (!item) return;
        const ok = await this.confirm({
            type: 'warning',
            title: '删除历史文件',
            message: `确定要删除文件 ${fileName} 吗？文件中所有运行都会丢失。`,
            detail: item.filePath,
            buttons: ['删除', '取消'],
            defaultId: 1,
            cancelId: 1
        });
        if (ok !== 0) return;
        try {
            await this.ipcDeleteFile(item.filePath);
            // 关键：先从 savedRuns 过滤掉同文件路径的 run，避免 stale 残留
            this.savedRuns = this.savedRuns.filter(r => r.__filePath !== item.filePath);
            this.loadHistoryFromDefaultPath().catch(e => console.warn('刷新历史失败：', e));
            this.updateDirtyHint();
            this.refreshDataView();
        } catch (e) {
            console.error('删除失败:', e);
            alert('删除失败: ' + e.message);
        }
    }

    async readHistoryFile(filePath) {
        if (!window.electronAPI || !window.electronAPI.readFile) return;
        this._log('readHistoryFile:enter', { filePath });
        try {
            const content = await this.ipcReadFile(filePath);
            // 简化：弹窗显示前 2000 字符
            alert(`📄 ${filePath}\n\n${String(content).slice(0, 2000)}${String(content).length > 2000 ? '\n\n…(截断显示)' : ''}`);
        } catch (e) {
            console.error('读取失败:', e);
            alert('读取失败: ' + e.message);
        }
    }

    // 为单条或多条运行生成 CSV
    generateCSVFor(runs) {
        const oldData = this.sessionData;
        this.sessionData = runs;
        const csv = this.generateCSV();
        this.sessionData = oldData;
        return csv;
    }

    async exportDataWithContent(csvContent) {
        this._log('exportDataWithContent:enter', {
            csvLength: csvContent ? csvContent.length : 0,
            defaultExportPath: this.appSettings.defaultExportPath,
            defaultSavePath: this.appSettings.defaultSavePath
        });
        try {
            let filePath = null;
            // 询问保存路径
            if (window.electronAPI && window.electronAPI.chooseSaveFile) {
                const dir = this.appSettings.defaultExportPath || this.appSettings.defaultSavePath || '';
                const sep = (dir && /[\\/]$/.test(dir)) ? '' : (dir ? '/' : '');
                const defaultPath = (dir ? dir + sep : '') + `sorting_stats_${Date.now()}.csv`;
                filePath = await this.ipcChooseSaveFile({
                    title: '导出 CSV',
                    defaultPath,
                    filters: [{ name: 'CSV', extensions: ['csv'] }]
                });
            }
            if (filePath && window.electronAPI && window.electronAPI.exportCSV) {
                await this.ipcExportCSV({ csvData: csvContent, filePath });
                alert('已导出: ' + filePath);
            } else if (window.electronAPI && window.electronAPI.exportCSV) {
                // 用户取消：用默认路径
                const saved = await this.ipcExportCSV({ csvData: csvContent });
                alert('已导出到默认路径: ' + saved);
            } else {
                this.downloadCSV(csvContent, `sorting_stats_${Date.now()}.csv`);
            }
        } catch (e) {
            console.error('导出失败:', e);
            alert('导出失败: ' + e.message);
        }
    }

    // ==================== 保存/导出（含询问） ====================
    async saveData() {
        // 询问：是否有数据
        if (this.sessionData.length === 0) {
            alert('当前会话内尚无运行数据。');
            return;
        }
        // 询问：是否保存
        const ask = await this.confirm({
            type: 'info',
            title: '保存数据',
            message: `当前会话共有 ${this.sessionData.length} 条运行记录，${this.unsavedCount} 条未保存。`,
            detail: '点击"保存"将弹出文件选择对话框。',
            buttons: ['保存', '取消'],
            defaultId: 0,
            cancelId: 1
        });
        if (ask !== 0) return;

        // 询问：保存路径
        const defaultDir = this.appSettings.defaultSavePath || '';
        const filePath = await this.pickSaveFilePath({
            title: '保存数据',
            defaultDir,
            defaultName: `session_${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
            filters: [{ name: 'JSON', extensions: ['json'] }]
        });
        if (!filePath) return;

        const sessionData = {
            version: '1.1.2',
            exportedAt: new Date().toISOString(),
            runs: this.sessionData
        };
        this._log('saveData:enter', {
            filePath,
            runs: this.sessionData.length,
            unsavedCount: this.unsavedCount
        });
        try {
            let savedPath;
            if (window.electronAPI && window.electronAPI.saveData) {
                savedPath = await this.ipcSaveData({ data: sessionData, filePath });
            } else {
                this.downloadFile(JSON.stringify(sessionData, null, 2), 'sorting_session.json', 'application/json');
                savedPath = 'sorting_session.json';
            }
            // 标记已保存，并清空 sessionData（已落到磁盘，sessionData 不再视为"未保存"）
            this.sessionData.forEach(r => r.savedToDisk = true);
            this.sessionData = [];
            this.unsavedCount = 0;
            if (this.sessionRunCountEl) this.sessionRunCountEl.textContent = '0';
            await this.loadHistoryFromDefaultPath();
            this.updateDirtyHint();
            alert(`数据已保存到:\n${savedPath}`);
        } catch (e) {
            console.error('保存数据失败:', e);
            alert('保存数据失败: ' + e.message);
        }
    }

    async exportData() {
        if (this.sessionData.length === 0) {
            alert('当前会话内尚无运行数据，无法导出。');
            return;
        }
        // 询问：是否导出
        const ask = await this.confirm({
            type: 'info',
            title: '导出数据',
            message: `即将导出 ${this.sessionData.length} 条运行记录。`,
            detail: '点击"导出"将先弹出保存路径对话框。',
            buttons: ['导出', '取消'],
            defaultId: 0,
            cancelId: 1
        });
        if (ask !== 0) return;

        // 询问：导出路径
        const defaultDir = this.appSettings.defaultExportPath || this.appSettings.defaultSavePath || '';
        const filePath = await this.pickSaveFilePath({
            title: '导出 CSV',
            defaultDir,
            defaultName: `sorting_stats_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`,
            filters: [{ name: 'CSV', extensions: ['csv'] }]
        });
        if (!filePath) return;

        try {
            const csvContent = this.generateCSV();
            let savedPath;
            if (window.electronAPI && window.electronAPI.exportCSV) {
                savedPath = await this.ipcExportCSV({ csvData: csvContent, filePath });
            } else {
                this.downloadCSV(csvContent, 'sorting_stats.csv');
                savedPath = 'sorting_stats.csv';
            }
            alert(`数据已导出到:\n${savedPath}`);
        } catch (e) {
            console.error('导出数据失败:', e);
            alert('导出数据失败: ' + e.message);
        }
    }

    async pickSaveFilePath({ title, defaultDir, defaultName, filters }) {
        if (window.electronAPI && window.electronAPI.chooseSaveFile) {
            // 用 / 作为默认分隔符；操作系统都会接受；Electron 会按系统规范化
            const sep = (defaultDir && /[\\/]$/.test(defaultDir)) ? '' : (defaultDir ? '/' : '');
            const defaultPath = (defaultDir ? defaultDir + sep : '') + (defaultName || 'untitled');
            return await window.electronAPI.chooseSaveFile({ title, defaultPath, filters });
        }
        // 浏览器环境：使用 <a download>，无法选目录——直接下载
        return null;
    }

    async confirm(opts) {
        if (window.electronAPI && window.electronAPI.confirmDialog) {
            return await window.electronAPI.confirmDialog(opts);
        }
        // 浏览器降级
        const buttons = (opts && opts.buttons) || ['确定', '取消'];
        const text = (opts && opts.message) + ((opts && opts.detail) ? '\n\n' + opts.detail : '');
        return window.confirm(text) ? 0 : 1;
    }

    generateCSV() {
        const headers = [
            '算法代码', '算法名称', '数组大小', '模式',
            '比较次数', '交换次数', '排序计时(ms)', '总耗时(ms)',
            '开始时间', '结束时间'
        ];
        const rows = this.sessionData.map(session => {
            const totalMs = typeof session.duration === 'number'
                ? session.duration
                : (session.endTime ? new Date(session.endTime) - new Date(session.startTime) : '');
            return [
                session.algorithm || '',
                session.algorithmLabel || session.algorithm || '',
                session.arraySize,
                session.mode || 'auto',
                session.totalComparisons != null ? session.totalComparisons : (session.comparisons || 0),
                session.totalSwaps != null ? session.totalSwaps : (session.swaps || 0),
                session.elapsedMs != null ? session.elapsedMs : 0,
                totalMs,
                session.startTime,
                session.endTime || ''
            ].map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',');
        });

        return [headers.join(','), ...rows].join('\n');
    }
    
    // 浏览器降级路径（无 electronAPI 时）的 CSV 下载：
    // 用 UTF-8 + BOM 写出。MIME 声明 utf-8；BOM 让 Excel 记事本按 UTF-8 识别，
    // 避免误标 GBK 导致乱码。在 Electron 环境中，导出走 main.js 的 iconv-lite GBK 路径。
    downloadCSV(csvContent, filename) {
        const BOM = '\uFEFF';
        const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);

        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
    
    downloadFile(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
    
    sleep() {
        // 三种等待：
        //   1. isSorting=false → 立即 reject（被重置/停止，让协程立即冒泡到 startSorting 的 catch）
        //   2. isPaused=true  → 50ms 轮询等待（暂停中）
        //   3. 正常 → 等满 speed 才放行
        //
        // 单步推进机制：
        //   当 stepRequested=true 时，当前 sleep 放行后立刻把 isPaused 置回 true，
        //   相当于"放行一帧"——算法会从当前 sleep 边界推进到下一个 sleep 边界。
        //
        // 关键：reset 期间 isSorting=false 时 sleep 必须 reject 而不是 resolve，
        // 这样协程在 await sleep() 后不会继续执行交换/renderBars 等副作用，
        // 避免污染已恢复的 this.array；异常会冒泡到 startSorting 的 catch/finally。
        return new Promise((resolve, reject) => {
            const start = Date.now();
            const tick = () => {
                if (!this.isSorting) {
                    reject(new Error('sorting-stopped'));
                    return;
                }
                if (this.isPaused) {
                    setTimeout(tick, 50);
                    return;
                }
                // 单步请求：放行本次 sleep，然后立即重新进入暂停
                if (this.stepRequested) {
                    this.stepRequested = false;
                    this.isPaused = true;
                    // 通知外部"单步已完成"——主要用于将来扩展
                    resolve();
                    return;
                }
                const elapsed = Date.now() - start;
                const remaining = this.speed - elapsed;
                if (remaining <= 0) {
                    resolve();
                } else {
                    setTimeout(tick, Math.min(remaining, 50));
                }
            };
            tick();
        });
    }
    
    initializeResizeHandler() {
        document.body.style.overflowX = 'hidden';
        window.addEventListener('resize', () => {
            this.renderBars();
        });
    }

    // ==================== 排序计时（考虑单步模式） ====================
    // 计时规则：
    //   - 自动播放中：每 100ms 累加 elapsedMs 一次
    //   - 暂停 / 单步等待中：停止累加
    //   - 单步推进放行那一帧：继续累加（视为有效工作时间）
    startElapsedTimer() {
        this.stopElapsedTimer();
        this.updateElapsedState('running');
        // 用 100ms 间隔打点累加，避免长会话下精度漂移
        this.elapsedTimerId = setInterval(() => {
            if (!this.isSorting) { this.stopElapsedTimer(); return; }
            if (this.isPaused) return; // 单步等待 / 暂停时不计
            this.elapsedMs += 100;
            this.updateElapsedDisplay();
        }, 100);
    }

    stopElapsedTimer() {
        if (this.elapsedTimerId) {
            clearInterval(this.elapsedTimerId);
            this.elapsedTimerId = null;
        }
        this.updateElapsedState('idle');
    }

    updateElapsedDisplay() {
        if (!this.elapsedTimeEl) return;
        const totalMs = Math.max(0, Math.floor(this.elapsedMs));
        const sec = totalMs / 1000;
        if (sec < 60) {
            this.elapsedTimeEl.textContent = sec.toFixed(1) + 's';
        } else {
            const m = Math.floor(sec / 60);
            const s = (sec - m * 60);
            this.elapsedTimeEl.textContent = `${m}m ${s.toFixed(1)}s`;
        }
    }

    updateElapsedState(kind) {
        if (!this.elapsedStatItem) return;
        this.elapsedStatItem.classList.remove('is-running', 'is-paused');
        if (kind === 'running') this.elapsedStatItem.classList.add('is-running');
        else if (kind === 'paused') this.elapsedStatItem.classList.add('is-paused');
    }

    // ==================== 退出/卸载守卫 ====================
    // 关闭拦截已完全在主进程内完成（main.js 的 close 事件），不再通过 IPC 询问渲染端，
    // 避免 IPC 竞态导致"卡住"现象。
    // 这里仅保留浏览器刷新/导航场景的 beforeunload 提示。
    attachWindowUnloadGuard() {
        window.addEventListener('beforeunload', (e) => {
            if (this.unsavedCount > 0) {
                e.preventDefault();
                e.returnValue = `当前会话还有 ${this.unsavedCount} 条未保存的运行数据，确定要离开吗？`;
                return e.returnValue;
            }
        });
    }
    
    getSidebarWidth() {
        const sidebar = document.querySelector('.sidebar');
        if (sidebar) {
            const computedStyle = window.getComputedStyle(sidebar);
            return sidebar.offsetWidth + 
                   parseInt(computedStyle.marginLeft) + 
                   parseInt(computedStyle.marginRight);
        }
        return 380;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const visualizer = new SortingVisualizer();
    
    if (window.appLogger) {
        window.appLogger.info('排序算法可视化应用已启动');
    }
});