/**
 * 自作GAME STREAM DJ - v1.9.1
 * Grouping and Advanced UI
 */

// ============ STATE ============
const state = {
    mode: 'A',

    // Timer
    timerDuration: 600000,
    timerStartTime: 0,
    timerInterval: null,

    // Selection & Easy Move state
    selectedIds: new Set(),
    lastSelectedId: null,

    deckA: {
        videoId: '', currentUrl: '', p1: null, p2: null, pPreload: null, activePlayer: 1,
        ready1: false, ready2: false, readyPreload: false,
        volume: 80, trim: 1.0, trimAutoEnabled: false, loopStart: 0, loopEnd: 9999,
        queue: [],
        nextLoopQueued: false,
        switching: false,
        fadeMultiplier: 1.0,
        pendingFade: null
    },

    deckB: {
        videoId: '', currentUrl: '', p1: null, p2: null, pPreload: null, activePlayer: 1,
        ready1: false, ready2: false, readyPreload: false,
        volume: 80, trim: 1.0, trimAutoEnabled: false, loopStart: 6, loopEnd: 92,
        queue: [],
        nextLoopQueued: false,
        switching: false,
        fadeMultiplier: 1.0,
        pendingFade: null
    },

    library: [], // All saved tracks

    crossfade: 0,
    ws: null, wsConnected: false,
    clipboardWatchEnabled: false,
    pendingHotkeySwitch: false,

    settings: {
        hotkeySwitch: 'F8',
        testLoopDuration: 1.5,
        switchModeAB: 'resume',
        switchModeBA: 'resume',
        timerMinutesAB: 10,
        timerSecondsAB: 0,
        timerMinutesBA: 10,
        timerSecondsBA: 0,
        timerEnabledAB: false,
        timerEnabledBA: false,
        fadeDurationAB: 2.0,
        fadeDurationBA: 2.0,
        obsEnabledAB: false,
        obsEnabledBA: false,
        obsHost: 'localhost',
        obsPort: 4455,
        obsPassword: '',
        obsSceneA: 'Deck A',
        obsSceneB: 'Deck B',
        clipboardTargetDeck: 'library',
        clipboardWatchEnabled: false,
        playModeA: 'order',
        playModeB: 'order',
        targetRms: 0.08,
        syncTrim: false
    },

    isTestingLoop: false,
    isAnalyzing: false,
    history: [],
    redoHistory: [],

    // D&D Scroll State
    dnd: {
        activeContainer: null,
        lastY: null,
        interval: null
    },
    
    // Internal Clipboard & Hover State
    internalClipboard: [],
    lastInternalCopiedText: '',
    hoveredItem: { id: null, type: null, containerType: null },
    hoveredDeck: null,
    
    pendingPlay: false
};
const MAX_HISTORY = 30;

function snapshotState() {
    const masterVolEl = document.getElementById('master-vol');
    const volAEl = document.getElementById('vol-a');
    const volBEl = document.getElementById('vol-b');

    return JSON.stringify({
        playlists: {
            deckA: state.deckA.queue,
            deckB: state.deckB.queue,
            library: state.library
        },
        mixer: {
            crossfade: state.crossfade,
            masterVol: masterVolEl ? parseFloat(masterVolEl.value) : 100,
            volA: volAEl ? parseFloat(volAEl.value) : 5,
            volB: volBEl ? parseFloat(volBEl.value) : 5,
            trimA: state.deckA.trim,
            trimB: state.deckB.trim
        },
        deckInfo: {
            deckA: {
                videoId: state.deckA.videoId,
                currentUrl: state.deckA.currentUrl,
                title: state.deckA.title,
                loopStart: state.deckA.loopStart,
                loopEnd: state.deckA.loopEnd,
                trim: state.deckA.trim,
                restricted: state.deckA.restricted,
                trimAutoEnabled: state.deckA.trimAutoEnabled
            },
            deckB: {
                videoId: state.deckB.videoId,
                currentUrl: state.deckB.currentUrl,
                title: state.deckB.title,
                loopStart: state.deckB.loopStart,
                loopEnd: state.deckB.loopEnd,
                trim: state.deckB.trim,
                restricted: state.deckB.restricted,
                trimAutoEnabled: state.deckB.trimAutoEnabled
            }
        }
    });
}

function pushHistory() {
    if (state.history.length >= MAX_HISTORY) state.history.shift();
    state.history.push(snapshotState());
    // 新しい操作でRedoスタックをクリア
    state.redoHistory = [];
}

function undo() {
    if (state.history.length === 0) {
        showToast("Nothing to Undo");
        return;
    }
    // 現在状態をRedoスタックに保存
    state.redoHistory.push(snapshotState());

    const prevStr = state.history.pop();
    const prev = JSON.parse(prevStr);

    restoreFromSnapshot(prev);

    renderAllLists();
    saveState(false);
    showToast("Undo");
}

function redo() {
    if (state.redoHistory.length === 0) {
        showToast("Nothing to Redo");
        return;
    }
    // 現在状態をUndoスタックに保存
    state.history.push(snapshotState());

    const nextStr = state.redoHistory.pop();
    const next = JSON.parse(nextStr);

    restoreFromSnapshot(next);

    renderAllLists();
    saveState(false);
    showToast("Redo");
}

function restoreFromSnapshot(data) {
    state.deckA.queue = data.playlists.deckA;
    state.deckB.queue = data.playlists.deckB;
    state.library = data.playlists.library;

    if (data.mixer) {
        state.crossfade = data.mixer.crossfade;
        state.deckA.trim = data.mixer.trimA;
        state.deckB.trim = data.mixer.trimB;

        const masterVolEl = document.getElementById('master-vol');
        if (masterVolEl) masterVolEl.value = data.mixer.masterVol;
        
        const volAEl = document.getElementById('vol-a');
        if (volAEl) volAEl.value = data.mixer.volA;
        
        const volBEl = document.getElementById('vol-b');
        if (volBEl) volBEl.value = data.mixer.volB;

        const trimAEl = document.getElementById('trim-val-a');
        if (trimAEl) trimAEl.value = state.deckA.trim.toFixed(2);
        
        const trimBEl = document.getElementById('trim-val-b');
        if (trimBEl) trimBEl.value = state.deckB.trim.toFixed(2);

        applyMixer();
    }

    if (data.deckInfo) {
        ['deckA', 'deckB'].forEach(dkKey => {
            const kl = dkKey === 'deckA' ? 'a' : 'b';
            const sDk = state[dkKey];
            const dDk = data.deckInfo[dkKey];
            
            if (sDk.currentUrl !== dDk.currentUrl) {
                if (dDk.currentUrl) {
                    loadTrackDirect(dkKey, dDk.currentUrl, false, null, dDk);
                } else {
                    clearDeck(dkKey);
                }
            } else {
                sDk.trim = dDk.trim;
                sDk.loopStart = dDk.loopStart;
                sDk.loopEnd = dDk.loopEnd;
                sDk.trimAutoEnabled = dDk.trimAutoEnabled;
                const tEl = document.getElementById(`trim-val-${kl}`);
                if (tEl) tEl.value = sDk.trim.toFixed(2);
                
                const ind = document.getElementById(`trim-auto-${kl}`);
                if (ind) {
                    ind.classList.toggle('active', !!sDk.trimAutoEnabled);
                    if (!sDk.trimAutoEnabled) {
                        ind.textContent = 'AUTO';
                        ind.classList.remove('trim-scanning');
                    }
                }
            }
        });
    }
}

// ============ ENGINE (Loop & UI Update) ============

let engineInterval;
let enginePace = 250;

function engineTick() {
    // Deck A
    updateDeckALoopLogic();
    // Deck B
    updateDeckBLoopLogic();

    // Dynamic Engine Pace for CPU load reduction
    let nextPace = 250;

    // Check Deck A
    const aPlaying = state.deckA.ready1 && state.deckA.ready2 && 
        ((state.deckA.activePlayer === 1 && state.deckA.p1 && state.deckA.p1.getPlayerState && state.deckA.p1.getPlayerState() === YT.PlayerState.PLAYING) || 
         (state.deckA.activePlayer === 2 && state.deckA.p2 && state.deckA.p2.getPlayerState && state.deckA.p2.getPlayerState() === YT.PlayerState.PLAYING) ||
         (state.deckA.activePlayer === 3 && state.deckA.pPreload && state.deckA.pPreload.getPlayerState && state.deckA.pPreload.getPlayerState() === YT.PlayerState.PLAYING));
    if (aPlaying && state.deckA.loopEnd < 9999) {
        const activePa = state.deckA.activePlayer === 3 ? state.deckA.pPreload : (state.deckA.activePlayer === 1 ? state.deckA.p1 : state.deckA.p2);
        if (activePa && activePa.getCurrentTime) {
            const remaining = Math.max(0, state.deckA.loopEnd - activePa.getCurrentTime());
            if (remaining < 3.5) nextPace = 50;
        }
    }

    // Check Deck B
    const bPlaying = state.deckB.ready1 && state.deckB.ready2 && 
        ((state.deckB.activePlayer === 1 && state.deckB.p1 && state.deckB.p1.getPlayerState && state.deckB.p1.getPlayerState() === YT.PlayerState.PLAYING) || 
         (state.deckB.activePlayer === 2 && state.deckB.p2 && state.deckB.p2.getPlayerState && state.deckB.p2.getPlayerState() === YT.PlayerState.PLAYING) ||
         (state.deckB.activePlayer === 3 && state.deckB.pPreload && state.deckB.pPreload.getPlayerState && state.deckB.pPreload.getPlayerState() === YT.PlayerState.PLAYING));
    if (bPlaying && state.deckB.loopEnd < 9999) {
        const activePb = state.deckB.activePlayer === 3 ? state.deckB.pPreload : (state.deckB.activePlayer === 1 ? state.deckB.p1 : state.deckB.p2);
        if (activePb && activePb.getCurrentTime) {
            const remaining = Math.max(0, state.deckB.loopEnd - activePb.getCurrentTime());
            if (remaining < 3.5) nextPace = 50;
        }
    }
    
    if (enginePace !== nextPace) {
        enginePace = nextPace;
        clearInterval(engineInterval);
        engineInterval = setInterval(engineTick, enginePace);
    }
}
engineInterval = setInterval(engineTick, enginePace);

function updateDeckUI(deckKey, time, duration) {
    const tEl = document.getElementById(deckKey === 'deckA' ? 'info-a-time' : 'info-b-time');
    if (tEl) tEl.textContent = `${formatTime(time)} / ${formatTime(duration)}`;

    const seekEl = document.getElementById(deckKey === 'deckA' ? 'seek-a' : 'seek-b');
    if (document.activeElement !== seekEl && duration > 0) {
        seekEl.value = (time / duration) * 100;
        seekEl.style.backgroundSize = `${(time / duration) * 100}% 100%`;
    }
}

function updateDeckLoopLogic(deckKey) {
    const dk = state[deckKey];
    if (!dk.ready1 || !dk.ready2 || dk.switching) return;

    const activeP = dk.activePlayer === 3 ? dk.pPreload : (dk.activePlayer === 1 ? dk.p1 : dk.p2);
    const nextP = dk.activePlayer === 1 ? dk.p2 : dk.p1;

    if (!activeP || !activeP.getCurrentTime) return;
    if (activeP.getPlayerState() !== YT.PlayerState.PLAYING && !state.isTestingLoop) return;

    const currTime = activeP.getCurrentTime();
    updateDeckUI(deckKey, currTime, activeP.getDuration());

    // Only perform loop switching if loopEnd is set to a real value
    if (dk.loopEnd >= 9999) return;

    const remaining = dk.loopEnd - currTime;

    // Preload (3s before)
    if (remaining < 3 && !dk.nextLoopQueued) {
        nextP.seekTo(dk.loopStart);
        nextP.pauseVideo();
        dk.nextLoopQueued = true;
    }

    // Switch (0.1s before)
    if (remaining <= 0.1 && dk.nextLoopQueued) {
        const k = deckKey === 'deckA' ? 'a' : 'b';
        const vol = getCalculatedVolume(k);
        nextP.setVolume(vol);
        nextP.playVideo();

        dk.switching = true;
        setTimeout(() => {
            activeP.pauseVideo();
            dk.switching = false;
        }, 150);

        dk.activePlayer = dk.activePlayer === 1 ? 2 : 1;
        dk.nextLoopQueued = false;
        
        // 切り替え直後に全プレイヤーの音量を強制同期
        applyMixer();
    }
}

function updateDeckALoopLogic() {
    updateDeckLoopLogic('deckA');
}

function updateDeckBLoopLogic() {
    updateDeckLoopLogic('deckB');
}

// ============ UTILS ============

function formatTime(s) {
    if (!s || isNaN(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
}

function resetDeck(deckKey) {
    const dk = state[deckKey];
    dk.activePlayer = 1;
    dk.nextLoopQueued = false;
    dk.switching = false;

    // Stop ongoing fade and reset multiplier
    if (!dk.fadeId) dk.fadeId = 0;
    dk.fadeId++;
    dk.fadeMultiplier = 1.0;

    if (dk.p1) dk.p1.pauseVideo();
    if (dk.p2) dk.p2.pauseVideo();
    if (dk.pPreload) dk.pPreload.pauseVideo();

    applyMixer(); // Ensure volume is restored in actual players
}

function resetDeckA() {
    resetDeck('deckA');
}

function resetDeckB() {
    resetDeck('deckB');
}

// ============ UI EVENTS ============

document.addEventListener('DOMContentLoaded', () => {
    // Restore clipboard monitor state from localStorage immediately
    const cachedClipWatch = localStorage.getItem('GAME_STREAM_DJ_CLIP_WATCH');
    if (cachedClipWatch === 'true') {
        state.settings.clipboardWatchEnabled = true;
        updateClipWatchUI(true);
    }

    connectWebSocket();
    setupEventListeners();
    setupGlobalKeyboardShortcuts();

    const tag = document.createElement('script');
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
});

function setupGlobalKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // Ctrl+F for Search and Replace
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
            e.preventDefault();
            
            document.getElementById('modal-replace').classList.remove('hidden');
            const findInput = document.getElementById('replace-find');
            
            let targetTrack = null;
            if (state.hoveredDeck) {
                const deck = state[state.hoveredDeck];
                if (deck.currentUrl) {
                    targetTrack = {
                        url: deck.currentUrl,
                        title: deck.currentTitle,
                        loopStart: deck.loopStart,
                        loopEnd: deck.loopEnd,
                        trim: deck.trim
                    };
                }
            } else if (state.hoveredItem.id) {
                // DOM から直接アイテム情報を取得
                const hovEl = document.querySelector(`.queue-item[data-id="${state.hoveredItem.id}"]`);
                if (hovEl) {
                    // state から該当アイテムを探す
                    const findIn = (list) => {
                        for (const item of list) {
                            if (item.id === state.hoveredItem.id) return item;
                            if (item.children) {
                                const found = findIn(item.children);
                                if (found) return found;
                            }
                        }
                        return null;
                    };
                    targetTrack = findIn(state.library) || findIn(state.deckA.queue) || findIn(state.deckB.queue);
                }
            }
            
            if (targetTrack) {
                const field = document.getElementById('replace-field').value;
                let searchStr = targetTrack[field] || '';
                
                if (field === 'url') {
                    let fullUrl = targetTrack.url || '';
                    const meta = [];
                    if (targetTrack.loopStart) meta.push(`loopStart=${targetTrack.loopStart}`);
                    if (targetTrack.loopEnd && targetTrack.loopEnd < 9999) meta.push(`loopEnd=${targetTrack.loopEnd}`);
                    if (targetTrack.trim && targetTrack.trim !== 1.0) meta.push(`trim=${targetTrack.trim}`);
                    if (targetTrack.title) meta.push(`title=${encodeURIComponent(targetTrack.title)}`);
                    
                    if (meta.length > 0) {
                        fullUrl += (fullUrl.includes('#') ? '&' : '#') + meta.join('&');
                    }
                    searchStr = fullUrl;
                }
                findInput.value = searchStr;
            }
            
            updateSearchMatches();
            renderReplacePreview('find');
            renderReplacePreview('with');
            
            setTimeout(() => {
                findInput.focus();
                findInput.select();
            }, 50);
            return;
        }

        // Ignore only if typing in a text input field
        const isEditing = e.target.tagName === 'TEXTAREA' || e.target.isContentEditable || (e.target.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'button', 'submit'].includes(e.target.type));
        if (isEditing) return;

        if (e.code === 'Space') {
            e.preventDefault();
            // Toggle play/pause on active deck
            togglePlay(state.mode === 'A' ? 'deckA' : 'deckB');
        }

        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            if (e.shiftKey) {
                redo();
            } else {
                undo();
            }
        }

        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
            // Internal Copy (selected items + hovered item)
            if (state.selectedIds.size > 0 || state.hoveredItem.id) {
                e.preventDefault();
                copySelectedToInternal();
            }
        }

        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') {
            // Internal Cut (selected items + hovered item)
            if (state.selectedIds.size > 0 || state.hoveredItem.id) {
                e.preventDefault();
                cutSelectedToInternal();
            }
        }

        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
            e.preventDefault();
            pasteFromInternal();
        }

        // Volume Controls
        if (e.code === 'ArrowUp') {
            e.preventDefault();
            if (e.altKey) {
                adjustVolume('master-vol', 2);
            } else {
                adjustVolume(state.mode === 'A' ? 'vol-a' : 'vol-b', 2);
            }
        }
        if (e.code === 'ArrowDown') {
            e.preventDefault();
            if (e.altKey) {
                adjustVolume('master-vol', -2);
            } else {
                adjustVolume(state.mode === 'A' ? 'vol-a' : 'vol-b', -2);
            }
        }
    });
}

function copySelectedToInternal(silent = false) {
    let itemsToCopy = [];
    
    // Collect selected items
    if (state.selectedIds.size > 0) {
        ['library', 'deckA', 'deckB'].forEach(sourceType => {
            const sourceList = sourceType === 'library' ? state.library : (sourceType === 'deckA' ? state.deckA.queue : state.deckB.queue);
            const extracted = getSelectedNodesData(sourceList, state.selectedIds);
            itemsToCopy = itemsToCopy.concat(extracted);
        });
    }

    // Also include hovered item if not already in selection
    if (state.hoveredItem.id && !state.selectedIds.has(state.hoveredItem.id)) {
        const hovId = state.hoveredItem.id;
        let hovItem = null;
        ['library', 'deckA', 'deckB'].forEach(sourceType => {
            if (hovItem) return;
            const sourceList = sourceType === 'library' ? state.library : (sourceType === 'deckA' ? state.deckA.queue : state.deckB.queue);
            hovItem = findNodeById(sourceList, hovId);
        });
        if (hovItem) itemsToCopy.push(hovItem);
    }

    // NEW: Also include hovered deck's current track if nothing else is selected/hovered in lists
    if (itemsToCopy.length === 0 && state.hoveredDeck) {
        const dk = state[state.hoveredDeck];
        if (dk && dk.currentUrl) {
            // Build a temporary track object for the deck state
            itemsToCopy.push({
                url: dk.currentUrl,
                title: dk.title || "Deck Track",
                loopStart: dk.loopStart,
                loopEnd: dk.loopEnd,
                trim: dk.trim,
                id: "deck_copy_" + Date.now()
            });
        }
    }

    if (itemsToCopy.length > 0) {
        state.internalClipboard = JSON.parse(JSON.stringify(itemsToCopy));
        
        // Write URLs to OS Clipboard
        const urls = [];
        const plainUrls = []; // For internal comparison with clipboard monitor
        const extractUrls = (nodes) => {
            nodes.forEach(n => {
                if (n.url) {
                    plainUrls.push(n.url);
                    // Serialize metadata into fragment for OS clipboard
                    let fullUrl = n.url;
                    const meta = [];
                    if (n.loopStart) meta.push(`loopStart=${n.loopStart}`);
                    if (n.loopEnd && n.loopEnd < 9999) meta.push(`loopEnd=${n.loopEnd}`);
                    if (n.trim && n.trim !== 1.0) meta.push(`trim=${n.trim}`);
                    if (n.title) meta.push(`title=${encodeURIComponent(n.title)}`);
                    
                    if (meta.length > 0) {
                        fullUrl += (fullUrl.includes('#') ? '&' : '#') + meta.join('&');
                    }
                    urls.push(fullUrl);
                }
                if (n.children) extractUrls(n.children);
            });
        };
        extractUrls(state.internalClipboard);
        
        const text = urls.join('\n');
        // Store the exact text we wrote to OS clipboard to ignore it in clipboard monitor
        state.lastInternalCopiedText = text;
        if (text) {
            navigator.clipboard.writeText(text).catch(err => console.warn("OS Copy failed:", err));
        }
        
        if (!silent) showToast(`Copied ${itemsToCopy.length} items`);
    }
}

function cutSelectedToInternal() {
    // 1. Copy to internal first (silent mode to avoid double toasts)
    copySelectedToInternal(true);
    
    if (state.internalClipboard.length === 0) return;
    
    pushHistory();
    
    const idsToRemove = new Set();
    const collectIds = (nodes) => {
        nodes.forEach(n => {
            idsToRemove.add(n.id);
            if (n.children) collectIds(n.children);
        });
    };
    collectIds(state.internalClipboard);
    
    // Remove from all lists
    ['library', 'deckA', 'deckB'].forEach(type => {
        const list = type === 'library' ? state.library : (type === 'deckA' ? state.deckA.queue : state.deckB.queue);
        removeNodes(list, item => idsToRemove.has(item.id));
    });
    
    // Clear selection
    state.selectedIds.clear();
    state.lastSelectedId = null;
    
    renderAllLists();
    saveState();
    
    showToast(`Cut ${state.internalClipboard.length} items`);
}

function getSelectedNodesData(list, selectedIds) {
    let res = [];
    for (const item of list) {
        if (selectedIds.has(item.id)) {
            res.push(item);
        } else if (item.type === 'group' && item.children) {
            res = res.concat(getSelectedNodesData(item.children, selectedIds));
        }
    }
    return res;
}

function findNodeById(list, id) {
    for (const item of list) {
        if (item.id === id) return item;
        if (item.children) {
            const found = findNodeById(item.children, id);
            if (found) return found;
        }
    }
    return null;
}

async function pasteFromInternal() {
    let itemsToInsert = [];
    let systemText = "";
    try {
        systemText = (await navigator.clipboard.readText()) || "";
    } catch (err) {
        console.warn("Clipboard read failed:", err);
    }

    const normSystem = systemText.replace(/\r\n/g, '\n').trim();
    const normInternal = (state.lastInternalCopiedText || "").replace(/\r\n/g, '\n').trim();

    const isSystemTextYT = normSystem.includes('youtube.com/') || normSystem.includes('youtu.be/');
    
    // logic: If system text is a YT URL and DIFFERENT from what we last copied inside, prioritize it.
    if (isSystemTextYT && normSystem !== normInternal) {
        const lines = normSystem.split('\n').map(l => l.trim()).filter(l => l);
        const validUrls = lines.filter(l => extractVideoId(l));
        
        if (validUrls.length > 0) {
            itemsToInsert = validUrls.map(url => ({
                url: url,
                title: "Loading...",
                id: Date.now().toString() + Math.random().toString().substring(2, 6)
            }));
            
            // Fetch titles for each
            itemsToInsert.forEach(item => {
                fetch(`https://noembed.com/embed?url=${encodeURIComponent(item.url)}`)
                    .then(r => r.json())
                    .then(d => {
                        if (d.title) {
                            item.title = d.title;
                            renderAllLists();
                            saveState(false);
                        }
                    }).catch(() => {});
            });
        }
    } 
    
    // Fallback to internal rich data if system text wasn't a "new" URL
    if (itemsToInsert.length === 0 && state.internalClipboard.length > 0) {
        itemsToInsert = state.internalClipboard.map(item => cloneNodeWithNewIds(item));
    }
    
    // Final fallback: if internal was empty, try system text anyway (even if it matches lastInternalCopiedText)
    if (itemsToInsert.length === 0 && isSystemTextYT) {
        const lines = normSystem.split('\n').map(l => l.trim()).filter(l => l);
        const validUrls = lines.filter(l => extractVideoId(l));
        if (validUrls.length > 0) {
            itemsToInsert = validUrls.map(url => ({
                url: url,
                title: "Loading...",
                id: Date.now().toString() + Math.random().toString().substring(2, 6)
            }));
        }
    }

    if (itemsToInsert.length === 0) {
        showToast("Clipboard is empty");
        return;
    }

    pushHistory();
    const target = state.hoveredItem;
    
    let targetListType = target.containerType;
    let anchorId = null;

    if (!targetListType) {
        // Fallback to settings
        targetListType = state.settings.clipboardTargetDeck || 'library';
    }

    const targetListRoot = targetListType === 'library' ? state.library : (targetListType === 'deckA' ? state.deckA.queue : state.deckB.queue);

    if (target.id) {
        if (target.type === 'group') {
            anchorId = target.id + '_inside';
        } else {
            anchorId = target.id + '_after';
        }
    }

    // 重複チェック: リスト全体（Library全体、または指定デッキのQueue全体）でURL重複を確認
    const filteredItems = [];
    for (const item of itemsToInsert) {
        if (item.url) {
            const itemId = extractVideoId(item.url);
            // リスト全体から検索
            const existing = itemId ? findNode(targetListRoot, i => i.url && extractVideoId(i.url) === itemId) : null;
            
            if (existing) {
                const choice = confirm(`この曲は既にリスト内に存在します（${existing.title}）。\n既存のものをすべて削除して、この位置に新位に上書き（移動）しますか？\n\n・はい（OK）：既存を削除してここに配置\n・いいえ（キャンセル）：削除せずに重複して追加`);
                
                if (choice) {
                    // 「はい」の場合、リスト全体から全ての重複（URL一致）を削除
                    removeNodes(targetListRoot, i => i.url && extractVideoId(i.url) === itemId);
                }
            }
        }
        filteredItems.push(item);
    }

    if (filteredItems.length === 0) return;

    if (!insertNodes(targetListRoot, anchorId, filteredItems)) {
        targetListRoot.unshift(...filteredItems); // Default to top
    }

    // Mark inserted IDs for visual feedback
    const insertedIds = itemsToInsert.flatMap(i => {
        const ids = [i.id];
        const getIds = (n) => { if (n.children) n.children.forEach(c => { ids.push(c.id); getIds(c); }); };
        getIds(i);
        return ids;
    });

    renderAllLists();
    saveState();
    showToast(`Pasted ${itemsToInsert.length} items`);

    // Visual feedback
    setTimeout(() => {
        insertedIds.forEach(id => {
            const el = document.querySelector(`[data-id="${id}"]`);
            if (el) {
                el.classList.add('just-pasted');
                setTimeout(() => el.classList.remove('just-pasted'), 2000);
            }
        });
    }, 100);
}

function setupEventListeners() {
    // Monitor all copy/cut events to prevent double-adding via clipboard monitor (includes URL inputs, etc.)
    ['copy', 'cut'].forEach(evtType => {
        document.addEventListener(evtType, (e) => {
            let text = window.getSelection().toString();
            if (!text && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
                try {
                    text = e.target.value.substring(e.target.selectionStart, e.target.selectionEnd);
                } catch (err) {}
            }
            if (text) {
                state.lastInternalCopiedText = text;
            }
        });
    });

    // Play/Pause
    document.getElementById('btn-play-a').onclick = () => togglePlay('deckA');
    document.getElementById('btn-play-b').onclick = () => togglePlay('deckB');

    // Load
    document.getElementById('btn-load-a').onclick = () => { pushHistory(); loadTrackDirect('deckA', document.getElementById('input-a').value); };
    document.getElementById('btn-load-b').onclick = () => { pushHistory(); loadTrackDirect('deckB', document.getElementById('input-b').value); };
    document.getElementById('btn-clear-a').onclick = () => { pushHistory(); clearDeck('deckA'); };
    document.getElementById('btn-clear-b').onclick = () => { pushHistory(); clearDeck('deckB'); };

    // Add to Library (from Deck)
    document.getElementById('btn-add-a').onclick = () => addToLibraryFromDeck('deckA');
    document.getElementById('btn-add-b').onclick = () => addToLibraryFromDeck('deckB');

    // Create Group Buttons
    document.querySelectorAll('.btn-add-group').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const target = btn.dataset.target;
            addGroup(target);
        };
    });

    // Clipboard Settings (Main UI Toggle Button)
    const btnClipWatch = document.getElementById('btn-clip-watch');
    if (btnClipWatch) {
        btnClipWatch.onclick = () => {
            const newState = !state.clipboardWatchEnabled;
            updateClipWatchUI(newState);
            state.settings.clipboardWatchEnabled = newState;
            saveState(false);
            if (state.ws) state.ws.send(JSON.stringify({ type: 'clipboard_watch', enabled: newState }));
            btnClipWatch.blur();
        };
    }
    const clipWatchModal = document.getElementById('clipboard-watch');
    if (clipWatchModal) {
        clipWatchModal.onchange = (e) => {
            updateClipWatchUI(e.target.checked);
            state.settings.clipboardWatchEnabled = e.target.checked;
            saveState(false);
            if (state.ws) state.ws.send(JSON.stringify({ type: 'clipboard_watch', enabled: e.target.checked }));
        };
    }
    const clipTarget = document.getElementById('clipboard-target');
    if (clipTarget) {
        clipTarget.onchange = (e) => {
            state.settings.clipboardTargetDeck = e.target.value;
            saveState(false);
            showToast(`Target: ${e.target.value}`);
            e.target.blur();
        };
    }

    // Modal Settings
    const modal = document.getElementById('settings-modal');
    const openBtn = document.getElementById('btn-open-settings');
    const closeBtn = document.getElementById('btn-close-settings');

    if (openBtn) {
        openBtn.onclick = () => {
            modal.classList.remove('hidden');
            syncModalFromState();
        };
    }
    if (closeBtn) closeBtn.onclick = () => modal.classList.add('hidden');
    window.onclick = (e) => { if (e.target === modal) modal.classList.add('hidden'); };

    // --- Per-direction settings listeners ---
    // A→B
    setupSettingCheckbox('timer-enabled-ab', 'timerEnabledAB');
    setupSettingNumber('timer-minutes-ab', 'timerMinutesAB');
    setupSettingNumber('timer-seconds-ab', 'timerSecondsAB');
    setupSettingCheckbox('obs-enabled-ab', 'obsEnabledAB');
    setupSettingNumber('fade-duration-ab', 'fadeDurationAB', true);
    // B→A
    setupSettingCheckbox('timer-enabled-ba', 'timerEnabledBA');
    setupSettingNumber('timer-minutes-ba', 'timerMinutesBA');
    setupSettingNumber('timer-seconds-ba', 'timerSecondsBA');
    setupSettingCheckbox('obs-enabled-ba', 'obsEnabledBA');
    setupSettingNumber('fade-duration-ba', 'fadeDurationBA', true);

    // Common
    const hotkeyInput = document.getElementById('hotkey-switch');
    if (hotkeyInput) {
        hotkeyInput.onchange = (e) => {
            const val = e.target.value.toUpperCase();
            state.settings.hotkeySwitch = val;
            saveState(false);
            showToast(`Hotkey: ${val}`);
        };
    }

    // Trim settings
    setupSettingNumber('setting-target-rms', 'targetRms', true);
    setupSettingCheckbox('setting-sync-trim', 'syncTrim');

    // OBS connection settings
    setupSettingText('obs-host', 'obsHost');
    setupSettingNumber('obs-port', 'obsPort');
    setupSettingText('obs-password', 'obsPassword');
    setupSettingText('obs-scene-a', 'obsSceneA');
    setupSettingText('obs-scene-b', 'obsSceneB');
    setupSettingText('hotkey-clip-on', 'hotkeyClipOn');
    setupSettingText('hotkey-clip-off', 'hotkeyClipOff');

    const obsConnBtn = document.getElementById('btn-obs-connect');
    if (obsConnBtn) {
        obsConnBtn.onclick = () => {
            if (state.ws && state.wsConnected) {
                // Send updated OBS config to backend then connect
                state.ws.send(JSON.stringify({
                    type: 'obs_update_config',
                    host: state.settings.obsHost,
                    port: state.settings.obsPort,
                    password: state.settings.obsPassword
                }));
                state.ws.send(JSON.stringify({ type: 'obs_connect' }));
                showToast('OBS connecting...');
            }
        };
    }

    // Swtich Mode Buttons (AB/BA)
    document.querySelectorAll('.btn-mode-select').forEach(btn => {
        btn.onclick = (e) => {
            const val = btn.dataset.val;
            const group = btn.closest('.button-group-mode');
            const isAB = group.id === 'mode-group-ab';

            if (isAB) state.settings.switchModeAB = val;
            else state.settings.switchModeBA = val;

            saveState(false);
            updateSwitchUI();
        };
    });

    // Shuffle/Order Toggle Buttons
    document.getElementById('btn-mode-a').onclick = () => togglePlayMode('A');
    document.getElementById('btn-mode-b').onclick = () => togglePlayMode('B');

    // Bottom Controls
    document.getElementById('btn-switch-deck').onclick = () => switchDeck();

    // Test Loop (Deck B)
    document.getElementById('btn-test-loop').onclick = () => {
        // Force 'resume' mode during test to prevent skipping the track
        if (state.mode === 'A') switchDeck('resume');
        const p = state.deckB.activePlayer === 1 ? state.deckB.p1 : state.deckB.p2;
        p.seekTo(state.deckB.loopEnd - parseFloat(document.getElementById('test-duration').value));
        p.playVideo();
        state.isTestingLoop = true;
        setTimeout(() => state.isTestingLoop = false, 3000);
    };

    // Test Loop (Deck A)
    document.getElementById('btn-test-loop-a').onclick = () => {
        if (state.mode === 'B') switchDeck('resume');
        const p = state.deckA.activePlayer === 1 ? state.deckA.p1 : state.deckA.p2;
        p.seekTo(state.deckA.loopEnd - parseFloat(document.getElementById('test-duration-a').value));
        p.playVideo();
        state.isTestingLoop = true;
        setTimeout(() => state.isTestingLoop = false, 3000);
    };

    // Analyze Loop (Deck B)
    document.getElementById('btn-analyze-loop').onclick = () => {
        let url = document.getElementById('input-b').value;
        if (!url && state.deckB.currentUrl) url = state.deckB.currentUrl;
        if (!url) { document.getElementById('global-status').textContent = 'No URL to analyze'; return; }
        if (state.ws && state.wsConnected) {
            state.isAnalyzing = true;
            state._analyzingDeck = 'deckB';
            document.getElementById('global-status').textContent = '⏳ Analyzing (B)...';
            document.getElementById('btn-cancel-analysis').classList.remove('hidden');
            state.ws.send(JSON.stringify({ type: 'analyze_loop', url, target_rms: state.settings.targetRms || 0.08, do_trim: !!state.deckB.trimAutoEnabled }));
        } else {
            document.getElementById('global-status').textContent = 'WebSocket not connected';
        }
    };

    // Analyze Loop (Deck A)
    document.getElementById('btn-analyze-loop-a').onclick = () => {
        let url = document.getElementById('input-a').value;
        if (!url && state.deckA.currentUrl) url = state.deckA.currentUrl;
        if (!url) { document.getElementById('global-status').textContent = 'No URL to analyze'; return; }
        if (state.ws && state.wsConnected) {
            state.isAnalyzing = true;
            state._analyzingDeck = 'deckA';
            document.getElementById('global-status').textContent = '⏳ Analyzing (A)...';
            document.getElementById('btn-cancel-analysis').classList.remove('hidden');
            state.ws.send(JSON.stringify({ type: 'analyze_loop', url, target_rms: state.settings.targetRms || 0.08, do_trim: !!state.deckA.trimAutoEnabled }));
        } else {
            document.getElementById('global-status').textContent = 'WebSocket not connected';
        }
    };

    // Loop Input Sync (A)
    document.getElementById('loop-start-a').onchange = (e) => {
        state.deckA.loopStart = parseFloat(e.target.value) || 0;
    };
    document.getElementById('loop-end-a').onchange = (e) => {
        state.deckA.loopEnd = parseFloat(e.target.value) || 9999;
    };
    // Loop Input Sync (B)
    document.getElementById('loop-start-b').onchange = (e) => {
        state.deckB.loopStart = parseFloat(e.target.value) || 0;
    };
    document.getElementById('loop-end-b').onchange = (e) => {
        state.deckB.loopEnd = parseFloat(e.target.value) || 9999;
    };

    document.getElementById('btn-cancel-analysis').onclick = () => {
        state.isAnalyzing = false;
        document.getElementById('btn-cancel-analysis').classList.add('hidden');
        document.getElementById('global-status').textContent = 'Analysis Cancelled';
        if (state.ws && state.wsConnected) {
            state.ws.send(JSON.stringify({ type: 'cancel_analysis' }));
        }
    };

    setupSeekAndVol();
    initCustomDnD();
    setupHoverTracking();
}

function setupHoverTracking() {
    window.addEventListener('mousemove', (e) => {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        if (!el) return;

        const itemEl = el.closest('.queue-item');
        const containerEl = el.closest('.queue-list, .library-list');

        if (itemEl) {
            state.hoveredItem.id = itemEl.dataset.id;
            state.hoveredItem.type = itemEl.classList.contains('group') ? 'group' : 'track';
        } else {
            state.hoveredItem.id = null;
            state.hoveredItem.type = null;
        }

        if (containerEl) {
            if (containerEl.id === 'queue-list-a') state.hoveredItem.containerType = 'deckA';
            else if (containerEl.id === 'queue-list-b') state.hoveredItem.containerType = 'deckB';
            else if (containerEl.id === 'library-list') state.hoveredItem.containerType = 'library';
        } else {
            state.hoveredItem.containerType = null;
        }
    });
}

function updateSwitchUI() {
    // AB
    const modeAB = state.settings.switchModeAB;
    const groupAB = document.getElementById('mode-group-ab');
    groupAB.querySelectorAll('.btn-mode-select').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.val === modeAB);
    });

    // BA
    const modeBA = state.settings.switchModeBA;
    const groupBA = document.getElementById('mode-group-ba');
    groupBA.querySelectorAll('.btn-mode-select').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.val === modeBA);
    });
}

function togglePlayMode(deckKey) {
    const key = `playMode${deckKey}`;
    const current = state.settings[key] || 'order';
    let next;
    if (current === 'order') next = 'shuffle';
    else if (current === 'shuffle') next = 'group_order';
    else if (current === 'group_order') next = 'group_shuffle';
    else next = 'order';

    state.settings[key] = next;
    updatePlayModeUI(deckKey);
    saveState(false);
}

function updatePlayModeUI(deckKey) {
    // deckKey can be passed as 'a', 'b', 'A', 'B'. Normalize to uppercase for state, lowercase for DOM.
    const keyUpper = deckKey.toUpperCase();
    const keyLower = deckKey.toLowerCase();
    
    const btn = document.getElementById(`btn-mode-${keyLower}`);
    const mode = state.settings[`playMode${keyUpper}`] || 'order';

    const isGroupMode = mode.startsWith('group_');
    const markEl = document.getElementById(`deck-${keyLower}-group-mark`);
    if (markEl) markEl.style.display = isGroupMode ? 'inline-block' : 'none';

    btn.classList.remove('mode-shuffle');
    if (mode === 'shuffle') {
        btn.innerHTML = '<i class="fa-solid fa-shuffle"></i>';
        btn.title = "Queue Mode: Shuffle";
        btn.classList.add('mode-shuffle');
        btn.style.color = 'var(--accent-a)';
    } else if (mode === 'group_order') {
        btn.innerHTML = '<i class="fa-solid fa-folder-tree"></i>';
        btn.title = "Queue Mode: Group Order";
        btn.style.color = '#5a9eff';
    } else if (mode === 'group_shuffle') {
        btn.innerHTML = '<i class="fa-solid fa-folder-tree"></i><i class="fa-solid fa-shuffle" style="font-size: 0.6em; margin-left: -5px;"></i>';
        btn.title = "Queue Mode: Group Shuffle";
        btn.style.color = '#5a9eff';
    } else {
        btn.innerHTML = '<i class="fa-solid fa-arrow-down-1-9"></i>';
        btn.title = "Queue Mode: Order";
        btn.style.color = '#fff';
    }
}

// ============ LIST MANAGEMENT (Queue & Library) ============

function addToLibraryFromDeck(deckKey) {
    // Try input field first, fallback to currentUrl in state
    let url = document.getElementById(deckKey === 'deckA' ? 'input-a' : 'input-b').value;
    if (!url) {
        url = (deckKey === 'deckA') ? state.deckA.currentUrl : state.deckB.currentUrl;
    }

    const titleEl = document.getElementById(deckKey === 'deckA' ? 'info-a-title' : 'info-b-title');
    const title = titleEl ? titleEl.textContent : 'No Track';

    if (!url || !url.startsWith('http')) {
        showToast("No valid URL found to add");
        return;
    }

    let target = state.settings.clipboardTargetDeck || 'library';
    // loadA / loadA_analyze → deckA, loadB / loadB_analyze → deckB
    if (target.startsWith('loadA')) target = 'deckA';
    else if (target.startsWith('loadB')) target = 'deckB';
    const targetName = target === 'library' ? 'Library' : (target === 'deckA' ? 'Queue A' : 'Queue B');
    const targetList = target === 'library' ? state.library 
                     : (target === 'deckA' ? state.deckA.queue : state.deckB.queue);

    // Duplication check (Shallow - only check same level)
    const existing = targetList.find(i => i.url === url);
    if (existing) {
        if (confirm(`このURLは「${targetName}」に既に存在します。タイトルやループ設定を上書きしますか？`)) {
            pushHistory();
            existing.title = title;
            const keyLower = deckKey === 'deckA' ? 'a' : 'b';
            existing.loopStart = parseFloat(document.getElementById(`loop-start-${keyLower}`).value);
            existing.loopEnd = parseFloat(document.getElementById(`loop-end-${keyLower}`).value);
            renderAllLists();
            saveState();
            showToast("Item Overwritten");
        }
        return;
    }

    const keyLower = deckKey === 'deckA' ? 'a' : 'b';
    const item = {
        url, title,
        loopStart: parseFloat(document.getElementById(`loop-start-${keyLower}`).value),
        loopEnd: parseFloat(document.getElementById(`loop-end-${keyLower}`).value),
        id: Date.now().toString() + Math.random().toString().substr(2, 4)
    };

    pushHistory();
    targetList.unshift(item);

    renderAllLists();
    saveState();
    showToast(`Added to ${targetName}`);
}

function addFromLibraryToQueue(libId, targetDeck) {
    const libItem = findNode(state.library, i => i.id === libId);
    if (!libItem) return;

    // Clone item for queue
    const qItem = cloneNodeWithNewIds(libItem);

    pushHistory();
    if (targetDeck === 'deckA') {
        state.deckA.queue.unshift(qItem);
    } else {
        state.deckB.queue.unshift(qItem);
    }

    renderAllLists();
    saveState();
    showToast(`Queued to ${targetDeck === 'deckA' ? 'A' : 'B'}`);
}

function loadGroupDirect(deckKey, group, fromQueue = false) {
    const allTracks = flattenTracks(group.children || []);
    if (allTracks.length === 0) {
        showToast("Group is empty");
        return;
    }
    
    let targetGroup = group;
    if (!fromQueue) {
        pushHistory();
        targetGroup = cloneNodeWithNewIds(group);
        // Removed: adding to queue when loading direct from library
    }
    
    // Set deck play mode
    const keyUpper = deckKey === 'deckA' ? 'A' : 'B';
    const mode = state.settings[`playMode${keyUpper}`] || 'order';

    let targetTrack;
    if (mode === 'shuffle' || mode === 'group_shuffle') {
        const randIdx = Math.floor(Math.random() * allTracks.length);
        targetTrack = allTracks[randIdx];
    } else {
        targetTrack = allTracks[0];
    }

    // アクティブデッキなら自動再生、そうでなければ停止
    const isActiveDeck = (deckKey === 'deckA' && state.mode === 'A') || (deckKey === 'deckB' && state.mode === 'B');
    loadTrackDirect(deckKey, targetTrack.url, isActiveDeck, targetTrack.id, targetTrack);
    
    renderAllLists();
    saveState();
    showToast(`Loaded Group to Deck ${keyUpper}`);
}

let pendingClipboardUrls = [];
let isProcessingClipboard = false;

async function processClipboardUrl(url) {
    if (url) pendingClipboardUrls.push(url);
    if (isProcessingClipboard) return;
    isProcessingClipboard = true;

    while (pendingClipboardUrls.length > 0) {
        const nextUrl = pendingClipboardUrls[0];
        const target = state.settings.clipboardTargetDeck || 'library';
        const isPlaylist = /[?&]list=/.test(nextUrl) || nextUrl.includes('/playlist?');

        // バックグラウンド時は、確認が必要なもの（プレイリストや重複）は待機
        if (document.hidden && !(target.startsWith('load') && !isPlaylist)) {
            break;
        }

        pendingClipboardUrls.shift();
        await executeClipboardProcess(nextUrl);
    }
    isProcessingClipboard = false;
}

async function executeClipboardProcess(url) {
    const target = state.settings.clipboardTargetDeck || 'library';
    const isPlaylist = /[?&]list=/.test(url) || url.includes('/playlist?');

    if (document.hidden) {
        // executeClipboardProcess is only called in background for direct loads
        processSingleUrl(url);
        return;
    }

    // プレイリスト判定の強化: ?list= または &list= を含む場合にダイアログを出す
    if (isPlaylist) {
        if (!confirm(`プレイリストの識別子（list=）が検出されました。プレイリスト内のすべての曲をグループで追加しますか？\n\n・はい（OK）: プレイリストとして一括追加\n・いいえ（キャンセル）: この曲単体として追加`)) {
            processSingleUrl(url);
            return;
        }

        showToast("プレイリストを解析中...");
        try {
            const res = await fetch('/api/import_playlist', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });
            const data = await res.json();
            if (data.success && data.tracks && data.tracks.length > 0) {
                const target = state.settings.clipboardTargetDeck || 'library';
                let targetList = state.library;
                if (target === 'deckA') targetList = state.deckA.queue;
                else if (target === 'deckB') targetList = state.deckB.queue;
                else if (target === 'loadA' || target === 'loadB') targetList = state.library; // Fallback to library for storage
                
                pushHistory();
                
                const newGroup = {
                    id: 'group_' + Date.now().toString() + Math.random().toString().substr(2, 4),
                    type: 'group',
                    title: data.title || 'Imported Playlist',
                    collapsed: true,
                    children: []
                };
                
                data.tracks.forEach(t => {
                    const item = { url: t.url, title: t.title, id: Date.now().toString() + Math.random().toString().substr(2, 4) };
                    newGroup.children.push(item);
                });
                
                if (newGroup.children.length > 0) {
                    targetList.unshift(newGroup);
                    renderAllLists();
                    saveState();
                    showToast(`Playlist Added: ${newGroup.children.length} tracks to ${target}`);

                    // If "Load" target, load the first track directly
                    if (target === 'loadA' || target === 'loadB') {
                        const deckKey = target === 'loadA' ? 'deckA' : 'deckB';
                        loadTrackDirect(deckKey, newGroup.children[0].url, true, newGroup.children[0].id);
                    }
                }
            } else {
                showToast(`Playlist import failed: ${data.error || 'Empty'}`);
                processSingleUrl(url);
            }
        } catch (err) {
            console.error(err);
            showToast("Playlist import error");
            processSingleUrl(url);
        }
    } else {
        processSingleUrl(url);
    }
}

function processSingleUrl(url, knownTitle = null) {
    const vid = extractVideoId(url);
    if (!vid) return;
    const title = knownTitle || ("Clip " + vid.substr(0, 5));

    const target = state.settings.clipboardTargetDeck || 'library';
    
    if (target.startsWith('load')) {
        const deckKey = target.includes('loadA') ? 'deckA' : 'deckB';
        const deckName = target.includes('loadA') ? 'Deck A' : 'Deck B';
        const isAnalyze = target.endsWith('_analyze');
        
        // Load into deck directly (No auto-play)
        loadTrackDirect(deckKey, url, false);
        
        // Auto Analyze if requested (Mostly useful for Deck B)
        if (isAnalyze && state.ws && state.wsConnected) {
            state.isAnalyzing = true;
            document.getElementById('global-status').textContent = '⏳ Auto Analyzing...';
            document.getElementById('btn-cancel-analysis').classList.remove('hidden');
            state.ws.send(JSON.stringify({ type: 'analyze_loop', url }));
            showToast(`Loaded & Analyzing (${deckName})`);
        } else {
            showToast(`Loaded directly into ${deckName}`);
        }
        return;
    }

    const targetName = target === 'library' ? 'Library' : (target === 'deckA' ? 'Queue A' : 'Queue B');
    const targetList = target === 'library' ? state.library
        : (target === 'deckA' ? state.deckA.queue : state.deckB.queue);
    const existing = findNode(targetList, i => extractVideoId(i.url) === vid);
    if (existing && !knownTitle) {
        if (!confirm(`このURLは「${targetName}」に既に存在します（${existing.title}）。\nタイトルを上書きして再読み込みしますか？\n（「キャンセル」で追加を中止します）`)) return;
        
        pushHistory();
        existing.title = title; // Update existing
        // Update title asynchronously if not known
        const vid = extractVideoId(url);
        fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${vid}`).then(r => r.json()).then(d => {
            if (d.title) {
                existing.title = d.title;
                renderAllLists();
                saveState(false);
            }
        });
        renderAllLists();
        saveState();
        showToast("Existing item updated");
        return;
    }

    const item = { url, title, id: Date.now().toString() + Math.random().toString().substr(2, 4) };
    pushHistory();
    targetList.unshift(item);

    if (!knownTitle) {
        fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${vid}`).then(r => r.json()).then(d => {
            if (d.title) {
                item.title = d.title;
                renderAllLists();
                saveState(false);
            }
        });
    }

    renderAllLists();
    saveState();
    showToast(`Added to ${target}`);
}

// ============ TREE UTILS ============

function removeNodes(list, predicate) {
    let removed = [];
    for (let i = list.length - 1; i >= 0; i--) {
        if (predicate(list[i])) {
            removed.unshift(...list.splice(i, 1));
        } else if (list[i].type === 'group' && list[i].children) {
            removed = removeNodes(list[i].children, predicate).concat(removed);
        }
    }
    return removed;
}

function findNode(list, predicate) {
    for (const item of list) {
        if (predicate(item)) return item;
        if (item.type === 'group' && item.children) {
            const found = findNode(item.children, predicate);
            if (found) return found;
        }
    }
    return null;
}

function flattenTracks(list, groupId = null) {
    let res = [];
    list.forEach(i => {
        if (i.type === 'group') res = res.concat(flattenTracks(i.children || [], i.id));
        else res.push({ ...i, groupId });
    });
    return res;
}

function insertNodes(list, anchorId, itemsToInsert) {
    if (!anchorId) {
        list.push(...itemsToInsert);
        return true;
    }
    const isAfter = anchorId.endsWith('_after');
    const isInside = anchorId.endsWith('_inside');
    let realId = anchorId;
    if (isAfter) realId = anchorId.replace('_after', '');
    if (isInside) realId = anchorId.replace('_inside', '');

    for (let i = 0; i < list.length; i++) {
        if (list[i].id === realId) {
            if (isInside && list[i].type === 'group') {
                list[i].children = list[i].children || [];
                list[i].children.unshift(...itemsToInsert);
                return true;
            } else if (isAfter) {
                list.splice(i + 1, 0, ...itemsToInsert);
                return true;
            } else {
                list.splice(i, 0, ...itemsToInsert);
                return true;
            }
        }
        if (list[i].type === 'group' && list[i].children) {
            if (insertNodes(list[i].children, anchorId, itemsToInsert)) return true;
        }
    }
    return false;
}

function findContainerByAnchor(list, anchorId) {
    if (!anchorId) return list;
    const isInside = anchorId.endsWith('_inside');
    const isAfter = anchorId.endsWith('_after');
    let realId = anchorId;
    if (isInside) realId = anchorId.replace('_inside', '');
    if (isAfter) realId = anchorId.replace('_after', '');
    
    for (let i = 0; i < list.length; i++) {
        if (list[i].id === realId) {
            if (isInside) return (list[i].children || (list[i].children = []));
            return list;
        }
        if (list[i].type === 'group' && list[i].children) {
            const nested = findContainerByAnchor(list[i].children, anchorId);
            if (nested) return nested;
        }
    }
    return null;
}

function cloneNodeWithNewIds(node) {
    const clone = JSON.parse(JSON.stringify(node));
    const assignNewIds = (n) => {
        n.id = Date.now().toString() + Math.random().toString().substr(2, 4);
        if (n.children) n.children.forEach(assignNewIds);
    };
    assignNewIds(clone);
    return clone;
}

// ============ ITEM OPERATIONS ============

function removeItem(listType, id) {
    pushHistory();
    const list = listType === 'library' ? state.library : (listType === 'deckA' ? state.deckA.queue : state.deckB.queue);
    removeNodes(list, i => i.id === id);
    renderAllLists();
    saveState();
}


function renderAllLists() {
    renderList('queue-list-a', state.deckA.queue, 'deckA');
    renderList('queue-list-b', state.deckB.queue, 'deckB');
    renderList('library-list', state.library, 'library');

    // Update Counts
    document.getElementById('count-a').textContent = `${state.deckA.queue.length} items`;
    document.getElementById('count-b').textContent = `${state.deckB.queue.length} items`;
    document.getElementById('count-lib').textContent = `${state.library.length} items`;
}

function renderList(containerId, listData, type) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';

    // Remove old classes for drop-zone highlighting
    // Only show drop zones (Easy Move) if there is a multi-selection (size > 1) 
    // OR if the user is holding Ctrl/Shift (which implies they are in "Selection Mode")
    container.classList.remove('has-selection');
    if (state.selectedIds.size > 0) {
        container.classList.add('has-selection');
    }

    // Helper: Create Drop Zone
    const createDropZone = (targetId, prefix = '') => {
        const dz = document.createElement('div');
        dz.className = 'drop-zone';
        dz.onclick = (e) => {
            e.stopPropagation();
            if (state.selectedIds.size > 0) {
                // Determine target list if dropping into a group
                handleEasyMove(targetId, type);
            }
        };
        dz.innerHTML = `<div class="drop-zone-inner"><span class="drop-zone-text"><i class="fa-solid fa-arrow-down"></i> ${prefix}ここに移動</span></div>`;
        return dz;
    };

    // Recursive item renderer
    const renderItems = (items, targetContainer, parentId = null) => {
        // Drop zone at the start of this list level
        const firstDropTarget = items.length > 0 ? items[0].id : (parentId ? parentId + '_inside' : null);
        targetContainer.appendChild(createDropZone(firstDropTarget));

        items.forEach(item => {
            const isGroup = item.type === 'group';
            const el = document.createElement('div');
            el.className = 'queue-item' + (isGroup ? ' group' : '');
            el.dataset.id = item.id;

            // Actions buttons
            let actionsHtml = '';
            if (type === 'library') {
                actionsHtml = `
                    <div class="q-actions">
                        <button class="btn-mini btn-to-a" title="Queue to A (Double-click to Load)">A</button>
                        <button class="btn-mini btn-to-b" title="Queue to B (Double-click to Load)">B</button>
                        <button class="btn-mini btn-del" title="Delete">×</button>
                    </div>
                `;
            } else {
                actionsHtml = `
                    <div class="q-actions">
                        <button class="btn-mini btn-del">×</button>
                    </div>
                `;
            }

            // Thumbnail (Tracks only)
            const videoId = !isGroup ? extractVideoId(item.url) : null;
            const thumbHtml = videoId
                ? `<img class="q-thumb" src="https://img.youtube.com/vi/${videoId}/default.jpg" loading="lazy" alt="">`
                : '';
            
            const groupIconHtml = isGroup ? `<i class="fa-solid fa-folder btn-collapse-group" style="padding: 0 4px; color: #5a9eff; cursor: pointer;"></i>` : '';

            // Content
            el.innerHTML = `
                ${thumbHtml}
                ${groupIconHtml}
                ${item.restricted ? `<span class="restricted-label">埋込禁止</span>` : ''}
                <div class="q-content" ${isGroup ? 'style="flex-direction: row; align-items: center;"' : ''} ${item.restricted ? 'style="color:#ff5a5a;"' : ''}>
                    <span class="q-title">${item.title}</span>
                    <span class="q-time" ${isGroup ? 'style="margin-left: 8px; font-size: 0.75rem"' : ''}>
                        ${(() => {
                            if (isGroup) return `(${item.children ? item.children.length : 0} items)`;
                            const metas = [];
                            if (item.loopStart) {
                                metas.push(`<span class="q-meta-item q-meta-loop">LOOP: ${formatTime(item.loopStart)}-${formatTime(item.loopEnd)}</span>`);
                            }
                            if (item.trim !== undefined && item.trim !== 1.0) {
                                metas.push(`<span class="q-meta-item q-meta-trim">TRIM: x${item.trim.toFixed(2)}</span>`);
                            }
                            return metas.join('');
                        })()}
                    </span>
                </div>
                ${actionsHtml}
            `;
            if (item.restricted) el.classList.add('restricted');

            if (state.selectedIds.has(item.id)) {
                el.classList.add('selected');
            }

            // D&D Handlers
            el.onmousedown = (e) => onDndDown(e, item, type, el);

            el.ondblclick = (e) => {
                if (isGroup && type !== 'library') {
                    const deckK = (type === 'deckA' ? 'deckA' : 'deckB');
                    loadGroupDirect(deckK, item, true);
                }
            };

            el.onclick = (e) => {
                if (dndState.isDragging) return;
                const titleEl = el.querySelector('.q-title');
                if (e.target.tagName !== 'BUTTON' && !titleEl.isContentEditable) {
                    // REMOVED: Auto-move on group click (Conflicts with Copy-Paste flow)
                    /*
                    if (state.selectedIds.size > 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && isGroup && !state.selectedIds.has(item.id)) {
                        handleEasyMove(item.id + '_inside', type);
                        return;
                    }
                    */

                    if (e.shiftKey) {
                        // Range-select between lastSelectedId and this item using visible DOM order
                        const allVisibleEls = [...document.querySelectorAll('.queue-item:not(.dragging-source)')];
                        const allIds = allVisibleEls.map(el => el.dataset.id).filter(Boolean);
                        const anchorId = state.lastSelectedId;
                        const anchorIdx = anchorId ? allIds.indexOf(anchorId) : -1;
                        const clickIdx = allIds.indexOf(item.id);
                        if (anchorIdx >= 0 && clickIdx >= 0) {
                            const lo = Math.min(anchorIdx, clickIdx);
                            const hi = Math.max(anchorIdx, clickIdx);
                            state.selectedIds.clear();
                            for (let n = lo; n <= hi; n++) state.selectedIds.add(allIds[n]);
                        } else {
                            state.selectedIds.add(item.id);
                            state.lastSelectedId = item.id;
                        }
                        renderAllLists();
                        setTimeout(() => {
                            const lastEl = document.querySelector(`[data-id="${item.id}"]`);
                            if (lastEl) lastEl.scrollIntoView({ block: 'nearest', behavior: 'instant' });
                        }, 50);
                        return;
                    }

                    if (e.ctrlKey || e.metaKey || state.selectedIds.size > 0) {
                        // User specifically requested: If clicking a Group without Ctrl, clear all song selections 
                        // to prepare for pasting into this group.
                        if (isGroup && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                            state.selectedIds.clear();
                            state.selectedIds.add(item.id);
                        } else {
                            if (state.selectedIds.has(item.id)) state.selectedIds.delete(item.id);
                            else state.selectedIds.add(item.id);
                        }
                        
                        state.lastSelectedId = item.id;
                        renderAllLists();
                        if (state.lastSelectedId) {
                            setTimeout(() => {
                                const lastEl = document.querySelector(`[data-id="${state.lastSelectedId}"]`);
                                if (lastEl) lastEl.scrollIntoView({ block: 'nearest', behavior: 'instant' });
                            }, 50);
                        }
                        return;
                    }

                    if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
                        if (isGroup) {
                            item.collapsed = !item.collapsed;
                            saveState(false);
                            // Update UI locally to avoid rerender/nuking double-click
                            // Update UI locally using hidden attribute for selectability
                            const childrenContainer = el.nextElementSibling;
                            if (childrenContainer && childrenContainer.classList.contains('group-children')) {
                                if (item.collapsed) {
                                    childrenContainer.setAttribute('hidden', 'until-found');
                                } else {
                                    childrenContainer.removeAttribute('hidden');
                                }
                            }
                            const icon = el.querySelector('.btn-collapse-group');
                            if (icon) {
                                if (item.collapsed) {
                                    icon.classList.remove('fa-folder-open');
                                    icon.classList.add('fa-folder');
                                } else {
                                    icon.classList.remove('fa-folder');
                                    icon.classList.add('fa-folder-open');
                                }
                            }
                            return;
                        }

                        if (state.selectedIds.size > 0) {
                            state.selectedIds.clear();
                            state.lastSelectedId = null;
                            renderAllLists();
                        }
                        if (type !== 'library' && !isGroup) {
                            pushHistory();
                            loadTrackDirect(type, item.url, true, item.id, item);
                        }
                    }
                }
            };

            const titleEl = el.querySelector('.q-title');
            titleEl.ondblclick = (e) => {
                e.stopPropagation();
                titleEl.contentEditable = true;
                titleEl.focus();
                titleEl.classList.add('editing');
                // Select all text
                setTimeout(() => {
                    document.execCommand('selectAll', false, null);
                }, 0);
            };
            titleEl.onblur = (e) => {
                titleEl.contentEditable = false;
                titleEl.classList.remove('editing');
                const newTitle = e.target.textContent.trim();
                if (item.title !== newTitle && newTitle !== '') {
                    pushHistory();
                    item.title = newTitle;
                    saveState(false);
                } else {
                    titleEl.textContent = item.title;
                }
            };
            titleEl.onkeydown = (e) => {
                if (e.key === 'Enter') { 
                    e.preventDefault(); 
                    titleEl.blur(); 
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    titleEl.textContent = item.title; // 元に戻す
                    titleEl.blur();
                }
            };

            el.querySelector('.btn-del').onclick = (e) => { e.stopPropagation(); removeItem(type, item.id); };

            if (type === 'library') {
                const btnA = el.querySelector('.btn-to-a');
                const btnB = el.querySelector('.btn-to-b');
                let aTimer = null;
                btnA.onclick = (e) => {
                    e.stopPropagation();
                    if (aTimer) clearTimeout(aTimer);
                    aTimer = setTimeout(() => { addFromLibraryToQueue(item.id, 'deckA'); aTimer = null; }, 250);
                };
                btnA.ondblclick = (e) => {
                    e.stopPropagation();
                    if (aTimer) { clearTimeout(aTimer); aTimer = null; }
                    if (!isGroup) {
                        pushHistory();
                        loadTrackDirect('deckA', item.url, false, item.id, item);
                        showToast("Loaded to Deck A (Paused)");
                    } else {
                        loadGroupDirect('deckA', item);
                    }
                };
                let bTimer = null;
                btnB.onclick = (e) => {
                    e.stopPropagation();
                    if (bTimer) clearTimeout(bTimer);
                    bTimer = setTimeout(() => { addFromLibraryToQueue(item.id, 'deckB'); bTimer = null; }, 250);
                };
                btnB.ondblclick = (e) => {
                    e.stopPropagation();
                    if (bTimer) { clearTimeout(bTimer); bTimer = null; }
                    if (!isGroup) {
                        pushHistory();
                        loadTrackDirect('deckB', item.url, false, item.id, item);
                        showToast("Loaded to Deck B (Paused)");
                    } else {
                        loadGroupDirect('deckB', item);
                    }
                };
            }

            targetContainer.appendChild(el);

            if (isGroup) {
                const icon = el.querySelector('.btn-collapse-group');
                if (item.collapsed) {
                    icon.classList.remove('fa-folder-open');
                    icon.classList.add('fa-folder');
                } else {
                    icon.classList.remove('fa-folder');
                    icon.classList.add('fa-folder-open');
                }

                const childrenContainer = document.createElement('div');
                childrenContainer.className = 'group-children';
                if (item.collapsed) {
                    childrenContainer.setAttribute('hidden', 'until-found');
                }
                
                // Expand when browser finds content inside (find in page)
                childrenContainer.addEventListener('beforematch', () => {
                    item.collapsed = false;
                    saveState(false);
                    const icon = el.querySelector('.btn-collapse-group');
                    if (icon) {
                        icon.classList.remove('fa-folder');
                        icon.classList.add('fa-folder-open');
                    }
                });
                
                // Recursive render
                renderItems(item.children || [], childrenContainer, item.id);
                targetContainer.appendChild(childrenContainer);
            }

            // Drop zone after this item
            targetContainer.appendChild(createDropZone(item.id + '_after'));
        });
    };

    renderItems(listData, container);
} // End renderList

// --- Group Creation ---
function addGroup(targetDeck) {
    const list = targetDeck === 'library' ? state.library : (targetDeck === 'deckA' ? state.deckA.queue : state.deckB.queue);
    const newGroup = {
        id: 'group_' + Date.now().toString(),
        type: 'group',
        title: 'New Group',
        children: []
    };
    pushHistory();
    list.unshift(newGroup); // Add to top for now
    renderAllLists();
    saveState();
    showToast("Group created in " + targetDeck);

    // Auto-rename
    setTimeout(() => startRenaming(newGroup.id), 100);
}

function startRenaming(id) {
    const el = document.querySelector(`[data-id="${id}"] .q-title`);
    if (el) {
        el.contentEditable = true;
        el.focus();
        // select all text
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        
        el.onblur = () => finishRename(id, el);
        el.onkeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                el.blur();
            }
        };
    }
}

function finishRename(id, el) {
    el.contentEditable = false;
    const newName = el.textContent.trim();
    if (newName) {
        pushHistory();
        updateTitleById(state.library, id, newName);
        updateTitleById(state.deckA.queue, id, newName);
        updateTitleById(state.deckB.queue, id, newName);
        renderAllLists();
        saveState();
    } else {
        renderAllLists(); // Revert to original
    }
}

function updateTitleById(list, id, newTitle) {
    for (const item of list) {
        if (item.id === id) {
            item.title = newTitle;
            return true;
        }
        if (item.children && updateTitleById(item.children, id, newTitle)) return true;
    }
    return false;
}


// Function to safely extract items from tree. 
// If a node is selected, we extract it (with its children).
// We do NOT recurse into its children if the node itself is extracted.
function extractSelectedNodes(list, selectedIds, shouldClone) {
    let extracted = [];
    for (let i = list.length - 1; i >= 0; i--) {
        const item = list[i];
        if (selectedIds.has(item.id)) {
            if (shouldClone) {
                extracted.unshift(cloneNodeWithNewIds(item));
            } else {
                extracted.unshift(...list.splice(i, 1));
            }
        } else if (item.type === 'group' && item.children) {
            extracted = extractSelectedNodes(item.children, selectedIds, shouldClone).concat(extracted);
        }
    }
    return extracted;
}

// --- Easy Move Implementation ---
function handleEasyMove(targetAnchorId, targetType, providedItems = null) {
    if (state.selectedIds.size === 0 && (!providedItems || providedItems.length === 0)) return;
    
    pushHistory();
    let itemsToMove = [];
    
    // If dragging from a direct source (like the Deck title area), we use the provided items (CLONED)
    if (providedItems && providedItems.length > 0) {
        itemsToMove = providedItems.map(i => cloneNodeWithNewIds(i));
    } else {
        // Normal extraction from lists
        ['library', 'deckA', 'deckB'].forEach(sourceType => {
            const sourceList = sourceType === 'library' ? state.library : (sourceType === 'deckA' ? state.deckA.queue : state.deckB.queue);
            const shouldClone = (sourceType === 'library' && targetType !== 'library');
            const extracted = extractSelectedNodes(sourceList, state.selectedIds, shouldClone);
            itemsToMove = extracted.concat(itemsToMove);
        });
    }

    if (itemsToMove.length === 0) return;

    const targetList = targetType === 'library' ? state.library : (targetType === 'deckA' ? state.deckA.queue : state.deckB.queue);
    
    // Duplicate Check (Scoped to target container)
    // findContainerByAnchor returns the specific array (e.g. group.children) where insertion will happen
    const actualTargetArr = findContainerByAnchor(targetList, targetAnchorId) || targetList;

    if (itemsToMove.length === 1 && itemsToMove[0].type !== 'group') {
        const url = itemsToMove[0].url;
        // Check only within actualTargetArr (Shallow check only, allowing same song in different groups)
        const vid = extractVideoId(url);
        const existing = vid ? actualTargetArr.find(i => extractVideoId(i.url) === vid) : null;
        if (existing) {
            const targetName = targetType === 'library' ? 'Library' : (targetType === 'deckA' ? 'Queue A' : 'Queue B');
            if (!confirm(`この曲（${existing.title}）はここ（${targetName}）に既に存在します。重複して追加しますか？`)) {
                return;
            }
        }
    }

    if (!insertNodes(targetList, targetAnchorId, itemsToMove)) {
        targetList.push(...itemsToMove);
    }
    
    // Clear selection after move
    state.selectedIds.clear();
    state.lastSelectedId = null;
    
    saveState(false);
    renderAllLists();
    showToast(`Added/Moved ${itemsToMove.length} items`);
}

// ============ CUSTOM DND SYSTEM (JS Controlled) ============

/**
 * Initialize custom DnD system.
 * Replaces standard HTML5 DnD to allow wheel scrolling while dragging.
 */
const dndState = {
    isDragging: false,
    dragItems: [],       // Array of items being dragged
    dragEl: null,        // The main element being dragged (original)
    ghostEl: null,       // The floating visual element
    placeholder: null,   // The visual placeholder in the list
    sourceType: null,    // 'deckA', 'deckB', 'library'
    startX: 0, startY: 0,
    currentX: 0, currentY: 0,
    scrollingContainer: null,
    autoScrollInterval: null,
    mouseDown: false,
    hoverDeckId: null,
    hoverGroupId: null
};

function initCustomDnD() {
    window.addEventListener('mousemove', onDndMove, { passive: false });
    window.addEventListener('mouseup', onDndUp);

    // Deck Info dragging
    document.querySelectorAll('.deck-info-drag-handle').forEach(el => {
        el.onmousedown = (e) => {
            const isA = el.closest('#deck-a') !== null;
            const deckKey = isA ? 'deckA' : 'deckB';
            const deckState = state[deckKey];
            if (!deckState.currentUrl) return;
            
            const item = {
                url: deckState.currentUrl,
                title: document.getElementById(`info-${isA?'a':'b'}-title`).textContent,
                id: deckState.currentTrackId || (`deck${isA?'A':'B'}_${Date.now()}`),
                loopStart: deckState.loopStart,
                loopEnd: deckState.loopEnd
            };
            onDndDown(e, item, `${deckKey}_direct`, el);
        };
    });
}

function onDndDown(e, item, type, element) {
    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
    if (e.button !== 0) return; // Only left click

    dndState.isDragging = false; // Wait for movement to start dragging
    dndState.sourceType = type;
    dndState.dragEl = element;
    dndState.startX = e.clientX;
    dndState.startY = e.clientY;

    if (state.selectedIds.has(item.id)) {
        const sourceList = type === 'library' ? state.library : (type === 'deckA' ? state.deckA.queue : state.deckB.queue);
        const dragged = [];
        const findSelected = (list) => {
            list.forEach(i => {
                if (state.selectedIds.has(i.id)) dragged.push(i);
                else if (i.type === 'group' && i.children) findSelected(i.children);
            });
        };
        findSelected(sourceList);
        dndState.dragItems = dragged;
    } else {
        dndState.dragItems = [item];
    }
    
    // Potential drag start
    dndState.mouseDown = true;
}

function onDndMove(e) {
    if (!dndState.mouseDown) return;

    // Start dragging if moved more than 5px
    if (!dndState.isDragging) {
        if (Math.abs(e.clientX - dndState.startX) > 5 || Math.abs(e.clientY - dndState.startY) > 5) {
            startDrag(e);
        }
    }

    if (dndState.isDragging) {
        e.preventDefault(); // Prevent text selection etc.
        dndState.currentX = e.clientX;
        dndState.currentY = e.clientY;

        // Move ghost
        if (dndState.ghostEl) {
            dndState.ghostEl.style.transform = `translate(${e.clientX + 10}px, ${e.clientY + 10}px)`;
        }

        // Find drop target
        const elBeneath = document.elementFromPoint(e.clientX, e.clientY);
        const hoverGroupEl = elBeneath ? elBeneath.closest('.queue-item.group') : null;
        const hoverDeckEl = elBeneath ? elBeneath.closest('.deck') : null;
        
        document.querySelectorAll('.group-hover').forEach(el => el.classList.remove('group-hover'));
        document.querySelectorAll('.deck-hover').forEach(el => el.classList.remove('deck-hover'));
        dndState.hoverDeckId = null;

        if (hoverDeckEl) {
            hoverDeckEl.classList.add('deck-hover');
            dndState.hoverDeckId = hoverDeckEl.id;
        }

        if (hoverGroupEl && !hoverGroupEl.classList.contains('dragging-source')) {
            const box = hoverGroupEl.getBoundingClientRect();
            const relY = e.clientY - box.top;
            const threshold = box.height * 0.25; // Top/bottom 25% for reordering between
            
            if (relY > threshold && relY < box.height - threshold) {
                // Hovering middle -> drop inside
                hoverGroupEl.classList.add('group-hover');
                dndState.hoverGroupId = hoverGroupEl.dataset.id;
            } else {
                // Hovering edges -> drop between
                dndState.hoverGroupId = null;
            }
        } else {
            dndState.hoverGroupId = null;
        }
        
        const currentContainer = getContainerFromPoint(e.clientX, e.clientY);
        if (currentContainer) dndState.scrollingContainer = currentContainer;
        
        if (dndState.hoverGroupId || dndState.hoverDeckId) {
            if (dndState.placeholder) dndState.placeholder.style.display = 'none';
        } else {
            if (dndState.placeholder) dndState.placeholder.style.display = '';
            handleDragHover(currentContainer, e.clientY);
        }

        // Auto scroll - Use the last known scrolling container if currently outside
        handleAutoScroll(dndState.scrollingContainer, e.clientY);
    }
}

function startDrag(e) {
    dndState.isDragging = true;

    // Create ghost element
    dndState.ghostEl = dndState.dragEl.cloneNode(true);
    dndState.ghostEl.classList.add('dnd-ghost');
    dndState.ghostEl.style.width = `${dndState.dragEl.offsetWidth}px`;
    dndState.ghostEl.style.position = 'fixed';
    dndState.ghostEl.style.left = '0';
    dndState.ghostEl.style.top = '0';
    dndState.ghostEl.style.zIndex = '9999';
    dndState.ghostEl.style.pointerEvents = 'none';
    dndState.ghostEl.style.opacity = '0.9';
    dndState.ghostEl.style.transform = `translate(${e.clientX + 10}px, ${e.clientY + 10}px)`;
    
    // Add badge if multiple items
    if (dndState.dragItems.length > 1) {
        const badge = document.createElement('div');
        badge.className = 'ghost-badge';
        badge.textContent = `${dndState.dragItems.length}`;
        dndState.ghostEl.appendChild(badge);
    }
    
    document.body.appendChild(dndState.ghostEl);

    // Create placeholder
    dndState.placeholder = document.createElement('div');
    dndState.placeholder.className = 'queue-placeholder';

    // Hide all dragged DOM elements visually
    const containers = document.querySelectorAll('.queue-list, .library-list');
    const dragIds = new Set(dndState.dragItems.map(i => i.id));
    
    containers.forEach(container => {
        const items = container.querySelectorAll('.queue-item');
        items.forEach(el => {
            if (dragIds.has(el.dataset.id)) {
                el.classList.add('dragging-source');
                el.style.opacity = '0.5'; // Visually fade the original items
            }
        });
    });

    document.body.classList.add('dragging-active');
    if (window.getSelection) {
        window.getSelection().removeAllRanges();
    }
}

function onDndUp(e) {
    dndState.mouseDown = false;

    if (dndState.isDragging) {
        finishDrag();
    }

    // Valid click (not drag) is handled by onclick on the element
}

function finishDrag() {
    // 1. Determine drop target
    let targetType = null;
    let targetId = null; // ID to drop BEFORE

    if (dndState.placeholder && dndState.placeholder.parentNode) {
        const container = dndState.placeholder.parentNode;
        const rootList = container.closest('.queue-list, .library-list');

        if (rootList) {
            if (rootList.id === 'queue-list-a') targetType = 'deckA';
            else if (rootList.id === 'queue-list-b') targetType = 'deckB';
            else if (rootList.id === 'library-list') targetType = 'library';
        }

        const nextEl = dndState.placeholder.nextElementSibling;
        if (nextEl && nextEl.dataset.id) {
            targetId = nextEl.dataset.id;
        } else if (container.classList.contains('group-children')) {
            const groupEl = container.closest('.queue-item.group');
            if (groupEl && groupEl.dataset.id) {
                targetId = groupEl.dataset.id + '_inside';
            }
        }

        if (dndState.hoverGroupId) {
            targetId = dndState.hoverGroupId + '_inside';
        }

        console.log("Finish Drag:", { targetType, targetId, from: dndState.sourceType });
    } else {
        console.log("No placeholder parent found.");
    }

    // 2. Cleanup
    if (dndState.ghostEl) dndState.ghostEl.remove();
    if (dndState.placeholder) dndState.placeholder.remove();
    
    // Remove pulling styles
    document.querySelectorAll('.dragging-source').forEach(el => {
        el.classList.remove('dragging-source');
        el.style.opacity = '';
    });
    document.querySelectorAll('.group-hover').forEach(el => el.classList.remove('group-hover'));
    document.querySelectorAll('.deck-hover').forEach(el => el.classList.remove('deck-hover'));
    
    document.body.classList.remove('dragging-active');
    clearInterval(dndState.autoScrollInterval);
    dndState.scrollingContainer = null;

    // Save states needed for execute move
    const fromType = dndState.sourceType;
    const itemsToMove = [...dndState.dragItems];
    const dropDeckId = dndState.hoverDeckId;

    dndState.isDragging = false;
    dndState.ghostEl = null;
    dndState.placeholder = null;
    dndState.dragEl = null;
    dndState.dragItems = [];
    dndState.hoverDeckId = null;

    // Handle Drop to Deck
    if (dropDeckId && itemsToMove.length > 0) {
        const deckKey = dropDeckId === 'deck-a' ? 'deckA' : 'deckB';
        const item = itemsToMove[0];
        if (item.type === 'group') {
            loadGroupDirect(deckKey, item);
        } else {
            loadTrackDirect(deckKey, item.url, false, item.id, item);
            showToast(`Loaded to Deck ${deckKey === 'deckA' ? 'A' : 'B'} (Paused)`);
        }
        return; // Skip normal list reordering
    }

    // 3. Execute Move (List Reordering)
    if (targetType && itemsToMove.length > 0) {
        let anchorIdForEasyMove = targetId ? targetId : null; // null means end of list
        
        // If it was a direct deck drag, pass items directly (Copying)
        if (fromType === 'deckA_direct' || fromType === 'deckB_direct') {
            handleEasyMove(anchorIdForEasyMove, targetType, itemsToMove);
        } else {
            // Standard list move: Let handleEasyMove extract based on selectedIds
            state.selectedIds.clear();
            itemsToMove.forEach(i => state.selectedIds.add(i.id));
            handleEasyMove(anchorIdForEasyMove, targetType);
        }
    }
}

function getContainerFromPoint(x, y) {
    const el = document.elementFromPoint(x, y);
    return el ? el.closest('.group-children, .queue-list, .library-list') : null;
}
function handleDragHover(container, y) {
    if (!container) return;

    // Check if we can start reordering in this container
    // If dragging from Lib to Queue, or Queue to same Queue, or Queue to Lib
    // (Assuming all moves allowed for now)

    if (!dndState.placeholder) return;

    // Check direct parent, not ancestor (container.contains would match nested .group-children too)
    if (dndState.placeholder.parentNode !== container) {
        container.appendChild(dndState.placeholder);
    }

    const afterElement = getDragAfterElement(container, y);
    if (afterElement == null) {
        container.appendChild(dndState.placeholder);
    } else {
        container.insertBefore(dndState.placeholder, afterElement);
    }
}

function handleAutoScroll(container, y) {
    clearInterval(dndState.autoScrollInterval);
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const scrollZone = 60;
    const maxSpeed = 20;

    let speed = 0;
    if (y < rect.top + scrollZone) {
        const dist = (rect.top + scrollZone) - y;
        speed = -Math.pow(Math.min(3, dist / scrollZone), 1.5) * maxSpeed;
    } else if (y > rect.bottom - scrollZone) {
        const dist = y - (rect.bottom - scrollZone);
        speed = Math.pow(Math.min(3, dist / scrollZone), 1.5) * maxSpeed;
    }

    if (speed !== 0) {
        dndState.autoScrollInterval = setInterval(() => {
            container.scrollTop += speed;
        }, 16);
    }
}

function handleReorder(fromType, itemId, targetId, targetType = null) {
    if (!targetType) targetType = fromType; // Default to same list

    const sourceList = (fromType === 'library') ? state.library : ((fromType === 'deckA') ? state.deckA.queue : state.deckB.queue);
    const targetList = (targetType === 'library') ? state.library : ((targetType === 'deckA') ? state.deckA.queue : state.deckB.queue);

    // 並べ替え前の状態をUndoスタックへ
    pushHistory();

    const removed = removeNodes(sourceList, i => i.id === itemId);
    if (removed.length === 0) return;
    
    if (!insertNodes(targetList, targetId, removed)) {
        targetList.push(...removed);
    }

    saveState(false);
    renderAllLists();
}

function getDragAfterElement(container, y) {
    // Only query DIRECT children to prevent insertBefore failures with nested elements
    const draggableElements = [...container.querySelectorAll(':scope > .queue-item:not(.dragging-source):not(.queue-placeholder)')];

    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function updateSelectors(id, list) {
    const sel = document.getElementById(id);
    sel.innerHTML = list.length ? '' : '<option>(Empty)</option>';
    list.forEach(i => {
        const opt = document.createElement('option');
        opt.value = i.id;
        opt.textContent = i.title;
        sel.appendChild(opt);
    });
}

// ============ PLAYBACK & SWITCH ============

function switchDeck(forceMode = null) {
    const toB = (state.mode === 'A');
    state.mode = toB ? 'B' : 'A';

    const targetDeck = toB ? state.deckB : state.deckA;
    const mode = (typeof forceMode === 'string') ? forceMode : (toB ? state.settings.switchModeAB : state.settings.switchModeBA);

    // Check Directional Triggers
    const timerEnabled = toB ? state.settings.timerEnabledAB : state.settings.timerEnabledBA;
    const obsEnabled = toB ? state.settings.obsEnabledAB : state.settings.obsEnabledBA;
    const fadeDuration = (toB ? state.settings.fadeDurationAB : state.settings.fadeDurationBA) || 2.0;

    // Stop Timer, restart if enabled for this direction
    stopTimer();
    if (timerEnabled) {
        let mins = toB ? state.settings.timerMinutesAB : state.settings.timerMinutesBA;
        let secs = toB ? state.settings.timerSecondsAB : state.settings.timerSecondsBA;
        if (mins === undefined) mins = 10;
        if (secs === undefined) secs = 0;
        startTimer(mins, secs);
    }

    if (mode === 'restart') {
        const p = targetDeck.activePlayer === 3 ? targetDeck.pPreload : (targetDeck.activePlayer === 1 ? targetDeck.p1 : targetDeck.p2);
        if (targetDeck.videoId) {
            if (p && p.pauseVideo) p.pauseVideo();
            p.seekTo(0);
            state.pendingPlay = true;
        } else {
            state.pendingPlay = false;
        }
    } else if (mode === 'next') {
        const modeKey = toB ? state.settings.playModeB : state.settings.playModeA;
        if (targetDeck.queue.length > 0) {
            // Flatten tracks
            const allTracks = flattenTracks(targetDeck.queue);
            
            if (allTracks.length > 0) {
                const currentVid = extractVideoId(targetDeck.currentUrl || "");
                // Try finding by ID first, then by video URL as fallback
                let currentIdx = allTracks.findIndex(i => i.id === targetDeck.currentTrackId);
                if (currentIdx < 0) currentIdx = allTracks.findIndex(i => extractVideoId(i.url) === currentVid);
                if (currentIdx < 0) currentIdx = 0;
                
                let candidates = allTracks;
                if (modeKey && modeKey.startsWith('group_')) {
                    const currentGroupId = allTracks[currentIdx].groupId;
                    candidates = allTracks.filter(i => i.groupId === currentGroupId);
                    if (candidates.length === 0) candidates = allTracks; 
                }
                
                let nextTrack;
                if (modeKey === 'shuffle' || modeKey === 'group_shuffle') {
                    if (candidates.length > 1) {
                        // Exclude CURRENT TRACK by ID if possible, otherwise by URL
                        const filtered = candidates.filter(i => i.id !== targetDeck.currentTrackId && extractVideoId(i.url) !== currentVid);
                        const pool = filtered.length > 0 ? filtered : candidates.filter(i => i.id !== targetDeck.currentTrackId);
                        nextTrack = pool[Math.floor(Math.random() * pool.length)];
                    } else {
                        nextTrack = candidates[0];
                    }
                } else {
                    let cIdx = candidates.findIndex(i => (targetDeck.currentTrackId && i.id === targetDeck.currentTrackId) || extractVideoId(i.url) === currentVid);
                    if (cIdx >= 0 && cIdx < candidates.length - 1) {
                        nextTrack = candidates[cIdx + 1];
                    } else {
                        nextTrack = candidates[0]; // Loop back
                    }
                }

                loadTrackDirect(toB ? 'deckB' : 'deckA', nextTrack.url, false, nextTrack.id);
                state.pendingPlay = true;

                if (nextTrack.loopStart) {
                    const keyLower = toB ? 'b' : 'a';
                    targetDeck.loopStart = nextTrack.loopStart;
                    targetDeck.loopEnd = nextTrack.loopEnd;
                    document.getElementById(`loop-start-${keyLower}`).value = nextTrack.loopStart;
                    document.getElementById(`loop-end-${keyLower}`).value = nextTrack.loopEnd;
                }
            }
        }
    } else {
        const p = targetDeck.activePlayer === 3 ? targetDeck.pPreload : (targetDeck.activePlayer === 1 ? targetDeck.p1 : targetDeck.p2);
        if (targetDeck.videoId) {
            p.playVideo();
        }
        state.pendingPlay = false;
    }

    animateCrossfade(toB ? 0 : 100, toB ? 100 : 0, fadeDuration * 1000);

    document.getElementById('deck-a').classList.toggle('active', !toB);
    document.getElementById('deck-b').classList.toggle('active', toB);
    document.getElementById('btn-switch-deck').classList.toggle('battle-mode', toB);
    const btnText = document.querySelector('#btn-switch-deck .btn-text');
    if (btnText) btnText.textContent = toB ? '🔀 TO DECK A' : '🔀 TO DECK B';

    // OBS Switch Trigger (direction-specific)
    if (obsEnabled && state.wsConnected && state.ws) {
        const sceneName = toB ? (state.settings.obsSceneB || 'Deck B') : (state.settings.obsSceneA || 'Deck A');
        state.ws.send(JSON.stringify({ type: 'obs_switch', scene: sceneName }));
    }

    state.pendingHotkeySwitch = false;
}

function loadTrackDirect(deckKey, url, autoPlay = true, trackId = null, trackInfo = null) {
    if (!url) {
        clearDeck(deckKey);
        return;
    }
    const vid = extractVideoId(url);
    if (!vid) return;

    const isA = deckKey === 'deckA';
    const keyLower = isA ? 'a' : 'b';
    const deckState = state[deckKey];

    // Update Input UI
    document.getElementById(`input-${keyLower}`).value = url;

    deckState.videoId = vid;
    deckState.currentUrl = url;
    deckState.currentTrackId = trackId;
    deckState.restricted = false;
    document.querySelectorAll(`.deck-${keyLower} .mini-player-container`).forEach(c => c.classList.add('has-track'));

    const activeP = deckState.activePlayer === 3 ? deckState.pPreload : (deckState.activePlayer === 1 ? deckState.p1 : deckState.p2);
    const isPlaying = activeP && activeP.getPlayerState && activeP.getPlayerState() === YT.PlayerState.PLAYING;

    // トラック情報にloop設定やTrimがあれば反映、なければデフォルトにリセット
    if (trackInfo) {
        deckState.loopStart = trackInfo.loopStart || 0;
        deckState.loopEnd = trackInfo.loopEnd || 9999;
        deckState.trim = trackInfo.trim || 1.0;
        
        document.getElementById(`loop-start-${keyLower}`).value = deckState.loopStart;
        document.getElementById(`loop-end-${keyLower}`).value = deckState.loopEnd === 9999 ? 0 : deckState.loopEnd;
        
        // Trim UI update
        const trimValInput = document.getElementById(`trim-val-${keyLower}`);
        if (trimValInput) trimValInput.value = deckState.trim.toFixed(2);
        
        // Auto Indicator only reflects the setting now, not if trim exists.
        const indicator = document.getElementById(`trim-auto-${keyLower}`);
        if (indicator) {
            indicator.classList.toggle('active', deckState.trimAutoEnabled === true);
        }
    } else {
        deckState.loopStart = 0;
        deckState.loopEnd = 9999;
        deckState.trim = 1.0;
        document.getElementById(`loop-start-${keyLower}`).value = 0;
        document.getElementById(`loop-end-${keyLower}`).value = 9999;
        
        const trimValInput = document.getElementById(`trim-val-${keyLower}`);
        if (trimValInput) trimValInput.value = '1.00';

        const indicator = document.getElementById(`trim-auto-${keyLower}`);
        if (indicator) {
            indicator.classList.toggle('active', deckState.trimAutoEnabled === true);
        }
    }
    
    // Restore RMS from metadata if available
    if (trackInfo && trackInfo.rms !== undefined) {
        deckState.lastRms = trackInfo.rms;
    }

    // Auto-Analysis (Auto-Scan): Trigger if enabled.
    // 修正: 既に解析済み(trim!==1.0等)であっても、Autoがオンなら常に最新の基準で再スキャンする
    if (vid && state.ws && state.wsConnected && deckState.trimAutoEnabled) {
        const otherDeck = isA ? state.deckB : state.deckA;
        let targetRms = state.settings.targetRms || 0.08;
        
        // 隣のデッキに合わせるモード
        if (state.settings.syncTrim && otherDeck.videoId && otherDeck.lastRms) {
            targetRms = otherDeck.lastRms;
            state.settings.targetRms = parseFloat(targetRms.toFixed(4));
            const rmsEl = document.getElementById('setting-target-rms');
            if (rmsEl) rmsEl.value = state.settings.targetRms;
            saveState(false);
            
            const indicator = document.getElementById(`trim-auto-${keyLower}`);
            if (indicator) {
                indicator.textContent = 'SCANNING...';
                indicator.classList.add('trim-scanning');
            }
            state.ws.send(JSON.stringify({ type: 'analyze_loop', url: url, trim_only: true, target_rms: targetRms }));
        } else if (state.settings.syncTrim && !otherDeck.videoId) {
            // 隣に曲がない → 待機
            deckState.pendingSyncTrim = true;
            const indicator = document.getElementById(`trim-auto-${keyLower}`);
            if (indicator) {
                indicator.textContent = 'WAITING...';
                indicator.classList.add('trim-scanning');
            }
        } else if (state.settings.syncTrim && otherDeck.videoId && !otherDeck.lastRms) {
            // 隣に曲はあるが解析待ち → 待機
            deckState.pendingSyncTrim = true;
            const indicator = document.getElementById(`trim-auto-${keyLower}`);
            if (indicator) {
                indicator.textContent = 'WAITING...';
                indicator.classList.add('trim-scanning');
            }
            // もし隣のデッキが実際に解析中でなければ、強制的に解析を開始させる
            const otherLower = isA ? 'b' : 'a';
            const otherIndicator = document.getElementById(`trim-auto-${otherLower}`);
            if (otherIndicator && !otherIndicator.classList.contains('trim-scanning')) {
                otherIndicator.textContent = 'SCANNING...';
                otherIndicator.classList.add('trim-scanning');
                state.ws.send(JSON.stringify({ type: 'analyze_loop', url: otherDeck.currentUrl, trim_only: true, target_rms: state.settings.targetRms || 0.08 }));
            }
        } else {
            // デフォルトの基準でスキャン
            const indicator = document.getElementById(`trim-auto-${keyLower}`);
            if (indicator) {
                indicator.textContent = 'SCANNING...';
                indicator.classList.add('trim-scanning');
            }
            state.ws.send(JSON.stringify({ type: 'analyze_loop', url: url, trim_only: true, target_rms: targetRms }));
        }
    } else {
        const indicator = document.getElementById(`trim-auto-${keyLower}`);
        if (indicator) {
            indicator.textContent = 'AUTO';
            indicator.classList.remove('trim-scanning');
        }
    }

    // 隣のデッキが自分のRMSを待っている場合のトリガー
    const otherKey = isA ? 'deckB' : 'deckA';
    const otherDk = state[otherKey];
    const otherLower = isA ? 'b' : 'a';
    if (otherDk.pendingSyncTrim && otherDk.currentUrl && deckState.lastRms) {
        otherDk.pendingSyncTrim = false;
        const tRms = deckState.lastRms;
        state.settings.targetRms = parseFloat(tRms.toFixed(4));
        const rmsEl = document.getElementById('setting-target-rms');
        if (rmsEl) rmsEl.value = state.settings.targetRms;
        
        const otherIndicator = document.getElementById(`trim-auto-${otherLower}`);
        if (otherIndicator) {
            otherIndicator.textContent = 'SCANNING...';
        }
        state.ws.send(JSON.stringify({ type: 'analyze_loop', url: otherDk.currentUrl, trim_only: true, target_rms: tRms }));
    }
    
    if (autoPlay && isPlaying) {
        // === Fade sequence: DO NOT call resetDeck (it would pause p1/p2) ===
        // Cancel any ongoing fade, but keep players running
        if (!deckState.fadeId) deckState.fadeId = 0;
        deckState.fadeId++;
        deckState.fadeMultiplier = 1.0;
        deckState.nextLoopQueued = false;
        applyMixer();

        // Use a player that is NOT currently playing for preloading
        deckState.pendingFade = { vid, autoPlay, trackId, trackInfo };
        
        const loaderP = (deckState.activePlayer === 3) ? deckState.p1 : deckState.pPreload;
        if (loaderP) {
            loaderP.cueVideoById({videoId: vid, suggestedQuality: 'tiny'});
        } else {
            console.error("No loader player ready for", deckKey);
            deckState.p1.cueVideoById({videoId: vid, suggestedQuality: 'tiny'});
        }
    } else {
        // Not playing -> safe to fully reset and load
        resetDeck(deckKey);
        deckState.activePlayer = 1;
        if (autoPlay) {
            deckState.p1.loadVideoById({videoId: vid, suggestedQuality: 'tiny'});
        } else {
            deckState.p1.cueVideoById({videoId: vid, suggestedQuality: 'tiny'});
        }
        deckState.p2.cueVideoById({videoId: vid, suggestedQuality: 'tiny'});
    }
    fetchTitle(vid, `info-${keyLower}-title`, deckKey);
}

function clearDeck(deckKey) {
    const keyUpper = deckKey === 'deckA' ? 'A' : 'B';
    const keyLower = deckKey === 'deckA' ? 'a' : 'b';
    const deckState = state[deckKey];

    // Update State
    deckState.videoId = '';
    deckState.currentUrl = '';
    deckState.currentTrackId = null;
    deckState.restricted = false;
    document.querySelectorAll(`.deck-${keyLower} .mini-player-container`).forEach(c => c.classList.remove('has-track'));
    deckState.loopStart = 0;
    deckState.loopEnd = 9999;
    deckState.lastRms = undefined;
    deckState.pendingSyncTrim = false;
    deckState.trim = 1.0;
    document.getElementById(`loop-start-${keyLower}`).value = '0';
    document.getElementById(`loop-end-${keyLower}`).value = '0';
    const trimValEl = document.getElementById(`trim-val-${keyLower}`);
    if (trimValEl) trimValEl.value = '1.00';
    const trimAutoEl = document.getElementById(`trim-auto-${keyLower}`);
    if (trimAutoEl) {
        trimAutoEl.textContent = 'AUTO';
        trimAutoEl.classList.remove('trim-scanning');
    }
    resetDeck(deckKey);
    if (deckState.p1) deckState.p1.stopVideo();
    if (deckState.p2) deckState.p2.stopVideo();

    // Update UI
    document.getElementById(`input-${keyLower}`).value = '';
    document.getElementById(`info-${keyLower}-title`).textContent = 'No Track';
    const timeEl = document.getElementById(`info-${keyLower}-time`);
    if (timeEl) timeEl.textContent = '00:00 / 00:00';
    const seekEl = document.getElementById(`seek-${keyLower}`);
    if (seekEl) {
        seekEl.value = 0;
        seekEl.style.backgroundSize = '0% 100%';
    }
    const markEl = document.getElementById(`deck-${keyLower}-group-mark`);
    if (markEl) markEl.style.display = 'none';

    showToast(`Cleared Deck ${keyUpper}`);
    saveState(false);
}

let currentFadeId = 0;
function animateCrossfade(start, end, duration) {
    const fadeId = ++currentFadeId;
    const startTime = Date.now();
    function step() {
        if (fadeId !== currentFadeId) return; // Cancel if new fade started

        const progress = Math.min((Date.now() - startTime) / duration, 1);
        state.crossfade = start + (end - start) * (1 - Math.pow(1 - progress, 3));
        applyMixer();
        if (progress < 1) requestAnimationFrame(step);
        else {
            if (state.mode === 'A') {
                if (state.deckB.p1) state.deckB.p1.pauseVideo();
                if (state.deckB.p2) state.deckB.p2.pauseVideo();
            } else {
                if (state.deckA.p1) state.deckA.p1.pauseVideo();
                if (state.deckA.p2) state.deckA.p2.pauseVideo();
            }

            if (state.pendingPlay) {
                const targetDeck = state.mode === 'A' ? state.deckA : state.deckB;
                const p = targetDeck.activePlayer === 3 ? targetDeck.pPreload : (targetDeck.activePlayer === 1 ? targetDeck.p1 : targetDeck.p2);
                if (p && p.playVideo && targetDeck.videoId) p.playVideo();
                state.pendingPlay = false;
            }
        }
    }
    requestAnimationFrame(step);
}

function animateTrimChange(deckKey, targetTrim) {
    const deck = state[deckKey];
    const keyLower = deckKey === 'deckA' ? 'a' : 'b';
    const startTrim = deck.trim || 1.0;
    const duration = 2000; // 2 seconds smoothing
    const startTime = Date.now();
    
    // UI Visual Feedback
    const container = document.getElementById(`trim-container-${keyLower}`);
    const indicator = document.getElementById(`trim-auto-${keyLower}`);
    if (container) container.classList.add('trim-auto-flash');
    if (indicator) {
        if (deck.trimAutoEnabled !== false) {
            indicator.classList.add('active');
        }
    }
    
    function step() {
        const progress = Math.min((Date.now() - startTime) / duration, 1);
        const currentTrim = startTrim + (targetTrim - startTrim) * progress;
        
        deck.trim = currentTrim;
        
        // Update UI
        const trimValInput = document.getElementById(`trim-val-${keyLower}`);
        if (trimValInput) trimValInput.value = currentTrim.toFixed(2);
        
        applyMixer();
        
        if (progress < 1) {
            requestAnimationFrame(step);
        } else {
            if (container) setTimeout(() => container.classList.remove('trim-auto-flash'), 500);
            // Reset indicator text from SCANNING... back to AUTO
            if (indicator) {
                indicator.textContent = 'AUTO';
                indicator.classList.remove('trim-scanning');
            }
        }
    }
    requestAnimationFrame(step);
}

function animateDeckFade(deckKey, start, end, duration, onComplete) {
    const deck = state[deckKey];
    if (!deck.fadeId) deck.fadeId = 0;
    const fadeId = ++deck.fadeId; 
    const startTime = Date.now();

    function step() {
        if (fadeId !== deck.fadeId) return;

        const progress = Math.min((Date.now() - startTime) / duration, 1);
        deck.fadeMultiplier = start + (end - start) * (1 - Math.pow(1 - progress, 3));
        applyMixer();

        if (progress < 1) {
            requestAnimationFrame(step);
        } else {
            if (onComplete) onComplete();
        }
    }
    requestAnimationFrame(step);
}

function getCalculatedVolume(k) {
    const deckKey = k === 'a' ? 'deckA' : 'deckB';
    const deck = state[deckKey];
    
    const deckVolVal = parseFloat(document.getElementById(`vol-${k}`).value) || 0;
    const xFadeMult = k === 'a' ? ((100 - state.crossfade) / 100) : (state.crossfade / 100);
    const masterVolEl = document.getElementById('master-vol');
    const masterVol = masterVolEl ? (masterVolEl.value / 100) : 1.0;
    
    // 計算結果
    let vol = deckVolVal * xFadeMult * masterVol * deck.fadeMultiplier * (deck.trim || 1.0);

    // ループ切り替え（オーバーラップ）期間中の音量スパイク抑制
    // 二つのプレイヤーが重なるため、そのままでは音量が最大2倍（+6dB）になるのを防ぐ
    if (deck.switching) {
        vol *= 0.6; 
    }

    return Math.min(100, Math.max(0, vol));
}

function applyMixer() {
    const slider = document.getElementById('crossfader');
    if (slider) slider.value = state.crossfade;

    ['a', 'b'].forEach(k => {
        const deckKey = k === 'a' ? 'deckA' : 'deckB';
        const deck = state[deckKey];
        
        // 警告表示用の計算
        const deckVolVal = parseFloat(document.getElementById(`vol-${k}`).value) || 0;
        const combinedVol = deckVolVal * (deck.trim || 1.0);
        const label = document.getElementById(`trim-label-${k}`);
        if (label) {
            label.classList.toggle('trim-clipping', combinedVol > 100);
        }

        const finalVol = getCalculatedVolume(k);
        
        // 1. どのプレイヤーが音を出すべきか判定
        // ループ切り替え中（switching）は p1 と p2 の両方。それ以外は activePlayer のみ。
        const isP1Active = (deck.activePlayer === 1) || (deck.switching);
        const isP2Active = (deck.activePlayer === 2) || (deck.switching);
        const isPPreloadActive = (deck.activePlayer === 3);

        if (deck.p1) deck.p1.setVolume(isP1Active ? finalVol : 0);
        if (deck.p2) deck.p2.setVolume(isP2Active ? finalVol : 0);
        if (deck.pPreload) deck.pPreload.setVolume(isPPreloadActive ? finalVol : 0);
    });
}

function togglePlay(deckKey) {
    // Check if ANY deck is currently playing
    const aPlayer = state.deckA.activePlayer === 3 ? state.deckA.pPreload : (state.deckA.activePlayer === 1 ? state.deckA.p1 : state.deckA.p2);
    const aPl = aPlayer && aPlayer.getPlayerState && aPlayer.getPlayerState() === YT.PlayerState.PLAYING;
    const bPlayer = state.deckB.activePlayer === 3 ? state.deckB.pPreload : (state.deckB.activePlayer === 1 ? state.deckB.p1 : state.deckB.p2);
    const bPl = bPlayer && bPlayer.getPlayerState && bPlayer.getPlayerState() === YT.PlayerState.PLAYING;

    if (aPl || bPl) {
        // Something is playing → Pause ALL decks
        if (state.deckA.p1 && state.deckA.p1.pauseVideo) state.deckA.p1.pauseVideo();
        if (state.deckA.p2 && state.deckA.p2.pauseVideo) state.deckA.p2.pauseVideo();
        if (state.deckA.pPreload && state.deckA.pPreload.pauseVideo) state.deckA.pPreload.pauseVideo();
        if (state.deckB.p1 && state.deckB.p1.pauseVideo) state.deckB.p1.pauseVideo();
        if (state.deckB.p2 && state.deckB.p2.pauseVideo) state.deckB.p2.pauseVideo();
        if (state.deckB.pPreload && state.deckB.pPreload.pauseVideo) state.deckB.pPreload.pauseVideo();
    } else {
        // Nothing is playing → Play only the target deck if it has content
        const dk = state[deckKey];
        const p = dk.activePlayer === 3 ? dk.pPreload : (dk.activePlayer === 1 ? dk.p1 : dk.p2);
        if (p && p.playVideo && dk.videoId) p.playVideo();
    }
}

function updatePlayPauseIcons() {
    // Check states
    const aPlayer = state.deckA.activePlayer === 3 ? state.deckA.pPreload : (state.deckA.activePlayer === 1 ? state.deckA.p1 : state.deckA.p2);
    const aPl = aPlayer && aPlayer.getPlayerState && aPlayer.getPlayerState() === YT.PlayerState.PLAYING;
    const bPlayer = state.deckB.activePlayer === 3 ? state.deckB.pPreload : (state.deckB.activePlayer === 1 ? state.deckB.p1 : state.deckB.p2);
    const bPl = bPlayer && bPlayer.getPlayerState && bPlayer.getPlayerState() === YT.PlayerState.PLAYING;

    const btnA = document.getElementById('btn-play-a');
    const btnB = document.getElementById('btn-play-b');

    if (btnA) btnA.innerHTML = aPl ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play"></i>';
    if (btnB) btnB.innerHTML = bPl ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play"></i>';
}

/**
 * 再生速度を現在のスライダー値に合わせる（最軽量版）
 * 定期監視を廃止し、スライダー操作や曲開始時のみ実行して負荷を最小化
 */
function forceSpeedGuard() {
    const rateA = parseFloat(document.getElementById('speed-a').value) || 1.0;
    const rateB = parseFloat(document.getElementById('speed-b').value) || 1.0;

    // Deck A (Both players for seamless transition)
    if (state.deckA.p1 && state.deckA.p1.setPlaybackRate) state.deckA.p1.setPlaybackRate(rateA);
    if (state.deckA.p2 && state.deckA.p2.setPlaybackRate) state.deckA.p2.setPlaybackRate(rateA);
    // Deck B (Both players for seamless transition)
    if (state.deckB.p1 && state.deckB.p1.setPlaybackRate) state.deckB.p1.setPlaybackRate(rateB);
    if (state.deckB.p2 && state.deckB.p2.setPlaybackRate) state.deckB.p2.setPlaybackRate(rateB);
}

function handlePlayerError(deckKey, errorCode) {
    if (errorCode === 101 || errorCode === 150) {
        // Embedding restricted
        const deckState = (deckKey === 'deckA' ? state.deckA : state.deckB);
        deckState.restricted = true;
        
        const url = deckState.currentUrl;
        if (!url) return;
        
        const markRestricted = (list) => {
            list.forEach(i => {
                if (i.url === url) i.restricted = true;
                if (i.type === 'group' && i.children) markRestricted(i.children);
            });
        };
        markRestricted(state.library);
        markRestricted(state.deckA.queue);
        markRestricted(state.deckB.queue);
        
        showToast("⚠️ 埋め込み禁止動画を検知しました", "#ff5a5a");
        renderAllLists();
        updateDeckStatusUI();
        saveState(false);
    }
}

function updateDeckStatusUI() {
    ['a', 'b'].forEach(k => {
        const deckState = (k === 'a' ? state.deckA : state.deckB);
        const titleEl = document.getElementById(`info-${k}-title`);
        
        // Remove existing labels
        const existingWarning = titleEl.querySelector('.deck-restricted-warning');
        if (existingWarning) existingWarning.remove();
        
        if (deckState.restricted) {
            const warn = document.createElement('span');
            warn.className = 'deck-restricted-warning';
            warn.textContent = ' ⚠️ 埋込禁止';
            titleEl.appendChild(warn);
        }
    });
}

// ============ SEARCH AND REPLACE (OFFICE STYLE) ============
let searchMatches = [];
let searchCurrentIndex = -1;

function updateSearchMatches() {
    let findStr = document.getElementById('replace-find').value;
    const field = document.getElementById('replace-field').value;
    searchMatches = [];
    searchCurrentIndex = -1;

    // URLモードの場合、検索対象文字列からメタデータ（#以降）を除外してマッチングさせる
    if (field === 'url' && findStr.includes('#')) {
        findStr = findStr.split('#')[0];
    }

    if (!findStr) {
        document.getElementById('replace-status').textContent = "";
        return;
    }

    const scan = (list, path = []) => {
        list.forEach(item => {
            if (item.type === 'track' || !item.type) { 
                const text = item[field] || "";
                if (text.toLowerCase().includes(findStr.toLowerCase())) {
                    searchMatches.push({ item, path: [...path] });
                }
            } else if (item.type === 'group' && item.children) {
                scan(item.children, [...path, item]);
            }
        });
    };

    scan(state.library);
    scan(state.deckA.queue);
    scan(state.deckB.queue);

    const statusEl = document.getElementById('replace-status');
    if (searchMatches.length > 0) {
        statusEl.textContent = `${searchMatches.length} 件がヒットしました`;
    } else {
        statusEl.textContent = "見つかりませんでした";
    }
}

function findNextMatch() {
    if (searchMatches.length === 0 || document.getElementById('replace-find').value !== state._lastSearch) {
        state._lastSearch = document.getElementById('replace-find').value;
        updateSearchMatches();
    }
    if (searchMatches.length === 0) return;

    searchCurrentIndex = (searchCurrentIndex + 1) % searchMatches.length;
    const match = searchMatches[searchCurrentIndex];
    
    // Expand parents if collapsed
    match.path.forEach(parent => {
        if (parent.collapsed) {
            parent.collapsed = false;
        }
    });
    
    renderAllLists();
    
    // Highlight and Scroll
    setTimeout(() => {
        const el = document.querySelector(`[data-id="${match.item.id}"]`);
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.classList.add('search-highlight');
            setTimeout(() => el.classList.remove('search-highlight'), 2000);
        }
        document.getElementById('replace-status').textContent = `${searchCurrentIndex + 1} / ${searchMatches.length} 件目`;
    }, 50);
}

function performSingleReplace() {
    if (searchCurrentIndex === -1 || searchMatches.length === 0) {
        findNextMatch();
        return;
    }
    const match = searchMatches[searchCurrentIndex];
    let findStr = document.getElementById('replace-find').value;
    const replaceWith = document.getElementById('replace-with').value;
    const field = document.getElementById('replace-field').value;

    if (field === 'url' && findStr.includes('#')) {
        findStr = findStr.split('#')[0];
    }

    const currentText = match.item[field] || "";
    // 大文字小文字を区別せず置換
    const regex = new RegExp(findStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    if (currentText.match(regex)) {
        pushHistory();
        const newUrl = currentText.replace(regex, replaceWith);
        match.item[field] = newUrl;
        
        const applyMetaCb = document.getElementById('replace-meta-with');
        if (field === 'url' && applyMetaCb && applyMetaCb.checked) {
            applyMetadataToTrack(match.item, newUrl);
        }
        
        saveState();
        renderAllLists();
        updateSearchMatches(); 
        findNextMatch(); 
    }
}

function performReplaceAll() {
    let findStr = document.getElementById('replace-find').value;
    const replaceWith = document.getElementById('replace-with').value;
    const field = document.getElementById('replace-field').value;

    if (field === 'url' && findStr.includes('#')) {
        findStr = findStr.split('#')[0];
    }

    if (!findStr) return;
    
    pushHistory();
    let count = 0;
    const regex = new RegExp(findStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');

    const recursiveReplace = (list) => {
        const applyMetaCb = document.getElementById('replace-meta-with');
        const applyMeta = applyMetaCb ? applyMetaCb.checked : false;
        list.forEach(item => {
            if (item.type === 'track' || !item.type) {
                const text = item[field] || "";
                if (text.match(regex)) {
                    const newUrl = text.replace(regex, replaceWith);
                    item[field] = newUrl;
                    if (field === 'url' && applyMeta) {
                        applyMetadataToTrack(item, newUrl);
                    }
                    count++;
                }
            } else if (item.children) {
                recursiveReplace(item.children);
            }
        });
    };

    recursiveReplace(state.library);
    recursiveReplace(state.deckA.queue);
    recursiveReplace(state.deckB.queue);

    renderAllLists();
    saveState();
    showToast(`${count} 件置換しました`);
    updateSearchMatches();
}

function extractVideoId(url) {
    if (!url) return null;
    const m = url.match(/(?:youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/);
    return (m && m[1].length === 11) ? m[1] : null;
}

/**
 * URLフラグメントからメタデータを抽出してアイテムに反映する
 * まず既存のメタデータをリセットし、URLに含まれる値のみ再設定する
 */
function applyMetadataToTrack(item, url) {
    // まずリセット（置換後のURLにメタデータがなければクリアされる）
    delete item.loopStart;
    delete item.loopEnd;
    delete item.trim;
    
    if (!url || !url.includes('#')) return;
    const hash = url.split('#')[1];
    const params = new URLSearchParams(hash);
    
    if (params.has('loopStart')) item.loopStart = parseFloat(params.get('loopStart'));
    if (params.has('loopEnd')) item.loopEnd = parseFloat(params.get('loopEnd'));
    if (params.has('trim')) item.trim = parseFloat(params.get('trim'));
    if (params.has('title')) item.title = decodeURIComponent(params.get('title'));
}

function fetchTitle(vid, elId, deckKey = null) {
    fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${vid}`).then(r => r.json()).then(d => {
        if (d.title) {
            document.getElementById(elId).textContent = d.title;
            if (deckKey) {
                const deckState = (deckKey === 'deckA' ? state.deckA : state.deckB);
                deckState.title = d.title;
                updateDeckStatusUI();
            }
        }
    }).catch(() => { });
}

function resetAll() {
    if (state.mode === 'B') switchDeck();
    resetDeckA();
    resetDeckB();
}

function setupSeekAndVol() {
    ['a', 'b'].forEach(k => {
        const seekEl = document.getElementById(`seek-${k}`);
        if (seekEl) {
            seekEl.oninput = (e) => {
                const dk = k === 'a' ? state.deckA : state.deckB;
                const p = dk.activePlayer === 3 ? dk.pPreload : (dk.activePlayer === 1 ? dk.p1 : dk.p2);
                p.seekTo(p.getDuration() * (e.target.value / 100));
            };
        }
        
        const volEl = document.getElementById(`vol-${k}`);
        if (volEl) {
            volEl.oninput = applyMixer;
            volEl.onchange = () => { pushHistory(); saveState(false); };
        }

        const trimValInput = document.getElementById(`trim-val-${k}`);
        const trimAutoBtn = document.getElementById(`trim-auto-${k}`);
        
        if (trimValInput) {
            trimValInput.onchange = (e) => {
                if (!trimValInput.dataset.dragging) pushHistory();
                let val = parseFloat(e.target.value);
                if (isNaN(val) || val <= 0) val = 1.0;
                e.target.value = val.toFixed(2);
                
                const dk = k === 'a' ? state.deckA : state.deckB;
                dk.trim = val;
                applyMixer();
                
                // ドラッグ中以外（数値入力など）は即座に保存
                if (dk.videoId && !trimValInput.dataset.dragging) {
                    const findAndSave = (list) => {
                        const item = list.find(i => i.url === dk.currentUrl);
                        if (item) {
                            item.trim = val;
                            saveState(false);
                            return true;
                        }
                        for (const i of list) {
                            if (i.type === 'group' && i.children && findAndSave(i.children)) return true;
                        }
                        return false;
                    };
                    findAndSave(state.library);
                    findAndSave(state.deckA.queue);
                    findAndSave(state.deckB.queue);
                }
            };
        }
        
        const trimLabel = document.getElementById(`trim-label-${k}`);
        if (trimLabel && trimValInput) {
            let startY = 0;
            let startVal = 1.0;
            
            const onMouseMove = (e) => {
                const deltaY = startY - e.clientY; // drag up = positive
                let newVal = startVal + (deltaY * 0.02);
                
                // Limit Trim so that DeckVol * Trim <= 100
                const deckVolVal = parseFloat(document.getElementById(`vol-${k}`).value) || 0;
                if (deckVolVal > 0) {
                    const maxAllowedTrim = 100 / deckVolVal;
                    if (newVal > maxAllowedTrim) newVal = maxAllowedTrim;
                }

                if (newVal < 0.1) newVal = 0.1;
                
                trimValInput.value = newVal.toFixed(2);
                trimValInput.dispatchEvent(new Event('change'));
            };
            
            const onMouseUp = () => {
                delete trimValInput.dataset.dragging;
                
                // ドラッグ終了時に最終的な値をライブラリに反映して保存
                const dk = k === 'a' ? state.deckA : state.deckB;
                const finalVal = parseFloat(trimValInput.value);
                if (dk.videoId && !isNaN(finalVal)) {
                    const findAndSave = (list) => {
                        const item = list.find(i => i.url === dk.currentUrl);
                        if (item) {
                            item.trim = finalVal;
                            return true;
                        }
                        for (const i of list) {
                            if (i.type === 'group' && i.children && findAndSave(i.children)) return true;
                        }
                        return false;
                    };
                    findAndSave(state.library);
                    findAndSave(state.deckA.queue);
                    findAndSave(state.deckB.queue);
                    saveState(false);
                }

                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                document.body.style.cursor = '';
            };
            
            trimLabel.onmousedown = (e) => {
                pushHistory();
                trimValInput.dataset.dragging = "true";
                e.preventDefault();
                startY = e.clientY;
                startVal = parseFloat(trimValInput.value) || 1.0;
                document.body.style.cursor = 'ns-resize';
                
                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            };
        }
        
        if (trimAutoBtn) {
            trimAutoBtn.onclick = (e) => {
                const dk = k === 'a' ? state.deckA : state.deckB;
                const otherDk = k === 'a' ? state.deckB : state.deckA;
                const isActive = e.target.classList.toggle('active');
                dk.trimAutoEnabled = isActive;
                applyMixer();
                
                // AUTO OFF時: pendingSyncTrimをクリアし、テキストをリセット
                if (!isActive) {
                    dk.pendingSyncTrim = false;
                    e.target.textContent = 'AUTO';
                    e.target.classList.remove('trim-scanning');
                    
                    if (state.ws && state.wsConnected) {
                        state.ws.send(JSON.stringify({ type: 'cancel_analysis' }));
                    }
                    return;
                }
                
                // オートスキャン開始 (オンにした時)
                // 修正: 既に解析済みであっても、明示的にオンにした場合は再スキャンを実行する
                if (isActive && dk.currentUrl && state.ws && state.wsConnected) {
                    let targetRms = state.settings.targetRms || 0.08;
                    
                    if (state.settings.syncTrim) {
                        if (otherDk.videoId && otherDk.lastRms) {
                            targetRms = otherDk.lastRms;
                            state.settings.targetRms = parseFloat(targetRms.toFixed(4));
                            const rmsEl = document.getElementById('setting-target-rms');
                            if (rmsEl) rmsEl.value = state.settings.targetRms;
                            saveState(false);
                        } else if (otherDk.videoId && !otherDk.lastRms) {
                            // 曲はあるが解析待ち → 待機
                            dk.pendingSyncTrim = true;
                            e.target.textContent = 'WAITING...';
                            e.target.classList.add('trim-scanning');
                            
                            // 隣のデッキが解析中でなければ強制解析
                            const otherLower = k === 'a' ? 'b' : 'a';
                            const otherIndicator = document.getElementById(`trim-auto-${otherLower}`);
                            if (otherIndicator && !otherIndicator.classList.contains('trim-scanning')) {
                                otherIndicator.textContent = 'SCANNING...';
                                otherIndicator.classList.add('trim-scanning');
                                state.ws.send(JSON.stringify({ type: 'analyze_loop', url: otherDk.currentUrl, trim_only: true, target_rms: state.settings.targetRms || 0.08 }));
                            }
                            return;
                        } else if (!otherDk.videoId) {
                            // 曲がない → 待機
                            dk.pendingSyncTrim = true;
                            e.target.textContent = 'WAITING...';
                            e.target.classList.add('trim-scanning');
                            return;
                        }
                    }
                    
                    e.target.textContent = 'SCANNING...';
                    e.target.classList.add('trim-scanning');
                    state.ws.send(JSON.stringify({ type: 'analyze_loop', url: dk.currentUrl, trim_only: true, target_rms: targetRms }));
                }
            };
        }
    });
    document.getElementById('crossfader').oninput = (e) => {
        state.crossfade = parseInt(e.target.value);
        applyMixer();
    };
    const masterVolEl = document.getElementById('master-vol');
    if (masterVolEl) {
        masterVolEl.oninput = applyMixer;
    }
}

function adjustVolume(id, delta) {
    const el = document.getElementById(id);
    if (!el) return;
    let val = parseFloat(el.value) + delta;
    if (val > 100) val = 100;
    if (val < 0) val = 0;
    el.value = val;
    applyMixer();
}

// Websocket
function connectWebSocket() {
    if (state.ws) {
        state.ws.onopen = null;
        state.ws.onmessage = null;
        state.ws.onclose = null;
        state.ws.onerror = null;
        state.ws.close();
    }

    state.ws = new WebSocket(`ws://${location.host}/ws`);
    state.ws.onopen = () => {
        state.wsConnected = true;
        document.getElementById('ws-status-dot').className = 'status-dot connected';
        document.getElementById('ws-status-text').textContent = 'WS: Connected';
        state.ws.send(JSON.stringify({ type: 'get_state' }));
        console.log("WebSocket Connected");
        // No auto-connect here, wait for settings from 'state' message
    };
    state.ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'state') {
            if (msg.playlists) {
                state.deckA.queue = msg.playlists.deckA || [];
                state.deckB.queue = msg.playlists.deckB || [];
                state.library = msg.playlists.library || [];
                renderAllLists();
            }
            if (msg.settings) {
                Object.assign(state.settings, msg.settings);
                // Update UI from settings
                updatePlayModeUI('A');
                updatePlayModeUI('B');
                updateSwitchUI();
                if (document.querySelector(`#clipboard-target option[value="${state.settings.clipboardTargetDeck}"]`)) {
                    document.getElementById('clipboard-target').value = state.settings.clipboardTargetDeck;
                }
                updateClipWatchUI(state.settings.clipboardWatchEnabled || false);
                // 設定ロード後にOBS自動接続（onopen時よりも確実）
                tryAutoConnectObs();
            }
        } else if (msg.type === 'hotkey_triggered') {
            console.log("Global Hotkey Triggered:", msg.action);
            if (document.hidden) {
                state.pendingHotkeySwitch = true;
            } else {
                switchDeck();
            }
        } else if (msg.type === 'clipboard_url') {
            // Ignore if this matches what we just copied internally
            const normIncoming = msg.url.replace(/\r\n/g, '\n').trim();
            const normLastCopied = (state.lastInternalCopiedText || "").replace(/\r\n/g, '\n').trim();
            
            if (normLastCopied && normIncoming === normLastCopied) {
                console.log("Ignoring internal copy in clipboard monitor.");
                return;
            }
            processClipboardUrl(msg.url);
        } else if (msg.type === 'clipboard_update') {
            console.log("Clipboard Watch Status Updated via Hotkey:", msg.enabled);
            updateClipWatchUI(msg.enabled);
            state.settings.clipboardWatchEnabled = msg.enabled;
            showToast(`Clipboard Monitor: ${msg.enabled ? 'ON' : 'OFF'}`);
        } else if (msg.type === 'loop_analyzed') {
            state.isAnalyzing = false;
            document.getElementById('btn-cancel-analysis').classList.add('hidden');
            if (msg.success) {
                // Determine which deck this analysis was for
                // If it's a background auto-analysis, we need to match the URL
                const targetDecks = [];
                if (state.deckA.currentUrl === msg.url) targetDecks.push('deckA');
                if (state.deckB.currentUrl === msg.url) targetDecks.push('deckB');
                
                targetDecks.forEach(dkKey => {
                    const dk = state[dkKey];
                    const keyLower = dkKey === 'deckA' ? 'a' : 'b';

                    // Trim Only analysis response
                    if (msg.isTrimOnly) {
                        // Save RMS for sync-trim reference
                        if (msg.rms) {
                            dk.lastRms = msg.rms;
                        }
                        
                        if (msg.volGain) {
                            animateTrimChange(dkKey, msg.volGain);
                            
                            // Save to library/queue for persistence (ALL matching URLs)
                            const updateAllTracks = (list) => {
                                list.forEach(item => {
                                    if (item.url === msg.url) {
                                        item.trim = msg.volGain;
                                        if (msg.rms) item.rms = msg.rms;
                                    }
                                    if (item.type === 'group' && item.children) {
                                        updateAllTracks(item.children);
                                    }
                                });
                            };
                            updateAllTracks(state.library);
                            updateAllTracks(state.deckA.queue);
                            updateAllTracks(state.deckB.queue);
                            saveState(false);
                        }
                        
                        // Check if the OTHER deck was waiting for this deck's RMS
                        const otherKey = dkKey === 'deckA' ? 'deckB' : 'deckA';
                        const otherDk = state[otherKey];
                        const otherLower = otherKey === 'deckA' ? 'a' : 'b';
                        if (otherDk.pendingSyncTrim && otherDk.currentUrl && dk.lastRms) {
                            otherDk.pendingSyncTrim = false;
                            const targetRms = dk.lastRms;
                            state.settings.targetRms = parseFloat(targetRms.toFixed(4));
                            const rmsEl = document.getElementById('setting-target-rms');
                            if (rmsEl) rmsEl.value = state.settings.targetRms;
                            saveState(false);
                            
                            const otherIndicator = document.getElementById(`trim-auto-${otherLower}`);
                            if (otherIndicator) {
                                otherIndicator.textContent = 'SCANNING...';
                            }
                            state.ws.send(JSON.stringify({ type: 'analyze_loop', url: otherDk.currentUrl, trim_only: true, target_rms: targetRms }));
                        }
                        
                        return; // do not update loops
                    }

                    // Update UI Loop fields
                    const startEl = document.getElementById(`loop-start-${keyLower}`);
                    const endEl = document.getElementById(`loop-end-${keyLower}`);
                    if (startEl && endEl) {
                        startEl.value = msg.loopStart.toFixed(2);
                        endEl.value = msg.loopEnd.toFixed(2);
                        dk.loopStart = msg.loopStart;
                        dk.loopEnd = msg.loopEnd;
                    }

                    // Update Volume Trim (Normalization)
                    if (msg.volGain) {
                        // Save RMS for sync-trim reference even in full analysis
                        if (msg.rms) {
                            dk.lastRms = msg.rms;
                        }

                        animateTrimChange(dkKey, msg.volGain);
                        
                        // Save to library/queue for persistence (ALL matching URLs)
                        const updateAllTracks = (list) => {
                            list.forEach(item => {
                                if (item.url === msg.url) {
                                    item.trim = msg.volGain;
                                    item.loopStart = msg.loopStart;
                                    item.loopEnd = msg.loopEnd;
                                    if (msg.rms) item.rms = msg.rms;
                                }
                                if (item.type === 'group' && item.children) {
                                    updateAllTracks(item.children);
                                }
                            });
                        };
                        updateAllTracks(state.library);
                        updateAllTracks(state.deckA.queue);
                        updateAllTracks(state.deckB.queue);
                        saveState(false);
                    }
                    
                    // Check for pending sync trim on other deck
                    const otherKey = dkKey === 'deckA' ? 'deckB' : 'deckA';
                    const otherDk = state[otherKey];
                    const otherLower = otherKey === 'deckA' ? 'a' : 'b';
                    if (otherDk.pendingSyncTrim && otherDk.currentUrl && dk.lastRms) {
                        otherDk.pendingSyncTrim = false;
                        const tRms = dk.lastRms;
                        state.settings.targetRms = parseFloat(tRms.toFixed(4));
                        const rmsEl = document.getElementById('setting-target-rms');
                        if (rmsEl) rmsEl.value = state.settings.targetRms;
                        saveState(false);
                        
                        const otherIndicator = document.getElementById(`trim-auto-${otherLower}`);
                        if (otherIndicator) {
                            otherIndicator.textContent = 'SCANNING...';
                        }
                        state.ws.send(JSON.stringify({ type: 'analyze_loop', url: otherDk.currentUrl, trim_only: true, target_rms: tRms }));
                    }
                });

                // Only show loop status if this was a full analysis (not trim-only)
                if (msg.loopStart !== undefined && msg.loopEnd !== undefined) {
                    const confStr = msg.confidence !== undefined ? ` (Conf: ${msg.confidence.toFixed(2)})` : '';
                    document.getElementById('global-status').textContent = `✅ Loop: ${msg.loopStart.toFixed(1)}s - ${msg.loopEnd.toFixed(1)}s${confStr}`;
                    setTimeout(() => {
                        document.getElementById('global-status').textContent = 'SYSTEM READY';
                    }, 5000);
                }
            } else {
                // Analysis failed - reset indicators for matching decks
                ['deckA', 'deckB'].forEach(dkKey => {
                    if (state[dkKey].currentUrl === msg.url) {
                        const kl = dkKey === 'deckA' ? 'a' : 'b';
                        const ind = document.getElementById(`trim-auto-${kl}`);
                        if (ind) {
                            ind.textContent = 'AUTO';
                            ind.classList.remove('trim-scanning');
                        }
                        state[dkKey].pendingSyncTrim = false;
                    }
                });
                document.getElementById('global-status').textContent = `❌ Analysis failed: ${msg.error}`;
                setTimeout(() => {
                    document.getElementById('global-status').textContent = 'SYSTEM READY';
                }, 5000);
            }
        } else if (msg.type === 'obs_connected') {
            const statusEl = document.getElementById('obs-status');
            const headerDot = document.getElementById('obs-header-status-dot');
            const headerText = document.getElementById('obs-header-status-text');
            
            if (statusEl) {
                if (msg.success) {
                    statusEl.textContent = 'Connected';
                    statusEl.className = 'status-badge status-connected';
                    if(headerDot) { headerDot.style.background = '#22c55e'; headerDot.style.boxShadow = '0 0 5px #22c55e'; }
                    if(headerText) { headerText.textContent = 'OBS: Connected'; headerText.style.color = '#22c55e'; }
                    showToast('OBS Connected!');
                } else {
                    statusEl.textContent = 'Disconnected';
                    statusEl.className = 'status-badge status-disconnected';
                    if(headerDot) { headerDot.style.background = '#ef4444'; headerDot.style.boxShadow = 'none'; }
                    if(headerText) { headerText.textContent = 'OBS: Disconnected'; headerText.style.color = '#ef4444'; }
                    showToast('OBS Connection Failed');
                }
            }
        } else if (msg.type === 'obs_scene_changed') {
            // OBS -> App Trigger
            // If current deck is A, and scene changes to Scene B, switch to B (if enabled)
            // If current deck is B, and scene changes to Scene A, switch to A (if enabled)

            const currentDeck = state.mode; // 'A' or 'B'
            const newScene = msg.scene;
            const sceneA = state.settings.obsSceneA || 'Deck A';
            const sceneB = state.settings.obsSceneB || 'Deck B';

            // If currently A, check if we should switch to B
            if (currentDeck === 'A') {
                // Check if B's trigger is enabled (meaning "Switch TO B" trigger)
                // Actually, the setting is "obsEnabledAB" which means "When switching A->B, trigger OBS"
                // But for bi-directional, we use the same flag: "Link Deck B with Scene B"
                if (state.settings.obsEnabledAB && newScene === sceneB) {
                    console.log(`OBS Scene matched Deck B (${newScene}). Switching to B...`);
                    switchDeck();
                }
            }
            // If currently B, check if we should switch to A
            else if (currentDeck === 'B') {
                if (state.settings.obsEnabledBA && newScene === sceneA) {
                    console.log(`OBS Scene matched Deck A (${newScene}). Switching to A...`);
                    switchDeck();
                }
            }
        }
    };
    state.ws.onclose = () => {
        state.wsConnected = false;
        document.getElementById('ws-status-dot').className = 'status-dot disconnected';
        document.getElementById('ws-status-text').textContent = 'WS: Disconnected (Reconnecting...)';
        console.log("WebSocket Disconnected. Retrying in 5s...");
        setTimeout(connectWebSocket, 5000);
    };
    state.ws.onerror = (err) => {
        console.error("WebSocket Error:", err);
        state.ws.close();
    };
}

function saveState(hist = true) {
    if (state.ws) state.ws.send(JSON.stringify({
        type: 'save_state',
        playlists: {
            deckA: state.deckA.queue,
            deckB: state.deckB.queue,
            library: state.library
        },
        settings: state.settings
    }));
}

function showToast(msg) {
    // 解析中はSYSTEM READYへの自動復帰をしない
    if (state.isAnalyzing) {
        // それでも一時的なトーストは表示する場合はconsoleにとどめる
        console.log('[Toast suppressed during analysis]', msg);
        return;
    }
    const el = document.getElementById('global-status');
    el.textContent = msg;
    setTimeout(() => {
        if (!state.isAnalyzing) el.textContent = 'SYSTEM READY';
    }, 3000);
}

function tryAutoConnectObs() {
    const s = state.settings;
    if (state.obsConnecting) return;
    // パスワードが設定されているか、hostが変更済みの場合のみ試みる
    if (!s.obsHost || (s.obsHost === 'localhost' && !s.obsPassword)) return;
    
    state.obsConnecting = true;
    setTimeout(() => {
        if (!state.wsConnected) {
            state.obsConnecting = false;
            return;
        }
        console.log('Auto-connecting to OBS...');
        state.ws.send(JSON.stringify({
            type: 'obs_update_config',
            host: s.obsHost,
            port: s.obsPort,
            password: s.obsPassword
        }));
        state.ws.send(JSON.stringify({ type: 'obs_connect' }));
        // Reset flag after a while to allow manual retry
        setTimeout(() => { state.obsConnecting = false; }, 10000);
    }, 1000); 
}

// Timer
function startTimer(minutes = 0, seconds = 0) {
    clearInterval(state.timerInterval);
    state.timerStartTime = Date.now();
    const durationMs = (minutes * 60000) + (seconds * 1000);
    if (durationMs <= 0) return;
    state.timerInterval = setInterval(() => {
        const rem = durationMs - (Date.now() - state.timerStartTime);
        if (rem <= 0) {
            stopTimer();
            switchDeck();
            return;
        }
        const timerEl = document.getElementById('match-timer');
        if (timerEl) timerEl.textContent = formatTime(rem / 1000);
        // Also put in btn-text for integrated display
        const btnText = document.querySelector('#btn-switch-deck .btn-text');
        if (btnText) btnText.textContent = formatTime(rem / 1000);
    }, 1000);
    const timerEl = document.getElementById('match-timer');
    if (timerEl) timerEl.textContent = formatTime(durationMs / 1000);
    const btnText = document.querySelector('#btn-switch-deck .btn-text');
    if (btnText) btnText.textContent = formatTime(durationMs / 1000);
}
function stopTimer() {
    clearInterval(state.timerInterval);
    const timerEl = document.getElementById('match-timer');
    if (timerEl) timerEl.textContent = '--:--';
    const toB = state.mode === 'A';
    const btnText = document.querySelector('#btn-switch-deck .btn-text');
    if (btnText) btnText.textContent = toB ? '🔀 TO DECK B' : '🔀 TO DECK A';
}

// YT Init
window.onYouTubeIframeAPIReady = function () {
    const commonOnReady = (deckKey) => {
        const isB = deckKey.startsWith('deckB');
        const dk = isB ? state.deckB : state.deckA;
        if (deckKey.endsWith('1')) dk.ready1 = true;
        else if (deckKey.endsWith('2')) dk.ready2 = true;
        else if (deckKey.endsWith('Preload')) dk.readyPreload = true;
        
        // Initial quality set
        const p = (deckKey.endsWith('1') ? dk.p1 : (deckKey.endsWith('2') ? dk.p2 : dk.pPreload));
        if (p && p.setPlaybackQuality) p.setPlaybackQuality('tiny');
    };

    const commonOnStateChange = (deckKey, e) => {
        updatePlayPauseIcons();

        if (e.data === YT.PlayerState.PLAYING) {
            forceSpeedGuard(); // Immediate check when play starts
        }

        // Handle Same-Deck Fade Sequence
        if (e.data === YT.PlayerState.CUED) {
            const dkKey = deckKey.startsWith('deckB') ? 'deckB' : 'deckA';
            const deckState = state[dkKey];
            
            // Trigger if a non-active player we cued is ready
            const isPreload = deckKey.endsWith('Preload');
            const isP1 = deckKey.endsWith('1');
            const isP2 = deckKey.endsWith('2');

            const isActive = (deckState.activePlayer === 3 && isPreload) ||
                             (deckState.activePlayer === 1 && isP1) ||
                             (deckState.activePlayer === 2 && isP2);

            if (deckState.pendingFade && !isActive) {
                deckState.pendingFade = null;
                // Use directional fade duration
                const duration = (state.mode === 'A' ? state.settings.fadeDurationAB : state.settings.fadeDurationBA) || 2.0;

                animateDeckFade(dkKey, 1.0, 0.0, duration * 1000, () => {
                    // Play the player that just became CUED
                    const targetP = (isPreload ? deckState.pPreload : (isP1 ? deckState.p1 : (isP2 ? deckState.p2 : null)));
                    
                    // Pause ALL other players in this deck to ensure old song stops completely
                    if (deckState.p1 && deckState.p1 !== targetP) deckState.p1.pauseVideo();
                    if (deckState.p2 && deckState.p2 !== targetP) deckState.p2.pauseVideo();
                    if (deckState.pPreload && deckState.pPreload !== targetP) deckState.pPreload.pauseVideo();

                    if (targetP && targetP.playVideo) {
                        targetP.playVideo();
                    }
                    
                    // Mark this player as active
                    deckState.activePlayer = (isPreload ? 3 : (isP1 ? 1 : 2));

                    // Update the OTHER loop player in background so they are ready for future loops
                    // If we are on 3 or 1, prepare 2. If we are on 2, prepare 1.
                    const otherP = (deckState.activePlayer === 2) ? deckState.p1 : deckState.p2;
                    if (otherP) otherP.cueVideoById({videoId: deckState.videoId, suggestedQuality: 'tiny'});
                    
                    // Also ensure the other primary player is updated if we switched to/from Preload
                    if (deckState.activePlayer === 3) {
                        if (deckState.p1) deckState.p1.cueVideoById({videoId: deckState.videoId, suggestedQuality: 'tiny'});
                    }

                    // Restore volume instantly
                    deckState.fadeMultiplier = 1.0;
                    applyMixer();
                });
            }
        }
    };

    const commonOnError = (deckKey, e) => {
        handlePlayerError(deckKey.startsWith('deckB') ? 'deckB' : 'deckA', e.data);
    };

    state.deckA.p1 = new YT.Player('player-a-1', {
        height: '1', width: '1', playerVars: { playsinline: 1, controls: 0, disablekb: 1 },
        events: { 
            onReady: () => commonOnReady('deckA1'),
            onStateChange: (e) => commonOnStateChange('deckA1', e),
            onError: (e) => commonOnError('deckA1', e),
            onPlaybackRateChange: () => forceSpeedGuard()
        }
    });
    state.deckA.p2 = new YT.Player('player-a-2', {
        height: '1', width: '1', playerVars: { playsinline: 1, controls: 0, disablekb: 1 },
        events: { 
            onReady: () => commonOnReady('deckA2'),
            onStateChange: (e) => commonOnStateChange('deckA2', e),
            onError: (e) => commonOnError('deckA2', e),
            onPlaybackRateChange: () => forceSpeedGuard()
        }
    });
    state.deckA.pPreload = new YT.Player('player-a-preload', {
        height: '1', width: '1', playerVars: { playsinline: 1, controls: 0, disablekb: 1 },
        events: { 
            onReady: () => commonOnReady('deckAPreload'),
            onStateChange: (e) => commonOnStateChange('deckAPreload', e)
        }
    });

    state.deckB.p1 = new YT.Player('player-b-1', {
        height: '1', width: '1', playerVars: { playsinline: 1, controls: 0, disablekb: 1 },
        events: { 
            onReady: () => commonOnReady('deckB1'),
            onStateChange: (e) => commonOnStateChange('deckB1', e),
            onError: (e) => commonOnError('deckB1', e),
            onPlaybackRateChange: () => forceSpeedGuard()
        }
    });
    state.deckB.p2 = new YT.Player('player-b-2', {
        height: '1', width: '1', playerVars: { playsinline: 1, controls: 0, disablekb: 1 },
        events: { 
            onReady: () => commonOnReady('deckB2'),
            onStateChange: (e) => commonOnStateChange('deckB2', e),
            onError: (e) => commonOnError('deckB2', e),
            onPlaybackRateChange: () => forceSpeedGuard()
        }
    });
    state.deckB.pPreload = new YT.Player('player-b-preload', {
        height: '1', width: '1', playerVars: { playsinline: 1, controls: 0, disablekb: 1 },
        events: { 
            onReady: () => commonOnReady('deckBPreload'),
            onStateChange: (e) => commonOnStateChange('deckBPreload', e)
        }
    });
};

function initIntegration() {
    // UI Event Listeners for new features
    document.getElementById('btn-open-replace').onclick = () => {
        document.getElementById('modal-replace').classList.remove('hidden');
        updateSearchMatches();
        renderReplacePreview('find');
        renderReplacePreview('with');
    };
    document.getElementById('btn-close-replace').onclick = () => {
        document.getElementById('modal-replace').classList.add('hidden');
    };
    document.getElementById('btn-find-next').onclick = findNextMatch;
    document.getElementById('btn-replace-single').onclick = performSingleReplace;
    document.getElementById('btn-exec-replace').onclick = performReplaceAll;

    document.getElementById('replace-find').oninput = () => {
        updateSearchMatches();
        renderReplacePreview('find');
    };
    document.getElementById('replace-with').oninput = () => {
        renderReplacePreview('with');
    };
    document.getElementById('replace-field').onchange = () => {
        updateSearchMatches();
        renderReplacePreview('find');
        renderReplacePreview('with');
    };
    
    const applyMetaFindCb = document.getElementById('replace-meta-find');
    if (applyMetaFindCb) {
        applyMetaFindCb.onchange = () => renderReplacePreview('find');
    }
    
    const applyMetaWithCb = document.getElementById('replace-meta-with');
    if (applyMetaWithCb) {
        applyMetaWithCb.onchange = () => renderReplacePreview('with');
    }

    // Speed Slider events
    ['a', 'b'].forEach(key => {
        const slider = document.getElementById(`speed-${key}`);
        const valDisp = document.getElementById(`speed-val-${key}`);
        slider.oninput = (e) => {
            const val = parseFloat(e.target.value).toFixed(2);
            valDisp.textContent = `x${val}`;
            forceSpeedGuard();
        };

        // Deck Hover tracking for Ctrl+C
        const deckEl = document.getElementById(`deck-${key}`);
        if (deckEl) {
            deckEl.addEventListener('mouseenter', () => { state.hoveredDeck = `deck${key.toUpperCase()}`; });
            deckEl.addEventListener('mouseleave', () => { state.hoveredDeck = null; });
        }
    });
}
// Call initIntegration in DOMContentLoaded or at end of file
document.addEventListener('DOMContentLoaded', initIntegration);

// ============ SETTINGS HELPERS ============

function syncModalFromState() {
    const s = state.settings;
    // A→B
    const timerAB = document.getElementById('timer-enabled-ab');
    if (timerAB) timerAB.checked = s.timerEnabledAB || false;
    const timerMinAB = document.getElementById('timer-minutes-ab');
    if (timerMinAB) timerMinAB.value = s.timerMinutesAB !== undefined ? s.timerMinutesAB : 10;
    const timerSecAB = document.getElementById('timer-seconds-ab');
    if (timerSecAB) timerSecAB.value = s.timerSecondsAB !== undefined ? s.timerSecondsAB : 0;
    const obsAB = document.getElementById('obs-enabled-ab');
    if (obsAB) obsAB.checked = s.obsEnabledAB || false;
    const fadeAB = document.getElementById('fade-duration-ab');
    if (fadeAB) fadeAB.value = s.fadeDurationAB || 2.0;

    // B→A
    const timerBA = document.getElementById('timer-enabled-ba');
    if (timerBA) timerBA.checked = s.timerEnabledBA || false;
    const timerMinBA = document.getElementById('timer-minutes-ba');
    if (timerMinBA) timerMinBA.value = s.timerMinutesBA !== undefined ? s.timerMinutesBA : 10;
    const timerSecBA = document.getElementById('timer-seconds-ba');
    if (timerSecBA) timerSecBA.value = s.timerSecondsBA !== undefined ? s.timerSecondsBA : 0;
    const obsBA = document.getElementById('obs-enabled-ba');
    if (obsBA) obsBA.checked = s.obsEnabledBA || false;
    const fadeBA = document.getElementById('fade-duration-ba');
    if (fadeBA) fadeBA.value = s.fadeDurationBA || 2.0;

    // Common
    if (document.getElementById('hotkey-switch')) {
        document.getElementById('hotkey-switch').value = s.hotkeySwitch || '';
    }
    if (document.getElementById('hotkey-clip-on')) {
        document.getElementById('hotkey-clip-on').value = s.hotkeyClipOn || '';
    }
    if (document.getElementById('hotkey-clip-off')) {
        document.getElementById('hotkey-clip-off').value = s.hotkeyClipOff || '';
    }

    // OBS
    const obsHost = document.getElementById('obs-host');
    if (obsHost) obsHost.value = s.obsHost || 'localhost';
    const obsPort = document.getElementById('obs-port');
    if (obsPort) obsPort.value = s.obsPort || 4455;
    const obsPw = document.getElementById('obs-password');
    if (obsPw) obsPw.value = s.obsPassword || '';
    const scA = document.getElementById('obs-scene-a');
    if (scA) scA.value = s.obsSceneA || 'Deck A';
    const scB = document.getElementById('obs-scene-b');
    if (scB) scB.value = s.obsSceneB || 'Deck B';

    // Trim Settings
    const targetRmsEl = document.getElementById('setting-target-rms');
    if (targetRmsEl) targetRmsEl.value = s.targetRms !== undefined ? s.targetRms : 0.08;
    const syncTrimEl = document.getElementById('setting-sync-trim');
    if (syncTrimEl) syncTrimEl.checked = s.syncTrim || false;

    updateMainUIHotkeys();
}

function updateMainUIHotkeys() {
    const s = state.settings;
    if (document.getElementById('label-hotkey-clip-on')) {
        document.getElementById('label-hotkey-clip-on').textContent = s.hotkeyClipOn || 'F2';
    }
    if (document.getElementById('label-hotkey-clip-off')) {
        document.getElementById('label-hotkey-clip-off').textContent = s.hotkeyClipOff || 'F9';
    }
}

function updateClipWatchUI(enabled) {
    state.clipboardWatchEnabled = enabled;
    const btn = document.getElementById('btn-clip-watch');
    if (btn) btn.classList.toggle('active', enabled);
    
    // Also sync the checkbox in modal if it exists
    const cb = document.getElementById('clipboard-watch');
    if (cb) cb.checked = enabled;

    // Cache locally to restore immediately on page load
    localStorage.setItem('GAME_STREAM_DJ_CLIP_WATCH', enabled ? 'true' : 'false');
}

function setupSettingCheckbox(elementId, settingsKey) {
    const el = document.getElementById(elementId);
    if (el) {
        el.onchange = (e) => {
            state.settings[settingsKey] = e.target.checked;
            saveState(false);
            e.target.blur();
        };
    }
}

function setupSettingNumber(elementId, settingsKey, isFloat = false) {
    const el = document.getElementById(elementId);
    if (el) {
        el.onchange = (e) => {
            state.settings[settingsKey] = isFloat ? parseFloat(e.target.value) : parseInt(e.target.value);
            saveState(false);
            e.target.blur();
        };
    }
}

function setupSettingText(elementId, settingsKey) {
    const el = document.getElementById(elementId);
    if (el) {
        el.onchange = (e) => {
            state.settings[settingsKey] = e.target.value;
            saveState(false);
            e.target.blur();
        };
    }
}

// ============ PAGE VISIBILITY (F8 delay mitigation & clipboard queue) ============
document.addEventListener('visibilitychange', async () => {
    if (!document.hidden) {
        if (state.pendingHotkeySwitch) {
            console.log('Executing pending hotkey switch on tab focus');
            switchDeck();
            state.pendingHotkeySwitch = false;
        }
        // Process pending clipboard URLs one by one
        processClipboardUrl();
    }
});

// ============ GLOBAL EVENT LISTENERS (SELECTION REFOCUS) ============
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.selectedIds.size > 0) {
        state.selectedIds.clear();
        state.lastSelectedId = null;
        renderAllLists();
    }
});

document.addEventListener('click', (e) => {
    if (state.selectedIds.size > 0) {
        // If the click happened outside of standard interactive elements
        if (!e.target.closest('.queue-item') && !e.target.closest('.drop-zone') && !e.target.closest('button')) {
            state.selectedIds.clear();
            state.lastSelectedId = null;
            renderAllLists();
        }
    }
});

// ============ SEARCH & REPLACE PREVIEW ============

function renderReplacePreview(target) {
    const field = document.getElementById('replace-field').value;
    const applyMetaCb = document.getElementById(`replace-meta-${target}`);
    const applyMeta = applyMetaCb ? applyMetaCb.checked : false;
    const inputEl = document.getElementById(`replace-${target}`);
    const previewContainer = document.getElementById(`replace-${target}-preview`);
    
    if (!inputEl || !previewContainer) return;
    
    const val = inputEl.value;
    
    if (field !== 'url' || !val) {
        previewContainer.style.display = 'none';
        return;
    }

    const vid = extractVideoId(val);
    if (!vid) {
        previewContainer.style.display = 'none';
        return;
    }

    previewContainer.style.display = 'block';
    
    const dummyItem = {
        id: 'preview_' + target,
        url: val,
        title: 'Loading...',
        type: 'track'
    };
    
    if (applyMeta) {
        applyMetadataToTrack(dummyItem, val);
    }
    
    if (dummyItem.title === 'Loading...') {
        fetch(`https://noembed.com/embed?url=${encodeURIComponent('https://www.youtube.com/watch?v=' + vid)}`)
            .then(r => r.json())
            .then(d => {
                if (d.title) {
                    dummyItem.title = d.title;
                    drawPreviewNode(previewContainer, dummyItem);
                }
            }).catch(() => {});
    }

    drawPreviewNode(previewContainer, dummyItem);
}

function drawPreviewNode(container, item) {
    container.innerHTML = '';
    const el = document.createElement('div');
    el.className = 'queue-item';
    el.style.margin = '0';
    el.style.border = '1px solid #444';
    el.style.borderRadius = '4px';
    el.style.padding = '4px 8px';
    el.style.overflow = 'hidden';
    el.style.boxSizing = 'border-box';
    el.style.maxWidth = '100%';
    
    const videoId = extractVideoId(item.url);
    const thumbHtml = videoId
        ? `<img class="q-thumb" src="https://img.youtube.com/vi/${videoId}/default.jpg" loading="lazy" alt="" style="width: 40px; height: 30px; object-fit: cover; border-radius: 2px;">`
        : '';
        
    let metaHtml = '';
    if (item.loopStart) {
        metaHtml += `<span class="q-meta-item q-meta-loop" style="margin-right:6px;">LOOP: ${formatTime(item.loopStart)}-${formatTime(item.loopEnd || 9999)}</span>`;
    }
    if (item.trim !== undefined && item.trim !== 1.0) {
        metaHtml += `<span class="q-meta-item q-meta-trim">TRIM: x${item.trim.toFixed(2)}</span>`;
    }
    
    el.innerHTML = `
        ${thumbHtml}
        <div class="q-content" style="display: flex; flex-direction: column; justify-content: center; min-width: 0;">
            <span class="q-title" style="font-size: 0.75rem; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; max-width: 100%;">${item.title}</span>
            <div class="q-time" style="font-size: 0.65rem; margin-top: 2px; display:flex; align-items:center;">${metaHtml}</div>
        </div>
    `;
    
    container.appendChild(el);
}
