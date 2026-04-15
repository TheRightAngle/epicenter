use log::{debug, info};
use parking_lot::Mutex;
use std::path::PathBuf;
use std::sync::OnceLock;
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
// set_directml_device_id, set_tensorrt_tuning, set_cuda_tuning are
// fork-only patches to the vendored crate:
//   - set_directml_device_id: target a specific DXGI adapter
//   - set_tensorrt_tuning:    FP16, engine cache, timing cache, etc.
//   - set_cuda_tuning:        TF32 on Ampere+ for the CUDA fallback
use transcribe_rs::accel::{
    set_cuda_tuning, set_directml_device_id, set_ort_accelerator,
    set_tensorrt_tuning, CudaTuning, OrtAccelerator, TensorRtTuning,
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
/// On NVIDIA hardware, the preference order is **TensorRt > DirectMl > Xnnpack > Cpu**.
/// TensorRT compiles an optimised graph on first load (~5-15 s, cached
/// after) and outperforms DirectML on NVIDIA GPUs. DirectML is the
/// universal Windows GPU path. XNNPACK gives SIMD-accelerated CPU for
/// users without a GPU. CPU is the unaccelerated fallback.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ParakeetAccelerationMode {
    /// Unaccelerated CPU execution (portable fallback).
    Cpu,
    /// CPU acceleration via XNNPACK (ARM NEON + x86 AVX). No GPU needed.
    Xnnpack,
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
            "xnnpack" => {
                if device_id.is_some() {
                    debug!(
                        "Parakeet XNNPACK mode ignores device_id={:?}",
                        device_id
                    );
                }
                Ok(Self::Xnnpack)
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
            Self::Xnnpack => OrtAccelerator::Xnnpack,
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
/// Global cache directory for TensorRT engine + timing caches. Set
/// once at app startup via [`set_cache_dir`]. Reads via [`cache_dir`].
/// Using a static OnceLock (vs. a field on ModelManager) keeps the
/// manager's public surface small and avoids threading a `&mut self`
/// through Arc-wrapped Tauri state.
static CACHE_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Set the directory used for TensorRT engine + timing caches. Safe
/// to call from Tauri's `setup()` closure once `app_data_dir()` is
/// resolvable.
pub fn set_cache_dir(dir: PathBuf) {
    let _ = CACHE_DIR.set(dir);
}

fn cache_dir() -> Option<&'static PathBuf> {
    CACHE_DIR.get()
}

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
        // specific device. For TensorRT, apply the performance tuning
        // (FP16, engine cache, timing cache) so cold-start after the
        // first launch is near-instant and first-launch inference runs
        // at Tensor Core speed on Ampere+ GPUs.
        set_ort_accelerator(acceleration_mode.to_ort_accelerator());
        set_directml_device_id(acceleration_mode.directml_device_id());
        apply_gpu_tuning(acceleration_mode);

        let load_started = Instant::now();
        let mut engine = ParakeetModel::load(&model_path, &Quantization::Int8)
            .map_err(|e| format!("Failed to load Parakeet model: {}", e))?;
        info!(
            "Loaded Parakeet model ({:?}, mode={:?}) in {:?}",
            model_path,
            acceleration_mode,
            load_started.elapsed()
        );

        // Warmup: run a tiny silent inference so the JIT / kernel
        // auto-tuning / cuDNN heuristic selection costs are paid NOW
        // rather than on the user's first real PTT press. For TensorRT
        // this is especially important on a cold engine cache (the
        // engine is compiled during this call; subsequent real
        // inferences reuse the compiled engine). Silent audio produces
        // no meaningful output, which we discard.
        let warmup_started = Instant::now();
        let warmup_samples = vec![0.0f32; 16_000]; // 1 second of silence at 16 kHz
        let warmup_params = transcribe_rs::onnx::parakeet::ParakeetParams::default();
        if let Err(e) = engine.transcribe_with(&warmup_samples, &warmup_params) {
            // Warmup failure is non-fatal — we log and continue. The
            // user will just pay the compile cost on their first real
            // transcription.
            debug!("Parakeet warmup inference failed (non-fatal): {}", e);
        } else {
            info!(
                "Parakeet warmup inference completed in {:?}",
                warmup_started.elapsed()
            );
        }

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
        let mut engine = MoonshineModel::load(&model_path, variant, &Quantization::FP32)
            .map_err(|e| format!("Failed to load Moonshine model: {}", e))?;
        info!(
            "Loaded Moonshine model ({:?}) in {:?}",
            model_path,
            load_started.elapsed()
        );

        // Warmup (see Parakeet warmup for rationale). Moonshine expects
        // 16 kHz mono f32 — 1 second of silence is enough to compile
        // the session.
        let warmup_started = Instant::now();
        let warmup_samples = vec![0.0f32; 16_000];
        let warmup_params = transcribe_rs::onnx::moonshine::MoonshineParams::default();
        if let Err(e) = engine.transcribe_with(&warmup_samples, &warmup_params) {
            debug!("Moonshine warmup inference failed (non-fatal): {}", e);
        } else {
            info!(
                "Moonshine warmup inference completed in {:?}",
                warmup_started.elapsed()
            );
        }

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

/// Configure the vendored transcribe-rs execution-provider tuning
/// globals based on the selected acceleration mode + the configured
/// cache directory. Called from `get_or_load_parakeet` before each
/// load so changing modes between sessions applies cleanly.
fn apply_gpu_tuning(mode: ParakeetAccelerationMode) {
    match mode {
        ParakeetAccelerationMode::TensorRt => {
            // FP16 + caches. Caches are opt-in per load because they
            // depend on a writable directory we only know at startup.
            let (engine_cache_path, timing_cache_path) = match cache_dir() {
                Some(dir) => {
                    let engine = dir.join("tensorrt-engine-cache");
                    let timing = dir.join("tensorrt-timing-cache");
                    if let Err(e) = std::fs::create_dir_all(&engine) {
                        debug!("Failed to create TensorRT engine cache dir: {}", e);
                    }
                    if let Err(e) = std::fs::create_dir_all(&timing) {
                        debug!("Failed to create TensorRT timing cache dir: {}", e);
                    }
                    (
                        Some(engine.to_string_lossy().into_owned()),
                        Some(timing.to_string_lossy().into_owned()),
                    )
                }
                None => (None, None),
            };
            set_tensorrt_tuning(TensorRtTuning {
                fp16: true,
                engine_cache_path,
                timing_cache_path,
                context_memory_sharing: true,
                layer_norm_fp32_fallback: true,
            });
            // TensorRT also uses CUDA as a fallback provider; tune TF32
            // for Ampere+ on that side too.
            set_cuda_tuning(CudaTuning { tf32: true });
        }
        _ => {
            // Clear tunings for non-TensorRT modes so a previously
            // configured session doesn't bleed into a new one.
            set_tensorrt_tuning(TensorRtTuning::default());
            set_cuda_tuning(CudaTuning::default());
        }
    }
}
