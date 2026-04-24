"""
GAME STREAM DJ - Python Backend
Features:
- WebSocket server for realtime UI communication
- Clipboard monitoring (auto-detect YouTube URLs)
- Global hotkey support
- OBS WebSocket integration
- Audio analysis for loop detection (using yt-dlp + librosa)
- State persistence (JSON)
"""

import os
import sys
import json
import asyncio
import logging
import threading
import time
import re
from pathlib import Path
from typing import Dict, List, Optional, Set
from contextlib import asynccontextmanager

# FastAPI
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

# Optional imports - gracefully handle if not installed
try:
    import pyperclip
    CLIPBOARD_AVAILABLE = True
except ImportError:
    CLIPBOARD_AVAILABLE = False
    print("[WARN] pyperclip not installed. Clipboard monitoring disabled.")

try:
    import keyboard
    KEYBOARD_AVAILABLE = True
except ImportError:
    KEYBOARD_AVAILABLE = False
    print("[WARN] keyboard not installed. Hotkeys disabled.")

try:
    import obsws_python as obs
    OBS_AVAILABLE = True
except ImportError:
    OBS_AVAILABLE = False
    print("[WARN] obsws-python not installed. OBS integration disabled.")

try:
    import yt_dlp
    import numpy as np
    import librosa
    AUDIO_ANALYSIS_AVAILABLE = True
except ImportError:
    AUDIO_ANALYSIS_AVAILABLE = False
    print("[WARN] yt-dlp/librosa/numpy not installed. Audio analysis disabled.")

# Setup Logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s'
)
logger = logging.getLogger("GameStreamDJ")

# ============ Constants ============
BASE_DIR = Path(__file__).parent
STATE_FILE = BASE_DIR / "dj_state.json"
TEMP_AUDIO_DIR = BASE_DIR / "temp_audio"
TEMP_AUDIO_DIR.mkdir(exist_ok=True)

DEFAULT_STATE = {
    "playlists": {
        "deckA": [],
        "deckB": [],
        "library": []
    },
    "settings": {
        "hotkeySwitch": "F8",
        "hotkeyClipOn": "F2",
        "hotkeyClipOff": "F9",
        "obsHost": "localhost",
        "obsPort": 4455,
        "obsPassword": ""
    }
}

# ============ Application State ============
class AppState:
    def __init__(self):
        self.playlists = DEFAULT_STATE["playlists"].copy()
        if "library" not in self.playlists:
            self.playlists["library"] = []
            
        self.settings = DEFAULT_STATE["settings"].copy()
        self.decks = {"deckA": {}, "deckB": {}}
        self.websockets: Set[WebSocket] = set()
        self.clipboard_watch_enabled = False
        self.last_clipboard = ""
        self.obs_client = None
        self.obs_event_client = None
        self.obs_monitor_running = False
        self.analysis_running = False
        self.load_state()

    def load_state(self):
        if STATE_FILE.exists():
            try:
                with open(STATE_FILE, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    self.playlists = data.get("playlists", DEFAULT_STATE["playlists"])
                    # Migrate old state
                    if "library" not in self.playlists:
                        self.playlists["library"] = []
                        
                    self.settings = data.get("settings", DEFAULT_STATE["settings"])
                    self.decks = data.get("decks", {"deckA": {}, "deckB": {}})
                    self.clipboard_watch_enabled = self.settings.get("clipboardWatchEnabled", False)
                logger.info(f"State loaded from file (Clipboard Watch: {self.clipboard_watch_enabled})")
            except Exception as e:
                logger.error(f"Failed to load state: {e}")

    def save_state(self):
        try:
            with open(STATE_FILE, 'w', encoding='utf-8') as f:
                json.dump({
                    "playlists": self.playlists,
                    "settings": self.settings,
                    "decks": self.decks
                }, f, indent=2, ensure_ascii=False)
            logger.info("State saved")
        except Exception as e:
            logger.error(f"Failed to save state: {e}")

    async def broadcast(self, message: dict):
        """Send message to all connected WebSocket clients"""
        dead = set()
        for ws in self.websockets:
            try:
                await ws.send_json(message)
            except:
                dead.add(ws)
        self.websockets -= dead

app_state = AppState()
event_loop = None

# ============ Background Services ============

async def clipboard_monitor():
    """Monitor clipboard for YouTube URLs"""
    global app_state
    logger.info("Clipboard monitor started")
    
    youtube_pattern = re.compile(r'(https?://)?(www\.)?(youtube\.com/watch\?v=|youtu\.be/)[\w-]+')
    
    while True:
        await asyncio.sleep(1.0)
        
        if not app_state.clipboard_watch_enabled or not CLIPBOARD_AVAILABLE:
            await asyncio.sleep(4.0)  # 無効時は合計5秒間隔に（CPU負荷低減）
            continue
            
        try:
            text = pyperclip.paste()
            if text and text != app_state.last_clipboard:
                app_state.last_clipboard = text
                if youtube_pattern.search(text):
                    logger.info(f"Clipboard detected YouTube URL: {text}")
                    await app_state.broadcast({
                        "type": "clipboard_url",
                        "url": text
                    })
        except Exception as e:
            logger.debug(f"Clipboard error: {e}")

def register_hotkeys():
    """Register global hotkeys"""
    if not KEYBOARD_AVAILABLE:
        return
    
    def on_switch_hotkey():
        if event_loop:
            asyncio.run_coroutine_threadsafe(
                app_state.broadcast({"type": "hotkey_triggered", "action": "switch"}),
                event_loop
            )
    
    def on_clip_on_hotkey():
        if event_loop:
            asyncio.run_coroutine_threadsafe(
                toggle_clip_via_hotkey(True),
                event_loop
            )

    def on_clip_off_hotkey():
        if event_loop:
            asyncio.run_coroutine_threadsafe(
                toggle_clip_via_hotkey(False),
                event_loop
            )

    async def toggle_clip_via_hotkey(enabled: bool):
        if app_state.clipboard_watch_enabled == enabled:
            return
        app_state.clipboard_watch_enabled = enabled
        app_state.settings["clipboardWatchEnabled"] = enabled
        app_state.save_state()
        await app_state.broadcast({
            "type": "clipboard_update",
            "enabled": enabled
        })
        logger.info(f"Clipboard watch set to {enabled} via hotkey")

    try:
        # Switch Deck Hotkey
        hotkey_sw = app_state.settings.get("hotkeySwitch", "F8").lower()
        keyboard.on_press_key(hotkey_sw, lambda e: on_switch_hotkey())
        logger.info(f"Hotkey '{hotkey_sw}' (Switch) registered")

        # Clip ON Hotkey
        hotkey_on = app_state.settings.get("hotkeyClipOn", "F2").lower()
        keyboard.on_press_key(hotkey_on, lambda e: on_clip_on_hotkey())
        logger.info(f"Hotkey '{hotkey_on}' (Clip-ON) registered")

        # Clip OFF Hotkey
        hotkey_off = app_state.settings.get("hotkeyClipOff", "F9").lower()
        keyboard.on_press_key(hotkey_off, lambda e: on_clip_off_hotkey())
        logger.info(f"Hotkey '{hotkey_off}' (Clip-OFF) registered")

        app_state.hotkey_registered = True
    except Exception as e:
        logger.error(f"Failed to register hotkeys: {e}")

def connect_obs(silent=False):
    """Connect to OBS WebSocket (Event-driven, no polling)"""
    if not OBS_AVAILABLE:
        return False
    
    # 既存の接続を閉じる
    disconnect_obs()
    
    try:
        host = app_state.settings.get("obsHost", "localhost")
        port = app_state.settings.get("obsPort", 4455)
        password = app_state.settings.get("obsPassword", "")
        
        # ReqClient for sending commands (scene switch etc.)
        app_state.obs_client = obs.ReqClient(host=host, port=port, password=password, timeout=5)
        if not silent: logger.info("Connected to OBS (ReqClient)")
        
        # EventClient for receiving scene change events (no polling!)
        app_state.obs_event_client = obs.EventClient(host=host, port=port, password=password)
        app_state.obs_event_client.callback.register(on_current_program_scene_changed)
        app_state.obs_monitor_running = True
        if not silent: logger.info("OBS EventClient registered (event-driven, no polling)")
        
        return True
    except Exception as e:
        if not silent: logger.error(f"OBS connection failed: {e}")
        app_state.obs_monitor_running = False
        return False

def disconnect_obs():
    """Disconnect existing OBS clients"""
    try:
        if app_state.obs_event_client:
            app_state.obs_event_client.callback.deregister(on_current_program_scene_changed)
            app_state.obs_event_client.disconnect()
    except Exception:
        pass
    try:
        if app_state.obs_client:
            app_state.obs_client.disconnect()
    except Exception:
        pass
    app_state.obs_client = None
    app_state.obs_event_client = None
    app_state.obs_monitor_running = False

def on_current_program_scene_changed(data):
    """Callback for OBS CurrentProgramSceneChanged event (event-driven)"""
    try:
        scene_name = data.scene_name
        logger.info(f"OBS scene changed (event): {scene_name}")
        if event_loop:
            asyncio.run_coroutine_threadsafe(
                app_state.broadcast({
                    "type": "obs_scene_changed",
                    "scene": scene_name
                }),
                event_loop
            )
    except Exception as e:
        logger.error(f"OBS event handler error: {e}")

# ============ Audio Analysis ============

def find_zero_crossings(audio: np.ndarray) -> np.ndarray:
    """Find indices where audio signal crosses zero"""
    return np.where(np.diff(np.signbit(audio)))[0]

def analyze_loop_points(url, trim_only=False, target_rms=0.08, do_trim=True):
    """
    Downloads audio via yt-dlp and analyzes loops + RMS volume using Cross-Correlation with Phase Matching.
    """
    # Ensure target_rms is a valid float
    try:
        target_rms = float(target_rms)
        if target_rms <= 0:
            target_rms = 0.08
    except (TypeError, ValueError):
        target_rms = 0.08
        
    logger.info(f"Starting analysis: trim_only={trim_only}, target_rms={target_rms}, url={url}, do_trim={do_trim}")
    if not AUDIO_ANALYSIS_AVAILABLE:
        return {"success": False, "error": "Audio analysis libraries not installed"}
    
    if app_state.analysis_running:
        return {"success": False, "error": "Analysis already in progress"}
    
    app_state.analysis_running = True
    audio_path = None
    
    try:
        # Clean up any leftover temp files first
        for f in TEMP_AUDIO_DIR.glob('temp_*'):
            try:
                f.unlink()
            except:
                pass

        # Sanitize URL: strip playlist parameters to avoid downloading entire playlists
        import urllib.parse as _urlparse
        parsed_url = _urlparse.urlparse(url)
        params = _urlparse.parse_qs(parsed_url.query)
        params.pop('list', None)
        params.pop('index', None)
        clean_query = _urlparse.urlencode(params, doseq=True)
        url = _urlparse.urlunparse(parsed_url._replace(query=clean_query))
        logger.info(f"Sanitized URL for analysis: {url}")

        import uuid
        run_id = uuid.uuid4().hex[:8]
        
        def progress_hook(d):
            if not app_state.analysis_running:
                raise Exception("Analysis cancelled by user")
        
        # Download audio
        ydl_opts = {
            'format': 'bestaudio/best',
            'outtmpl': str(TEMP_AUDIO_DIR / f'temp_%(id)s_{run_id}.%(ext)s'),
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'wav',
                'preferredquality': '192',
            }],
            'progress_hooks': [progress_hook],
            'quiet': True,
            'no_warnings': True,
            'extract_flat': False,
            'noplaylist': True,
            'overwrites': True,
        }
        
        if trim_only:
            # 冒頭1分のみダウンロードすることで高速化と通信量削減
            ydl_opts['download_sections'] = [{'start_time': 0, 'end_time': 60}]
            ydl_opts['force_keyframes_at_cuts'] = True

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            try:
                info = ydl.extract_info(url, download=True)
                if 'entries' in info:
                    info = info['entries'][0]
                video_id = info['id']
                audio_path = TEMP_AUDIO_DIR / f'temp_{video_id}_{run_id}.wav'
            except Exception as dl_e:
                if not app_state.analysis_running:
                    return {"success": False, "error": "Cancelled"}
                logger.warning(f"yt-dlp download raised exception: {dl_e}. Checking if file exists anyway...")

                
        # Wait briefly for FFmpeg to release file handle or AV to finish scanning
        import time as _time
        _time.sleep(1.0)

        # Fallback: Find the file by run_id if video_id wasn't extracted
        if not audio_path or not audio_path.exists():
            for f in TEMP_AUDIO_DIR.glob(f'temp_*_{run_id}.*'):
                audio_path = f
                break
                
        if not audio_path or not audio_path.exists():
            raise RuntimeError(f"Download failed and no file created. See logs.")
        
        # Load audio (mono for correlation)
        # Trimのみの場合は1分（60秒）で十分。ループ解析の場合は全体をロードする。
        load_duration = 60 if trim_only else None
        logger.info(f"Loading audio for analysis (duration={load_duration})...")
        y, sr = librosa.load(str(audio_path), sr=22050, mono=True, duration=load_duration)
        duration = len(y) / sr
        
        # --- Volume Analysis (RMS) ---
        if do_trim:
            rms = np.sqrt(np.mean(y**2))
            # 基準音量 (フロントから受け取った target_rms をターゲットにする)
            recommended_trim = target_rms / rms if rms > 0.001 else 1.0
            # 補正の下限のみ0.1に設定し、上限を撤廃
            recommended_trim = round(float(max(0.1, recommended_trim)), 2)
        else:
            rms = 0.0
            recommended_trim = 1.0

        if trim_only:
            logger.info(f"Trim Analysis Only (RMS: {rms:.4f}, Trim: {recommended_trim})")
            return {
                "success": True,
                "isTrimOnly": True,
                "duration": round(duration, 1),
                "rms": round(float(rms), 4) if do_trim else None,
                "volGain": recommended_trim if do_trim else None
            }
            
        # --- Cross-Correlation Strategy V2 (Phase Matching) ---
        from scipy import signal
        
        # 1. Select Reference Segment (Query)
        # Use segment from end, but ensure it starts/ends on zero crossings
        # to ensure the reference itself is "clean"
        raw_test_end_time = duration - 5
        query_duration = 15.0 if duration > 60 else duration / 4
        raw_test_start_time = raw_test_end_time - query_duration
        
        # Adjust query window to nearest zero crossings
        zcs = np.where(np.diff(np.signbit(y)))[0]
        
        start_idx = int(raw_test_start_time * sr)
        end_idx = int(raw_test_end_time * sr)
        
        # Snap start/end to nearest ZC
        if len(zcs) > 0:
            start_idx = zcs[np.abs(zcs - start_idx).argmin()]
            end_idx = zcs[np.abs(zcs - end_idx).argmin()]
        
        query_segment = y[start_idx:end_idx]
        test_start_time = start_idx / sr # Exact start time of query
        
        # 2. Search Area
        search_end_idx = start_idx - int(5 * sr) # Don't overlap
        search_wave = y[:search_end_idx]
        
        logger.info("Running cross-correlation...")
        # FFT based correlation is fast
        correlation = signal.correlate(search_wave, query_segment, mode='valid', method='fft')
        
        # Find peaks
        peak_idx = np.argmax(correlation)
        peak_score = correlation[peak_idx]
        
        # Normalize score
        energy_query = np.sum(query_segment**2)
        energy_match = np.sum(search_wave[peak_idx:peak_idx+len(query_segment)]**2)
        norm_score = peak_score / np.sqrt(energy_query * energy_match)
        
        loop_start_sec = peak_idx / sr
        loop_end_sec = test_start_time
        
        # 3. Phase Match Checking (Slope)
        if peak_idx + 1 < len(y) and peak_idx < len(y) and start_idx + 1 < len(y):
            slope_start = np.sign(y[peak_idx+1] - y[peak_idx])
            slope_end = np.sign(y[start_idx+1] - y[start_idx])
            
            # If slopes opposite, move to next zero crossing
            if slope_start != slope_end:
                logger.info("Slope mismatch, adjusting to next zero crossing...")
                # Find next ZC near loop_start_sec
                local_zcs = zcs[(zcs > peak_idx) & (zcs < peak_idx + 1000)]
                if len(local_zcs) > 0:
                    peak_idx = local_zcs[0]
                    loop_start_sec = peak_idx / sr


        logger.info(f"Loop Found: {loop_start_sec:.3f}s -> {loop_end_sec:.3f}s (Conf: {norm_score:.3f}, RMS: {rms:.4f}, Trim: {recommended_trim})")
        
        return {
            "success": True,
            "isTrimOnly": False,
            "loopStart": round(float(loop_start_sec), 3),
            "loopEnd": round(float(loop_end_sec), 3),
            "duration": round(float(duration), 1),
            "confidence": round(float(norm_score), 2),
            "rms": round(float(rms), 4) if do_trim else None,
            "volGain": recommended_trim if do_trim else None
        }
        
    except Exception as e:
        logger.error(f"Loop analysis failed: {e}")
        return {"success": False, "error": str(e)}
    finally:
        if audio_path:
            try:
                if audio_path.exists(): audio_path.unlink()
            except: pass
        app_state.analysis_running = False

async def obs_health_check():
    """Periodically check OBS connection and try to reconnect slowly if lost."""
    global app_state
    while True:
        await asyncio.sleep(10)
        if not OBS_AVAILABLE:
            continue
            
        settings = app_state.settings
        # Only try if host/password are configured (don't try if default unconfigured)
        if not settings.get("obsHost") or (settings.get("obsHost") == "localhost" and not settings.get("obsPassword")):
            continue
            
        is_connected = False
        if app_state.obs_client:
            try:
                # get_version is lightweight
                app_state.obs_client.get_version()
                is_connected = True
            except Exception:
                logger.info("OBS connection lost. Disconnecting clients.")
                disconnect_obs()
                is_connected = False
                if event_loop:
                    asyncio.run_coroutine_threadsafe(
                        app_state.broadcast({"type": "obs_connected", "success": False}),
                        event_loop
                    )
                
        if not is_connected:
            # Try to connect silently
            try:
                success = connect_obs(silent=True)
                if success:
                    logger.info("OBS Auto-reconnected successfully!")
                    if event_loop:
                        asyncio.run_coroutine_threadsafe(
                            app_state.broadcast({"type": "obs_connected", "success": True}),
                            event_loop
                        )
            except Exception:
                pass


# ============ FastAPI App ============

@asynccontextmanager
async def lifespan(app: FastAPI):
    global event_loop
    event_loop = asyncio.get_running_loop()
    
    # Start background tasks
    asyncio.create_task(clipboard_monitor())
    asyncio.create_task(obs_health_check())
    
    # Register hotkeys
    if KEYBOARD_AVAILABLE:
        threading.Thread(target=register_hotkeys, daemon=True).start()
    
    logger.info("GAME STREAM DJ Backend started")
    yield
    
    # Cleanup
    disconnect_obs()
    if KEYBOARD_AVAILABLE:
        try:
            keyboard.unhook_all()
        except:
            pass
    logger.info("Backend shutdown")

app = FastAPI(lifespan=lifespan, title="GAME STREAM DJ Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============ Extra API ============

@app.post("/api/import_playlist")
async def import_playlist(data: dict):
    url = data.get("url")
    if not url:
        return {"success": False, "error": "No URL provided"}
    import urllib.parse
    
    logger.info(f"Importing playlist: {url}")
    try:
        # Force playlist extraction by crafting a clean playlist URL if list parameter exists
        parsed = urllib.parse.urlparse(url)
        params = urllib.parse.parse_qs(parsed.query)
        if 'list' in params:
            url = f"https://www.youtube.com/playlist?list={params['list'][0]}"
            logger.info(f"Cleaned playlist URL: {url}")
            
        ydl_opts = {
            'extract_flat': 'in_playlist',
            'quiet': True,
            'skip_download': True,
            'no_warnings': True,
            'ignoreerrors': True, # Keep going even if some items fail
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            
            if not info or 'entries' not in info:
                # If it's not a playlist but a single video being forced.
                # Just return it as a single entry in tracks.
                if info and info.get('id'):
                    tracks = [{
                        "url": f"https://www.youtube.com/watch?v={info['id']}",
                        "title": info.get('title', 'Unknown Track')
                    }]
                    return {"success": True, "tracks": tracks, "title": info.get('title', 'Single Track')}
                return {"success": False, "error": "Could not extract playlist information."}
                
            tracks = []
            for entry in info['entries']:
                if not entry: continue
                
                eid = entry.get('id')
                etitle = entry.get('title')
                
                # Filter out placeholders
                if not eid or etitle in [None, '[Private video]', '[Deleted video]']:
                    continue
                    
                tracks.append({
                    "url": f"https://www.youtube.com/watch?v={eid}",
                    "title": etitle or 'Unknown Track'
                })
            
            logger.info(f"Found {len(tracks)} tracks in playlist '{info.get('title')}'")
            return {"success": True, "tracks": tracks, "title": info.get('title', 'Imported Playlist')}
            
    except Exception as e:
        logger.error(f"Playlist import failed: {e}")
        return {"success": False, "error": str(e)}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    app_state.websockets.add(websocket)
    logger.info(f"WebSocket connected. Total: {len(app_state.websockets)}")
    
    # Send current state
    await websocket.send_json({
        "type": "state",
        "playlists": app_state.playlists,
        "settings": app_state.settings,
        "decks": app_state.decks
    })
    
    try:
        while True:
            data = await websocket.receive_json()
            await handle_ws_message(websocket, data)
    except WebSocketDisconnect:
        app_state.websockets.discard(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        app_state.websockets.discard(websocket)

async def handle_ws_message(ws: WebSocket, data: dict):
    msg_type = data.get("type", "")
    
    if msg_type == "get_state":
        await ws.send_json({
            "type": "state",
            "playlists": app_state.playlists,
            "settings": app_state.settings,
            "decks": app_state.decks
        })
    
    elif msg_type == "save_state":
        if "playlists" in data:
            app_state.playlists = data["playlists"]
        
        if "decks" in data:
            app_state.decks = data["decks"]
        
        # Check if settings changed, especially hotkey
        hotkey_changed = False
        if "settings" in data:
            new_hotkey = data["settings"].get("hotkeySwitch")
            if new_hotkey and new_hotkey != app_state.settings.get("hotkeySwitch"):
                hotkey_changed = True
            app_state.settings.update(data["settings"])
            if "clipboardWatchEnabled" in data["settings"]:
                app_state.clipboard_watch_enabled = data["settings"]["clipboardWatchEnabled"]
            
        app_state.save_state()
        
        # Re-register hotkeys if changed
        if hotkey_changed and KEYBOARD_AVAILABLE:
            try:
                keyboard.unhook_all()
                threading.Thread(target=register_hotkeys, daemon=True).start()
                logger.info("Hotkeys re-registered")
            except Exception as e:
                logger.error(f"Failed to re-register hotkeys: {e}")
                
        await ws.send_json({"type": "state_saved", "success": True})
    
    elif msg_type == "clipboard_watch":
        app_state.clipboard_watch_enabled = data.get("enabled", False)
    
    elif msg_type == "obs_connect":
        success = connect_obs()
        await ws.send_json({"type": "obs_connected", "success": success})
    
    elif msg_type == "obs_switch":
        scene = data.get("scene")
        if app_state.obs_client and scene:
            try:
                app_state.obs_client.set_current_program_scene(scene)
                logger.info(f"OBS Switched to scene: {scene}")
            except Exception as e:
                logger.error(f"Failed to switch OBS scene: {e}")
    
    elif msg_type == "analyze_loop":
        url = data.get("url", "")
        trim_only = data.get("trim_only", False)
        do_trim = data.get("do_trim", True)
        target_rms = data.get("target_rms", 0.08)
        if url:
            loop = asyncio.get_running_loop()
            result = await loop.run_in_executor(None, analyze_loop_points, url, trim_only, target_rms, do_trim)
            # If the user cancelled during analysis, app_state.analysis_running would be False
            # However, analyze_loop_points resets it in finally.
            # We only broadcast if the socket is still waiting? 
            # Actually just broadcasting is fine.
            result["url"] = url
            await ws.send_json({"type": "loop_analyzed", **result})

    elif msg_type == "cancel_analysis":
        app_state.analysis_running = False
        logger.info("Analysis cancelled by user (flag reset)")
            
    elif msg_type == "obs_update_config":
        # Update OBS connection settings from frontend
        if "host" in data:
            app_state.settings["obsHost"] = data["host"]
        if "port" in data:
            app_state.settings["obsPort"] = data["port"]
        if "password" in data:
            app_state.settings["obsPassword"] = data["password"]
        app_state.save_state()
        logger.info("OBS config updated from frontend")

    elif msg_type == "import_playlist":
        url = data.get("url", "")
        if url:
            # We call the functionality directly here for simplicity over ws
            # But normally we'd keep logic separate. 
            # Re-using the logic from the API endpoint would be cleaner but for now:
            # We'll just trigger the same logic if needed or let frontend call the API.
            # Frontend handles this via REST usually, but let's confirm.
            pass

# Serve static files (frontend)
frontend_dir = BASE_DIR.parent / "frontend"
if frontend_dir.exists():
    app.mount("/", StaticFiles(directory=str(frontend_dir), html=True), name="static")
else:
    # Try alternate path
    alt_frontend = BASE_DIR / ".." / "frontend"
    if alt_frontend.exists():
        app.mount("/", StaticFiles(directory=str(alt_frontend.resolve()), html=True), name="static")

# ============ Main ============

if __name__ == "__main__":
    print("=" * 50)
    print("  GAME STREAM DJ - Backend Server")
    print("=" * 50)
    print(f"  Clipboard Monitor: {'OK' if CLIPBOARD_AVAILABLE else 'NG'}")
    print(f"  Global Hotkeys:    {'OK' if KEYBOARD_AVAILABLE else 'NG'}")
    print(f"  OBS Integration:   {'OK' if OBS_AVAILABLE else 'NG'}")
    print(f"  Audio Analysis:    {'OK' if AUDIO_ANALYSIS_AVAILABLE else 'NG'}")
    print("=" * 50)
    print("  Starting server at http://127.0.0.1:8000")
    print("=" * 50)
    
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")
