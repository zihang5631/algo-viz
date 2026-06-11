class SortingVisualizer {
    constructor() {
        this.array = [];
        this.arraySize = 30;
        this.speed = 100;
        this.currentAlgorithm = 'bubble';
        this.isSorting = false;
        this.sortingComplete = false;
        this.comparisons = 0;
        this.swaps = 0;
        this.sortSteps = [];
        this.currentStep = 0;
        this.sessionData = [];
        
        this.initializeElements();
        this.generateRandomArray();
        this.attachEventListeners();
        this.renderBars();
        this.initializeDesktopFeatures();
        this.initializeResizeHandler();
    }
    
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
        
        this.exportDataBtn = document.getElementById('exportData');
        this.saveSessionBtn = document.getElementById('saveSession');
        this.appInfoBtn = document.getElementById('appInfo');
    }
    
    generateRandomArray() {
        this.array = [];
        for (let i = 0; i < this.arraySize; i++) {
            this.array.push(Math.floor(Math.random() * 95) + 5);
        }
        this.resetStats();
        this.renderBars();
    }
    
    resetStats() {
        this.comparisons = 0;
        this.swaps = 0;
        this.sortingComplete = false;
        this.isSorting = false;
        this.sortSteps = [];
        this.currentStep = 0;
        this.updateStats();
    }
    
    updateStats() {
        this.comparisonsEl.textContent = this.comparisons;
        this.swapsEl.textContent = this.swaps;
        this.arraySizeDisplay.textContent = this.arraySize;
    }
    
    renderBars() {
        this.barsContainer.innerHTML = '';
        const maxHeight = Math.max(...this.array);
        
        this.array.forEach((value, index) => {
            const bar = document.createElement('div');
            bar.className = 'bar';
            bar.style.height = `${(value / maxHeight) * 100}%`;
            
            if (this.sortingComplete) {
                bar.classList.add('sorted');
            }
            
            const valueLabel = document.createElement('div');
            valueLabel.className = 'bar-label';
            valueLabel.textContent = value;
            
            bar.appendChild(valueLabel);
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
        document.getElementById('generateArray').addEventListener('click', () => {
            if (!this.isSorting) {
                this.generateRandomArray();
            }
        });
        
        document.getElementById('startSort').addEventListener('click', () => {
            if (!this.isSorting && !this.sortingComplete) {
                this.startSorting();
            }
        });
        
        document.getElementById('reset').addEventListener('click', () => {
            this.isSorting = false;
            this.generateRandomArray();
        });
        
        document.getElementById('stepSort').addEventListener('click', () => {
            if (!this.isSorting && !this.sortingComplete) {
                this.stepSort();
            }
        });
        
        this.arraySizeSlider.addEventListener('input', (e) => {
            this.arraySize = parseInt(e.target.value);
            this.sizeValue.textContent = this.arraySize;
            if (!this.isSorting) {
                this.generateRandomArray();
            }
        });
        
        this.sortSpeedSlider.addEventListener('input', (e) => {
            this.speed = parseInt(e.target.value);
            this.speedValue.textContent = this.speed;
        });
        
        document.querySelectorAll('.algo-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                if (this.isSorting) return;
                
                document.querySelectorAll('.algo-btn').forEach(b => b.classList.remove('active'));
                const targetBtn = e.target.closest('.algo-btn');
                targetBtn.classList.add('active');
                this.currentAlgorithm = targetBtn.dataset.algorithm;
                this.currentAlgorithmEl.textContent = targetBtn.querySelector('.algo-name').textContent;
                this.updateComplexityTable();
            });
        });
    }
    
    async startSorting() {
        this.isSorting = true;
        this.recordSessionStart();
        
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
        
        this.isSorting = false;
        this.sortingComplete = true;
        this.updateBarColors([], [], Array.from({length: this.array.length}, (_, i) => i));
        this.recordSessionEnd();
    }
    
    stepSort() {
        if (this.sortSteps.length === 0) {
            this.prepareSortSteps();
        }
        
        if (this.currentStep < this.sortSteps.length) {
            const step = this.sortSteps[this.currentStep];
            this.array = step.array;
            this.comparisons = step.comparisons;
            this.swaps = step.swaps;
            this.updateStats();
            this.renderBars();
            this.updateBarColors(step.activeIndices, step.comparingIndices, step.sortedIndices);
            this.currentStep++;
        } else {
            this.sortingComplete = true;
            this.updateBarColors([], [], Array.from({length: this.array.length}, (_, i) => i));
        }
    }
    
    prepareSortSteps() {
        this.sortSteps = [];
        const arrayCopy = [...this.array];
        
        switch (this.currentAlgorithm) {
            case 'bubble':
                this.bubbleSortSteps(arrayCopy);
                break;
            case 'selection':
                this.selectionSortSteps(arrayCopy);
                break;
        }
    }
    
    bubbleSortSteps(array) {
        let steps = [];
        let n = array.length;
        let comparisons = 0;
        let swaps = 0;
        
        for (let i = 0; i < n - 1; i++) {
            for (let j = 0; j < n - i - 1; j++) {
                comparisons++;
                steps.push({
                    array: [...array],
                    comparisons: comparisons,
                    swaps: swaps,
                    activeIndices: [j],
                    comparingIndices: [j + 1],
                    sortedIndices: Array.from({length: i}, (_, k) => n - 1 - k)
                });
                
                if (array[j] > array[j + 1]) {
                    swaps++;
                    [array[j], array[j + 1]] = [array[j + 1], array[j]];
                    steps.push({
                        array: [...array],
                        comparisons: comparisons,
                        swaps: swaps,
                        activeIndices: [j, j + 1],
                        comparingIndices: [],
                        sortedIndices: Array.from({length: i}, (_, k) => n - 1 - k)
                    });
                }
            }
        }
        
        this.sortSteps = steps;
    }
    
    async bubbleSort() {
        let n = this.array.length;
        
        for (let i = 0; i < n - 1; i++) {
            for (let j = 0; j < n - i - 1; j++) {
                if (!this.isSorting) return;
                
                this.comparisons++;
                this.updateBarColors([j], [j + 1], Array.from({length: i}, (_, k) => n - 1 - k));
                await this.sleep();
                
                if (this.array[j] > this.array[j + 1]) {
                    this.swaps++;
                    [this.array[j], this.array[j + 1]] = [this.array[j + 1], this.array[j]];
                    this.renderBars();
                    this.updateBarColors([j, j + 1], [], Array.from({length: i}, (_, k) => n - 1 - k));
                    await this.sleep();
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
                
                this.swaps++;
                this.array[j + 1] = this.array[j];
                j = j - 1;
                
                this.renderBars();
                this.updateBarColors([j + 1], [], Array.from({length: i}, (_, k) => k));
                await this.sleep();
            }
            
            this.array[j + 1] = key;
            this.renderBars();
            this.updateBarColors([j + 1], [], Array.from({length: i + 1}, (_, k) => k));
            await this.sleep();
            
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
                i++;
            } else {
                this.array[k] = R[j];
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
            i++;
            k++;
            
            this.renderBars();
            this.updateBarColors([k - 1], [], Array.from({length: l}, (_, idx) => idx));
            await this.sleep();
        }
        
        while (j < n2) {
            this.array[k] = R[j];
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
                this.comparisons++;
                this.updateBarColors([i], [i - gap], []);
                await this.sleep();
                while (j >= gap && this.array[j - gap] > temp) {
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
        let max = Math.max(...this.array);
        let min = Math.min(...this.array);
        let range = max - min + 1;
        let count = new Array(range).fill(0);
        let output = new Array(n);
        for (let i = 0; i < n; i++) {
            if (!this.isSorting) return;
            count[this.array[i] - min]++;
            this.updateBarColors([i], [], []);
            await this.sleep();
        }
        for (let i = 1; i < range; i++) count[i] += count[i - 1];
        for (let i = n - 1; i >= 0; i--) {
            if (!this.isSorting) return;
            output[count[this.array[i] - min] - 1] = this.array[i];
            count[this.array[i] - min]--;
        }
        for (let i = 0; i < n; i++) {
            if (!this.isSorting) return;
            this.array[i] = output[i];
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
            buckets[b].sort((a, b) => a - b);
            for (let v of buckets[b]) {
                if (!this.isSorting) return;
                this.array[k++] = v;
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
            if (piles[minIdx].length === 0) piles.splice(minIdx, 1);
            this.renderBars();
            this.updateBarColors([k - 1], [], []);
            await this.sleep();
        }
    }
    
    async librarySort() {
        let n = this.array.length;
        if (n === 0) return;
        let gap = Math.max(1, Math.floor(Math.sqrt(n)));
        let sorted = new Array(n * 2).fill(null);
        sorted[0] = this.array[0];
        let sortedLen = 1;
        for (let i = 1; i < n; i++) {
            if (!this.isSorting) return;
            let pos = this.binarySearchInsert(sorted, sortedLen, this.array[i]);
            let insertPos = pos * gap;
            for (let j = sortedLen * gap; j > insertPos; j--) {
                sorted[j] = sorted[j - gap];
            }
            sorted[insertPos] = this.array[i];
            sortedLen++;
            this.comparisons++;
            this.updateBarColors([i], [], []);
            await this.sleep();
        }
        let k = 0;
        for (let i = 0; i < sorted.length && k < n; i++) {
            if (sorted[i] !== null) {
                this.array[k++] = sorted[i];
                this.renderBars();
                this.updateBarColors([k - 1], [], []);
                await this.sleep();
            }
        }
    }
    
    binarySearchInsert(arr, len, target) {
        let lo = 0, hi = len;
        while (lo < hi) {
            let mid = (lo + hi) >> 1;
            if (arr[mid] === undefined || arr[mid] > target) hi = mid;
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
            let block = this.array.slice(i, i + blockSize).sort((a, b) => a - b);
            blocks.push({ values: block, startIdx: i });
        }
        let result = [];
        while (blocks.some(b => b.values.length > 0)) {
            if (!this.isSorting) return;
            let minVal = Infinity, minBlock = -1;
            for (let b = 0; b < blocks.length; b++) {
                if (blocks[b].values.length > 0 && blocks[b].values[0] < minVal) {
                    minVal = blocks[b].values[0];
                    minBlock = b;
                }
            }
            if (minBlock >= 0) {
                result.push(blocks[minBlock].values.shift());
                this.comparisons++;
            }
        }
        for (let i = 0; i < n; i++) {
            if (!this.isSorting) return;
            this.array[i] = result[i];
            this.renderBars();
            this.updateBarColors([i], [], []);
            await this.sleep();
        }
    }
    
    async smoothSort() {
        let n = this.array.length;
        let lp = [1, 1];
        for (let i = 2; i < 32; i++) lp.push(lp[i - 1] + lp[i - 2] + 1);
        let head = 0;
        for (let i = 0; i < n; i++) {
            if (!this.isSorting) return;
            if (lp[head + 1] < i + 1) head++;
            if (head > 0) {
                this.sift(i, lp[head], head);
            }
            this.updateBarColors([i], [], []);
            await this.sleep();
        }
        for (let i = n - 1; i >= 1; i--) {
            if (!this.isSorting) return;
            if (lp[head - 1] >= i - 1) head--;
            let t = i - lp[head] - 1;
            this.swaps++;
            [this.array[t], this.array[i]] = [this.array[i], this.array[t]];
            this.renderBars();
            this.updateBarColors([t, i], [], []);
            await this.sleep();
            this.semitrinkle(i - 1, lp[head], head);
        }
    }
    
    sift(i, p, head) {
        let c = this.leonardo(p, head);
        while (c < p && i - c >= 0) {
            if (this.array[i - c] < this.array[i]) {
                this.swaps++;
                [this.array[i], this.array[i - c]] = [this.array[i - c], this.array[i]];
            }
            i -= c;
            c = this.leonardo(p, head);
        }
    }
    
    semitrinkle(i, p, head) {
        let c = this.leonardo(p, head);
        while (c < p) {
            if (this.array[i] < this.array[i - c]) {
                this.swaps++;
                [this.array[i], this.array[i - c]] = [this.array[i - c], this.array[i]];
            }
            c = this.leonardo(p, head);
        }
    }
    
    leonardo(p, head) {
        return [1, 1, 3, 5, 9, 15, 25, 41, 67, 109, 177, 287, 465, 753, 1219, 1973][head] || 0;
    }
    
    async tournamentSort() {
        let n = this.array.length;
        if (n === 0) return;
        let tree = new Array(2 * n - 1).fill(null);
        for (let i = 0; i < n; i++) tree[n - 1 + i] = { val: this.array[i], idx: i };
        for (let i = n - 2; i >= 0; i--) {
            let l = tree[2 * i + 1], r = tree[2 * i + 2];
            tree[i] = (l && r) ? (l.val <= r.val ? l : r) : (l || r);
        }
        for (let k = 0; k < n; k++) {
            if (!this.isSorting) return;
            let winner = tree[0];
            if (!winner) break;
            this.array[k] = winner.val;
            this.renderBars();
            this.updateBarColors([k], [winner.idx], []);
            await this.sleep();
            let pos = n - 1 + winner.idx;
            tree[pos] = null;
            while (pos > 0) {
                pos = Math.floor((pos - 1) / 2);
                let l = tree[2 * pos + 1], r = tree[2 * pos + 2];
                tree[pos] = (l && r) ? (l.val <= r.val ? l : r) : (l || r);
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
            if (L[i] <= R[j]) { this.array[k] = L[i++]; }
            else { this.array[k] = R[j++]; }
            this.renderBars();
            this.updateBarColors([k], [], []);
            await this.sleep();
            k++;
        }
        while (i < n1) { this.array[k++] = L[i++]; this.renderBars(); await this.sleep(); }
        while (j < n2) { this.array[k++] = R[j++]; this.renderBars(); await this.sleep(); }
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
        
        if (this.saveSessionBtn) {
            this.saveSessionBtn.addEventListener('click', () => this.saveSession());
        }
        
        if (this.appInfoBtn) {
            this.appInfoBtn.addEventListener('click', () => this.showAppInfo());
        }
    }
    
    async exportData() {
        try {
            const csvContent = this.generateCSV();
            if (window.electronAPI) {
                const filePath = await window.electronAPI.exportCSV(csvContent);
                alert(`数据已导出到: ${filePath}`);
            } else {
                this.downloadCSV(csvContent, 'sorting_stats.csv');
            }
        } catch (error) {
            console.error('导出数据失败:', error);
            alert('导出数据失败: ' + error.message);
        }
    }
    
    async saveSession() {
        try {
            const sessionData = {
                timestamp: new Date().toISOString(),
                algorithm: this.currentAlgorithm,
                arraySize: this.arraySize,
                array: [...this.array],
                comparisons: this.comparisons,
                swaps: this.swaps,
                isSorting: this.isSorting,
                sortingComplete: this.sortingComplete
            };
            
            this.sessionData.push(sessionData);
            
            if (window.electronAPI) {
                const filePath = await window.electronAPI.saveData(sessionData);
                alert(`会话已保存到: ${filePath}`);
            } else {
                const dataStr = JSON.stringify(sessionData, null, 2);
                this.downloadFile(dataStr, 'sorting_session.json', 'application/json');
            }
        } catch (error) {
            console.error('保存会话失败:', error);
            alert('保存会话失败: ' + error.message);
        }
    }
    
    async showAppInfo() {
        try {
            if (window.electronAPI) {
                const appInfo = await window.electronAPI.getAppInfo();
                alert(
                    `应用信息:\n` +
                    `名称: ${appInfo.name}\n` +
                    `版本: ${appInfo.version}\n` +
                    `平台: ${appInfo.platform}\n` +
                    `用户: ${navigator.userAgent.split(' ')[0]}`
                );
            } else {
                alert(
                    `应用信息:\n` +
                    `名称: 排序算法可视化测试\n` +
                    `版本: 1.0.0 (Web版)\n` +
                    `用户代理: ${navigator.userAgent}`
                );
            }
        } catch (error) {
            console.error('获取应用信息失败:', error);
        }
    }
    
    recordSessionStart() {
        this.currentSession = {
            startTime: new Date().toISOString(),
            algorithm: this.currentAlgorithm,
            arraySize: this.arraySize,
            initialArray: [...this.array],
            comparisons: 0,
            swaps: 0
        };
    }
    
    recordSessionEnd() {
        if (this.currentSession) {
            this.currentSession.endTime = new Date().toISOString();
            this.currentSession.finalArray = [...this.array];
            this.currentSession.totalComparisons = this.comparisons;
            this.currentSession.totalSwaps = this.swaps;
            this.currentSession.duration = 
                new Date(this.currentSession.endTime) - new Date(this.currentSession.startTime);
            
            this.sessionData.push(this.currentSession);
        }
    }
    
    generateCSV() {
        const headers = ['算法', '数组大小', '比较次数', '交换次数', '开始时间', '结束时间', '耗时(ms)'];
        const rows = this.sessionData.map(session => [
            session.algorithm,
            session.arraySize,
            session.totalComparisons || session.comparisons,
            session.totalSwaps || session.swaps,
            session.startTime,
            session.endTime || '',
            session.duration || ''
        ].map(cell => `"${cell}"`).join(','));
        
        return [headers.join(','), ...rows].join('\n');
    }
    
    downloadCSV(csvContent, filename) {
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
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
        return new Promise(resolve => setTimeout(resolve, this.speed));
    }
    
    initializeResizeHandler() {
        document.body.style.overflowX = 'hidden';
        window.addEventListener('resize', () => {
            this.renderBars();
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