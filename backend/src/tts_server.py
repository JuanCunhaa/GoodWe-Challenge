"""
Servidor TTS simples (Flask) com Coqui TTS.

Objetivos:
- Usar um modelo de alta qualidade e gratuito (XTTS v2) para pt‑BR
- Padronizar uma voz para todos (sem escolha no cliente)
- Manter fallback para um modelo leve (VITS pt/cv) caso XTTS falhe

Config por variáveis de ambiente (opcionais):
- TTS_MODEL: nome do modelo primário (default: xtts_v2)
- TTS_MODEL_FALLBACK: modelo de fallback (default: tts_models/pt/cv/vits)
- TTS_LANG: idioma (default: "pt")
- TTS_SPEAKER_WAV: caminho para um .wav de referência (opcional, se quiser travar a voz no XTTS)
- TTS_PORT: porta do Flask (default: 5002)
"""

from flask import Flask, request, send_file, jsonify
from TTS.api import TTS
import tempfile
import os

app = Flask(__name__)

PRIMARY_MODEL = os.getenv("TTS_MODEL", "tts_models/multilingual/multi-dataset/xtts_v2").strip()
FALLBACK_MODEL = os.getenv("TTS_MODEL_FALLBACK", "tts_models/pt/cv/vits").strip()
LANG = os.getenv("TTS_LANG", "pt").strip()
SPEAKER_WAV = os.getenv("TTS_SPEAKER_WAV", "").strip() or None
PORT = int(os.getenv("TTS_PORT", "5002"))

tts_primary = None
tts_fallback = None
primary_is_xtts = "xtts" in PRIMARY_MODEL.lower()

def _load_primary():
    global tts_primary
    if tts_primary is None:
        tts_primary = TTS(model_name=PRIMARY_MODEL, progress_bar=False, gpu=False)

def _load_fallback():
    global tts_fallback
    if tts_fallback is None:
        tts_fallback = TTS(model_name=FALLBACK_MODEL, progress_bar=False, gpu=False)

@app.route("/tts", methods=["POST"])
def tts_endpoint():
    try:
        data = request.get_json(silent=True) or {}
        text = str(data.get("text", "")).strip()
        if not text:
            return jsonify({"ok": False, "error": "text is required"}), 400

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            # 1) Tenta modelo primário
            try:
                _load_primary()
                if primary_is_xtts:
                    # XTTS v2 aceita language e opcionalmente speaker_wav
                    kwargs = {"language": LANG}
                    if SPEAKER_WAV:
                        kwargs["speaker_wav"] = SPEAKER_WAV
                    tts_primary.tts_to_file(text=text, file_path=f.name, **kwargs)
                else:
                    tts_primary.tts_to_file(text=text, file_path=f.name)
            except Exception:
                # 2) Fallback
                try:
                    _load_fallback()
                    tts_fallback.tts_to_file(text=text, file_path=f.name)
                except Exception as e2:
                    return jsonify({"ok": False, "error": str(e2)}), 500

            return send_file(f.name, mimetype="audio/wav")
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

if __name__ == "__main__":
    # Inicia na porta 5002 por padrão (evita conflito com o Node em 3000)
    app.run(port=PORT)
