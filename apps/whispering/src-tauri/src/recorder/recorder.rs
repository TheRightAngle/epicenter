use crate::recorder::wav_writer::WavWriter;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{BufferSize, Device, DeviceId, SampleFormat, Stream, SupportedBufferSize};
use log::{debug, error, info, warn};
use serde::Serialize;
use std::any::Any;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, Sender, SyncSender, TrySendError};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

pub type Result<T> = std::result::Result<T, String>;

/// Audio recording metadata — returned to frontend
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioRecording {
    pub audio_data: Vec<f32>, // Empty for file-based recording
    pub sample_rate: u32,
    pub channels: u16,
    pub duration_seconds: f32,
    pub file_path: Option<String>,
}

/// Recording device metadata returned to the frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingDeviceInfo {
    pub id: String,
    pub label: String,
}

/// Commands for the stream-owner worker thread (start/stop/shutdown).
#[derive(Debug)]
enum RecorderCmd {
    Start(mpsc::Sender<()>),
    Stop(mpsc::Sender<()>),
    Shutdown,
}

/// Messages flowing into the writer thread on a single bounded channel.
///
/// The audio callback sends `Samples` variants (high-frequency). The main
/// thread sends `Finalize` on stop and `Shutdown` on teardown. Because
/// everything arrives on one channel, a `Finalize` sent *after* the
/// callback's last `Samples` is guaranteed to be processed *after* all
/// those samples have been ingested — no risk of finalizing before the
/// last batch has been written.
#[derive(Debug)]
enum WriterMsg {
    Samples(CaptureBatch),
    Finalize(SyncSender<WriterFinalizeResult>),
    Shutdown,
}

/// Sample batches handed from the audio callback to the writer thread.
/// Each batch owns its own heap allocation so the callback can drop the
/// CPAL borrow immediately after cloning.
#[derive(Debug)]
enum CaptureBatch {
    F32(Box<[f32]>),
    I16(Box<[i16]>),
    U16(Box<[u16]>),
}

#[derive(Debug)]
struct WriterFinalizeResult {
    /// For buffered mode: all captured samples, collapsed to the output
    /// channel layout and converted to f32. None for inline mode.
    buffered_samples: Option<Vec<f32>>,
    sample_rate: u32,
    output_channels: u16,
    duration_seconds: f32,
    err: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RecorderWriteMode {
    Inline,
    BufferedMemory,
}

/// Target CPAL callback buffer in frames. 2048 frames at 16 kHz = 128 ms
/// per callback, cutting Windows WASAPI's default ~10 ms callback rate by
/// ~12×. Applied to both modes now — the old design only applied it to
/// the buffered path.
const CAPTURE_TARGET_BUFFER_FRAMES: u32 = 2048;
/// Initial capacity hint for the in-memory buffer. 30 seconds covers most
/// push-to-talk sessions without a resize; longer recordings just grow.
const CAPTURE_INITIAL_SECONDS: usize = 30;
/// Buffered mode always collapses to mono on the output side (matches
/// transcriber input). Inline mode preserves capture channels.
const CAPTURE_BUFFERED_OUTPUT_CHANNELS: u16 = 1;
/// How many sample batches the audio callback → writer thread channel
/// can hold. 128 slots × 128 ms per batch ≈ 16 s of jitter tolerance
/// against slow disk I/O. On overflow, oldest-policy isn't possible with
/// std's sync_channel, so we drop the new batch and count it in
/// diagnostics — an audible glitch, but better than stalling the audio
/// thread.
const CAPTURE_CHANNEL_SLOTS: usize = 128;

#[derive(Debug)]
enum InMemoryAudioBuffer {
    F32(Vec<f32>),
    I16(Vec<i16>),
    U16(Vec<u16>),
}

/// Diagnostics written to by the audio callback and read at finalize.
/// Atomic updates only — no locks. Extended with `dropped_batches` so we
/// can surface audio loss when the writer thread can't keep up.
#[derive(Debug, Default)]
struct CaptureDiagnostics {
    callback_count: AtomicU64,
    input_sample_count: AtomicU64,
    output_sample_count: AtomicU64,
    dropped_batches: AtomicU64,
    callback_nanos: AtomicU64,
    max_callback_nanos: AtomicU64,
    callback_thread_id: AtomicU32,
}

#[derive(Debug, Clone, Copy)]
struct CaptureDiagnosticsSnapshot {
    callback_count: u64,
    input_sample_count: u64,
    output_sample_count: u64,
    dropped_batches: u64,
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
        self.max_callback_nanos
            .fetch_max(elapsed_nanos, Ordering::Relaxed);

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

    fn record_dropped(&self) {
        self.dropped_batches.fetch_add(1, Ordering::Relaxed);
    }

    fn snapshot(&self) -> CaptureDiagnosticsSnapshot {
        CaptureDiagnosticsSnapshot {
            callback_count: self.callback_count.load(Ordering::Relaxed),
            input_sample_count: self.input_sample_count.load(Ordering::Relaxed),
            output_sample_count: self.output_sample_count.load(Ordering::Relaxed),
            dropped_batches: self.dropped_batches.load(Ordering::Relaxed),
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

/// Modal state owned exclusively by the writer thread. Because only the
/// writer thread touches this, no lock is needed on the hot path.
enum WriterModeState {
    Inline {
        writer: WavWriter,
    },
    Buffered {
        buffer: InMemoryAudioBuffer,
        sample_rate: u32,
        output_channels: u16,
    },
}

impl WriterModeState {
    fn ingest(&mut self, batch: CaptureBatch, capture_channels: u16) -> Result<()> {
        match (self, batch) {
            (Self::Inline { writer }, CaptureBatch::F32(samples)) => writer
                .write_samples_f32(&samples)
                .map_err(|e| format!("Failed to write f32 samples: {}", e)),
            (Self::Inline { writer }, CaptureBatch::I16(samples)) => writer
                .write_samples_i16(&samples)
                .map_err(|e| format!("Failed to write i16 samples: {}", e)),
            (Self::Inline { writer }, CaptureBatch::U16(samples)) => writer
                .write_samples_u16(&samples)
                .map_err(|e| format!("Failed to write u16 samples: {}", e)),
            (Self::Buffered { buffer, .. }, CaptureBatch::F32(samples)) => {
                buffer.append_f32_interleaved_mono(&samples, capture_channels);
                Ok(())
            }
            (Self::Buffered { buffer, .. }, CaptureBatch::I16(samples)) => {
                buffer.append_i16_interleaved_mono(&samples, capture_channels);
                Ok(())
            }
            (Self::Buffered { buffer, .. }, CaptureBatch::U16(samples)) => {
                buffer.append_u16_interleaved_mono(&samples, capture_channels);
                Ok(())
            }
        }
    }

    fn finalize_and_take(mut self) -> WriterFinalizeResult {
        match &mut self {
            Self::Inline { writer } => {
                let (sample_rate, output_channels, duration_seconds) = writer.get_metadata();
                let err = writer
                    .finalize()
                    .err()
                    .map(|e| format!("Failed to finalize WAV: {}", e));
                WriterFinalizeResult {
                    buffered_samples: None,
                    sample_rate,
                    output_channels,
                    duration_seconds,
                    err,
                }
            }
            Self::Buffered {
                buffer,
                sample_rate,
                output_channels,
            } => {
                let samples = buffer.take_f32_samples();
                let duration_seconds =
                    samples.len() as f32 / (*sample_rate as f32 * *output_channels as f32);
                WriterFinalizeResult {
                    buffered_samples: Some(samples),
                    sample_rate: *sample_rate,
                    output_channels: *output_channels,
                    duration_seconds,
                    err: None,
                }
            }
        }
    }
}

/// Simplified recorder state.
///
/// Ownership model:
/// - The audio callback (on CPAL's own thread) holds a `SyncSender<WriterMsg>`
///   and sends `WriterMsg::Samples(batch)` when recording is active. It
///   never takes a lock, never touches the WAV writer, never does I/O.
///   One heap allocation per batch (to copy the CPAL borrow).
/// - The stream-owner thread holds the `Stream` (required on macOS), and
///   blocks on `cmd_rx.recv()` for start/stop/shutdown commands. It
///   toggles `is_recording` and replies to confirm command reception.
/// - The writer thread owns the `WriterModeState` exclusively. It blocks
///   on the unified `WriterMsg` channel, handling Samples, Finalize, and
///   Shutdown on the same queue. Because control messages ride the same
///   channel as sample batches, a Finalize sent after the last Samples
///   is guaranteed to see those samples ingested first.
pub struct RecorderState {
    cmd_tx: Option<mpsc::Sender<RecorderCmd>>,
    worker_handle: Option<JoinHandle<()>>,
    writer_handle: Option<JoinHandle<()>>,
    /// Main-thread handle to the writer channel — used to send Finalize
    /// and Shutdown. The callback holds its own clone for Samples.
    writer_msg_tx: Option<SyncSender<WriterMsg>>,
    capture_diagnostics: Option<Arc<CaptureDiagnostics>>,
    is_recording: Arc<AtomicBool>,
    sample_rate: u32,
    channels: u16,
    write_mode: RecorderWriteMode,
    file_path: Option<PathBuf>,
    current_recording_id: Option<String>,
}

impl RecorderState {
    pub fn new() -> Self {
        Self {
            cmd_tx: None,
            worker_handle: None,
            writer_handle: None,
            writer_msg_tx: None,
            capture_diagnostics: None,
            is_recording: Arc::new(AtomicBool::new(false)),
            sample_rate: 0,
            channels: 0,
            write_mode: RecorderWriteMode::Inline,
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

    /// Initialize a recording session: build the stream, spawn the writer
    /// thread, and arm both for start/stop commands.
    pub fn init_session(
        &mut self,
        device_identifier: String,
        output_folder: PathBuf,
        recording_id: String,
        preferred_sample_rate: Option<u32>,
        use_buffered_memory: bool,
    ) -> Result<()> {
        // Tear down any pre-existing session first.
        self.close_session()?;

        let file_path = output_folder.join(format!("{}.wav", recording_id));
        let host = cpal::default_host();
        let device = find_device(&host, &device_identifier)?;
        let write_mode = if use_buffered_memory {
            RecorderWriteMode::BufferedMemory
        } else {
            RecorderWriteMode::Inline
        };

        let config = get_optimal_config(&device, preferred_sample_rate)?;
        let sample_format = config.sample_format();
        let sample_rate = config.sample_rate();
        let capture_channels = config.channels();
        let output_channels = match write_mode {
            RecorderWriteMode::Inline => capture_channels,
            RecorderWriteMode::BufferedMemory => CAPTURE_BUFFERED_OUTPUT_CHANNELS,
        };

        // Build the mode-specific writer state. This is owned by the
        // writer thread after we hand it off below.
        let mode_state = match write_mode {
            RecorderWriteMode::Inline => WriterModeState::Inline {
                writer: WavWriter::new(file_path.clone(), sample_rate, capture_channels)
                    .map_err(|e| format!("Failed to create WAV file: {}", e))?,
            },
            RecorderWriteMode::BufferedMemory => {
                let initial_capacity = sample_rate as usize
                    * output_channels as usize
                    * CAPTURE_INITIAL_SECONDS;
                WriterModeState::Buffered {
                    buffer: InMemoryAudioBuffer::new(sample_format, initial_capacity)?,
                    sample_rate,
                    output_channels,
                }
            }
        };

        let stream_config = cpal::StreamConfig {
            channels: capture_channels,
            sample_rate,
            buffer_size: resolve_stream_buffer_size(&config),
        };
        let stream_buffer_size = format!("{:?}", stream_config.buffer_size);

        // Fresh recording flag, ensures no stale reads after a cancel.
        self.is_recording = Arc::new(AtomicBool::new(false));
        let is_recording = self.is_recording.clone();

        let capture_diagnostics = Arc::new(CaptureDiagnostics::default());

        // Channels:
        //   cmd_tx/cmd_rx       — main → stream worker (start/stop/shutdown)
        //   writer_msg_tx/rx    — callback (Samples) + main (Finalize/Shutdown) → writer thread
        //
        // Using a single channel for samples + control messages means
        // Finalize arrives strictly AFTER all Samples queued before it —
        // the writer drains samples first, then finalizes. No risk of
        // the old bug where the writer was blocked reading samples
        // while the main thread waited on a separate control channel.
        let (cmd_tx, cmd_rx) = mpsc::channel::<RecorderCmd>();
        let (writer_msg_tx, writer_msg_rx) =
            mpsc::sync_channel::<WriterMsg>(CAPTURE_CHANNEL_SLOTS);

        let writer_handle = spawn_writer_thread(mode_state, writer_msg_rx, capture_channels);

        // Clones for the stream-owner thread closure.
        let is_recording_for_stream = is_recording.clone();
        let capture_diagnostics_for_stream = capture_diagnostics.clone();
        let writer_msg_tx_for_stream = writer_msg_tx.clone();

        let worker_handle = thread::spawn(move || {
            info!(
                "Recorder stream-owner thread started: os_thread_id={}",
                current_os_thread_id()
            );

            let stream = match build_input_stream(
                &device,
                &stream_config,
                sample_format,
                is_recording_for_stream,
                writer_msg_tx_for_stream,
                capture_diagnostics_for_stream,
            ) {
                Ok(s) => s,
                Err(e) => {
                    error!("Failed to build stream: {}", e);
                    return;
                }
            };

            if let Err(e) = stream.play() {
                error!("Failed to start stream: {}", e);
                return;
            }
            info!("Audio stream started successfully");

            // Block on commands. `recv()` parks the thread — no spinning.
            loop {
                match cmd_rx.recv() {
                    Ok(RecorderCmd::Start(reply_tx)) => {
                        is_recording.store(true, Ordering::Relaxed);
                        info!("Recording started");
                        let _ = reply_tx.send(());
                    }
                    Ok(RecorderCmd::Stop(reply_tx)) => {
                        is_recording.store(false, Ordering::Relaxed);
                        info!("Recording stopped");
                        let _ = reply_tx.send(());
                    }
                    Ok(RecorderCmd::Shutdown) | Err(_) => {
                        info!("Shutting down audio stream-owner thread");
                        break;
                    }
                }
            }
            // Shutdown: drop the stream first so the callback stops
            // immediately, then the callback's writer_msg_tx clone drops
            // naturally. Writer thread still ends via an explicit
            // WriterMsg::Shutdown or Finalize sent by the main thread.
            drop(stream);
        });

        self.cmd_tx = Some(cmd_tx);
        self.worker_handle = Some(worker_handle);
        self.writer_handle = Some(writer_handle);
        self.writer_msg_tx = Some(writer_msg_tx);
        self.capture_diagnostics = Some(capture_diagnostics);
        self.sample_rate = sample_rate;
        self.channels = output_channels;
        self.write_mode = write_mode;
        self.file_path = match write_mode {
            RecorderWriteMode::Inline => Some(file_path),
            RecorderWriteMode::BufferedMemory => None,
        };
        self.current_recording_id = Some(recording_id);

        info!(
            "Recording session initialized: {} Hz, capture_channels={}, output_channels={}, buffer={}, mode={:?}, file: {:?}",
            sample_rate, capture_channels, output_channels, stream_buffer_size, write_mode, self.file_path
        );

        Ok(())
    }

    pub fn start_recording(&mut self) -> Result<()> {
        let tx = self
            .cmd_tx
            .as_ref()
            .ok_or_else(|| "No recording session initialized".to_string())?;

        let (reply_tx, reply_rx) = mpsc::channel();
        tx.send(RecorderCmd::Start(reply_tx))
            .map_err(|e| format!("Failed to send start command: {}", e))?;
        reply_rx
            .recv()
            .map_err(|e| format!("Failed to receive start confirmation: {}", e))?;
        Ok(())
    }

    pub fn stop_recording(&mut self) -> Result<AudioRecording> {
        // 1. Ask the stream-owner thread to stop sampling.
        if let Some(tx) = &self.cmd_tx {
            let (reply_tx, reply_rx) = mpsc::channel();
            tx.send(RecorderCmd::Stop(reply_tx))
                .map_err(|e| format!("Failed to send stop command: {}", e))?;
            reply_rx
                .recv()
                .map_err(|e| format!("Failed to receive stop confirmation: {}", e))?;
        }

        // 2. Ask the writer thread to drain and finalize. It responds on
        //    a oneshot channel with the final buffer + metadata.
        let finalize_result = self.request_finalize()?;

        // 3. Emit diagnostics for the buffered mode (unchanged semantics
        //    from before, just with the new dropped-batches counter).
        if self.write_mode == RecorderWriteMode::BufferedMemory {
            self.emit_buffered_diagnostics();
        }

        // 4. Build the AudioRecording struct for the frontend.
        let recording = match finalize_result.buffered_samples {
            Some(samples) => {
                info!(
                    "Recording stopped (buffered): {:.2}s, {} samples",
                    finalize_result.duration_seconds,
                    samples.len()
                );
                AudioRecording {
                    audio_data: samples,
                    sample_rate: finalize_result.sample_rate,
                    channels: finalize_result.output_channels,
                    duration_seconds: finalize_result.duration_seconds,
                    file_path: None,
                }
            }
            None => {
                let file_path = self
                    .file_path
                    .as_ref()
                    .map(|p| p.to_string_lossy().to_string());
                info!(
                    "Recording stopped (inline): {:.2}s, file: {:?}",
                    finalize_result.duration_seconds, file_path
                );
                AudioRecording {
                    audio_data: Vec::new(),
                    sample_rate: finalize_result.sample_rate,
                    channels: finalize_result.output_channels,
                    duration_seconds: finalize_result.duration_seconds,
                    file_path,
                }
            }
        };

        if let Some(err) = finalize_result.err {
            return Err(err);
        }

        Ok(recording)
    }

    pub fn cancel_recording(&mut self) -> Result<()> {
        let file_path = self.file_path.clone();

        // Signal stop. Ignore any reply errors — we're tearing down.
        if let Some(tx) = &self.cmd_tx {
            let (reply_tx, reply_rx) = mpsc::channel();
            let _ = tx.send(RecorderCmd::Stop(reply_tx));
            let _ = reply_rx.recv();
        }

        // Fully close the session (stream drops, writer thread drains).
        self.close_session()?;

        if let Some(file_path) = &file_path {
            std::fs::remove_file(file_path)
                .map_err(|e| format!("Failed to delete recording file {:?}: {}", file_path, e))?;
            debug!("Deleted recording file: {:?}", file_path);
        }

        Ok(())
    }

    /// Fully tear down the session: stream, stream-owner thread, writer
    /// thread, and any writer state. Accumulates errors and returns them
    /// all so a partial failure is visible to the caller.
    pub fn close_session(&mut self) -> Result<()> {
        let mut cleanup_errors = Vec::new();

        // 1. Tell the stream-owner thread to shut down. It drops the
        //    stream, which stops the callback immediately.
        if let Some(tx) = self.cmd_tx.take() {
            if let Err(e) = tx.send(RecorderCmd::Shutdown) {
                cleanup_errors.push(format!("Failed to send shutdown command: {}", e));
            }
        }
        if let Some(handle) = self.worker_handle.take() {
            if let Err(panic) = handle.join() {
                cleanup_errors.push(format!(
                    "Failed to join stream-owner thread: {}",
                    panic_payload_message(&panic)
                ));
            }
        }

        // 2. Signal the writer thread to exit. Shutdown is benign if
        //    the writer already exited via a Finalize — the send will
        //    just fail silently (channel disconnected).
        if let Some(tx) = self.writer_msg_tx.take() {
            let _ = tx.send(WriterMsg::Shutdown);
        }
        if let Some(handle) = self.writer_handle.take() {
            if let Err(panic) = handle.join() {
                cleanup_errors.push(format!(
                    "Failed to join writer thread: {}",
                    panic_payload_message(&panic)
                ));
            }
        }

        self.capture_diagnostics = None;
        self.sample_rate = 0;
        self.channels = 0;
        self.write_mode = RecorderWriteMode::Inline;
        self.file_path = None;
        self.current_recording_id = None;

        debug!("Recording session closed");
        if cleanup_errors.is_empty() {
            Ok(())
        } else {
            Err(cleanup_errors.join("; "))
        }
    }

    pub fn get_current_recording_id(&self) -> Option<String> {
        if self.is_recording.load(Ordering::Acquire) {
            self.current_recording_id.clone()
        } else {
            None
        }
    }

    /// Send a Finalize request to the writer thread and await its reply.
    /// Because the message travels on the same channel as Samples, the
    /// writer processes every in-flight sample before finalizing — no
    /// race between "last sample" and "finalize".
    ///
    /// After this returns, the writer thread has exited (finalize path
    /// is terminal by design — the session is done). The stream-owner
    /// thread is still alive until `close_session` tears it down.
    fn request_finalize(&mut self) -> Result<WriterFinalizeResult> {
        let msg_tx = self
            .writer_msg_tx
            .as_ref()
            .ok_or_else(|| "No writer thread initialized".to_string())?;

        let (reply_tx, reply_rx) = mpsc::sync_channel::<WriterFinalizeResult>(1);
        msg_tx
            .send(WriterMsg::Finalize(reply_tx))
            .map_err(|e| format!("Failed to send finalize to writer: {}", e))?;
        reply_rx
            .recv()
            .map_err(|e| format!("Writer thread hung up before finalizing: {}", e))
    }

    fn emit_buffered_diagnostics(&self) {
        let Some(diagnostics) = &self.capture_diagnostics else {
            return;
        };
        let snapshot = diagnostics.snapshot();

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
            "Capture diagnostics: thread={}, callbacks={}, dropped={}, input_samples={}, output_samples={}, avg_samples_per_cb={:.2}, avg_cb_ms={:.4}, max_cb_ms={:.4}",
            snapshot.callback_thread_id,
            snapshot.callback_count,
            snapshot.dropped_batches,
            snapshot.input_sample_count,
            snapshot.output_sample_count,
            avg_output_samples_per_callback,
            avg_callback_ms,
            max_callback_ms
        );

        if snapshot.dropped_batches > 0 {
            warn!(
                "Audio capture dropped {} batches; writer thread could not keep up. \
                 This usually means disk I/O is saturated or the system is under heavy load.",
                snapshot.dropped_batches
            );
        }
    }
}

fn spawn_writer_thread(
    mut mode_state: WriterModeState,
    msg_rx: Receiver<WriterMsg>,
    capture_channels: u16,
) -> JoinHandle<()> {
    thread::spawn(move || {
        info!(
            "Recorder writer thread started: os_thread_id={}",
            current_os_thread_id()
        );

        // Single `recv()` loop handling both sample batches and control
        // messages. Because they share a channel, a Finalize queued
        // after the last Samples is guaranteed to be processed AFTER
        // those samples — no lost-audio race at stop.
        let mut finalize_reply: Option<SyncSender<WriterFinalizeResult>> = None;
        loop {
            match msg_rx.recv() {
                Ok(WriterMsg::Samples(batch)) => {
                    if let Err(e) = mode_state.ingest(batch, capture_channels) {
                        error!("Writer thread error: {}", e);
                    }
                }
                Ok(WriterMsg::Finalize(reply)) => {
                    finalize_reply = Some(reply);
                    break;
                }
                Ok(WriterMsg::Shutdown) | Err(_) => {
                    // Channel closed (stream-owner dropped all senders)
                    // or explicit Shutdown without a Finalize. Finalize
                    // anyway so the WAV file isn't left truncated.
                    break;
                }
            }
        }

        let result = mode_state.finalize_and_take();
        if let Some(tx) = finalize_reply {
            let _ = tx.send(result);
        } else if let Some(err) = &result.err {
            error!("Writer thread finalize error (no listener): {}", err);
        }

        info!("Recorder writer thread finished");
    })
}

/// Build the CPAL input stream. Callback is a **single non-blocking
/// producer**: check is_recording, clone the CPAL slice into a Box,
/// wrap in WriterMsg::Samples, and try_send onto the writer channel.
/// No lock, no I/O, no syscalls.
fn build_input_stream(
    device: &Device,
    config: &cpal::StreamConfig,
    sample_format: SampleFormat,
    is_recording: Arc<AtomicBool>,
    writer_msg_tx: SyncSender<WriterMsg>,
    capture_diagnostics: Arc<CaptureDiagnostics>,
) -> Result<Stream> {
    let err_fn = |err| error!("Audio stream error: {}", err);

    macro_rules! build_stream {
        ($sample_ty:ty, $variant:path) => {{
            let is_recording = is_recording.clone();
            let writer_msg_tx = writer_msg_tx.clone();
            let capture_diagnostics = capture_diagnostics.clone();
            device
                .build_input_stream(
                    config,
                    move |data: &[$sample_ty], _: &_| {
                        if !is_recording.load(Ordering::Relaxed) {
                            return;
                        }
                        let started = Instant::now();
                        let batch = $variant(Box::<[$sample_ty]>::from(data));
                        match writer_msg_tx.try_send(WriterMsg::Samples(batch)) {
                            Ok(()) => {
                                capture_diagnostics.record_callback(
                                    data.len(),
                                    data.len(),
                                    started.elapsed(),
                                );
                            }
                            Err(TrySendError::Full(_)) => {
                                capture_diagnostics.record_dropped();
                                capture_diagnostics.record_callback(
                                    data.len(),
                                    0,
                                    started.elapsed(),
                                );
                            }
                            Err(TrySendError::Disconnected(_)) => {
                                // Writer thread is gone; nothing we can
                                // do from the callback. Next stop/cancel
                                // will surface the error.
                            }
                        }
                    },
                    err_fn,
                    None,
                )
                .map_err(|e| format!("Failed to build stream: {}", e))?
        }};
    }

    let stream = match sample_format {
        SampleFormat::F32 => build_stream!(f32, CaptureBatch::F32),
        SampleFormat::I16 => build_stream!(i16, CaptureBatch::I16),
        SampleFormat::U16 => build_stream!(u16, CaptureBatch::U16),
        other => return Err(format!("Unsupported sample format: {:?}", other)),
    };

    Ok(stream)
}

fn find_device(host: &cpal::Host, device_identifier: &str) -> Result<Device> {
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

/// Get an optimal config for voice, honoring an optional preferred sample
/// rate. Preference order: exact match → closest rate within range →
/// config with the widest range → first config available.
fn get_optimal_config(
    device: &Device,
    preferred_sample_rate: Option<u32>,
) -> Result<cpal::SupportedStreamConfig> {
    let default_config = device
        .default_input_config()
        .map_err(|e| format!("Failed to get default config: {}", e))?;

    if preferred_sample_rate.is_none() {
        // cpal 0.17 returns u32 directly from sample_rate() / *_sample_rate();
        // SampleRate is a type alias, not a tuple struct, so no `.0` and no
        // wrapping constructor.
        debug!(
            "Using device default config: {} Hz, {} channels, {:?}",
            default_config.sample_rate(),
            default_config.channels(),
            default_config.sample_format(),
        );
        return Ok(default_config);
    }

    let preferred = preferred_sample_rate.unwrap();
    let supported_configs: Vec<_> = device
        .supported_input_configs()
        .map_err(|e| format!("Failed to query supported configs: {}", e))?
        .collect();

    let mut best_config: Option<cpal::SupportedStreamConfig> = None;

    for config in supported_configs {
        let min_rate = config.min_sample_rate();
        let max_rate = config.max_sample_rate();

        let rate = if preferred >= min_rate && preferred <= max_rate {
            preferred
        } else if preferred < min_rate {
            continue;
        } else {
            min_rate
        };
        best_config = Some(config.with_sample_rate(rate));
    }

    best_config.ok_or_else(|| "Failed to find suitable audio configuration".to_string())
}

/// Choose a buffer size for both modes. We always target larger CPAL
/// buffers now (~128 ms at 16 kHz) because the callback is lightweight
/// enough that there's no reason to push for smaller buffers — they just
/// increase callback overhead without reducing latency (we don't emit to
/// frontend on each callback).
fn resolve_stream_buffer_size(config: &cpal::SupportedStreamConfig) -> BufferSize {
    match config.buffer_size() {
        SupportedBufferSize::Range { min, max } => {
            let preferred = CAPTURE_TARGET_BUFFER_FRAMES.max(*min).min(*max);
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
    // SAFETY: `GetCurrentThreadId` is infallible and has no safety
    // preconditions — it's a simple read from the Windows TEB. The
    // `unsafe` wrapper is required only because `windows-sys` exposes
    // every raw Win32 function as `unsafe`, not because this call is
    // actually unsafe. See:
    // https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getcurrentthreadid
    unsafe { windows_sys::Win32::System::Threading::GetCurrentThreadId() }
}

#[cfg(not(target_os = "windows"))]
fn current_os_thread_id() -> u32 {
    0
}

impl Drop for RecorderState {
    fn drop(&mut self) {
        let _ = self.close_session();
    }
}

#[cfg(test)]
mod tests {
    use super::RecorderState;
    use std::fs;
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
        // A directory path stands in for a real recording file; remove_file
        // fails on directories, which the cancel path must surface.
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
}
