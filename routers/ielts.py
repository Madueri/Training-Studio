#!/usr/bin/env python3
"""
MAD Training Studio — IELTS router
Routes: /api/ielts-question, /api/ielts-feedback
"""

from fastapi import APIRouter, Form
from fastapi.responses import JSONResponse

from shared import ask_claude, extract_json, save_session

router = APIRouter()

# ── IELTS ─────────────────────────────────────────────────────────────────────

@router.post("/api/ielts-question")
async def ielts_question(module: str = Form(...), difficulty: str = Form("8")):
    try:
        prompts = {
            "speaking": f"""Generate an IELTS Speaking practice set targeting Band {difficulty}.
Return JSON: {{"part1": "Personal question...", "part2": {{"topic": "Describe...", "bullets": ["what it is","when","who with","explain why"]}}, "part3": "Abstract discussion question..."}}""",

            "writing": f"""Generate an IELTS Writing Task 2 question for Band {difficulty} practice (complex topic, discursive).
Return JSON: {{"task": "full question text", "type": "argument/discussion/problem-solution", "word_limit": 250, "time_limit": 40}}""",

            "reading": f"""Generate a short IELTS Academic Reading passage with questions for Band {difficulty} practice.
Return JSON: {{"passage": "200-word passage...", "questions": [{{"q_type": "True/False/NG|matching|gap", "question": "...", "answer": "..."}}]}}""",

            "listening": f"""Create an IELTS Listening practice script for Band {difficulty}.
Return JSON: {{"scenario": "brief context", "transcript": "150-word dialogue or monologue...", "questions": [{{"question": "...", "answer": "..."}}]}}"""
        }
        result = extract_json(ask_claude(prompts.get(module, prompts["speaking"]), 1100))
        return JSONResponse(result)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@router.post("/api/ielts-feedback")
async def ielts_feedback(
    module: str         = Form(...),
    question: str       = Form(...),
    response_text: str  = Form(...)
):
    try:
        criteria = {
            "speaking": "Fluency & Coherence, Lexical Resource, Grammatical Range & Accuracy, Pronunciation",
            "writing":  "Task Achievement, Coherence & Cohesion, Lexical Resource, Grammatical Range & Accuracy",
            "reading":  "Accuracy",
            "listening":"Accuracy"
        }.get(module, "Accuracy")

        result = extract_json(ask_claude(f"""You are a certified IELTS examiner. Grade this {module.upper()} response.

QUESTION / TASK:
{question}

CANDIDATE RESPONSE:
{response_text}

Grade using official IELTS band descriptors for: {criteria}

Return JSON only:
{{
  "overall_band": <5.0–9.0 in 0.5 steps>,
  "sub_scores": {{{{"criterion": band}}}},
  "band_justification": "why this band",
  "strengths": ["specific positives"],
  "weaknesses": ["specific gaps"],
  "model_direction": "how a Band 8 response differs",
  "key_vocabulary": ["5 high-band words/phrases for this topic"],
  "next_step": "one actionable practice task"
}}""", 800))

        save_session("ielts", {"module": module, "question": question[:200],
                               "response": response_text[:400], "feedback": result})
        return JSONResponse(result)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)
