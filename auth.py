#!/usr/bin/env python3
"""
InterpLing — Authentication Dependency Module
Handles JWT verification from Supabase Auth tokens.
Used as a FastAPI dependency to protect API routes.
"""

import os
import jwt
from fastapi import Request, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

# ── Config ────────────────────────────────────────────────────────────────────

SUPABASE_URL = os.getenv("SUPABASE_URL", "https://ubkgcnurzopqyvrryfzx.supabase.co")
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")

# Supabase JWT issuer
SUPABASE_ISSUER = f"{SUPABASE_URL}/auth/v1"

# ── Security scheme ───────────────────────────────────────────────────────────

security = HTTPBearer(auto_error=False)


# ── JWT Verification ────────────────────────────────────────────────────────────

async def get_current_user(request: Request) -> dict:
    """
    FastAPI dependency: extract and verify the Supabase JWT from the
    Authorization header. Returns the user dict (sub, email, etc.).
    Raises 401 if token is missing, expired, or invalid.
    """
    auth_header = request.headers.get("Authorization", "")
    
    if not auth_header.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid Authorization header. Expected: Bearer <token>",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    token = auth_header[7:]  # Remove "Bearer " prefix
    
    if not SUPABASE_JWT_SECRET:
        # In development without JWT secret: accept any token format as demo
        # WARNING: Remove this block in production!
        try:
            # Try to decode without verification (for dev only)
            payload = jwt.decode(token, options={"verify_signature": False})
            return {
                "id": payload.get("sub", "demo-user"),
                "email": payload.get("email", "demo@example.com"),
                "role": payload.get("role", "authenticated"),
            }
        except Exception:
            return {
                "id": "demo-user",
                "email": "demo@example.com",
                "role": "authenticated",
            }
    
    try:
        # Decode and verify the JWT using Supabase's JWT secret
        payload = jwt.decode(
            token,
            SUPABASE_JWT_SECRET,
            algorithms=["HS256"],
            audience="authenticated",
            issuer=SUPABASE_ISSUER,
        )
        
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token: missing subject (sub)",
            )
        
        return {
            "id": user_id,
            "email": payload.get("email", ""),
            "role": payload.get("role", "authenticated"),
            "metadata": payload.get("user_metadata", {}),
        }
    
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired. Please sign in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.InvalidTokenError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {str(e)}",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Token verification failed: {str(e)}",
            headers={"WWW-Authenticate": "Bearer"},
        )


async def get_optional_user(request: Request) -> dict | None:
    """
    Same as get_current_user but returns None instead of 401.
    Useful for routes that work for both logged-in and anonymous users.
    """
    try:
        return await get_current_user(request)
    except HTTPException:
        return None
