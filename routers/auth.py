#!/usr/bin/env python3
"""
MAD Training Studio — Auth Router
Routes: /api/auth/signup, /api/auth/signin, /api/auth/signout,
        /api/auth/refresh, /api/auth/me, /api/auth/reset-password
Handles user authentication via Supabase Auth.

NOTE: In development mode (SUPABASE_JWT_SECRET not set), this router
      returns demo responses so the frontend can be tested without
      a live Supabase connection.
"""

import os, uuid
from fastapi import APIRouter, Form
from fastapi.responses import JSONResponse

# ── Config ────────────────────────────────────────────────────────────────────

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")

# Try to create Supabase client, but don't fail if network is unavailable
_supabase = None

def _get_supabase():
    global _supabase
    if _supabase is not None:
        return _supabase
    
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        return None
    
    try:
        from supabase import create_client
        _supabase = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
        return _supabase
    except Exception as e:
        print(f"[Auth] Supabase client creation failed: {e}")
        return None

router = APIRouter(prefix="/api/auth")

# ── Dev mode helpers ────────────────────────────────────────────────────────────

_is_dev_mode = not SUPABASE_JWT_SECRET

def _dev_user(email: str):
    return {
        "id": str(uuid.uuid4()),
        "email": email,
        "created_at": "2025-01-01T00:00:00Z",
        "metadata": {"full_name": "Dev User"},
    }

def _dev_session(email: str):
    return {
        "access_token": "dev_token_" + str(uuid.uuid4())[:8],
        "refresh_token": "dev_refresh_" + str(uuid.uuid4())[:8],
        "expires_at": 9999999999,
    }

# ── Endpoints ───────────────────────────────────────────────────────────────────

@router.post("/signup")
async def signup(
    email: str = Form(...),
    password: str = Form(...),
    full_name: str = Form(""),
):
    """POST /api/auth/signup — Register a new user."""
    try:
        supabase = _get_supabase()
        if not supabase:
            if _is_dev_mode:
                return JSONResponse({
                    "success": True,
                    "user": _dev_user(email),
                    "session": _dev_session(email),
                    "message": "DEV MODE: Signed up successfully (no Supabase connection).",
                })
            return JSONResponse(
                {"error": "Supabase not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in .env"},
                status_code=500
            )
        
        response = supabase.auth.sign_up({
            "email": email,
            "password": password,
            "options": {"data": {"full_name": full_name}},
        })
        
        user = response.user
        session = response.session
        
        if not user:
            return JSONResponse(
                {"error": "Sign up failed. User may already exist."},
                status_code=400
            )
        
        return JSONResponse({
            "success": True,
            "user": {
                "id": user.id,
                "email": user.email,
                "created_at": user.created_at,
                "metadata": user.user_metadata,
            },
            "session": {
                "access_token": session.access_token if session else None,
                "refresh_token": session.refresh_token if session else None,
                "expires_at": session.expires_at if session else None,
            } if session else None,
            "message": "Check your email to confirm your account." if not session else "Signed up successfully.",
        })
    
    except Exception as e:
        err_str = str(e)
        if "nodename nor servname" in err_str or "getaddrinfo" in err_str:
            if _is_dev_mode:
                return JSONResponse({
                    "success": True,
                    "user": _dev_user(email),
                    "session": _dev_session(email),
                    "message": "DEV MODE: Signed up successfully (Supabase DNS unreachable).",
                })
            return JSONResponse(
                {"error": "Cannot connect to Supabase. Check your internet connection and verify SUPABASE_URL in .env."},
                status_code=503
            )
        return JSONResponse(
            {"error": f"Sign up failed: {err_str}"},
            status_code=500
        )


@router.post("/signin")
async def signin(
    email: str = Form(...),
    password: str = Form(...),
):
    """POST /api/auth/signin — Sign in an existing user."""
    try:
        supabase = _get_supabase()
        if not supabase:
            if _is_dev_mode:
                return JSONResponse({
                    "success": True,
                    "user": _dev_user(email),
                    "session": _dev_session(email),
                })
            return JSONResponse(
                {"error": "Supabase not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in .env"},
                status_code=500
            )
        
        response = supabase.auth.sign_in_with_password({
            "email": email,
            "password": password,
        })
        
        user = response.user
        session = response.session
        
        if not user or not session:
            return JSONResponse(
                {"error": "Invalid email or password."},
                status_code=401
            )
        
        return JSONResponse({
            "success": True,
            "user": {
                "id": user.id,
                "email": user.email,
                "metadata": user.user_metadata,
            },
            "session": {
                "access_token": session.access_token,
                "refresh_token": session.refresh_token,
                "expires_at": session.expires_at,
            },
        })
    
    except Exception as e:
        err_str = str(e)
        if "nodename nor servname" in err_str or "getaddrinfo" in err_str:
            if _is_dev_mode:
                return JSONResponse({
                    "success": True,
                    "user": _dev_user(email),
                    "session": _dev_session(email),
                })
            return JSONResponse(
                {"error": "Cannot connect to Supabase. Check your internet connection and verify SUPABASE_URL in .env."},
                status_code=503
            )
        return JSONResponse(
            {"error": f"Sign in failed: {err_str}"},
            status_code=500
        )


@router.post("/signout")
async def signout():
    """POST /api/auth/signout — Sign out."""
    try:
        supabase = _get_supabase()
        if supabase:
            supabase.auth.sign_out()
        return JSONResponse({"success": True, "message": "Signed out successfully."})
    except Exception as e:
        return JSONResponse({"success": True, "message": "Signed out."})


@router.post("/refresh")
async def refresh_token(refresh_token: str = Form(...)):
    """POST /api/auth/refresh — Refresh access token."""
    try:
        supabase = _get_supabase()
        if not supabase:
            if _is_dev_mode:
                return JSONResponse({
                    "success": True,
                    "session": _dev_session("dev@example.com"),
                })
            return JSONResponse(
                {"error": "Supabase not configured."},
                status_code=500
            )
        
        response = supabase.auth.refresh_session(refresh_token)
        session = response.session
        if not session:
            return JSONResponse(
                {"error": "Invalid or expired refresh token."},
                status_code=401
            )
        
        return JSONResponse({
            "success": True,
            "session": {
                "access_token": session.access_token,
                "refresh_token": session.refresh_token,
                "expires_at": session.expires_at,
            },
        })
    
    except Exception as e:
        err_str = str(e)
        if "nodename nor servname" in err_str or "getaddrinfo" in err_str:
            if _is_dev_mode:
                return JSONResponse({
                    "success": True,
                    "session": _dev_session("dev@example.com"),
                })
            return JSONResponse(
                {"error": "Cannot connect to Supabase."},
                status_code=503
            )
        return JSONResponse(
            {"error": f"Token refresh failed: {err_str}"},
            status_code=500
        )


@router.get("/me")
async def get_me():
    """GET /api/auth/me — Get current authenticated user."""
    try:
        supabase = _get_supabase()
        if not supabase:
            if _is_dev_mode:
                return JSONResponse({
                    "success": True,
                    "user": _dev_user("dev@example.com"),
                })
            return JSONResponse(
                {"error": "Supabase not configured."},
                status_code=500
            )
        
        response = supabase.auth.get_user()
        user = response.user
        if not user:
            return JSONResponse({"error": "Not authenticated."}, status_code=401)
        
        return JSONResponse({
            "success": True,
            "user": {
                "id": user.id,
                "email": user.email,
                "metadata": user.user_metadata,
                "created_at": user.created_at,
            },
        })
    
    except Exception as e:
        err_str = str(e)
        if "nodename nor servname" in err_str or "getaddrinfo" in err_str:
            if _is_dev_mode:
                return JSONResponse({
                    "success": True,
                    "user": _dev_user("dev@example.com"),
                })
            return JSONResponse(
                {"error": "Cannot connect to Supabase."},
                status_code=503
            )
        return JSONResponse(
            {"error": f"Failed to get user: {err_str}"},
            status_code=500
        )


@router.post("/reset-password")
async def reset_password(email: str = Form(...)):
    """POST /api/auth/reset-password — Send reset email."""
    try:
        supabase = _get_supabase()
        if not supabase:
            return JSONResponse(
                {"error": "Supabase not configured."},
                status_code=500
            )
        
        supabase.auth.reset_password_for_email(email)
        return JSONResponse({
            "success": True,
            "message": "Password reset email sent. Check your inbox.",
        })
    except Exception as e:
        return JSONResponse(
            {"error": f"Failed to send reset email: {str(e)}"},
            status_code=500
        )
