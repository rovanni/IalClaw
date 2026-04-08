---
name: telegram-voice
description: Handle audio messages from Telegram and send voice responses. Trigger when the user sends an audio file (e.g., .ogg), requests a voice response, or when the conversation context implies a voice-based interaction is needed. Use this skill to transcribe incoming audio using Whisper and generate outgoing audio using the neural TTS engine.
---

# Telegram Voice Skill

This skill empowers the agent to handle voice-based communication on Telegram. It provides standardized workflows for Speech-to-Text (STT) and Text-to-Speech (TTS) using local Whisper and neural TTS scripts, following the **Multi-Audio Context Pattern**.

## Core Capabilities

1.  **Incoming Audio Processing (STT)**: Transcribe `.ogg` voice messages from Telegram into text.
2.  **Outgoing Audio Generation (TTS)**: Convert text responses into `.ogg` (opus) formatted voice messages compatible with Telegram.

## Workflow: Processing Incoming Audio

When a user sends an audio file, the system persists it in the `TaskContext`. Follow these steps to process it:

1.  **Context Selection**: Identify the most recent audio file from the `[ARQUIVOS ANEXADOS]` section in your system prompt. Use the file with the **highest sequence number**.
    *Note: The actual file path is not in the prompt for brevity, but you can infer it: `workspace/audios/inputs/<chatId>/<filename>`.*

2.  **Conversion**: Convert the selected `.ogg` file to a 16kHz mono `.wav` file required by Whisper.
    ```bash
    # Substitua [FILE_PATH] pelo caminho real do arquivo identificado
    ffmpeg -y -i [FILE_PATH] -ar 16000 -ac 1 workspace/audios/inputs/input.wav
    ```

3.  **Transcription**: Use the GPU-optimized Whisper CLI to transcribe the audio.
    ```bash
    /home/venus/whisper.cpp/build/bin/whisper-cli -m /home/venus/whisper.cpp/models/ggml-base.bin -f workspace/audios/inputs/input.wav -l pt
    ```
    *Note: The `-l pt` flag ensures transcription in Portuguese.*

4.  **Context Integration**: Use the transcribed text as the user's input for the conversation.

## Workflow: Generating Outgoing Audio

When a voice response is requested or appropriate, follow these steps:

1.  **Speech Generation**: Use the `thorial-tts.sh` script to generate an `.mp3` file.
    ```bash
    /home/venus/.openclaw/workspace/scripts/thorial-tts.sh "[RESPONSE_TEXT]" workspace/audios/outputs/output.mp3
    ```

2.  **Conversion**: Convert the `.mp3` to a Telegram-compatible Voice message (`.ogg` Opus).
    ```bash
    ffmpeg -y -i workspace/audios/outputs/output.mp3 -c:a libopus workspace/audios/outputs/output.ogg
    ```
    *Default Voice: pt-BR-AntonioNeural (Masculino)*

3.  **Delivery**: Inform the user that the voice message is located at `/home/venus/.openclaw/workspace/audios/output.ogg`.

## Strategy for Execution (Cognitive Pattern)

> [!IMPORTANT]
> **Autonomy & Context Awareness**
> - **Always check for attached files**: If a user says "transcreva isso" or "o que eu disse?", look at the `[ARQUIVOS ANEXADOS]` block.
> - **Multi-file resilience**: If multiple files are present, assume the user refers to the most recent one unless specified otherwise.
> - **No Whisper Gate**: Even if Whisper transcription fails or is missing, you have the file path. You can notify the user specifically about the file `[FILENAME]` being saved.

## Instalação e Requisitos

Esta skill requer ferramentas externas instaladas na VPS Linux:

### 1. Whisper (STT)
O motor de transcrição deve estar em `/home/venus/whisper.cpp/build/bin/whisper-cli`.

### 2. Thorial TTS (TTS)
O script de voz deve estar em `/home/venus/.openclaw/workspace/scripts/thorial-tts.sh`.

### 3. FFmpeg
Necessário para conversão de formatos (`sudo apt update && sudo apt install ffmpeg -y`).

## Voice Options

| Language | Gender | Voice Name |
| :--- | :--- | :--- |
| pt-BR | Masculino | pt-BR-AntonioNeural (Default) |
| pt-BR | Feminino | pt-BR-FranciscaNeural |
| en-US | Feminino | en-US-MichelleNeural |
| en-GB | Masculino | en-GB-RyanNeural |

## Important Paths

- **Whisper CLI**: `/home/venus/whisper.cpp/build/bin/whisper-cli`
- **Whisper model (Default)**: `/home/venus/whisper.cpp/models/ggml-base.bin`
- **TTS Script**: `/home/venus/.openclaw/workspace/scripts/thorial-tts.sh`
- **Output Audio Dir**: `/home/venus/.openclaw/workspace/audios/`

## 👤 Autoria
Criada por **Luciano Rovanni do Nascimento**
