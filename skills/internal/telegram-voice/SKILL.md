---
name: telegram-voice
description: Handle audio messages from Telegram and send voice responses. Trigger when the user sends an audio file (e.g., .ogg), requests a voice response, or when the conversation context implies a voice-based interaction is needed. Use this skill to transcribe incoming audio using Whisper and generate outgoing audio using the neural TTS engine.
---

# Telegram Voice Skill

This skill empowers the agent to handle voice-based communication on Telegram. It provides standardized workflows for Speech-to-Text (STT) and Text-to-Speech (TTS) using local Whisper and neural TTS scripts.

## Core Capabilities

1.  **Incoming Audio Processing (STT)**: Transcribe `.ogg` voice messages from Telegram into text.
2.  **Outgoing Audio Generation (TTS)**: Convert text responses into `.ogg` (opus) formatted voice messages compatible with Telegram.

## Workflow: Processing Incoming Audio

When a user sends an audio file (typically `.ogg`), follow these steps:

1.  **Conversion**: Convert the Telegram `.ogg` file to a 16kHz mono `.wav` file required by Whisper.
    ```bash
    ffmpeg -i audio.ogg -ar 16000 -ac 1 audio.wav
    ```

2.  **Transcription**: Use the GPU-optimized Whisper CLI to transcribe the audio.
    ```bash
    /home/rover/whisper.cpp/build/bin/whisper-cli -m /home/rover/whisper.cpp/models/ggml-base.bin -f audio.wav -l pt
    ```
    *Note: The `-l pt` flag ensures transcription in Portuguese.*

3.  **Context Integration**: Use the transcribed text as the user's input for the conversation.

## Workflow: Generating Outgoing Audio

When a voice response is requested or appropriate (e.g., responding to a voice message), follow these steps:

1.  **Speech Generation**: Use the `thorial-tts.sh` script to generate an `.mp3` file.
    ```bash
    /home/rover/.openclaw/workspace/scripts/thorial-tts.sh "[RESPONSE_TEXT]" /tmp/output.mp3
    ```
    *Default Voice: pt-BR-AntonioNeural (Masculino)*

2.  **Telegram Conversion**: Convert the `.mp3` to a Telegram-compatible `.ogg` (opus) file.
    ```bash
    ffmpeg -i /tmp/output.mp3 -c:a libopus -b:a 64k /home/rover/.openclaw/workspace/audios/output.ogg -y
    ```

3.  **Delivery**: Inform the user that the voice message is located at `/home/rover/.openclaw/workspace/audios/output.ogg`.

## Voice Options

If the user requests a different voice, adjust the `thorial-tts.sh` parameters if supported, or inform the user of availability:

| Language | Gender | Voice Name |
| :--- | :--- | :--- |
| pt-BR | Masculino | pt-BR-AntonioNeural (Default) |
| pt-BR | Feminino | pt-BR-FranciscaNeural |
| en-US | Feminino | en-US-MichelleNeural |
| en-GB | Masculino | en-GB-RyanNeural |

## Important Paths

- **Whisper CLI**: `/home/rover/whisper.cpp/build/bin/whisper-cli`
- **Whisper Models**:
  - `/home/rover/whisper.cpp/models/ggml-base.bin` (Default, Fast)
  - `/home/rover/whisper.cpp/models/ggml-small.bin`
  - `/home/rover/whisper.cpp/models/ggml-medium.bin`
  - `/home/rover/whisper.cpp/models/ggml-large.bin` (Best quality)
- **TTS Script**: `/home/rover/.openclaw/workspace/scripts/thorial-tts.sh`
  - Uses `node tts-converter.js` internally.
  - Default: `pt-BR-AntonioNeural`, `--rate -5%`.
- **Output Audio Dir**: `/home/rover/.openclaw/workspace/audios/`
