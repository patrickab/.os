"""Transcribe a meeting recording with speaker turns, runs on the GPU box.

Installed to ~/whisperx/transcribe.py by scripts/setup-whisperx.sh
Usage: transcribe.py <audio> <title>  ->  markdown on stdout
WhisperX: large-v3 transcription, word alignment, pyannote diarization, all local
"""

import logging
import sys
import warnings

warnings.filterwarnings("ignore")  # torchcodec/pyannote noise, audio is passed in memory

import whisperx  # noqa: E402
from whisperx.diarize import DiarizationPipeline  # noqa: E402

# whisperx logs INFO to stdout, which carries the markdown
logging.getLogger("whisperx").setLevel(logging.ERROR)

DEVICE = "cuda"
audio_path, title = sys.argv[1], sys.argv[2]


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def stamp(seconds):
    m, s = divmod(int(seconds), 60)
    h, m = divmod(m, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


audio = whisperx.load_audio(audio_path)

log("transcribing")
model = whisperx.load_model("large-v3", DEVICE, compute_type="float16")
result = model.transcribe(audio, batch_size=16)
language = result["language"]

log(f"aligning words ({language})")
align_model, metadata = whisperx.load_align_model(language_code=language, device=DEVICE)
result = whisperx.align(result["segments"], align_model, metadata, audio, DEVICE)

log("separating speakers")
diarize = DiarizationPipeline(device=DEVICE)
result = whisperx.assign_word_speakers(diarize(audio), result)

# Group consecutive words of the same speaker into turns
# Words without a speaker or timestamp (e.g. numbers) stay with the current turn
turns = []
for segment in result["segments"]:
    for word in segment.get("words", []):
        speaker = word.get("speaker") or (turns[-1]["speaker"] if turns else "SPEAKER_00")
        if not turns or turns[-1]["speaker"] != speaker:
            turns.append({"speaker": speaker, "start": word.get("start", segment["start"]), "words": []})
        turns[-1]["words"].append(word["word"])

print(f"# {title}\n")
for turn in turns:
    print(f"**{turn['speaker']}** [{stamp(turn['start'])}]: {' '.join(turn['words'])}\n")
