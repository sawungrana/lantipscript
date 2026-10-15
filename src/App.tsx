import './App.css';
import { useState, useEffect, useRef, useCallback, memo } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import WaveSurfer from "wavesurfer.js";
import { Play, Pause, Download, Sparkles, Plus, FileAudio, Settings, X } from "lucide-react";

import fullLogo from "./assets/lantipscript_logo_color_full.png";
import logoIcon from "./assets/lantipscript_logo_color_icon.png";

interface TranscriptSegment {
  start_ms: number;
  end_ms: number;
  text: string;
}

interface EngineStatus {
  backend: "metal" | "vulkan" | "cpu";
  using_gpu: boolean;
  loaded: boolean;
  forced_cpu: boolean;
  model: string;
}

const GPU_SETTING_KEY = "lantipscript.gpuEnabled";

const formatTime = (ms: number) => {
  const totalMs = Math.max(0, Math.floor(ms));
  const totalSeconds = Math.floor(totalMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const millis = totalMs % 1000;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
};

interface TranscriptRowProps {
  segment: TranscriptSegment;
  index: number;
  isActive: boolean;
  onSeek: (ms: number) => void;
  onEdit: (index: number, text: string) => void;
}

// Memoized so the 10fps playback re-renders only touch rows whose isActive flips
const TranscriptRow = memo(function TranscriptRow({ segment, index, isActive, onSeek, onEdit }: TranscriptRowProps) {
  // Limit animation delay to max 2 seconds so the tail end doesn't take forever to appear
  const cascadeDelay = Math.min(index * 0.05, 2);

  return (
    <div
      data-segment-index={index}
      // The 'animate-slide-up' CSS class is what creates the beautiful entrance
      className={`animate-slide-up flex gap-4 p-4 transition-all duration-300 ${
        isActive ? 'neo-segment-active' : 'border-[3px] border-transparent hover:border-lantip-beige/60 rounded-2xl'
      }`}
      style={{ animationDelay: `${cascadeDelay}s` }}
    >
      {/* Clickable Timestamp */}
      <div 
        onClick={() => onSeek(segment.start_ms)}
        className={`w-20 flex-shrink-0 mt-1 text-sm font-bold font-sans tabular-nums whitespace-nowrap cursor-pointer transition-colors ${
          isActive ? 'text-lantip-dark' : 'text-lantip-blue hover:text-lantip-dark'
        }`}
      >
        {formatTime(segment.start_ms)}
      </div>
      
      {/* Editable Transcript Text */}
      <div 
        contentEditable
        suppressContentEditableWarning
        onBlur={(e) => onEdit(index, e.currentTarget.textContent || "")}
        className={`font-sans leading-relaxed text-[1.1rem] outline-none w-full transition-colors duration-300 ${
          isActive ? 'text-lantip-dark font-semibold' : 'text-lantip-dark/90'
        }`}
      >
        {segment.text}
      </div>
    </div>
  );
});

export default function App() {
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [isTranscribing, setIsTranscribing] = useState<boolean>(false);
  const[filePath, setFilePath] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [engineStatus, setEngineStatus] = useState<EngineStatus | null>(null);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [gpuEnabled, setGpuEnabled] = useState<boolean>(true);

  const waveformContainerRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const isTranscribingRef = useRef<boolean>(false); // Prevents duplicate drops
  const lastTimeUpdateRef = useRef<number>(0); // Throttles timeupdate -> state

  // Initialize WaveSurfer
  useEffect(() => {
    if (!waveformContainerRef.current) return;

    const ws = WaveSurfer.create({
      container: waveformContainerRef.current,
      waveColor: '#98A1BC',
      progressColor: '#555879',
      cursorColor: '#555879',
      cursorWidth: 3,
      barWidth: 3,
      barGap: 3,
      barRadius: 4,
      height: 60,
      normalize: true,
    });

    ws.on('play', () => setIsPlaying(true));
    ws.on('pause', () => setIsPlaying(false));
    // Throttle to ~10 fps: the highlight only needs segment-level precision
    ws.on('timeupdate', (time) => {
      const now = performance.now();
      if (now - lastTimeUpdateRef.current < 100) return;
      lastTimeUpdateRef.current = now;
      setCurrentTime(time * 1000);
    });
    // Keep the highlight accurate while scrubbing
    ws.on('seeking', () => setCurrentTime(ws.getCurrentTime() * 1000));

    wavesurferRef.current = ws;

    return () => ws.destroy();
  },[]);

  // Initialize Native Drag & Drop Listeners
  useEffect(() => {
    let unlistenDrop: UnlistenFn;
    let unlistenEnter: UnlistenFn;
    let unlistenLeave: UnlistenFn;

    const setupDragEvents = async () => {
      // Listen for files dropped into the app window
      unlistenDrop = await listen<{ paths: string[] }>('tauri://drag-drop', (event) => {
        setIsDragging(false);
        const paths = event.payload.paths;
        if (paths && paths.length > 0) {
          processAudio(paths[0]);
        }
      });
      
      unlistenEnter = await listen('tauri://drag-enter', () => setIsDragging(true));
      unlistenLeave = await listen('tauri://drag-leave', () => setIsDragging(false));
    };

    setupDragEvents();

    return () => {
      if (unlistenDrop) unlistenDrop();
      if (unlistenEnter) unlistenEnter();
      if (unlistenLeave) unlistenLeave();
    };
  },[]);

  // Listen for whisper progress events (0-100)
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    listen<number>('transcribe-progress', (event) => setProgress(event.payload)).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) unlisten();
    };
  },[]);

  // Restore the GPU preference and fetch the engine status
  useEffect(() => {
    const stored = localStorage.getItem(GPU_SETTING_KEY);
    const enabled = stored === null ? true : stored === 'true';
    setGpuEnabled(enabled);
    invoke("set_gpu_enabled", { enabled }).catch(console.error);
    refreshEngineStatus();
  },[]);

  // Reusable core processor for both button clicks and drag/drop
  async function processAudio(actualPath: string) {
    if (isTranscribingRef.current) return;
    
    // Quick validation
    const isMedia = /\.(mp3|wav|m4a|mp4|mov)$/i.test(actualPath);
    if (!isMedia) {
      setErrorMessage("Please provide a valid audio or video file (mp3, wav, m4a, mp4, mov).");
      return;
    }

    try {
      isTranscribingRef.current = true;
      setIsTranscribing(true);
      setFilePath(actualPath);
      setSegments([]);
      setErrorMessage(null);
      setProgress(null);

      if (wavesurferRef.current) {
        wavesurferRef.current.load(convertFileSrc(actualPath));
      }

      const result = await invoke<TranscriptSegment[]>("transcribe_audio", { inputPath: actualPath });
      setSegments(result);

    } catch (error) {
      // Cancelling is a user action, not an error
      if (String(error) !== "TRANSCRIPTION_CANCELLED") {
        setErrorMessage(String(error));
      }
    } finally {
      isTranscribingRef.current = false;
      setIsTranscribing(false);
      setProgress(null);
      refreshEngineStatus();
    }
  }

  async function refreshEngineStatus() {
    try {
      setEngineStatus(await invoke<EngineStatus>("get_engine_status"));
    } catch (error) {
      console.error(error);
    }
  }

  async function handleCancel() {
    try {
      await invoke("cancel_transcription");
    } catch (error) {
      console.error(error);
    }
  }

  async function handleToggleGpu(nextEnabled: boolean) {
    setGpuEnabled(nextEnabled);
    localStorage.setItem(GPU_SETTING_KEY, String(nextEnabled));
    try {
      await invoke("set_gpu_enabled", { enabled: nextEnabled });
      await refreshEngineStatus();
    } catch (error) {
      console.error(error);
    }
  }

  async function handleImportButton() {
    const selected = await open({
      multiple: false,
      filters:[{ name: 'Media', extensions:['mp3', 'wav', 'm4a', 'mp4', 'mov'] }]
    });
    
    // If user canceled the dialog, it returns null.
    if (!selected) return;
    
    // Because multiple is false, 'selected' is guaranteed to be a string path here!
    processAudio(selected as string);
  }

  async function handleExport() {
    if (segments.length === 0) return;
    try {
      const lastEnd = segments[segments.length - 1].end_ms;
      const textContent =
        segments.map(s => `[${formatTime(s.start_ms)}] ${s.text}`).join('\n\n') +
        `\n\n[${formatTime(lastEnd)}] [END]`;
      const savePath = await save({
        filters: [{ name: 'Text Document', extensions: ['txt'] }],
        defaultPath: 'LantipScript_Transcript.txt'
      });
      if (!savePath) return;
      await writeTextFile(savePath, textContent);
    } catch (error) {
      setErrorMessage(`Export failed: ${String(error)}`);
    }
  }

  const togglePlayPause = () => wavesurferRef.current?.playPause();
  
  const jumpToTime = useCallback((ms: number) => {
    if (wavesurferRef.current) {
      wavesurferRef.current.setTime(ms / 1000);
      wavesurferRef.current.play();
    }
  }, []);

  const updateSegmentText = useCallback((index: number, newText: string) => {
    setSegments((prev) => prev.map((seg, i) => (i === index ? { ...seg, text: newText } : seg)));
  }, []);

  const activeIndex = segments.findIndex(
    (seg) => currentTime >= seg.start_ms && currentTime < seg.end_ms
  );

  // During playback, keep the active segment in view (without fighting manual scroll)
  useEffect(() => {
    if (!isPlaying || activeIndex < 0) return;
    const container = mainRef.current;
    const row = container?.querySelector<HTMLElement>(`[data-segment-index="${activeIndex}"]`);
    if (!container || !row) return;

    const containerRect = container.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const margin = 24;
    const outOfView = rowRect.top < containerRect.top + margin || rowRect.bottom > containerRect.bottom - margin;
    if (outOfView) {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeIndex, isPlaying]);

  return (
    <div className="flex flex-col h-screen bg-lantip-cream p-4 sm:p-5 gap-4 overflow-hidden font-sans relative">
      
      {/* GLOBAL DRAG OVERLAY */}
      {isDragging && (
        <div className="absolute inset-0 z-50 drag-overlay flex items-center justify-center m-4 sm:m-5 rounded-[1.5rem] bg-white/60 border-4 border-dashed border-lantip-dark">
          <div className="flex flex-col items-center text-lantip-dark animate-float">
            <FileAudio className="w-20 h-20 mb-4 opacity-80" />
            <p className="font-serif italic text-4xl">Drop media file to transcribe</p>
          </div>
        </div>
      )}

      {/* 1. HEADER CARD */}
      <header className="bento-card drag-region flex-none h-20 flex items-center justify-between px-6 z-20">
        <div className="flex items-center">
          <img src={fullLogo} alt="LantipScript" className="h-8 object-contain pointer-events-none" />
        </div>
        
        <div className="flex items-center gap-4 no-drag">
          <button 
            onClick={handleExport} 
            disabled={segments.length === 0} 
            className="neo-btn neo-btn-secondary group"
          >
            <Download className="w-4 h-4 group-hover:-translate-y-0.5 transition-transform" />
            <span>Export</span>
          </button>

          {/* Engine settings, hidden behind the gear icon */}
          <div className="relative">
            <button
              onClick={() => setShowSettings((open) => !open)}
              className="neo-btn neo-btn-secondary relative px-3! group"
              title="Engine settings"
            >
              <Settings className="w-4 h-4 group-hover:rotate-45 transition-transform duration-300" />
              <span
                className={`absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full border-2 border-lantip-dark ${
                  !engineStatus ? 'bg-lantip-blue' : engineStatus.using_gpu ? 'bg-emerald-500' : 'bg-amber-500'
                }`}
              />
            </button>

            {showSettings && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setShowSettings(false)} />
                <div className="absolute right-0 top-full mt-4 z-40 w-72 bento-card p-5 text-left">
                  <p className="text-xs font-bold uppercase tracking-widest text-lantip-dark/50 mb-3">
                    Engine
                  </p>
                  <p className="font-bold text-sm">
                    {engineStatus ? (
                      <>
                        {engineStatus.backend === 'metal' && 'Metal GPU'}
                        {engineStatus.backend === 'vulkan' && 'Vulkan GPU'}
                        {engineStatus.backend === 'cpu' && 'CPU'}
                        {engineStatus.forced_cpu && ' (forced)'}
                        {!engineStatus.loaded && ' · not loaded yet'}
                      </>
                    ) : (
                      'Checking...'
                    )}
                  </p>
                  <p className="text-xs text-lantip-dark/60 mt-1 mb-4 break-all">
                    {engineStatus ? engineStatus.model.replace(/^ggml-/, '').replace(/\.bin$/, '') : '—'}
                  </p>
                  <label className={`flex items-start gap-3 select-none ${isTranscribing ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
                    <input
                      type="checkbox"
                      checked={!gpuEnabled}
                      disabled={isTranscribing}
                      onChange={(e) => handleToggleGpu(!e.target.checked)}
                      className="mt-0.5 w-4 h-4 accent-lantip-dark"
                    />
                    <span>
                      <span className="block font-bold text-sm">Force CPU mode</span>
                      <span className="block text-xs text-lantip-dark/60">
                        Troubleshooting only. Applies on the next transcription (model reloads).
                      </span>
                    </span>
                  </label>
                </div>
              </>
            )}
          </div>

          {isTranscribing ? (
            <button onClick={handleCancel} className="neo-btn neo-btn-secondary group">
              <X className="w-4 h-4 group-hover:rotate-90 transition-transform duration-300" />
              <span>Cancel</span>
            </button>
          ) : (
            <button onClick={handleImportButton} className="neo-btn neo-btn-primary group">
              <Plus className="w-5 h-5 group-hover:rotate-90 transition-transform duration-300" />
              <span>New Audio</span>
            </button>
          )}
        </div>
      </header>

      {/* 2. MAIN TRANSCRIPT AREA */}
      <main ref={mainRef} className="bento-card flex-1 overflow-y-auto p-8 lg:px-24 scroll-smooth relative flex flex-col">

        {/* Transcription error */}
        {errorMessage && (
          <div className="flex items-start justify-between gap-4 border-[3px] border-lantip-dark rounded-2xl bg-red-100 px-5 py-4 mb-6 shadow-[4px_4px_0px_#555879] max-w-3xl mx-auto w-full flex-none">
            <p className="text-sm font-bold text-lantip-dark whitespace-pre-wrap break-words">
              {errorMessage}
            </p>
            <button
              onClick={() => setErrorMessage(null)}
              className="flex-shrink-0 text-lantip-dark/60 hover:text-lantip-dark transition-colors"
              title="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        
        {/* Empty State with float animation */}
        {segments.length === 0 && !isTranscribing && (
          <div className="flex-1 flex flex-col items-center justify-center text-lantip-dark/50 space-y-4">
            <img src={logoIcon} alt="" className="w-16 h-16 opacity-40 grayscale animate-float" />
            <p className="font-serif italic text-3xl text-lantip-dark/80">Drag and drop audio here.</p>
          </div>
        )}

        {/* Loading State */}
        {isTranscribing && segments.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center text-lantip-dark space-y-5">
            <Sparkles className="w-10 h-10 animate-spin text-lantip-blue" />
            <p className="font-sans font-bold text-sm tracking-widest uppercase animate-pulse">
              {progress === null ? "Preparing audio..." : "Transcribing offline securely..."}
            </p>
            {progress !== null && (
              <div className="w-64">
                <div className="h-5 border-[3px] border-lantip-dark rounded-full bg-white overflow-hidden">
                  <div
                    className="h-full bg-lantip-blue transition-[width] duration-300 ease-out"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="text-center text-xs font-bold mt-2 tabular-nums">{progress}%</p>
              </div>
            )}
          </div>
        )}

        {/* Transcription Bubbles with Staggered Cascading Animation */}
        <div className="max-w-3xl mx-auto space-y-4 pb-12 w-full mt-2">
          {segments.map((seg, idx) => (
            <TranscriptRow
              key={idx}
              segment={seg}
              index={idx}
              isActive={idx === activeIndex}
              onSeek={jumpToTime}
              onEdit={updateSegmentText}
            />
          ))}
        </div>
      </main>

      {/* 3. BOTTOM TIMELINE */}
      <footer className="bento-card bg-lantip-beige flex-none h-28 flex flex-col justify-center px-6 z-20">
        <div className="flex items-center gap-6 max-w-5xl mx-auto w-full">
          
          <button 
            onClick={togglePlayPause}
            disabled={!filePath}
            className="flex-shrink-0 w-14 h-14 bg-lantip-dark text-lantip-cream rounded-[1rem] border-3 border-lantip-dark flex items-center justify-center hover:bg-white hover:text-lantip-dark transition-all duration-200 shadow-[3px_3px_0px_#555879] active:shadow-[0px_0px_0px_#555879] active:translate-y-[3px] active:translate-x-[3px] disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-lantip-dark disabled:hover:text-lantip-cream disabled:hover:translate-y-0 disabled:hover:translate-x-0 disabled:hover:shadow-[3px_3px_0px_#555879]"
          >
            {isPlaying ? <Pause className="w-6 h-6 fill-current" /> : <Play className="w-6 h-6 fill-current ml-1" />}
          </button>

          <div className="flex-1 w-full relative">
            {!filePath && (
              <div className="absolute inset-0 flex items-center justify-center font-bold text-lantip-dark/30 text-sm z-10 pointer-events-none">
                Timeline waveform will appear here
              </div>
            )}
            <div ref={waveformContainerRef} className="w-full cursor-pointer transition-opacity duration-500" />
          </div>

        </div>
      </footer>

    </div>
  );
}