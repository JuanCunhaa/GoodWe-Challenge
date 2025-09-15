# Salve como tts_server.py
from flask import Flask, request, send_file
from TTS.api import TTS
import tempfile

app = Flask(__name__)
tts = TTS(model_name="tts_models/pt/cv/vits", progress_bar=False, gpu=False)

@app.route("/tts", methods=["POST"])
def tts_endpoint():
    text = request.json.get("text", "")
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        tts.tts_to_file(text=text, file_path=f.name)
        return send_file(f.name, mimetype="audio/wav")

if __name__ == "__main__":
    app.run(port=3000)