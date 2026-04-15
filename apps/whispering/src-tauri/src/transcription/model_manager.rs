use log::{debug, info};
use parking_lot::Mutex;
use std::path::PathBuf;
use std::time::{Duration, Instant};
#[cfg(not(target_os = "windows"))]
use transcribe_rs::onnx::moonshine::MoonshineModel;
#[cfg(not(target_os = "windows"))]
use transcribe_rs::onnx::moonshine::MoonshineVariant;
use transcribe_rs::onnx::parakeet::ParakeetModel;
use transcribe_rs::onnx::session::OnnxExecutionProvider;
use transcribe_rs::onnx::Quantization;
#[cfg(not(target_os = "windows"))]
use transcribe_rs::whisper_cpp::WhisperEngine;

/// Engine type for managing different transcription engines.
///
/// Moonshine and Whisper.cpp are unavailable on Windows due to upstream
/// build issues in their native dependencies (whisper.cpp MSVC runtime
/// conflict with ort; tokenizers esaxx-rs CRT conflict). Parakeet is the
/// only local option on Windows and supports CPU + DirectML.
pub enum Engine {
    #[cfg(not(target_os = "windows"))]
    Whisper(WhisperEngine),
    Parakeet(ParakeetModel),
    #[cfg(not(target_os = "windows"))]
    Moonshine(MoonshineModel),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ParakeetAccelerationMode {
    Cpu,
    DirectML { device_id: Option<i32> },
}

impl ParakeetAccelerationMode {
    pub fn parse(mode: &str, device_id: Option<i32>) -> Result<Self, String> {
        match mode {
            "cpu" => Ok(Self::Cpu),
            "directml" => {
                #[cfg(target_os = "windows")]
                {
                    Ok(Self::DirectML { device_id })
                }
                #[cfg(not(target_os = "windows"))]
                {
                    let _ = device_id;
                    Err("DirectML acceleration is only available on Windows.".to_string())
                }
            }
            _ => Err(format!("Unsupported Parakeet acceleration mode: {}", mode)),
        }
    }

    fn to_execution_provider(&self) -> Result<OnnxExecutionProvider, String> {
        match self {
            Self::Cpu => Ok(OnnxExecutionProvider::Cpu),
            Self::DirectML { device_id } => {
                #[cfg(target_os = "windows")]
                {
                    Ok(OnnxExecutionProvider::DirectML {
                        device_id: *device_id,
                    })
                }
                #[cfg(not(target_os = "windows"))]
                {
                    let _ = device_id;
                    Err("DirectML acceleration is only available on Windows.".to_string())
                }
            }
        }
    }
}

/// Tracks which model+config combo is currently resident. Kept in a
/// single struct so swapping models only takes one lock (matches the
/// "load new model, forget old model" atomicity the public API promises).
#[derive(Default)]
struct LoadedModel {
    engine: Option<Engine>,
    model_path: Option<PathBuf>,
    parakeet_mode: Option<ParakeetAccelerationMode>,
    last_activity: Option<Instant>,
}

/// Persistent model cache for transcription engines.
///
/// ## Thread safety
///
/// Uses `parking_lot::Mutex` — non-poisoning, so panics during inference
/// don't leave the manager wedged. Prior std::sync::Mutex required
/// boilerplate `recover_lock(..., |engine| *engine = None)` at every call
/// site to handle poisoning; parking_lot makes that unnecessary because a
/// panicked thread simply unlocks.
///
/// ## Blocking model loads
///
/// `get_or_load_*` is synchronous and can block for hundreds of
/// milliseconds (CPU) to multiple seconds (DirectML cold GPU init).
/// Callers from async Tauri commands must wrap the call in
/// `tauri::async_runtime::spawn_blocking` or `block_in_place` — otherwise
/// the command freezes whatever async worker it was scheduled on. See
/// the `transcribe_audio_*` command handlers for the correct pattern.
pub struct ModelManager {
    state: Mutex<LoadedModel>,
    idle_timeout: Duration,
}

impl ModelManager {
    pub fn new() -> Self {
        Self::with_idle_timeout(Duration::from_secs(5 * 60))
    }

    pub fn with_idle_timeout(idle_timeout: Duration) -> Self {
        Self {
            state: Mutex::new(LoadedModel::default()),
            idle_timeout,
        }
    }

    /// Load (or reuse) a Parakeet model. Blocks for the duration of
    /// ONNX + DirectML initialization on a cold load.
    pub fn get_or_load_parakeet(
        &self,
        model_path: PathBuf,
        acceleration_mode: ParakeetAccelerationMode,
    ) -> Result<(), String> {
        let mut state = self.state.lock();

        // Reuse if it's the same model AND the same acceleration mode.
        let can_reuse = matches!(&state.engine, Some(Engine::Parakeet(_)))
            && state.model_path.as_deref() == Some(&model_path)
            && state.parakeet_mode == Some(acceleration_mode);

        if can_reuse {
            state.last_activity = Some(Instant::now());
            return Ok(());
        }

        // Drop whatever's currently loaded before loading the new one —
        // we don't want two ONNX sessions resident simultaneously.
        state.engine = None;
        state.model_path = None;
        state.parakeet_mode = None;

        let provider = acceleration_mode.to_execution_provider()?;
        let load_started = Instant::now();
        let engine =
            ParakeetModel::load_with_provider(&model_path, &Quantization::Int8, &provider)
                .map_err(|e| format!("Failed to load Parakeet model: {}", e))?;
        info!(
            "Loaded Parakeet model ({:?}, mode={:?}) in {:?}",
            model_path,
            acceleration_mode,
            load_started.elapsed()
        );

        state.engine = Some(Engine::Parakeet(engine));
        state.model_path = Some(model_path);
        state.parakeet_mode = Some(acceleration_mode);
        state.last_activity = Some(Instant::now());
        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    pub fn get_or_load_whisper(&self, model_path: PathBuf) -> Result<(), String> {
        let mut state = self.state.lock();

        let can_reuse = matches!(&state.engine, Some(Engine::Whisper(_)))
            && state.model_path.as_deref() == Some(&model_path);

        if can_reuse {
            state.last_activity = Some(Instant::now());
            return Ok(());
        }

        state.engine = None;
        state.model_path = None;
        state.parakeet_mode = None;

        let load_started = Instant::now();
        let engine = WhisperEngine::load(&model_path)
            .map_err(|e| format!("Failed to load Whisper model: {}", e))?;
        info!(
            "Loaded Whisper model ({:?}) in {:?}",
            model_path,
            load_started.elapsed()
        );

        state.engine = Some(Engine::Whisper(engine));
        state.model_path = Some(model_path);
        state.last_activity = Some(Instant::now());
        Ok(())
    }

    #[cfg(target_os = "windows")]
    pub fn get_or_load_whisper(&self, _model_path: PathBuf) -> Result<(), String> {
        Err("Whisper C++ is not available on Windows due to build compatibility issues. \
             Please use Parakeet for local transcription."
            .to_string())
    }

    #[cfg(not(target_os = "windows"))]
    pub fn get_or_load_moonshine(
        &self,
        model_path: PathBuf,
        variant: MoonshineVariant,
    ) -> Result<(), String> {
        let mut state = self.state.lock();

        let can_reuse = matches!(&state.engine, Some(Engine::Moonshine(_)))
            && state.model_path.as_deref() == Some(&model_path);

        if can_reuse {
            state.last_activity = Some(Instant::now());
            return Ok(());
        }

        state.engine = None;
        state.model_path = None;
        state.parakeet_mode = None;

        let load_started = Instant::now();
        let engine = MoonshineModel::load(&model_path, variant, &Quantization::FP32)
            .map_err(|e| format!("Failed to load Moonshine model: {}", e))?;
        info!(
            "Loaded Moonshine model ({:?}) in {:?}",
            model_path,
            load_started.elapsed()
        );

        state.engine = Some(Engine::Moonshine(engine));
        state.model_path = Some(model_path);
        state.last_activity = Some(Instant::now());
        Ok(())
    }

    // Moonshine is intentionally not exposed on Windows — the
    // `cfg(not(target_os = "windows"))` `get_or_load_moonshine` above is
    // the only public version. The Windows `transcribe_audio_moonshine`
    // command returns an error directly without calling into the model
    // manager, so no Windows stub is needed here.

    /// Run a closure with exclusive access to the currently loaded engine.
    ///
    /// This is the only way to actually use the model — callers load the
    /// model, then call `with_engine` to run inference. The lock is held
    /// for the duration of the closure, so callers should assume
    /// inference serialization (which is what ONNX Runtime wants anyway —
    /// sessions are not thread-safe for concurrent inference).
    pub fn with_engine<T>(
        &self,
        f: impl FnOnce(&mut Engine) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut state = self.state.lock();
        state.last_activity = Some(Instant::now());
        let engine = state
            .engine
            .as_mut()
            .ok_or_else(|| "No model loaded; call get_or_load_* first".to_string())?;
        f(engine)
    }

    /// Unload the model if it hasn't been touched within `idle_timeout`.
    /// Intended to be called on a timer from a background task — gives
    /// the GPU back to the system after the user stops transcribing.
    pub fn unload_if_idle(&self) {
        let mut state = self.state.lock();
        let Some(last_activity) = state.last_activity else {
            return;
        };
        let elapsed = last_activity.elapsed();
        if elapsed > self.idle_timeout {
            debug!(
                "Unloading idle model (idle for {:?}, threshold {:?})",
                elapsed, self.idle_timeout
            );
            state.engine = None;
            state.model_path = None;
            state.parakeet_mode = None;
            state.last_activity = None;
        }
    }

    pub fn unload_model(&self) {
        let mut state = self.state.lock();
        state.engine = None;
        state.model_path = None;
        state.parakeet_mode = None;
        state.last_activity = None;
    }
}

impl Default for ModelManager {
    fn default() -> Self {
        Self::new()
    }
}
