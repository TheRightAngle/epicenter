#[cfg(feature = "directml")]
use ort::execution_providers::DirectMLExecutionProvider;
use ort::execution_providers::{CPUExecutionProvider, ExecutionProviderDispatch};
use ort::session::builder::GraphOptimizationLevel;
use ort::session::Session;
use std::path::Path;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub enum OnnxExecutionProvider {
    #[default]
    Cpu,
    DirectML {
        device_id: Option<i32>,
    },
}

impl OnnxExecutionProvider {
    fn execution_providers(&self) -> Result<Vec<ExecutionProviderDispatch>, ort::Error> {
        match self {
            Self::Cpu => Ok(vec![CPUExecutionProvider::default().build()]),
            Self::DirectML { device_id } => {
                #[cfg(feature = "directml")]
                {
                    let mut provider = DirectMLExecutionProvider::default();
                    if let Some(device_id) = device_id {
                        provider = provider.with_device_id(*device_id);
                    }
                    return Ok(vec![provider.build().error_on_failure()]);
                }

                #[cfg(not(feature = "directml"))]
                {
                    let _ = device_id;
                    Err(ort::Error::new(
                        "DirectML was requested but the transcribe-rs build does not enable the `directml` feature.",
                    ))
                }
            }
        }
    }

    fn memory_pattern_enabled(&self) -> bool {
        matches!(self, Self::Cpu)
    }

    fn parallel_execution_enabled(&self) -> bool {
        matches!(self, Self::Cpu)
    }
}

/// Create an ONNX session with standard settings.
pub fn create_session(path: &Path) -> Result<Session, ort::Error> {
    create_session_with_provider(path, &OnnxExecutionProvider::Cpu)
}

/// Create an ONNX session with a runtime-selectable execution provider.
pub fn create_session_with_provider(
    path: &Path,
    provider: &OnnxExecutionProvider,
) -> Result<Session, ort::Error> {
    let session = Session::builder()?
        .with_optimization_level(GraphOptimizationLevel::Level3)?
        .with_execution_providers(provider.execution_providers()?)?
        .with_memory_pattern(provider.memory_pattern_enabled())?
        .with_parallel_execution(provider.parallel_execution_enabled())?
        .commit_from_file(path)?;

    for input in &session.inputs {
        log::info!(
            "Model input: name={}, type={:?}",
            input.name,
            input.input_type
        );
    }
    for output in &session.outputs {
        log::info!(
            "Model output: name={}, type={:?}",
            output.name,
            output.output_type
        );
    }

    Ok(session)
}

/// Create an ONNX session with configurable thread count.
pub fn create_session_with_threads(path: &Path, num_threads: usize) -> Result<Session, ort::Error> {
    create_session_with_threads_and_provider(path, num_threads, &OnnxExecutionProvider::Cpu)
}

/// Create an ONNX session with configurable thread count and a runtime-selectable execution provider.
pub fn create_session_with_threads_and_provider(
    path: &Path,
    num_threads: usize,
    provider: &OnnxExecutionProvider,
) -> Result<Session, ort::Error> {
    let mut builder =
        Session::builder()?.with_optimization_level(GraphOptimizationLevel::Level3)?;

    if num_threads > 0 {
        builder = builder.with_intra_threads(num_threads)?;
    }

    let session = builder
        .with_execution_providers(provider.execution_providers()?)?
        .with_memory_pattern(provider.memory_pattern_enabled())?
        .with_parallel_execution(provider.parallel_execution_enabled())?
        .commit_from_file(path)?;

    Ok(session)
}

/// Resolve a model file path for the requested quantization level.
///
/// Looks for `{name}.{suffix}.onnx` based on the quantization variant,
/// falling back to `{name}.onnx` (FP32) if the requested file doesn't exist.
pub fn resolve_model_path(
    dir: &Path,
    name: &str,
    quantization: &super::Quantization,
) -> std::path::PathBuf {
    let suffix = match quantization {
        super::Quantization::FP32 => None,
        super::Quantization::FP16 => Some("fp16"),
        super::Quantization::Int8 => Some("int8"),
    };

    if let Some(suffix) = suffix {
        let path = dir.join(format!("{}.{}.onnx", name, suffix));
        if path.exists() {
            log::info!("Loading {} model: {}", suffix, path.display());
            return path;
        }
        log::warn!(
            "{} model not found at {}, falling back to {}.onnx",
            suffix,
            path.display(),
            name
        );
    }

    dir.join(format!("{}.onnx", name))
}

/// Read a custom metadata string from an ONNX session.
pub fn read_metadata_str(session: &Session, key: &str) -> Result<Option<String>, ort::Error> {
    let meta = session.metadata()?;
    meta.custom(key)
}

/// Read a custom metadata i32 value, with optional default.
pub fn read_metadata_i32(
    session: &Session,
    key: &str,
    default: Option<i32>,
) -> Result<Option<i32>, crate::TranscribeError> {
    let str_val = read_metadata_str(session, key).map_err(|e| {
        crate::TranscribeError::Config(format!("failed to read metadata '{}': {}", key, e))
    })?;
    match str_val {
        Some(v) => Ok(Some(v.parse::<i32>().map_err(|e| {
            crate::TranscribeError::Config(format!("failed to parse '{}': {}", key, e))
        })?)),
        None => Ok(default),
    }
}

/// Read a comma-separated float vector from metadata.
pub fn read_metadata_float_vec(
    session: &Session,
    key: &str,
) -> Result<Option<Vec<f32>>, crate::TranscribeError> {
    let str_val = read_metadata_str(session, key).map_err(|e| {
        crate::TranscribeError::Config(format!("failed to read metadata '{}': {}", key, e))
    })?;
    match str_val {
        Some(v) => {
            let floats: Result<Vec<f32>, _> =
                v.split(',').map(|s| s.trim().parse::<f32>()).collect();
            Ok(Some(floats.map_err(|e| {
                crate::TranscribeError::Config(format!(
                    "failed to parse floats in '{}': {}",
                    key, e
                ))
            })?))
        }
        None => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::OnnxExecutionProvider;

    #[test]
    fn cpu_provider_keeps_default_session_optimizations() {
        let provider = OnnxExecutionProvider::Cpu;

        assert!(provider.memory_pattern_enabled());
        assert!(provider.parallel_execution_enabled());
    }

    #[test]
    fn directml_provider_disables_dynamic_session_optimizations() {
        let provider = OnnxExecutionProvider::DirectML { device_id: Some(1) };

        assert!(!provider.memory_pattern_enabled());
        assert!(!provider.parallel_execution_enabled());
    }
}
