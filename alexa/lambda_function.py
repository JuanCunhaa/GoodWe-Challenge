# lambda_function.py
import os
import json
import urllib3
from urllib.parse import urlencode

# ===== Config via variáveis de ambiente =====
LLM_URL = os.environ.get("LLM_URL", "https://good-we-challenge.vercel.app/api/assistant/chat")
LLM_TIMEOUT = float(os.environ.get("LLM_TIMEOUT", "25"))  # segundos
ASSIST_TOKEN = os.environ.get("ASSIST_TOKEN", "").strip()  # obrigatório em modo serviço
PLANT_ID_DEFAULT = (os.environ.get("PLANT_ID") or "").strip()  # opcional

http = urllib3.PoolManager()

# ===== Helpers de resposta Alexa (sem ASK SDK) =====
def speak_response(text, should_end=True, reprompt_text=None, session_attributes=None):
    resp = {
        "version": "1.0",
        "sessionAttributes": session_attributes or {},
        "response": {
            "outputSpeech": {"type": "PlainText", "text": text},
            "shouldEndSession": should_end,
        },
    }
    if not should_end and reprompt_text:
        resp["response"]["reprompt"] = {"outputSpeech": {"type": "PlainText", "text": reprompt_text}}
    return resp

def get_slot(event, name):
    try:
        return event["request"]["intent"]["slots"][name]["value"]
    except Exception:
        return None

def mount_url_with_powerstation(base_url: str, plant_id: str | None) -> str:
    if not plant_id:
        return base_url
    sep = "&" if ("?" in base_url) else "?"
    return f"{base_url}{sep}{urlencode({'powerstation_id': plant_id})}"

def ask_backend(url: str, user_input: str, messages=None, timeout_s: float = LLM_TIMEOUT):
    if messages is None:
        messages = [{"role": "user", "content": user_input}]

    if not ASSIST_TOKEN:
        # Sem token não tem como autenticar no modo serviço
        return 401, "application/json", json.dumps({"ok": False, "error": "ASSIST_TOKEN ausente na Lambda."})

    payload = {
        "input": user_input,
        "messages": messages,
    }

    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": f"Bearer {ASSIST_TOKEN}",
        "User-Agent": "goodwe-alexa-lambda/assistant-chat/1.0",
    }

    resp = http.request(
        "POST",
        url,
        body=json.dumps(payload),
        headers=headers,
        timeout=urllib3.Timeout(connect=timeout_s, read=timeout_s),
        redirect=True,
    )

    raw = resp.data.decode("utf-8", "ignore")
    ctype = resp.headers.get("Content-Type", "")
    if isinstance(ctype, bytes):
        ctype = ctype.decode("utf-8", "ignore")

    # Logs úteis no CloudWatch
    try:
        print("ASSIST POST url:", url)
        print("ASSIST status:", resp.status)
        print("ASSIST headers:", dict(resp.headers))
        print("ASSIST raw head:", (raw[:600] + "...") if len(raw) > 600 else raw)
    except Exception:
        pass

    return resp.status, str(ctype), raw

def extract_answer(content_type: str, raw: str) -> tuple[str | None, dict]:
    data = {}
    ans = None
    if str(content_type).startswith("application/json"):
        try:
            data = json.loads(raw)
        except Exception:
            data = {}

        # prioriza 'answer' (padrão do teu assistant/chat)
        v = data.get("answer")
        if isinstance(v, str) and v.strip():
            ans = v.strip()
        else:
            # pequenos fallbacks comuns
            for k in ("resposta", "message", "output", "text"):
                v2 = data.get(k)
                if isinstance(v2, str) and v2.strip():
                    ans = v2.strip()
                    break

        if not ans and data.get("ok") is False and isinstance(data.get("error"), str):
            ans = f"Erro do serviço: {data['error']}"
    else:
        # se não veio JSON mas é texto
        if raw.strip():
            ans = raw.strip()

    return ans, data

# ===== Handlers =====
def handle_launch_request(event):
    return speak_response("Oi! O que você quer saber da sua energia?", should_end=False, reprompt_text="Pode repetir?")

def handle_route_intent(event):
    # slot 'query' = pergunta do usuário
    user_query = get_slot(event, "query")
    # slot opcional 'planta' para informar por voz o powerstation_id
    plant_slot = (get_slot(event, "planta") or "").strip()

    if not user_query:
        return speak_response("Não entendi. Pode repetir sua pergunta?", should_end=False, reprompt_text="Pode repetir?")

    # define a planta: slot > env > (nenhuma)
    plant_id = plant_slot or PLANT_ID_DEFAULT
    if not plant_id:
        # sem planta definida, avisa de forma amigável
        return speak_response(
            "Preciso saber qual é a sua usina. Diga, por exemplo: usar a planta PWID um dois três. "
            "Ou configure a variável PLANT_ID na Lambda.",
            should_end=False,
            reprompt_text="Qual é o ID da sua usina?"
        )

    url = mount_url_with_powerstation(LLM_URL, plant_id)
    try:
        status, ctype, raw = ask_backend(url, user_query)
        if status == 200:
            answer, data = extract_answer(ctype, raw)
            if not answer:
                # dica de diagnóstico se cair fora do domínio energia
                first_step = ""
                try:
                    if isinstance(data.get("steps"), list) and data["steps"]:
                        first_step = str(data["steps"][0].get("name", "")).lower()
                except Exception:
                    pass

                if first_step.startswith("st_") or "smartthings" in first_step:
                    answer = "Parece que ainda não selecionei a usina correta. Confirme o ID e tente de novo."
                else:
                    answer = "Eu não recebi uma resposta útil agora."
        else:
            answer = f"Erro ao acessar o serviço. Código {status}"

    except Exception as e:
        print("ASSIST error:", str(e))
        answer = "Estou com dificuldade para acessar o serviço no momento."

    if len(answer) > 7900:
        answer = answer[:7900] + "…"
    return speak_response(answer, should_end=True)

def handle_fallback(event):
    return speak_response("Desculpe, não entendi. Pode reformular?", should_end=False, reprompt_text="Pode reformular?")

def handle_session_ended(event):
    return speak_response("Até mais!", should_end=True)

# ===== Lambda entrypoint =====
def lambda_handler(event, context):
    try:
        req_type = event.get("request", {}).get("type")
        if req_type == "LaunchRequest":
            return handle_launch_request(event)
        elif req_type == "IntentRequest":
            intent_name = event["request"]["intent"]["name"]
            if intent_name == "RouteIntent":
                return handle_route_intent(event)
            elif intent_name in ("AMAZON.FallbackIntent", "AMAZON.HelpIntent"):
                return handle_fallback(event)
            else:
                return handle_fallback(event)
        elif req_type == "SessionEndedRequest":
            return handle_session_ended(event)
        else:
            return speak_response("Desculpe, ocorreu um erro ao processar sua solicitação.", should_end=True)
    except Exception as e:
        print("Unhandled error:", str(e))
        return speak_response("Desculpe, tive um problema aqui.", should_end=True)