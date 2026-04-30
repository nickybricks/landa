"""Landa Streamer — local Whisper transcription via pywhispercpp + sounddevice.

Provides the `LandaStreamer` class used by `landa_core.py` as the "landa-base"
transcription provider. Also runnable directly (`python -m landa_streamer`) as a
CLI mic test.
"""
from __future__ import annotations

import os
import sys
import tempfile
import time
from pathlib import Path
from typing import Union

import numpy as np
import sounddevice as sd
from scipy.io import wavfile


SAMPLE_RATE = 16000
MODEL_FILENAME = "landa-base.bin"


def _resolve_model_path() -> Path:
    override = Path.home() / ".landa" / "models" / MODEL_FILENAME
    if override.exists():
        return override

    bundle_root = getattr(sys, "_MEIPASS", None)
    if bundle_root:
        bundled = Path(bundle_root) / "models" / MODEL_FILENAME
        if bundled.exists():
            return bundled

    dev = Path(__file__).resolve().parent / "models" / MODEL_FILENAME
    return dev


class LandaStreamer:
    _model_instance = None

    def __init__(self, model_path: Path | None = None, sample_rate: int = SAMPLE_RATE):
        self.model_path = Path(model_path) if model_path else _resolve_model_path()
        self.sample_rate = sample_rate
        self._stream: sd.InputStream | None = None
        self._frames: list[np.ndarray] = []

    def _ensure_model(self):
        if LandaStreamer._model_instance is not None:
            return LandaStreamer._model_instance
        if not self.model_path.exists():
            raise FileNotFoundError(f"Landa model not found: {self.model_path}")
        from pywhispercpp.model import Model as WhisperModel
        print(f"[LandaStreamer] Loading model: {self.model_path}")
        LandaStreamer._model_instance = WhisperModel(str(self.model_path))
        return LandaStreamer._model_instance

    def start(self) -> None:
        if self._stream is not None:
            raise RuntimeError("LandaStreamer already recording")
        self._frames = []
        self._stream = sd.InputStream(
            samplerate=self.sample_rate,
            channels=1,
            dtype="float32",
            callback=lambda indata, frames, time_info, status: self._frames.append(indata.copy()),
        )
        self._stream.start()

    def stop(self) -> tuple[str, str | None, dict]:
        if self._stream is None:
            raise RuntimeError("LandaStreamer not recording")
        self._stream.stop()
        self._stream.close()
        self._stream = None
        if not self._frames:
            return "", None, {"latency_ms": 0, "duration_seconds": 0.0}
        audio = np.concatenate(self._frames, axis=0).flatten()
        self._frames = []
        return self.transcribe(audio, sample_rate=self.sample_rate)

    def transcribe(
        self,
        audio: Union[np.ndarray, str, os.PathLike],
        sample_rate: int = SAMPLE_RATE,
        language: str | None = None,
    ) -> tuple[str, str | None, dict]:
        model = self._ensure_model()

        cleanup_path: str | None = None
        if isinstance(audio, np.ndarray):
            tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
            tmp.close()
            cleanup_path = tmp.name
            wavfile.write(tmp.name, sample_rate, np.int16(audio * 32767))
            wav_path = tmp.name
        else:
            wav_path = str(audio)

        try:
            import contextlib
            import wave
            try:
                with contextlib.closing(wave.open(wav_path, "r")) as wf:
                    duration_seconds = wf.getnframes() / wf.getframerate()
            except Exception:
                duration_seconds = 0.0

            t0 = time.time()
            detected_language: str | None = None
            if language and language != "auto":
                detected_language = language
            else:
                try:
                    (detected_code, prob), _ = model.auto_detect_language(wav_path)
                    detected_language = detected_code
                    print(f"[LandaStreamer] auto_detect_language: {detected_code} (prob={prob:.2f})")
                except Exception as e:
                    print(f"[LandaStreamer] auto_detect_language failed: {e}")

            kwargs = {"no_context": True}
            if detected_language:
                kwargs["language"] = detected_language
            segments = model.transcribe(wav_path, **kwargs)
            text = " ".join(seg.text for seg in segments).strip()
            latency_ms = round((time.time() - t0) * 1000)
            usage = {
                "step": "transcription",
                "model": "landa-base",
                "input_tokens": 0,
                "output_tokens": 0,
                "duration_seconds": round(duration_seconds, 2),
                "latency_ms": latency_ms,
                "cost": 0.0,
                "local": True,
            }
            return text, detected_language, usage
        finally:
            if cleanup_path:
                try:
                    os.unlink(cleanup_path)
                except OSError:
                    pass


def _cli() -> None:
    streamer = LandaStreamer()
    print(f"[LandaStreamer] Model path: {streamer.model_path}")
    print("[LandaStreamer] Press Enter to start recording...")
    input()
    streamer.start()
    print("[LandaStreamer] Recording... Press Enter to stop.")
    input()
    text, lang, usage = streamer.stop()
    print(f"[LandaStreamer] Language: {lang}")
    print(f"[LandaStreamer] Text: {text}")
    print(f"[LandaStreamer] Latency: {usage['latency_ms']} ms (audio {usage['duration_seconds']}s)")


if __name__ == "__main__":
    _cli()
