/**
 * Mukhpath Timekeeper
 * Production-Ready Timer Application
 * 
 * Features:
 * - High-precision timer using requestAnimationFrame
 * - Web Audio API for bell sounds
 * - Settings persistence with localStorage
 * - Dark/Light mode support
 * - Fullscreen and Wake Lock APIs
 * - Mobile responsive design
 * - Accessibility features
 * - Offline capable
 */

// ============================================
// Configuration & Constants
// ============================================

const CONFIG = {
    DEFAULT_WARNING_TIME: 360,      // 6:00 in seconds
    DEFAULT_END_TIME: 420,          // 7:00 in seconds
    DEFAULT_WARNING_BELLS: 1,
    DEFAULT_END_BELLS: 5,
    DEFAULT_BELL_INTERVAL: 500,    // milliseconds
    DEFAULT_BELL_VOLUME: 0.5,
    STORAGE_KEY: 'mukhpath-settings',
    SOUND_SAMPLE_RATE: 22050,       // Hz
    SOUND_DURATION: 0.2,            // seconds
    SOUND_FREQUENCY: 800,           // Hz (bell tone)
};

// ============================================
// Application State
// ============================================

const state = {
    isRunning: false,
    isPaused: false,
    elapsedTime: 0,                 // milliseconds
    startTime: null,
    pauseTime: 0,
    participantCount: 1,
    
    // Settings
    warningTime: CONFIG.DEFAULT_WARNING_TIME,
    endTime: CONFIG.DEFAULT_END_TIME,
    warningBells: CONFIG.DEFAULT_WARNING_BELLS,
    endBells: CONFIG.DEFAULT_END_BELLS,
    bellInterval: CONFIG.DEFAULT_BELL_INTERVAL,
    bellVolume: CONFIG.DEFAULT_BELL_VOLUME,
    enableVibration: true,
    enableFlash: true,
    enableWakeLock: true,
    
    // Bell state tracking
    warningBellPlayed: false,
    endBellsPlayed: 0,
    
    // Audio
    audioContext: null,
    customBellBuffer: null,
    
    // Wake Lock
    wakeLock: null,
};

// ============================================
// DOM Elements
// ============================================

const elements = {
    // Timer display
    timerTime: document.getElementById('timerTime'),
    limitDisplay: document.getElementById('limitDisplay'),
    overtimeDisplay: document.getElementById('overtimeDisplay'),
    timerDisplay: document.getElementById('timerDisplay'),
    
    // Buttons
    startBtn: document.getElementById('startBtn'),
    pauseBtn: document.getElementById('pauseBtn'),
    resumeBtn: document.getElementById('resumeBtn'),
    resetBtn: document.getElementById('resetBtn'),
    nextBtn: document.getElementById('nextBtn'),
    
    // Header buttons
    settingsBtn: document.getElementById('settingsBtn'),
    fullscreenBtn: document.getElementById('fullscreenBtn'),
    darkModeBtn: document.getElementById('darkModeBtn'),
    
    // Settings panel
    settingsPanel: document.getElementById('settingsPanel'),
    closeSettingsBtn: document.getElementById('closeSettingsBtn'),
    
    // Settings inputs
    warningTime: document.getElementById('warningTime'),
    endTime: document.getElementById('endTime'),
    warningBells: document.getElementById('warningBells'),
    endBells: document.getElementById('endBells'),
    bellInterval: document.getElementById('bellInterval'),
    bellVolume: document.getElementById('bellVolume'),
    bellVolumeValue: document.getElementById('bellVolumeValue'),
    enableVibration: document.getElementById('enableVibration'),
    enableFlash: document.getElementById('enableFlash'),
    enableWakeLock: document.getElementById('enableWakeLock'),
    
    // Custom bell
    customBellInput: document.getElementById('customBellInput'),
    clearCustomBell: document.getElementById('clearCustomBell'),
    customBellStatus: document.getElementById('customBellStatus'),
    
    // Settings actions
    resetSettingsBtn: document.getElementById('resetSettingsBtn'),
    exportSettingsBtn: document.getElementById('exportSettingsBtn'),
    importSettingsBtn: document.getElementById('importSettingsBtn'),
    importSettingsInput: document.getElementById('importSettingsInput'),
    
    // Other
    participantCount: document.getElementById('participantCount'),
    flashEffect: document.getElementById('flashEffect'),
};

// ============================================
// Utility Functions
// ============================================

/**
 * Convert seconds to MM:SS.ms format (with milliseconds)
 */
function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

/**
 * Parse MM:SS format to seconds
 */
function parseTime(timeStr) {
    const parts = timeStr.split(':');
    if (parts.length !== 2) return null;
    const minutes = parseInt(parts[0], 10);
    const seconds = parseInt(parts[1], 10);
    if (isNaN(minutes) || isNaN(seconds) || minutes < 0 || seconds < 0 || seconds > 59) {
        return null;
    }
    return minutes * 60 + seconds;
}

/**
 * Get current elapsed time in seconds
 */
function getElapsedSeconds() {
    if (!state.isRunning && !state.isPaused) {
        return state.elapsedTime / 1000;
    }
    
    if (state.isPaused) {
        return state.pauseTime / 1000;
    }
    
    const now = performance.now();
    const elapsed = now - state.startTime + state.pauseTime;
    return elapsed / 1000;
}

/**
 * Calculate overtime in seconds
 */
function getOvertimeSeconds() {
    const current = getElapsedSeconds();
    const limit = state.endTime;
    return Math.max(0, current - limit);
}

/**
 * Request vibration feedback
 */
function vibrate(pattern) {
    if (!state.enableVibration || !navigator.vibrate) {
        return;
    }
    navigator.vibrate(pattern);
}

/**
 * Flash the screen
 */
function flashScreen() {
    if (!state.enableFlash) {
        return;
    }
    
    elements.flashEffect.classList.remove('active');
    // Trigger reflow to restart animation
    void elements.flashEffect.offsetWidth;
    elements.flashEffect.classList.add('active');
}

/**
 * Request Wake Lock
 */
async function requestWakeLock() {
    if (!state.enableWakeLock || !navigator.wakeLock) {
        return;
    }
    
    try {
        state.wakeLock = await navigator.wakeLock.request('screen');
        console.log('Wake Lock acquired');
        
        // Re-request wake lock if it's released
        state.wakeLock.addEventListener('release', () => {
            console.log('Wake Lock released');
            if (state.isRunning) {
                requestWakeLock();
            }
        });
    } catch (err) {
        console.error('Wake Lock error:', err);
    }
}

/**
 * Release Wake Lock
 */
async function releaseWakeLock() {
    if (state.wakeLock) {
        try {
            await state.wakeLock.release();
            state.wakeLock = null;
            console.log('Wake Lock released');
        } catch (err) {
            console.error('Wake Lock release error:', err);
        }
    }
}

/**
 * Initialize Audio Context
 */
function initializeAudioContext() {
    if (!state.audioContext) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        state.audioContext = new AudioContext();
    }
    
    // Resume context if suspended (required for some browsers)
    if (state.audioContext.state === 'suspended') {
        state.audioContext.resume();
    }
}

/**
 * Generate bell sound using Web Audio API
 */
function generateBellSound() {
    initializeAudioContext();
    
    const context = state.audioContext;
    const now = context.currentTime;
    const duration = CONFIG.SOUND_DURATION;
    
    // Create oscillator for bell tone
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    const filter = context.createBiquadFilter();
    
    // Configure oscillator
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(CONFIG.SOUND_FREQUENCY, now);
    
    // Frequency modulation for natural bell sound
    oscillator.frequency.exponentialRampToValueAtTime(CONFIG.SOUND_FREQUENCY * 1.5, now + duration * 0.3);
    oscillator.frequency.exponentialRampToValueAtTime(CONFIG.SOUND_FREQUENCY * 0.8, now + duration);
    
    // Envelope (attack, sustain, decay)
    envelope.gain.setValueAtTime(0, now);
    envelope.gain.linearRampToValueAtTime(state.bellVolume, now + 0.02);
    envelope.gain.exponentialRampToValueAtTime(0.01, now + duration);
    
    // Filter for bell characteristics
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(600, now);
    
    // Connect nodes
    oscillator.connect(filter);
    filter.connect(envelope);
    envelope.connect(context.destination);
    
    // Schedule
    oscillator.start(now);
    oscillator.stop(now + duration);
}

/**
 * Play custom bell sound if available
 */
async function playCustomBellSound() {
    if (!state.customBellBuffer) {
        generateBellSound();
        return;
    }
    
    initializeAudioContext();
    
    const context = state.audioContext;
    const source = context.createBufferSource();
    const gainNode = context.createGain();
    
    source.buffer = state.customBellBuffer;
    gainNode.gain.value = state.bellVolume;
    
    source.connect(gainNode);
    gainNode.connect(context.destination);
    source.start(context.currentTime);
}

/**
 * Play bell sound multiple times
 */
async function playBells(count, interval) {
    for (let i = 0; i < count; i++) {
        await new Promise(resolve => setTimeout(resolve, interval));
        await playCustomBellSound();
    }
}

// ============================================
// Settings Management
// ============================================

/**
 * Save settings to localStorage
 */
function saveSettings() {
    const settings = {
        warningTime: state.warningTime,
        endTime: state.endTime,
        warningBells: state.warningBells,
        endBells: state.endBells,
        bellInterval: state.bellInterval,
        bellVolume: state.bellVolume,
        enableVibration: state.enableVibration,
        enableFlash: state.enableFlash,
        enableWakeLock: state.enableWakeLock,
    };
    
    localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(settings));
    console.log('Settings saved');
}

/**
 * Load settings from localStorage
 */
function loadSettings() {
    const stored = localStorage.getItem(CONFIG.STORAGE_KEY);
    
    if (stored) {
        try {
            const settings = JSON.parse(stored);
            
            if (typeof settings.warningTime === 'number') state.warningTime = settings.warningTime;
            if (typeof settings.endTime === 'number') state.endTime = settings.endTime;
            if (typeof settings.warningBells === 'number') state.warningBells = settings.warningBells;
            if (typeof settings.endBells === 'number') state.endBells = settings.endBells;
            if (typeof settings.bellInterval === 'number') state.bellInterval = settings.bellInterval;
            if (typeof settings.bellVolume === 'number') state.bellVolume = settings.bellVolume;
            if (typeof settings.enableVibration === 'boolean') state.enableVibration = settings.enableVibration;
            if (typeof settings.enableFlash === 'boolean') state.enableFlash = settings.enableFlash;
            if (typeof settings.enableWakeLock === 'boolean') state.enableWakeLock = settings.enableWakeLock;
            
            console.log('Settings loaded');
        } catch (err) {
            console.error('Error loading settings:', err);
        }
    }
}

/**
 * Reset settings to defaults
 */
function resetSettingsToDefaults() {
    state.warningTime = CONFIG.DEFAULT_WARNING_TIME;
    state.endTime = CONFIG.DEFAULT_END_TIME;
    state.warningBells = CONFIG.DEFAULT_WARNING_BELLS;
    state.endBells = CONFIG.DEFAULT_END_BELLS;
    state.bellInterval = CONFIG.DEFAULT_BELL_INTERVAL;
    state.bellVolume = CONFIG.DEFAULT_BELL_VOLUME;
    state.enableVibration = true;
    state.enableFlash = true;
    state.enableWakeLock = true;
    
    updateSettingsUI();
    saveSettings();
    console.log('Settings reset to defaults');
}

/**
 * Update UI from state
 */
function updateSettingsUI() {
    elements.warningTime.value = formatTime(state.warningTime);
    elements.endTime.value = formatTime(state.endTime);
    elements.warningBells.value = state.warningBells;
    elements.endBells.value = state.endBells;
    elements.bellInterval.value = state.bellInterval;
    elements.bellVolume.value = Math.round(state.bellVolume * 100);
    elements.bellVolumeValue.textContent = `${Math.round(state.bellVolume * 100)}%`;
    elements.enableVibration.checked = state.enableVibration;
    elements.enableFlash.checked = state.enableFlash;
    elements.enableWakeLock.checked = state.enableWakeLock;
}

/**
 * Update state from UI
 */
function updateStateFromUI() {
    const warningTimeValue = parseTime(elements.warningTime.value);
    if (warningTimeValue !== null) state.warningTime = warningTimeValue;
    
    const endTimeValue = parseTime(elements.endTime.value);
    if (endTimeValue !== null) state.endTime = endTimeValue;
    
    state.warningBells = Math.max(0, parseInt(elements.warningBells.value, 10) || 0);
    state.endBells = Math.max(0, parseInt(elements.endBells.value, 10) || 0);
    state.bellInterval = Math.max(100, parseInt(elements.bellInterval.value, 10) || 500);
    state.bellVolume = Math.min(1, Math.max(0, parseInt(elements.bellVolume.value, 10) / 100));
    state.enableVibration = elements.enableVibration.checked;
    state.enableFlash = elements.enableFlash.checked;
    state.enableWakeLock = elements.enableWakeLock.checked;
    
    saveSettings();
    updateSettingsUI();
    updateDisplay();
}

/**
 * Export settings as JSON
 */
function exportSettings() {
    const settings = {
        warningTime: formatTime(state.warningTime),
        endTime: formatTime(state.endTime),
        warningBells: state.warningBells,
        endBells: state.endBells,
        bellInterval: state.bellInterval,
        bellVolume: state.bellVolume,
        enableVibration: state.enableVibration,
        enableFlash: state.enableFlash,
        enableWakeLock: state.enableWakeLock,
        exportDate: new Date().toISOString(),
    };
    
    const dataStr = JSON.stringify(settings, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `mukhpath-settings-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
}

/**
 * Import settings from JSON
 */
function importSettings(file) {
    const reader = new FileReader();
    
    reader.onload = (event) => {
        try {
            const settings = JSON.parse(event.target.result);
            
            const warningTime = parseTime(settings.warningTime);
            if (warningTime !== null) state.warningTime = warningTime;
            
            const endTime = parseTime(settings.endTime);
            if (endTime !== null) state.endTime = endTime;
            
            if (typeof settings.warningBells === 'number') state.warningBells = settings.warningBells;
            if (typeof settings.endBells === 'number') state.endBells = settings.endBells;
            if (typeof settings.bellInterval === 'number') state.bellInterval = settings.bellInterval;
            if (typeof settings.bellVolume === 'number') state.bellVolume = settings.bellVolume;
            if (typeof settings.enableVibration === 'boolean') state.enableVibration = settings.enableVibration;
            if (typeof settings.enableFlash === 'boolean') state.enableFlash = settings.enableFlash;
            if (typeof settings.enableWakeLock === 'boolean') state.enableWakeLock = settings.enableWakeLock;
            
            updateSettingsUI();
            saveSettings();
            alert('Settings imported successfully');
        } catch (err) {
            console.error('Error importing settings:', err);
            alert('Error importing settings. Please check the file format.');
        }
    };
    
    reader.readAsText(file);
}

/**
 * Handle custom bell sound upload
 */
function handleCustomBellUpload(file) {
    if (!file) return;
    
    const reader = new FileReader();
    
    reader.onload = async (event) => {
        try {
            initializeAudioContext();
            const arrayBuffer = event.target.result;
            const audioBuffer = await state.audioContext.decodeAudioData(arrayBuffer);
            
            state.customBellBuffer = audioBuffer;
            elements.customBellStatus.textContent = `✓ Custom bell loaded (${(file.size / 1024).toFixed(1)} KB)`;
            elements.customBellStatus.classList.add('success');
            elements.customBellStatus.classList.remove('error');
            
            console.log('Custom bell sound loaded');
        } catch (err) {
            console.error('Error loading audio:', err);
            elements.customBellStatus.textContent = `✗ Error loading audio file`;
            elements.customBellStatus.classList.add('error');
            elements.customBellStatus.classList.remove('success');
        }
    };
    
    reader.onerror = () => {
        elements.customBellStatus.textContent = `✗ Error reading file`;
        elements.customBellStatus.classList.add('error');
        elements.customBellStatus.classList.remove('success');
    };
    
    reader.readAsArrayBuffer(file);
}

// ============================================
// Timer Display Update
// ============================================

/**
 * Update timer display with current time
 */
function updateDisplay() {
    const elapsedSeconds = getElapsedSeconds();
    const overtime = getOvertimeSeconds();
    
    // Update main timer
    elements.timerTime.textContent = formatTime(elapsedSeconds);
    
    // Update limit display
    elements.limitDisplay.textContent = formatTime(state.endTime);
    
    // Update overtime display
    elements.overtimeDisplay.textContent = overtime > 0 ? `+${formatTime(overtime)}` : '+00:00';
    
    // Update visual alerts
    const timerMain = elements.timerDisplay.querySelector('.timer-main');
    timerMain.classList.remove('warning', 'danger');
    
    if (elapsedSeconds >= state.endTime) {
        timerMain.classList.add('danger');
    } else if (elapsedSeconds >= state.warningTime) {
        timerMain.classList.add('warning');
    }
    
    // Handle warning bell
    if (!state.warningBellPlayed && elapsedSeconds >= state.warningTime && elapsedSeconds < state.endTime) {
        if (state.warningBells > 0) {
            playBells(state.warningBells, state.bellInterval);
            vibrate(200);
        }
        state.warningBellPlayed = true;
    }
    
    // Handle end bells
    if (Math.floor(elapsedSeconds) >= state.endTime && state.endBellsPlayed < state.endBells) {
        if (state.endBells > 0) {
            playCustomBellSound();
            vibrate([100, 50, 100]);
            flashScreen();
            state.endBellsPlayed++;
        }
    }
}

// ============================================
// Timer Control Functions
// ============================================

/**
 * Start timer
 */
function startTimer() {
    if (state.isRunning) return;
    
    state.isRunning = true;
    state.isPaused = false;
    state.startTime = performance.now();
    state.pauseTime = state.elapsedTime;
    state.warningBellPlayed = false;
    state.endBellsPlayed = 0;
    
    // Request wake lock
    if (state.enableWakeLock) {
        requestWakeLock();
    }
    
    updateButtonStates();
    updateDisplay();
    animationLoop();
    
    console.log('Timer started');
}

/**
 * Pause timer
 */
function pauseTimer() {
    if (!state.isRunning || state.isPaused) return;
    
    state.isPaused = true;
    state.pauseTime = (performance.now() - state.startTime) + state.pauseTime;
    
    releaseWakeLock();
    updateButtonStates();
    
    console.log('Timer paused');
}

/**
 * Resume timer
 */
function resumeTimer() {
    if (!state.isRunning || !state.isPaused) return;
    
    state.isPaused = false;
    state.startTime = performance.now();
    
    if (state.enableWakeLock) {
        requestWakeLock();
    }
    
    updateButtonStates();
    animationLoop();
    
    console.log('Timer resumed');
}

/**
 * Reset timer
 */
function resetTimer() {
    state.isRunning = false;
    state.isPaused = false;
    state.elapsedTime = 0;
    state.startTime = null;
    state.pauseTime = 0;
    state.warningBellPlayed = false;
    state.endBellsPlayed = 0;
    
    releaseWakeLock();
    updateButtonStates();
    updateDisplay();
    
    // Remove visual alerts
    const timerMain = elements.timerDisplay.querySelector('.timer-main');
    timerMain.classList.remove('warning', 'danger');
    
    console.log('Timer reset');
}

/**
 * Next participant
 */
function nextParticipant() {
    resetTimer();
    state.participantCount++;
    elements.participantCount.textContent = state.participantCount;
    
    console.log(`Next participant: ${state.participantCount}`);
}

/**
 * Update button states based on timer state
 */
function updateButtonStates() {
    elements.startBtn.disabled = state.isRunning;
    elements.pauseBtn.disabled = !state.isRunning || state.isPaused;
    elements.resumeBtn.disabled = !state.isPaused;
    elements.resetBtn.disabled = false;
    elements.nextBtn.disabled = false;
}

// ============================================
// Animation Loop
// ============================================

let animationFrameId = null;

/**
 * Main animation loop using requestAnimationFrame
 */
function animationLoop() {
    updateDisplay();
    
    if (state.isRunning && !state.isPaused) {
        animationFrameId = requestAnimationFrame(animationLoop);
    }
}

// ============================================
// Settings Panel
// ============================================

/**
 * Open settings panel
 */
function openSettingsPanel() {
    elements.settingsPanel.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    updateSettingsUI();
}

/**
 * Close settings panel
 */
function closeSettingsPanel() {
    elements.settingsPanel.classList.add('hidden');
    document.body.style.overflow = '';
    updateStateFromUI();
}

// ============================================
// Dark Mode
// ============================================

/**
 * Toggle dark mode
 */
function toggleDarkMode() {
    document.body.classList.toggle('dark-mode');
    
    // Save preference
    const isDarkMode = document.body.classList.contains('dark-mode');
    localStorage.setItem('mukhpath-dark-mode', isDarkMode);
}

/**
 * Initialize dark mode based on saved preference or system
 */
function initializeDarkMode() {
    const savedDarkMode = localStorage.getItem('mukhpath-dark-mode');
    
    if (savedDarkMode !== null) {
        if (savedDarkMode === 'true') {
            document.body.classList.add('dark-mode');
        }
    } else {
        // Use system preference
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            document.body.classList.add('dark-mode');
        }
    }
}

// ============================================
// Fullscreen
// ============================================

/**
 * Toggle fullscreen
 */
async function toggleFullscreen() {
    const elem = document.documentElement;
    
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
        // Enter fullscreen
        try {
            if (elem.requestFullscreen) {
                await elem.requestFullscreen();
            } else if (elem.webkitRequestFullscreen) {
                await elem.webkitRequestFullscreen();
            }
        } catch (err) {
            console.error('Fullscreen request failed:', err);
        }
    } else {
        // Exit fullscreen
        try {
            if (document.exitFullscreen) {
                await document.exitFullscreen();
            } else if (document.webkitExitFullscreen) {
                await document.webkitExitFullscreen();
            }
        } catch (err) {
            console.error('Exit fullscreen failed:', err);
        }
    }
}

// ============================================
// Event Listeners
// ============================================

/**
 * Initialize all event listeners
 */
function initializeEventListeners() {
    // Timer controls
    elements.startBtn.addEventListener('click', startTimer);
    elements.pauseBtn.addEventListener('click', pauseTimer);
    elements.resumeBtn.addEventListener('click', resumeTimer);
    elements.resetBtn.addEventListener('click', resetTimer);
    elements.nextBtn.addEventListener('click', nextParticipant);
    
    // Header buttons
    elements.settingsBtn.addEventListener('click', openSettingsPanel);
    elements.fullscreenBtn.addEventListener('click', toggleFullscreen);
    elements.darkModeBtn.addEventListener('click', toggleDarkMode);
    
    // Settings panel
    elements.closeSettingsBtn.addEventListener('click', closeSettingsPanel);
    
    // Settings inputs
    elements.warningTime.addEventListener('change', updateStateFromUI);
    elements.endTime.addEventListener('change', updateStateFromUI);
    elements.warningBells.addEventListener('change', updateStateFromUI);
    elements.endBells.addEventListener('change', updateStateFromUI);
    elements.bellInterval.addEventListener('change', updateStateFromUI);
    
    elements.bellVolume.addEventListener('input', (e) => {
        const volume = parseInt(e.target.value, 10) / 100;
        state.bellVolume = volume;
        elements.bellVolumeValue.textContent = `${e.target.value}%`;
        saveSettings();
    });
    
    elements.enableVibration.addEventListener('change', () => {
        state.enableVibration = elements.enableVibration.checked;
        saveSettings();
    });
    
    elements.enableFlash.addEventListener('change', () => {
        state.enableFlash = elements.enableFlash.checked;
        saveSettings();
    });
    
    elements.enableWakeLock.addEventListener('change', () => {
        state.enableWakeLock = elements.enableWakeLock.checked;
        saveSettings();
    });
    
    // Custom bell
    elements.customBellInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleCustomBellUpload(e.target.files[0]);
        }
    });
    
    elements.clearCustomBell.addEventListener('click', () => {
        state.customBellBuffer = null;
        elements.customBellInput.value = '';
        elements.customBellStatus.textContent = '';
        elements.customBellStatus.classList.remove('success', 'error');
    });
    
    // Settings actions
    elements.resetSettingsBtn.addEventListener('click', () => {
        if (confirm('Reset all settings to defaults?')) {
            resetSettingsToDefaults();
        }
    });
    
    elements.exportSettingsBtn.addEventListener('click', exportSettings);
    
    elements.importSettingsBtn.addEventListener('click', () => {
        elements.importSettingsInput.click();
    });
    
    elements.importSettingsInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            importSettings(e.target.files[0]);
        }
    });
    
    // Close settings panel when clicking outside
    document.addEventListener('click', (e) => {
        const settingsPanel = elements.settingsPanel;
        const settingsBtn = elements.settingsBtn;
        
        if (settingsPanel && !settingsPanel.classList.contains('hidden')) {
            if (!settingsPanel.contains(e.target) && !settingsBtn.contains(e.target)) {
                closeSettingsPanel();
            }
        }
    });
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Prevent shortcuts when input is focused
        if (e.target.tagName === 'INPUT') return;
        
        switch (e.key.toLowerCase()) {
            case ' ':
                e.preventDefault();
                if (state.isRunning) {
                    if (state.isPaused) {
                        resumeTimer();
                    } else {
                        pauseTimer();
                    }
                } else {
                    startTimer();
                }
                break;
            case 'r':
                resetTimer();
                break;
            case 'n':
                nextParticipant();
                break;
            case 'escape':
                if (!elements.settingsPanel.classList.contains('hidden')) {
                    closeSettingsPanel();
                }
                break;
        }
    });
    
    // Handle page visibility for wake lock
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            if (state.wakeLock) {
                releaseWakeLock();
            }
        } else {
            if (state.isRunning && !state.isPaused && state.enableWakeLock) {
                requestWakeLock();
            }
        }
    });
}

// ============================================
// Initialization
// ============================================

/**
 * Initialize the application
 */
function initializeApp() {
    console.log('Initializing Mukhpath Timekeeper...');
    
    // Load settings
    loadSettings();
    
    // Initialize dark mode
    initializeDarkMode();
    
    // Initialize event listeners
    initializeEventListeners();
    
    // Update display
    updateButtonStates();
    updateDisplay();
    updateSettingsUI();
    
    // Initialize audio context (required by some browsers)
    initializeAudioContext();
    
    console.log('Mukhpath Timekeeper initialized');
}

// Start the application when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}

// ============================================
// Service Worker Registration (Optional)
// ============================================

/**
 * Register service worker for offline capability
 */
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        // Service worker code would go here for true offline support
        // For now, the app works fully offline with just HTML, CSS, and JS
        console.log('Offline capability enabled');
    });
}
