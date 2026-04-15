use log::{debug, info};
use parking_lot::Mutex;
use std::path::PathBuf;
use std::time::{Duration, Instant};
use transcribe_rs::onnx::moonshine::{MoonshineModel, MoonshineVariant};
use transcribe_rs::onnx::parakeet::ParakeetModel;
use transcribe_rs::onnx::Quantization;
#[cfg(not(target_os = "windows"))]
use transcribe_rs::whisper_cpp::WhisperEngine;

// transcribe-rs 0.3.11 moved accelerator selection to a global atomic.
// Set it before loading a model; subsequent models pick up the setting.
// Already-loaded sessions are frozen at their original provider.
//
// set_directml_device_id is a fork-only patch to the vendored crate
// that lets us target a specific DXGI adapter when DirectML is
// selected — useful on multi-GPU hosts where the default adapter
// isn't the strongest one.
use transcribe_rs::accel::{
    set_directml_device_id, set_ort_accelerator, OrtAccelerator,
};

/// Engine type for managing different transcription engines.
///
/// Whisper.cpp remains unavailable on Windows due to a persistent MSVC
/// runtime library conflict between whisper-rs-sys and ort. Moonshine
/// now works everywhere: transcribe-rs 0.3.11 dropped the tokenizers/
/// esaxx-rs dependency that previously blocked it on Windows and its
/// PR #53 explicitly enabled DirectML for Moonshine sessions.
pub enum Engine {
    #[cfg(not(target_os = "windows"))]
    Whisper(WhisperEngine),
    Parakeet(ParakeetModel),
    Moonshine(MoonshineModel),
}

/// User-facing acceleration preferences for Parakeet.
///
/// On NVIDIA hardware, the preference order is **TensorRt > DirectMl > Cpu**.
/// TensorRT compiles an optimised graph on first load (~5-15 s) and
/// outperforms DirectML on NVIDIA GPUs. DirectML is the universal Windows
/// GPU path that works on any DX12-capable adapter. CPU is the fallback.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ParakeetAccelerationMode {
    Cpu,
    /// Microsoft DirectML (works on any DX12 GPU on Windows).
    ///
    /// `device_id` is an optional DXGI adapter index — pass `Some(id)`
    /// to target a specific GPU (useful on multi-GPU hosts), or `None`
    /// to let DirectML pick the default adapter. The id matches what
    /// `enumerate_directml_adapters` returns.
    DirectMl { device_id: Option<i32> },
    /// NVIDIA TensorRT (NVIDIA GPUs only; requires CUDA runtime installed).
    /// Falls back to CUDA for ops TensorRT doesn't natively support.
    /// CUDA/TensorRT pick the primary NVIDIA device automatically; no
    /// device_id selection is plumbed through because CUDA is vendor-
    /// specific and typically there's only one NVIDIA GPU to pick from.
    TensorRt,
}

impl ParakeetAccelerationMode {
    pub fn parse(mode: &str, device_id: Option<i32>) -> Result<Self, String> {
        match mode {
            "cpu" => {
                if device_id.is_some() {
                    debug!(
                        "Parakeet CPU mode ignores device_id={:?}",
                        device_id
                    );
                }
                Ok(Self::Cpu)
            }
            "directml" => {
                #[cfg(target_os = "windows")]
                {
                    Ok(Self::DirectMl { device_id })
                }
                #[cfg(not(target_os = "windows"))]
                {
                    let _ = device_id;
                    Err("DirectML acceleration is only available on Windows.".to_string())
                }
            }
            "tensorrt" | "tensor_rt" | "tensor-rt" => {
                if device_id.is_some() {
                    debug!(
                        "Parakeet TensorRT mode ignores device_id={:?} — CUDA selects the \
                         NVIDIA GPU automatically",
                        device_id
                    );
                }
                #[cfg(target_os = "windows")]
                {
                    Ok(Self::TensorRt)
                }
                #[cfg(not(target_os = "windows"))]
                {
                    Err("TensorRT acceleration is only available on Windows with an \
                         NVIDIA GPU + CUDA runtime installed."
                        .to_string())
                }
            }
            _ => Err(format!("Unsupported Parakeet acceleration mode: {}", mode)),
        }
    }

    fn to_ort_accelerator(self) -> OrtAccelerator {
        match self {
            Self::Cpu => OrtAccelerator::CpuOnly,
            Self::DirectMl { .. } => OrtAccelerator::DirectMl,
            Self::TensorRt => OrtAccelerator::TensorRt,
        }
    }

    /// DirectML device id to apply globally before load. `None` for all
    /// other modes (resets the DirectML selection so a subsequent
    /// DirectML-mode load without a specific device goes back to default).
    fn directml_device_id(self) -> Option<i32> {
        match self {
            Self::DirectMl { device_id } => device_id,
            _ => None,
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
/// don't leave the manager wedged.
///
/// ## Blocking model loads
///
/// `get_or_load_*` is synchronous and can block for hundreds of
/// milliseconds (CPU) to multiple seconds (DirectML cold GPU init, or
/// TensorRT graph compilation on first load). Callers from async Tauri
/// commands must wrap the call in `tauri::async_runtime::spawn_blocking`
/// — otherwise the command freezes whatever async worker it was
/// scheduled on.
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

    pub fn get_or_load_parakeet(
        &self,
        model_path: PathBuf,
        acceleration_mode: ParakeetAccelerationMode,
    ) -> Result<(), String> {
        let mut state = self.state.lock();

        let can_reuse = matches!(&state.engine, Some(Engine::Parakeet(_)))
            && state.model_path.as_deref() == Some(&model_path)
            && state.parakeet_mode == Some(acceleration_mode);

        if can_reuse {
            state.last_activity = Some(Instant::now());
            return Ok(());
        }

        state.engine = None;
        state.model_path = None;
        state.parakeet_mode = None;

        // Configure the global ORT accelerator BEFORE load — ort sessions
        // are immutable once created. For DirectML, also apply the
        // (optional) adapter selection so multi-GPU hosts can target a
        // specific device.
        set_ort_accelerator(acceleration_mode.to_ort_accelerator());
        set_directml_device_id(acceleration_mode.directml_device_id());

        let load_started = Instant::now();
        let engine = ParakeetModel::load(&model_path, &Quantization::Int8)
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

    /// Run a closure with exclusive access to the currently loaded engine.
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
