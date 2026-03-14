use crate::recorder::wav_writer::WavWriter;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{BufferSize, Device, DeviceId, SampleFormat, Stream, SupportedBufferSize};
use log::{debug, error, info};
use serde::Serialize;
use std::any::Any;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

/// Simple result type using String for errors
pub type Result<T> = std::result::Result<T, String>;

/// Audio recording metadata - returned to frontend
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioRecording {
    pub audio_data: Vec<f32>, // Empty for file-based recording
    pub sample_rate: u32,
    pub channels: u16,
    pub duration_seconds: f32,
    pub file_path: Option<String>, // Path to the WAV file
}

/// Recording device metadata returned to the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingDeviceInfo {
    pub id: String,
    pub label: String,
}

/// Simple recorder commands for worker thread communication
#[derive(Debug)]
enum RecorderCmd {
    Start(mpsc::Sender<()>), // Response channel to confirm command processed
    Stop(mpsc::Sender<()>),  // Response channel to confirm command processed
    Shutdown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RecorderWriteMode {
    Inline,
    BufferedMemory,
}

const EXPERIMENTAL_CAPTURE_TARGET_BUFFER_FRAMES: u32 = 2048;
const EXPERIMENTAL_CAPTURE_INITIAL_SECONDS: usize = 30;
const EXPERIMENTAL_CAPTURE_OUTPUT_CHANNELS: u16 = 1;

#[derive(Debug)]
enum InMemoryAudioBuffer {
    F32(Vec<f32>),
    I16(Vec<i16>),
    U16(Vec<u16>),
}

#[derive(Debug, Default)]
struct CaptureDiagnostics {
    callback_count: AtomicU64,
    input_sample_count: AtomicU64,
    output_sample_count: AtomicU64,
    callback_nanos: AtomicU64,
    max_callback_nanos: AtomicU64,
    callback_thread_id: AtomicU32,
}

#[derive(Debug, Clone, Copy)]
struct CaptureDiagnosticsSnapshot {
    callback_count: u64,
    input_sample_count: u64,
    output_sample_count: u64,
    callback_nanos: u64,
    max_callback_nanos: u64,
    callback_thread_id: u32,
}

impl CaptureDiagnostics {
    fn record_callback(&self, input_samples: usize, output_samples: usize, elapsed: Duration) {
        self.callback_count.fetch_add(1, Ordering::Relaxed);
        self.input_sample_count
            .fetch_add(input_samples as u64, Ordering::Relaxed);
        self.output_sample_count
            .fetch_add(output_samples as u64, Ordering::Relaxed);

        let elapsed_nanos = elapsed.as_nanos().min(u64::MAX as u128) as u64;
        self.callback_nanos
            .fetch_add(elapsed_nanos, Ordering::Relaxed);

        let mut current_max = self.max_callback_nanos.load(Ordering::Relaxed);
        while elapsed_nanos > current_max {
            match self.max_callback_nanos.compare_exchange_weak(
                current_max,
                elapsed_nanos,
                Ordering::Relaxed,
                Ordering::Relaxed,
            ) {
                Ok(_) => break,
                Err(observed) => current_max = observed,
            }
        }

        let thread_id = current_os_thread_id();
        if thread_id != 0 {
            let _ = self.callback_thread_id.compare_exchange(
                0,
                thread_id,
                Ordering::Relaxed,
                Ordering::Relaxed,
            );
        }
    }

    fn snapshot(&self) -> CaptureDiagnosticsSnapshot {
        CaptureDiagnosticsSnapshot {
            callback_count: self.callback_count.load(Ordering::Relaxed),
            input_sample_count: self.input_sample_count.load(Ordering::Relaxed),
            output_sample_count: self.output_sample_count.load(Ordering::Relaxed),
            callback_nanos: self.callback_nanos.load(Ordering::Relaxed),
            max_callback_nanos: self.max_callback_nanos.load(Ordering::Relaxed),
            callback_thread_id: self.callback_thread_id.load(Ordering::Relaxed),
        }
    }
}

impl InMemoryAudioBuffer {
    fn new(sample_format: SampleFormat, initial_capacity_samples: usize) -> Result<Self> {
        match sample_format {
            SampleFormat::F32 => Ok(Self::F32(Vec::with_capacity(initial_capacity_samples))),
            SampleFormat::I16 => Ok(Self::I16(Vec::with_capacity(initial_capacity_samples))),
            SampleFormat::U16 => Ok(Self::U16(Vec::with_capacity(initial_capacity_samples))),
            _ => Err(format!(
                "Unsupported sample format for in-memory capture: {:?}",
                sample_format
            )),
        }
    }

    fn append_f32_interleaved_mono(&mut self, samples: &[f32], capture_channels: u16) {
        if let Self::F32(buffer) = self {
            append_f32_interleaved_mono(buffer, samples, capture_channels);
        }
    }

    fn append_i16_interleaved_mono(&mut self, samples: &[i16], capture_channels: u16) {
        if let Self::I16(buffer) = self {
            append_i16_interleaved_mono(buffer, samples, capture_channels);
        }
    }

    fn append_u16_interleaved_mono(&mut self, samples: &[u16], capture_channels: u16) {
        if let Self::U16(buffer) = self {
            append_u16_interleaved_mono(buffer, samples, capture_channels);
        }
    }

    fn take_f32_samples(&mut self) -> Vec<f32> {
        match self {
            Self::F32(samples) => std::mem::take(samples),
            Self::I16(samples) => std::mem::take(samples)
                .into_iter()
                .map(|sample| sample as f32 / i16::MAX as f32)
                .collect(),
            Self::U16(samples) => std::mem::take(samples)
                .into_iter()
                .map(|sample| (sample as f32 / u16::MAX as f32) * 2.0 - 1.0)
                .collect(),
        }
    }
}

fn append_f32_interleaved_mono(buffer: &mut Vec<f32>, samples: &[f32], capture_channels: u16) {
    if capture_channels <= 1 {
        buffer.extend_from_slice(samples);
        return;
    }

    let channel_count = capture_channels as usize;
    buffer.reserve(samples.len() / channel_count);

    for frame in samples.chunks_exact(channel_count) {
        let sum: f32 = frame.iter().copied().sum();
        buffer.push(sum / capture_channels as f32);
    }
}

fn append_i16_interleaved_mono(buffer: &mut Vec<i16>, samples: &[i16], capture_channels: u16) {
    if capture_channels <= 1 {
        buffer.extend_from_slice(samples);
        return;
    }

    let channel_count = capture_channels as usize;
    let divisor = capture_channels as i32;
    buffer.reserve(samples.len() / channel_count);

    for frame in samples.chunks_exact(channel_count) {
        let sum: i32 = frame.iter().map(|sample| *sample as i32).sum();
        buffer.push((sum / divisor) as i16);
    }
}

fn append_u16_interleaved_mono(buffer: &mut Vec<u16>, samples: &[u16], capture_channels: u16) {
    if capture_channels <= 1 {
        buffer.extend_from_slice(samples);
        return;
    }

    let channel_count = capture_channels as usize;
    let divisor = capture_channels as u32;
    buffer.reserve(samples.len() / channel_count);

    for frame in samples.chunks_exact(channel_count) {
        let sum: u32 = frame.iter().map(|sample| *sample as u32).sum();
        buffer.push((sum / divisor) as u16);
    }
}

/// Simplified recorder state
pub struct RecorderState {
    cmd_tx: Option<mpsc::Sender<RecorderCmd>>,
    worker_handle: Option<JoinHandle<()>>,
    writer: Option<Arc<Mutex<WavWriter>>>,
    write_mode: RecorderWriteMode,
    in_memory_audio: Option<Arc<Mutex<InMemoryAudioBuffer>>>,
    capture_diagnostics: Option<Arc<CaptureDiagnostics>>,
    is_recording: Arc<AtomicBool>,
    sample_rate: u32,
    channels: u16,
    file_path: Option<PathBuf>,
    current_recording_id: Option<String>,
}

impl RecorderState {
    pub fn new() -> Self {
        Self {
            cmd_tx: None,
            worker_handle: None,
            writer: None,
            write_mode: RecorderWriteMode::Inline,
            in_memory_audio: None,
            capture_diagnostics: None,
            is_recording: Arc::new(AtomicBool::new(false)),
            sample_rate: 0,
            channels: 0,
            file_path: None,
            current_recording_id: None,
        }
    }

    /// List available recording devices using stable identifiers and user-facing labels.
    pub fn enumerate_devices(&self) -> Result<Vec<RecordingDeviceInfo>> {
        let host = cpal::default_host();
        let devices = host
            .input_devices()
            .map_err(|e| format!("Failed to get input devices: {}", e))?
            .map(|device| {
                let id = device
                    .id()
                    .map(|device_id| device_id.to_string())
                    .or_else(|_| device.name())
                    .map_err(|e| format!("Failed to get device id: {}", e))?;
                let label = format_device_label(&device)?;
                Ok(RecordingDeviceInfo { id, label })
            })
            .collect::<Result<Vec<_>>>()?;

        Ok(devices)
    }

    /// Initialize recording session - creates stream and WAV writer
    pub fn init_session(
        &mut self,
        device_identifier: String,
        output_folder: PathBuf,
        recording_id: String,
        preferred_sample_rate: Option<u32>,
        experimental_buffered_capture: bool,
    ) -> Result<()> {
        // Clean up any existing session
        self.close_session()?;

        // Create file path
        let file_path = output_folder.join(format!("{}.wav", recording_id));

        // Find the device
        let host = cpal::default_host();
        let device = find_device(&host, &device_identifier)?;
        let write_mode = if experimental_buffered_capture {
            RecorderWriteMode::BufferedMemory
        } else {
            RecorderWriteMode::Inline
        };

        // Get optimal config for voice with optional preferred sample rate
        let config = get_optimal_config(
            &device,
            preferred_sample_rate,
            write_mode == RecorderWriteMode::BufferedMemory,
        )?;
        let sample_format = config.sample_format();
        let sample_rate = config.sample_rate();
        let capture_channels = config.channels();
        let output_channels = if write_mode == RecorderWriteMode::BufferedMemory {
            EXPERIMENTAL_CAPTURE_OUTPUT_CHANNELS
        } else {
            capture_channels
        };
        let writer = if write_mode == RecorderWriteMode::Inline {
            Some(Arc::new(Mutex::new(
                WavWriter::new(file_path.clone(), sample_rate, capture_channels)
                    .map_err(|e| format!("Failed to create WAV file: {}", e))?,
            )))
        } else {
            None
        };
        let in_memory_audio = if write_mode == RecorderWriteMode::BufferedMemory {
            let initial_capacity_samples = sample_rate as usize
                * output_channels as usize
                * EXPERIMENTAL_CAPTURE_INITIAL_SECONDS;
            Some(Arc::new(Mutex::new(InMemoryAudioBuffer::new(
                sample_format,
                initial_capacity_samples,
            )?)))
        } else {
            None
        };
        let capture_diagnostics = if write_mode == RecorderWriteMode::BufferedMemory {
            Some(Arc::new(CaptureDiagnostics::default()))
        } else {
            None
        };

        // Create stream config
        let stream_config = cpal::StreamConfig {
            channels: capture_channels,
            sample_rate,
            buffer_size: resolve_stream_buffer_size(&config, write_mode),
        };
        let stream_buffer_size = format!("{:?}", stream_config.buffer_size);

        // Create fresh recording flag
        self.is_recording = Arc::new(AtomicBool::new(false));
        let is_recording = self.is_recording.clone();

        // Create command channel for worker thread
        let (cmd_tx, cmd_rx) = mpsc::channel();

        // Clone for the worker thread
        let writer_clone = writer.clone();
        let is_recording_clone = is_recording.clone();
        let in_memory_audio_for_stream = in_memory_audio.clone();
        let capture_diagnostics_for_stream = capture_diagnostics.clone();
        let write_mode_for_stream = write_mode;

        // Create the worker thread that owns the stream
        let worker = thread::spawn(move || {
            info!(
                "Recorder worker thread started: os_thread_id={}",
                current_os_thread_id()
            );
            // Build the stream IN this thread (required for macOS)
            let stream = match build_input_stream(
                &device,
                &stream_config,
                sample_format,
                is_recording_clone,
                write_mode_for_stream,
                writer_clone,
                in_memory_audio_for_stream,
                capture_diagnostics_for_stream,
            ) {
                Ok(s) => s,
                Err(e) => {
                    error!("Failed to build stream: {}", e);
                    return;
                }
            };

            // Start the stream
            if let Err(e) = stream.play() {
                error!("Failed to start stream: {}", e);
                return;
            }

            info!("Audio stream started successfully");

            // Keep thread alive by waiting for commands
            // This blocks but is responsive - no sleeping!
            loop {
                match cmd_rx.recv() {
                    Ok(RecorderCmd::Start(reply_tx)) => {
                        is_recording.store(true, Ordering::Relaxed);
                        info!("Recording started");
                        let _ = reply_tx.send(()); // Confirm command processed
                    }
                    Ok(RecorderCmd::Stop(reply_tx)) => {
                        is_recording.store(false, Ordering::Relaxed);
                        info!("Recording stopped");
                        let _ = reply_tx.send(()); // Confirm command processed
                    }
                    Ok(RecorderCmd::Shutdown) | Err(_) => {
                        info!("Shutting down audio worker");
                        break;
                    }
                }
            }
            // Stream automatically drops here
        });

        // Store everything
        self.cmd_tx = Some(cmd_tx);
        self.worker_handle = Some(worker);
        self.writer = writer;
        self.write_mode = write_mode;
        self.in_memory_audio = in_memory_audio;
        self.capture_diagnostics = capture_diagnostics;
        self.sample_rate = sample_rate;
        self.channels = output_channels;
        self.file_path = if write_mode == RecorderWriteMode::Inline {
            Some(file_path)
        } else {
            None
        };
        self.current_recording_id = Some(recording_id);

        info!(
            "Recording session initialized: {} Hz, capture_channels={}, output_channels={}, buffer={}, file: {:?}",
            sample_rate, capture_channels, output_channels, stream_buffer_size, self.file_path
        );

        Ok(())
    }

    /// Start recording - send command to worker thread and wait for confirmation
    pub fn start_recording(&mut self) -> Result<()> {
        if let Some(tx) = &self.cmd_tx {
            let (reply_tx, reply_rx) = mpsc::channel();
            tx.send(RecorderCmd::Start(reply_tx))
                .map_err(|e| format!("Failed to send start command: {}", e))?;
            // Wait for worker thread to confirm the command was processed
            reply_rx
                .recv()
                .map_err(|e| format!("Failed to receive start confirmation: {}", e))?;
        } else {
            return Err("No recording session initialized".to_string());
        }
        Ok(())
    }

    /// Stop recording - return file info
    pub fn stop_recording(&mut self) -> Result<AudioRecording> {
        // Send stop command to worker thread and wait for confirmation
        if let Some(tx) = &self.cmd_tx {
            let (reply_tx, reply_rx) = mpsc::channel();
            tx.send(RecorderCmd::Stop(reply_tx))
                .map_err(|e| format!("Failed to send stop command: {}", e))?;
            // Wait for worker thread to confirm the command was processed
            reply_rx
                .recv()
                .map_err(|e| format!("Failed to receive stop confirmation: {}", e))?;
        }

        if self.write_mode == RecorderWriteMode::BufferedMemory {
            let recording = self.finalize_in_memory_audio()?;
            if let Some(capture_diagnostics) = &self.capture_diagnostics {
                let snapshot = capture_diagnostics.snapshot();
                let avg_output_samples_per_callback = if snapshot.callback_count == 0 {
                    0.0
                } else {
                    snapshot.output_sample_count as f64 / snapshot.callback_count as f64
                };
                let avg_callback_ms = if snapshot.callback_count == 0 {
                    0.0
                } else {
                    snapshot.callback_nanos as f64 / snapshot.callback_count as f64 / 1_000_000.0
                };
                let max_callback_ms = snapshot.max_callback_nanos as f64 / 1_000_000.0;

                info!(
                    "Experimental capture diagnostics: callback_thread_id={}, callbacks={}, input_samples={}, output_samples={}, avg_output_samples_per_callback={:.2}, avg_callback_ms={:.4}, max_callback_ms={:.4}",
                    snapshot.callback_thread_id,
                    snapshot.callback_count,
                    snapshot.input_sample_count,
                    snapshot.output_sample_count,
                    avg_output_samples_per_callback,
                    avg_callback_ms,
                    max_callback_ms
                );
            }
            info!(
                "Recording stopped in memory: {:.2}s, samples: {}",
                recording.duration_seconds,
                recording.audio_data.len()
            );
            return Ok(recording);
        }

        // Finalize the WAV file and get metadata
        let (sample_rate, channels, duration) = if let Some(writer) = &self.writer {
            let mut w = writer
                .lock()
                .map_err(|e| format!("Failed to lock writer: {}", e))?;
            w.finalize()
                .map_err(|e| format!("Failed to finalize WAV: {}", e))?;
            w.get_metadata()
        } else {
            (self.sample_rate, self.channels, 0.0)
        };

        let file_path = self
            .file_path
            .as_ref()
            .map(|p| p.to_string_lossy().to_string());

        info!("Recording stopped: {:.2}s, file: {:?}", duration, file_path);

        Ok(AudioRecording {
            audio_data: Vec::new(), // Empty for file-based recording
            sample_rate,
            channels,
            duration_seconds: duration,
            file_path,
        })
    }

    /// Cancel recording - stop and delete the file
    pub fn cancel_recording(&mut self) -> Result<()> {
        let file_path = self.file_path.clone();

        // Send stop command
        if let Some(tx) = &self.cmd_tx {
            let (reply_tx, reply_rx) = mpsc::channel();
            let _ = tx.send(RecorderCmd::Stop(reply_tx));
            let _ = reply_rx.recv(); // Wait for confirmation but ignore errors during cancel
        }

        // Clear the session
        self.close_session()?;

        // Delete the file if it exists
        if let Some(file_path) = &file_path {
            std::fs::remove_file(file_path)
                .map_err(|e| format!("Failed to delete recording file {:?}: {}", file_path, e))?;
            debug!("Deleted recording file: {:?}", file_path);
        }

        Ok(())
    }

    /// Close the recording session
    pub fn close_session(&mut self) -> Result<()> {
        let mut cleanup_errors = Vec::new();

        // Send shutdown command to worker thread
        if let Some(tx) = self.cmd_tx.take() {
            if let Err(e) = tx.send(RecorderCmd::Shutdown) {
                cleanup_errors.push(format!("Failed to send shutdown command: {}", e));
            }
        }

        // Wait for worker thread to finish
        if let Some(handle) = self.worker_handle.take() {
            if let Err(panic) = handle.join() {
                cleanup_errors.push(format!(
                    "Failed to join worker thread: {}",
                    panic_payload_message(&panic)
                ));
            }
        }

        // Finalize and drop the writer
        if let Some(writer) = self.writer.take() {
            match writer.lock() {
                Ok(mut w) => {
                    if let Err(e) = w.finalize() {
                        cleanup_errors.push(format!("Failed to finalize WAV: {}", e));
                    }
                }
                Err(e) => {
                    cleanup_errors.push(format!("Failed to lock writer: {}", e));
                }
            }
        }

        // Clear state
        self.write_mode = RecorderWriteMode::Inline;
        self.in_memory_audio = None;
        self.capture_diagnostics = None;
        self.file_path = None;
        self.current_recording_id = None;
        self.sample_rate = 0;
        self.channels = 0;

        debug!("Recording session closed");
        if cleanup_errors.is_empty() {
            Ok(())
        } else {
            Err(cleanup_errors.join("; "))
        }
    }

    /// Get current recording ID if actively recording
    pub fn get_current_recording_id(&self) -> Option<String> {
        if self.is_recording.load(Ordering::Acquire) {
            self.current_recording_id.clone()
        } else {
            None
        }
    }

    fn finalize_in_memory_audio(&mut self) -> Result<AudioRecording> {
        let in_memory_audio = self
            .in_memory_audio
            .as_ref()
            .ok_or_else(|| "No in-memory audio buffer initialized".to_string())?;
        let mut in_memory_audio = in_memory_audio
            .lock()
            .map_err(|e| format!("Failed to lock in-memory audio buffer: {}", e))?;
        let audio_data = in_memory_audio.take_f32_samples();
        let duration_seconds =
            audio_data.len() as f32 / (self.sample_rate as f32 * self.channels as f32);

        Ok(AudioRecording {
            audio_data,
            sample_rate: self.sample_rate,
            channels: self.channels,
            duration_seconds,
            file_path: None,
        })
    }
}

/// Find a recording device by stable id, falling back to the legacy name path.
fn find_device(host: &cpal::Host, device_identifier: &str) -> Result<Device> {
    // Handle "default" device
    if device_identifier.to_lowercase() == "default" {
        return host
            .default_input_device()
            .ok_or_else(|| "No default input device available".to_string());
    }

    if let Ok(device_id) = device_identifier.parse::<DeviceId>() {
        if let Some(device) = host.device_by_id(&device_id) {
            return Ok(device);
        }
    }

    // Fall back to legacy name-based lookup for older persisted settings.
    let devices: Vec<_> = host.input_devices().map_err(|e| e.to_string())?.collect();

    for device in devices {
        if let Ok(name) = device.name() {
            if name == device_identifier {
                return Ok(device);
            }
        }
    }

    Err(format!("Device '{}' not found", device_identifier))
}

fn format_device_label(device: &Device) -> Result<String> {
    if let Ok(description) = device.description() {
        let name = description.name().trim();

        if let Some(friendly_name) = description
            .extended()
            .first()
            .map(|line| line.trim())
            .filter(|line| !line.is_empty() && *line != name)
        {
            return Ok(format!("{} ({})", friendly_name, name));
        }

        if !name.is_empty() {
            return Ok(name.to_string());
        }
    }

    device
        .name()
        .map_err(|e| format!("Failed to get device label: {}", e))
}

fn panic_payload_message(panic: &Box<dyn Any + Send + 'static>) -> String {
    if let Some(message) = panic.downcast_ref::<&str>() {
        (*message).to_string()
    } else if let Some(message) = panic.downcast_ref::<String>() {
        message.clone()
    } else {
        "unknown panic".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::RecorderState;
    use std::fs;
    use std::thread;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn cancel_recording_propagates_delete_failures_after_cleanup() {
        let unique_suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let temp_dir =
            std::env::temp_dir().join(format!("whispering-cancel-recording-{unique_suffix}"));

        fs::create_dir(&temp_dir).unwrap();

        let mut recorder = RecorderState::new();
        recorder.file_path = Some(temp_dir.clone());
        recorder.sample_rate = 16_000;
        recorder.channels = 1;

        let error = recorder.cancel_recording().unwrap_err();

        assert!(error.contains("Failed to delete recording file"));
        assert!(recorder.file_path.is_none());
        assert_eq!(recorder.sample_rate, 0);
        assert_eq!(recorder.channels, 0);

        fs::remove_dir_all(temp_dir).unwrap();
    }

    #[test]
    fn close_session_propagates_worker_join_failures() {
        let mut recorder = RecorderState::new();
        recorder.worker_handle = Some(thread::spawn(|| panic!("worker boom")));

        let error = recorder.close_session().unwrap_err();

        assert!(error.contains("Failed to join worker thread"));
        assert!(error.contains("worker boom"));
        assert!(recorder.worker_handle.is_none());
        assert!(recorder.file_path.is_none());
        assert_eq!(recorder.sample_rate, 0);
        assert_eq!(recorder.channels, 0);
    }
}

/// Get optimal configuration for voice recording
fn get_optimal_config(
    device: &Device,
    preferred_sample_rate: Option<u32>,
    prefer_native_rate: bool,
) -> Result<cpal::SupportedStreamConfig> {
    if prefer_native_rate {
        let default_config = device
            .default_input_config()
            .map_err(|e| format!("Failed to get default input config: {}", e))?;

        let sample_format = default_config.sample_format();
        if matches!(
            sample_format,
            SampleFormat::F32 | SampleFormat::I16 | SampleFormat::U16
        ) {
            debug!(
                "Using device default input config for experimental capture: {} Hz, {} channels, {:?}",
                default_config.sample_rate(),
                default_config.channels(),
                sample_format
            );
            return Ok(default_config);
        }
    }

    // Use preferred sample rate or default to 16kHz for voice
    let target_sample_rate = preferred_sample_rate.unwrap_or(16000);

    let configs: Vec<_> = device
        .supported_input_configs()
        .map_err(|e| e.to_string())?
        .collect();

    if configs.is_empty() {
        return Err("No supported input configurations".to_string());
    }

    // Filter for supported sample formats only
    let supported_formats = [SampleFormat::F32, SampleFormat::I16, SampleFormat::U16];
    let compatible_configs: Vec<_> = configs
        .iter()
        .filter(|config| supported_formats.contains(&config.sample_format()))
        .collect();

    if compatible_configs.is_empty() {
        return Err("No configurations with supported sample formats (F32, I16, U16)".to_string());
    }

    // Try to find mono config with target sample rate and supported format
    for config in &compatible_configs {
        if config.channels() == 1 {
            let min_rate = config.min_sample_rate();
            let max_rate = config.max_sample_rate();
            if min_rate <= target_sample_rate && max_rate >= target_sample_rate {
                return Ok(config.with_sample_rate(target_sample_rate));
            }
        }
    }

    // Try stereo with target sample rate if mono not available
    for config in &compatible_configs {
        let min_rate = config.min_sample_rate();
        let max_rate = config.max_sample_rate();
        if min_rate <= target_sample_rate && max_rate >= target_sample_rate {
            return Ok(config.with_sample_rate(target_sample_rate));
        }
    }

    // If target rate not supported, try to find closest rate
    let mut best_config = None;
    let mut best_diff = u32::MAX;

    for config in &compatible_configs {
        // Prefer mono
        if config.channels() == 1 {
            let min_rate = config.min_sample_rate();
            let max_rate = config.max_sample_rate();

            // Find closest supported rate
            let closest_rate = if target_sample_rate < min_rate {
                min_rate
            } else if target_sample_rate > max_rate {
                max_rate
            } else {
                target_sample_rate
            };

            let diff = (closest_rate as i32 - target_sample_rate as i32).abs() as u32;
            if diff < best_diff {
                best_diff = diff;
                best_config = Some(config.with_sample_rate(closest_rate));
            }
        }
    }

    // If still no best config, take any compatible config
    if best_config.is_none() && !compatible_configs.is_empty() {
        let config = compatible_configs[0];
        let min_rate = config.min_sample_rate();
        let max_rate = config.max_sample_rate();
        let rate = if min_rate <= target_sample_rate && max_rate >= target_sample_rate {
            target_sample_rate
        } else {
            min_rate // Use minimum rate as fallback
        };
        best_config = Some(config.with_sample_rate(rate));
    }

    best_config.ok_or_else(|| "Failed to find suitable audio configuration".to_string())
}

fn resolve_stream_buffer_size(
    config: &cpal::SupportedStreamConfig,
    write_mode: RecorderWriteMode,
) -> BufferSize {
    if write_mode != RecorderWriteMode::BufferedMemory {
        return BufferSize::Default;
    }

    match config.buffer_size() {
        SupportedBufferSize::Range { min, max } => {
            let preferred = EXPERIMENTAL_CAPTURE_TARGET_BUFFER_FRAMES
                .max(*min)
                .min(*max);

            if preferred == 0 {
                BufferSize::Default
            } else {
                BufferSize::Fixed(preferred)
            }
        }
        SupportedBufferSize::Unknown => BufferSize::Default,
    }
}

#[cfg(target_os = "windows")]
fn current_os_thread_id() -> u32 {
    windows_sys::Win32::System::Threading::GetCurrentThreadId()
}

#[cfg(not(target_os = "windows"))]
fn current_os_thread_id() -> u32 {
    0
}

/// Build input stream for any supported sample format
fn build_input_stream(
    device: &Device,
    config: &cpal::StreamConfig,
    sample_format: SampleFormat,
    is_recording: Arc<AtomicBool>,
    write_mode: RecorderWriteMode,
    writer: Option<Arc<Mutex<WavWriter>>>,
    in_memory_audio: Option<Arc<Mutex<InMemoryAudioBuffer>>>,
    capture_diagnostics: Option<Arc<CaptureDiagnostics>>,
) -> Result<Stream> {
    let err_fn = |err| error!("Audio stream error: {}", err);
    let capture_channels = config.channels;

    let stream = match sample_format {
        SampleFormat::F32 => {
            let writer = writer.clone();
            let in_memory_audio = in_memory_audio.clone();
            let capture_diagnostics = capture_diagnostics.clone();
            device
                .build_input_stream(
                    config,
                    move |data: &[f32], _: &_| {
                        if is_recording.load(Ordering::Relaxed) {
                            let started = Instant::now();
                            match write_mode {
                                RecorderWriteMode::Inline => {
                                    if let Some(writer) = &writer {
                                        if let Ok(mut w) = writer.lock() {
                                            let _ = w.write_samples_f32(data);
                                        }
                                    }
                                }
                                RecorderWriteMode::BufferedMemory => {
                                    if let Some(in_memory_audio) = &in_memory_audio {
                                        if let Ok(mut buffer) = in_memory_audio.lock() {
                                            buffer.append_f32_interleaved_mono(
                                                data,
                                                capture_channels,
                                            );
                                        }
                                    }
                                }
                            }

                            if let Some(capture_diagnostics) = &capture_diagnostics {
                                let output_samples = if write_mode
                                    == RecorderWriteMode::BufferedMemory
                                    && capture_channels > 1
                                {
                                    data.len() / capture_channels as usize
                                } else {
                                    data.len()
                                };
                                capture_diagnostics.record_callback(
                                    data.len(),
                                    output_samples,
                                    started.elapsed(),
                                );
                            }
                        }
                    },
                    err_fn,
                    None,
                )
                .map_err(|e| format!("Failed to build F32 stream: {}", e))?
        }
        SampleFormat::I16 => {
            let writer = writer.clone();
            let in_memory_audio = in_memory_audio.clone();
            let capture_diagnostics = capture_diagnostics.clone();
            device
                .build_input_stream(
                    config,
                    move |data: &[i16], _: &_| {
                        if is_recording.load(Ordering::Relaxed) {
                            let started = Instant::now();
                            match write_mode {
                                RecorderWriteMode::Inline => {
                                    if let Some(writer) = &writer {
                                        if let Ok(mut w) = writer.lock() {
                                            let _ = w.write_samples_i16(data);
                                        }
                                    }
                                }
                                RecorderWriteMode::BufferedMemory => {
                                    if let Some(in_memory_audio) = &in_memory_audio {
                                        if let Ok(mut buffer) = in_memory_audio.lock() {
                                            buffer.append_i16_interleaved_mono(
                                                data,
                                                capture_channels,
                                            );
                                        }
                                    }
                                }
                            }

                            if let Some(capture_diagnostics) = &capture_diagnostics {
                                let output_samples = if write_mode
                                    == RecorderWriteMode::BufferedMemory
                                    && capture_channels > 1
                                {
                                    data.len() / capture_channels as usize
                                } else {
                                    data.len()
                                };
                                capture_diagnostics.record_callback(
                                    data.len(),
                                    output_samples,
                                    started.elapsed(),
                                );
                            }
                        }
                    },
                    err_fn,
                    None,
                )
                .map_err(|e| format!("Failed to build I16 stream: {}", e))?
        }
        SampleFormat::U16 => {
            let writer = writer.clone();
            let in_memory_audio = in_memory_audio.clone();
            let capture_diagnostics = capture_diagnostics.clone();
            device
                .build_input_stream(
                    config,
                    move |data: &[u16], _: &_| {
                        if is_recording.load(Ordering::Relaxed) {
                            let started = Instant::now();
                            match write_mode {
                                RecorderWriteMode::Inline => {
                                    if let Some(writer) = &writer {
                                        if let Ok(mut w) = writer.lock() {
                                            let _ = w.write_samples_u16(data);
                                        }
                                    }
                                }
                                RecorderWriteMode::BufferedMemory => {
                                    if let Some(in_memory_audio) = &in_memory_audio {
                                        if let Ok(mut buffer) = in_memory_audio.lock() {
                                            buffer.append_u16_interleaved_mono(
                                                data,
                                                capture_channels,
                                            );
                                        }
                                    }
                                }
                            }

                            if let Some(capture_diagnostics) = &capture_diagnostics {
                                let output_samples = if write_mode
                                    == RecorderWriteMode::BufferedMemory
                                    && capture_channels > 1
                                {
                                    data.len() / capture_channels as usize
                                } else {
                                    data.len()
                                };
                                capture_diagnostics.record_callback(
                                    data.len(),
                                    output_samples,
                                    started.elapsed(),
                                );
                            }
                        }
                    },
                    err_fn,
                    None,
                )
                .map_err(|e| format!("Failed to build U16 stream: {}", e))?
        }
        _ => return Err(format!("Unsupported sample format: {:?}", sample_format)),
    };

    Ok(stream)
}

impl Drop for RecorderState {
    fn drop(&mut self) {
        let _ = self.close_session();
    }
}
