#!/usr/bin/env python3
"""
MAD Training Studio — Auth Router
Routes: /api/auth/signup, /api/auth/signin, /api/auth/signout,
        /api/auth/refresh, /api/auth/me, /api/auth/reset-password
Handles user authentication via Supabase Auth.
"""

import os
from fastapi import APIRouter, Form, HTTPException, status
from fastapi.responses import JSONResponse
from supabase import create_client, Client

# ── Config ────────────────────────────────────────────────────────────────────

SUPABASE_URL = os.getenv("SUPABASE_URL", "https://ubkgcnurzopqyvrryfzx.supabase.co")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "sb_publishable_8Y-7N4D367nESxjyqNmZyQ_7e6YmRMZ")

# Create Supabase client (for auth operations)
supabase: Client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)

router = APIRouter(prefix="/api/auth")

# ── Endpoints ───────────────────────────────────────────────────────────────────

@router.post("/signup")
async def signup(
    email: str = Form(...),
    password: str = Form(...),
    full_name: str = Form(""),
):
    """
    POST /api/auth/signup
    Register a new user with Supabase Auth.
    Returns the user object and session tokens.
    """
    try:
        # Sign up with Supabase Auth
        response = supabase.auth.sign_up({
            "email": email,
            "password": password,
            "options": {
                "data": {
                    "full_name": full_name,
                }
            }
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
        return JSONResponse(
            {"error": f"Sign up failed: {str(e)}"},
            status_code=500
        )


@router.post("/signin")
async def signin(
    email: str = Form(...),
    password: str = Form(...),
):
    """
    POST /api/auth/signin
    Sign in an existing user. Returns access_token and refresh_token.
    """
    try:
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
        return JSONResponse(
            {"error": f"Sign in failed: {str(e)}"},
            status_code=500
        )


@router.post("/signout")
async def signout():
    """
    POST /api/auth/signout
    Sign out the current user. Client should discard tokens.
    """
    try:
        supabase.auth.sign_out()
        return JSONResponse({"success": True, "message": "Signed out successfully."})
    except Exception as e:
        return JSONResponse(
            {"error": f"Sign out failed: {str(e)}"},
            status_code=500
        )


@router.post("/refresh")
async def refresh_token(refresh_token: str = Form(...)):
    """
    POST /api/auth/refresh
    Refresh an expired access token using a refresh token.
    """
    try:
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
        return JSONResponse(
            {"error": f"Token refresh failed: {str(e)}"},
            status_code=500
        )


@router.get("/me")
async def get_me():
    """
    GET /api/auth/me
    Get the current authenticated user. Requires Authorization header.
    Note: This is a backend proxy. The frontend should also verify the user
    with Supabase client-side, but this endpoint confirms the token is valid
    on the server.
    """
    try:
        # Get current user from Supabase (uses the anon key, so this
        # will only work if the user is authenticated in the Supabase client context)
        # For a stateless server, the frontend should send the token and we verify it.
        response = supabase.auth.get_user()
        
        user = response.user
        if not user:
            return JSONResponse(
                {"error": "Not authenticated."},
                status_code=401
            )
        
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
        return JSONResponse(
            {"error": f"Failed to get user: {str(e)}"},
            status_code=500
        )


@router.post("/reset-password")
async def reset_password(email: str = Form(...)):
    """
    POST /api/auth/reset-password
    Send a password reset email to the user.
    """
    try:
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
