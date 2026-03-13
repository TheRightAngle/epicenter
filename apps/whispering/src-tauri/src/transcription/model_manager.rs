use log::error;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};
#[cfg(not(target_os = "windows"))]
use transcribe_rs::onnx::moonshine::MoonshineModel;
use transcribe_rs::onnx::moonshine::MoonshineVariant;
use transcribe_rs::onnx::parakeet::ParakeetModel;
use transcribe_rs::onnx::Quantization;
#[cfg(not(target_os = "windows"))]
use transcribe_rs::whisper_cpp::WhisperEngine;

/// Engine type for managing different transcription engines
pub enum Engine {
    #[cfg(not(target_os = "windows"))]
    Whisper(WhisperEngine),
    Parakeet(ParakeetModel),
    #[cfg(not(target_os = "windows"))]
    Moonshine(MoonshineModel),
}

impl Engine {
    fn unload(&mut self) {
        // transcribe-rs 0.3.0 drops loaded models directly; there is no explicit unload API.
    }
}

pub struct ModelManager {
    engine: Arc<Mutex<Option<Engine>>>,
    current_model_path: Arc<Mutex<Option<PathBuf>>>,
    last_activity: Arc<Mutex<SystemTime>>,
    idle_timeout: Duration,
}

impl ModelManager {
    pub fn new() -> Self {
        Self {
            engine: Arc::new(Mutex::new(None)),
            current_model_path: Arc::new(Mutex::new(None)),
            last_activity: Arc::new(Mutex::new(SystemTime::now())),
            idle_timeout: Duration::from_secs(5 * 60), // 5 minutes default
        }
    }

    pub fn get_or_load_parakeet(
        &self,
        model_path: PathBuf,
    ) -> Result<Arc<Mutex<Option<Engine>>>, String> {
        let mut engine_guard = self.engine.lock().map_err(|e| {
            format!(
                "Engine mutex poisoned (likely due to previous panic): {}",
                e
            )
        })?;
        let mut current_path_guard = self.current_model_path.lock().map_err(|e| {
            format!(
                "Model path mutex poisoned (likely due to previous panic): {}",
                e
            )
        })?;

        // Check if we need to load a new model
        let needs_load = match (&*engine_guard, &*current_path_guard) {
            (None, _) => true,
            (Some(_), Some(path)) if path != &model_path => {
                // Different model requested, unload current one
                if let Some(mut engine) = engine_guard.take() {
                    engine.unload();
                }
                true
            }
            #[cfg(not(target_os = "windows"))]
            (Some(Engine::Whisper(_)), _) => {
                // Wrong engine type, unload and reload
                if let Some(mut engine) = engine_guard.take() {
                    engine.unload();
                }
                true
            }
            _ => false,
        };

        if needs_load {
            let engine = ParakeetModel::load(&model_path, &Quantization::Int8)
                .map_err(|e| format!("Failed to load Parakeet model: {}", e))?;

            *engine_guard = Some(Engine::Parakeet(engine));
            *current_path_guard = Some(model_path);
        }

        // Update last activity
        let mut last_activity_guard = self
            .last_activity
            .lock()
            .map_err(|e| format!("Last activity mutex poisoned: {}", e))?;
        *last_activity_guard = SystemTime::now();

        Ok(self.engine.clone())
    }

    #[cfg(not(target_os = "windows"))]
    pub fn get_or_load_whisper(
        &self,
        model_path: PathBuf,
    ) -> Result<Arc<Mutex<Option<Engine>>>, String> {
        let mut engine_guard = self.engine.lock().map_err(|e| {
            format!(
                "Engine mutex poisoned (likely due to previous panic): {}",
                e
            )
        })?;
        let mut current_path_guard = self.current_model_path.lock().map_err(|e| {
            format!(
                "Model path mutex poisoned (likely due to previous panic): {}",
                e
            )
        })?;

        // Check if we need to load a new model
        let needs_load = match (&*engine_guard, &*current_path_guard) {
            (None, _) => true,
            (Some(_), Some(path)) if path != &model_path => {
                // Different model requested, unload current one
                if let Some(mut engine) = engine_guard.take() {
                    engine.unload();
                }
                true
            }
            (Some(Engine::Parakeet(_)), _) => {
                // Wrong engine type, unload and reload
                if let Some(mut engine) = engine_guard.take() {
                    engine.unload();
                }
                true
            }
            _ => false,
        };

        if needs_load {
            let engine = WhisperEngine::load(&model_path)
                .map_err(|e| format!("Failed to load Whisper model: {}", e))?;

            *engine_guard = Some(Engine::Whisper(engine));
            *current_path_guard = Some(model_path);
        }

        // Update last activity
        let mut last_activity_guard = self
            .last_activity
            .lock()
            .map_err(|e| format!("Last activity mutex poisoned: {}", e))?;
        *last_activity_guard = SystemTime::now();

        Ok(self.engine.clone())
    }

    #[cfg(target_os = "windows")]
    pub fn get_or_load_whisper(
        &self,
        _model_path: PathBuf,
    ) -> Result<Arc<Mutex<Option<Engine>>>, String> {
        Err("Whisper C++ is not available on Windows due to build compatibility issues. Please use Parakeet for local transcription.".to_string())
    }

    #[cfg(not(target_os = "windows"))]
    pub fn get_or_load_moonshine(
        &self,
        model_path: PathBuf,
        variant: MoonshineVariant,
    ) -> Result<Arc<Mutex<Option<Engine>>>, String> {
        let mut engine_guard = self.engine.lock().map_err(|e| {
            format!(
                "Engine mutex poisoned (likely due to previous panic): {}",
                e
            )
        })?;
        let mut current_path_guard = self.current_model_path.lock().map_err(|e| {
            format!(
                "Model path mutex poisoned (likely due to previous panic): {}",
                e
            )
        })?;

        // Check if we need to load a new model
        let needs_load = match (&*engine_guard, &*current_path_guard) {
            (None, _) => true,
            (Some(_), Some(path)) if path != &model_path => {
                // Different model requested, unload current one
                if let Some(mut engine) = engine_guard.take() {
                    engine.unload();
                }
                true
            }
            (Some(Engine::Whisper(_)), _) => {
                // Wrong engine type, unload and reload
                if let Some(mut engine) = engine_guard.take() {
                    engine.unload();
                }
                true
            }
            (Some(Engine::Parakeet(_)), _) => {
                // Wrong engine type, unload and reload
                if let Some(mut engine) = engine_guard.take() {
                    engine.unload();
                }
                true
            }
            _ => false,
        };

        if needs_load {
            let engine = MoonshineModel::load(&model_path, variant, &Quantization::FP32)
                .map_err(|e| format!("Failed to load Moonshine model: {}", e))?;

            *engine_guard = Some(Engine::Moonshine(engine));
            *current_path_guard = Some(model_path);
        }

        // Update last activity
        let mut last_activity_guard = self
            .last_activity
            .lock()
            .map_err(|e| format!("Last activity mutex poisoned: {}", e))?;
        *last_activity_guard = SystemTime::now();

        Ok(self.engine.clone())
    }

    #[cfg(target_os = "windows")]
    pub fn get_or_load_moonshine(
        &self,
        _model_path: PathBuf,
        _variant: MoonshineVariant,
    ) -> Result<Arc<Mutex<Option<Engine>>>, String> {
        Err("Moonshine is not available on Windows due to build compatibility issues. Please use Parakeet for local transcription.".to_string())
    }

    pub fn unload_if_idle(&self) {
        let last_activity = match self.last_activity.lock() {
            Ok(guard) => *guard,
            Err(e) => {
                error!(
                    "Last activity mutex poisoned while checking idle unload: {}",
                    e
                );
                return;
            }
        };
        let elapsed = SystemTime::now()
            .duration_since(last_activity)
            .unwrap_or(Duration::from_secs(0));

        if elapsed > self.idle_timeout {
            let mut engine_guard = match self.engine.lock() {
                Ok(guard) => guard,
                Err(e) => {
                    error!("Engine mutex poisoned while unloading idle model: {}", e);
                    return;
                }
            };
            if let Some(mut engine) = engine_guard.take() {
                engine.unload();
            }
            if let Ok(mut current_path_guard) = self.current_model_path.lock() {
                *current_path_guard = None;
            } else {
                error!("Model path mutex poisoned while clearing idle model path after unload");
            }
        }
    }

    pub fn unload_model(&self) {
        let mut engine_guard = match self.engine.lock() {
            Ok(guard) => guard,
            Err(e) => {
                error!("Engine mutex poisoned while unloading model: {}", e);
                return;
            }
        };
        if let Some(mut engine) = engine_guard.take() {
            engine.unload();
        }
        if let Ok(mut current_path_guard) = self.current_model_path.lock() {
            *current_path_guard = None;
        } else {
            error!("Model path mutex poisoned while clearing model path after unload");
        }
    }
}
